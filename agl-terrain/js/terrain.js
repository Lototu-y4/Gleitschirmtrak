// terrain.js – Geländehöhe aus den WGS84-Kacheln (swisstopo swissALTIRegio). ES-Modul, keine Abhängigkeiten.
// Gleiche Formeln und gleiche Rechenreihenfolge wie scripts/agl/terrain.py (Parität per Test geprüft).
//
//   import { ladeIndex, Gelaende } from "./terrain.js";
//   const g = new Gelaende(await ladeIndex("tiles_25m/"), "tiles_25m/");
//   await g.ladeUmgebung(lat, lon);   // Kachel laden (danach im Speicher)
//   const h = g.hoeheAn(lat, lon);    // Meter (LN02) oder null
//
// Die App (../../index.html) enthält dieselbe Logik im CORE-Block (terrainLocate/terrainSample).

export async function ladeIndex(basis) {
  const res = await fetch(basis + "index.json");
  if (!res.ok) throw new Error("index.json: HTTP " + res.status);
  return res.json();
}

async function ladeBytesFetch(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(url + ": HTTP " + res.status);
  return res.arrayBuffer();
}

// gzip an den Magic-Bytes erkennen; fehlen sie, hat der Server schon entpackt (Content-Encoding: gzip)
async function entpacke(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
    if (typeof DecompressionStream !== "undefined") {
      const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    const zlib = await import("node:zlib");     // Node ohne DecompressionStream
    return new Uint8Array(zlib.gunzipSync(u8));
  }
  return u8;
}

export class Gelaende {
  constructor(index, basis, ladeBytes = ladeBytesFetch, cacheMax = 32) {
    const g = index.grid;
    this.index = index;
    this.basis = basis;
    this.ladeBytes = ladeBytes;
    this.cacheMax = cacheMax;
    this.tr = g.cells_per_tile_lat;
    this.tc = g.cells_per_tile_lon;
    this.latTop = g.lat_top;
    this.lonLeft = g.lon_left;
    this.dlat = g.tile_deg / this.tr;
    this.dlon = g.tile_deg / this.tc;
    this.nodata = index.nodata ?? 65535;
    this.cache = new Map();
  }

  _ort(lat, lon, interpol) {
    const rf = (this.latTop - lat) / this.dlat;
    const cf = (lon - this.lonLeft) / this.dlon;
    if (!Number.isFinite(rf) || !Number.isFinite(cf)) return null;
    if (!interpol) {
      const R = Math.floor(rf + 0.5), C = Math.floor(cf + 0.5);
      const ty = Math.floor(R / this.tr), tx = Math.floor(C / this.tc);
      return { key: ty + "_" + tx, r: R - ty * this.tr, c: C - tx * this.tc, nearest: true };
    }
    const R0 = Math.floor(rf), C0 = Math.floor(cf);
    const ty = Math.floor(R0 / this.tr), tx = Math.floor(C0 / this.tc);
    return { key: ty + "_" + tx, r: R0 - ty * this.tr, c: C0 - tx * this.tc, fr: rf - R0, fc: cf - C0, nearest: false };
  }

  async _ladeKachel(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    let arr = null;
    if (key in this.index.kacheln) {
      const buf = await this.ladeBytes(this.basis + "tiles/" + key + ".u16.gz");
      if (buf) {
        const u8 = await entpacke(buf);
        const n = (this.tr + 1) * (this.tc + 1);
        if (u8.byteLength !== n * 2) throw new Error(key + ": unerwartete Grösse " + u8.byteLength);
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        arr = new Uint16Array(n);
        for (let i = 0; i < n; i++) arr[i] = dv.getUint16(i * 2, true);
      }
    }
    if (this.cache.size >= this.cacheMax) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, arr);
    return arr;
  }

  async ladeUmgebung(lat, lon) {
    const o = this._ort(lat, lon, true);
    if (o) await this._ladeKachel(o.key);
    const n = this._ort(lat, lon, false);
    if (n && n.key !== (o && o.key)) await this._ladeKachel(n.key);
  }

  // Synchron, liest nur aus dem Speicher. Meter oder null.
  hoeheAn(lat, lon, interpol = true) {
    const o = this._ort(lat, lon, interpol);
    if (!o) return null;
    const a = this.cache.get(o.key);
    if (!a) return null;
    const W = this.tc + 1, i = o.r * W + o.c, nd = this.nodata;
    if (o.nearest) return a[i] === nd ? null : a[i] / 10;
    const v00 = a[i], v01 = a[i + 1], v10 = a[i + W], v11 = a[i + W + 1];
    if (v00 === nd || v01 === nd || v10 === nd || v11 === nd) return null;
    const fr = o.fr, fc = o.fc;
    return ((1 - fr) * ((1 - fc) * v00 + fc * v01) + fr * ((1 - fc) * v10 + fc * v11)) / 10;
  }

  async hoeheAnAsync(lat, lon, interpol = true) {
    const o = this._ort(lat, lon, interpol);
    if (!o) return null;
    await this._ladeKachel(o.key);
    return this.hoeheAn(lat, lon, interpol);
  }
}
