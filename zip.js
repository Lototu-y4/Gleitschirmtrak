/* ZIP-Dateien schreiben und lesen (Sicherung des Logbuchs). Ohne Abhängigkeiten; läuft im Browser (globales Objekt
   "Zip") und in Node (require("./zip.js")).
   Schreiben: jede Datei mit Deflate (CompressionStream "deflate-raw"), wenn der Browser das kann und es kleiner wird,
   sonst unkomprimiert ("stored"). Dateinamen in UTF-8 (Bit 11). Ergebnis lässt sich mit jedem Entpacker öffnen.
   Schrittweise (packer): jede Datei wird sofort gepackt, unkomprimiert liegt immer nur eine im Speicher.
   Lesen: über das zentrale Verzeichnis am Dateiende (dort stehen die Grössen auch bei Einträgen mit Datendeskriptor).
   Entpackt wird nur, was gelesen wird (oeffnen → lies). Methoden 0 (stored) und 8 (deflate, braucht
   DecompressionStream). Prüfsumme (CRC-32) wird kontrolliert.
   Nicht unterstützt: ZIP64 (über 4 GB oder 65535 Dateien), Verschlüsselung, mehrteilige Archive. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Zip = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SIG_LOKAL = 0x04034b50, SIG_ZENTRAL = 0x02014b50, SIG_ENDE = 0x06054b50;
  const UTF8 = 0x0800;

  const TABELLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = TABELLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const kannPacken = () => { try { return typeof CompressionStream === "function" && !!new CompressionStream("deflate-raw"); } catch (e) { return false; } };
  const kannEntpacken = () => { try { return typeof DecompressionStream === "function" && !!new DecompressionStream("deflate-raw"); } catch (e) { return false; } };
  async function durchStrom(bytes, strom) {
    const r = new Response(new Blob([bytes]).stream().pipeThrough(strom));
    return new Uint8Array(await r.arrayBuffer());
  }

  // Datum und Zeit im MS-DOS-Format (Ortszeit, 2 s Auflösung, ab 1980)
  function dosZeit(d) {
    if (!(d instanceof Date) || isNaN(d)) d = new Date();
    const j = Math.min(2107, Math.max(1980, d.getFullYear()));
    return { zeit: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), datum: ((j - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }

  function verbinden(teile) {
    const n = teile.reduce((s, t) => s + t.length, 0), out = new Uint8Array(n);
    let p = 0;
    for (const t of teile) { out.set(t, p); p += t.length; }
    return out;
  }

  /* Schrittweise packen:
       const p = packer();  await p.hinzu({name, daten (Text oder Uint8Array), zeit (Date oder ms, sonst jetzt)});  …
       const teile = p.ende();   // [Uint8Array] in Reihenfolge, z. B. für new Blob(teile)
     hinzu → {groesse, gepackt} in Bytes.  opts: {komprimieren (Standard true)} */
  function packer(opts) {
    opts = opts || {};
    const deflate = opts.komprimieren !== false && kannPacken();
    const enc = new TextEncoder();
    const teile = [], zentral = [], namen = new Set();
    let pos = 0, anzahl = 0, fertig = false;
    async function hinzu(d) {
      if (fertig) throw new Error("ZIP-Datei ist schon abgeschlossen");
      if (anzahl >= 0xFFFF) throw new Error("zu viele Dateien für eine ZIP-Datei");
      if (namen.has(d.name)) throw new Error("Dateiname doppelt: " + d.name);
      namen.add(d.name);
      const name = enc.encode(d.name);
      if (!name.length || name.length > 0xFFFF) throw new Error("ungültiger Dateiname");
      const roh = typeof d.daten === "string" ? enc.encode(d.daten) : d.daten;
      const crc = crc32(roh);
      let methode = 0, daten = roh;
      if (deflate && roh.length > 100) {
        const z = await durchStrom(roh, new CompressionStream("deflate-raw"));
        if (z.length < roh.length) { methode = 8; daten = z; }
      }
      if (roh.length > 0xFFFFFFFE || pos + 30 + name.length + daten.length > 0xFFFFFFFE) throw new Error("Sicherung zu gross (über 4 GB)");
      const { zeit, datum } = dosZeit(d.zeit === undefined ? new Date() : new Date(d.zeit));
      const l = new DataView(new ArrayBuffer(30));
      l.setUint32(0, SIG_LOKAL, true); l.setUint16(4, 20, true); l.setUint16(6, UTF8, true); l.setUint16(8, methode, true);
      l.setUint16(10, zeit, true); l.setUint16(12, datum, true); l.setUint32(14, crc, true);
      l.setUint32(18, daten.length, true); l.setUint32(22, roh.length, true); l.setUint16(26, name.length, true);
      teile.push(new Uint8Array(l.buffer), name, daten === d.daten ? daten.slice() : daten);   // fremdes Array nicht übernehmen
      const z = new DataView(new ArrayBuffer(46));
      z.setUint32(0, SIG_ZENTRAL, true); z.setUint16(4, 20, true); z.setUint16(6, 20, true); z.setUint16(8, UTF8, true); z.setUint16(10, methode, true);
      z.setUint16(12, zeit, true); z.setUint16(14, datum, true); z.setUint32(16, crc, true);
      z.setUint32(20, daten.length, true); z.setUint32(24, roh.length, true); z.setUint16(28, name.length, true);
      z.setUint32(42, pos, true);
      zentral.push(new Uint8Array(z.buffer), name);
      pos += 30 + name.length + daten.length;
      anzahl++;
      return { groesse: roh.length, gepackt: daten.length };
    }
    function ende() {
      if (!fertig) {
        fertig = true;
        const zGroesse = zentral.reduce((s, t) => s + t.length, 0);
        const e = new DataView(new ArrayBuffer(22));
        e.setUint32(0, SIG_ENDE, true); e.setUint16(8, anzahl, true); e.setUint16(10, anzahl, true);
        e.setUint32(12, zGroesse, true); e.setUint32(16, pos, true);
        for (const t of zentral) teile.push(t);
        teile.push(new Uint8Array(e.buffer));
      }
      return teile;
    }
    return { hinzu, ende };
  }
  // Alles auf einmal: dateien wie bei hinzu  →  Uint8Array mit der ZIP-Datei
  async function packen(dateien, opts) {
    const p = packer(opts);
    for (const d of dateien) await p.hinzu(d);
    return verbinden(p.ende());
  }

  /* ZIP-Datei öffnen, zuerst nur das Verzeichnis lesen. bytes: Uint8Array oder ArrayBuffer.
     →  {namen: [Name je Datei, ohne Ordner], hat(name), lies(name, {maxGroesse}) → {name, daten: Uint8Array} oder {name, fehler}}
     Fehler im Aufbau der ganzen Datei werfen eine Ausnahme, Fehler einer einzelnen Datei kommen als {fehler}. */
  function oeffnen(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xFFFF); i--) if (dv.getUint32(i, true) === SIG_ENDE) { e = i; break; }
    if (e < 0) throw new Error("keine ZIP-Datei");
    const anzahl = dv.getUint16(e + 10, true), zPos = dv.getUint32(e + 16, true);
    if (anzahl === 0xFFFF || zPos === 0xFFFFFFFF) throw new Error("ZIP64 wird nicht unterstützt");
    if (dv.getUint16(e + 4, true) !== 0 || dv.getUint16(e + 8, true) !== anzahl) throw new Error("mehrteilige ZIP-Dateien werden nicht unterstützt");
    const utf8 = new TextDecoder("utf-8"), liste = [], nachName = new Map();
    let p = zPos;
    for (let k = 0; k < anzahl; k++) {
      if (p + 46 > b.length || dv.getUint32(p, true) !== SIG_ZENTRAL) throw new Error("ZIP-Verzeichnis beschädigt");
      const flags = dv.getUint16(p + 8, true);
      const nL = dv.getUint16(p + 28, true), xL = dv.getUint16(p + 30, true), cL = dv.getUint16(p + 32, true);
      const nb = b.subarray(p + 46, p + 46 + nL);
      const x = { name: (flags & UTF8 ? utf8.decode(nb) : String.fromCharCode(...nb)).replace(/\\/g, "/"),   // Windows-Packer schreiben teils "\"
                  flags, methode: dv.getUint16(p + 10, true), crc: dv.getUint32(p + 16, true),
                  kGroesse: dv.getUint32(p + 20, true), groesse: dv.getUint32(p + 24, true), off: dv.getUint32(p + 42, true) };
      p += 46 + nL + xL + cL;
      if (x.name.endsWith("/")) continue;
      liste.push(x);
      if (!nachName.has(x.name)) nachName.set(x.name, x);
    }
    async function liesEintrag(x, opts) {
      opts = opts || {};
      const name = x.name, fehler = (text) => ({ name, fehler: text });
      if (x.flags & 1) return fehler("verschlüsselt");
      if (opts.maxGroesse && x.groesse > opts.maxGroesse) return fehler("zu gross");
      if (x.off + 30 > b.length || dv.getUint32(x.off, true) !== SIG_LOKAL) return fehler("Eintrag beschädigt");
      const start = x.off + 30 + dv.getUint16(x.off + 26, true) + dv.getUint16(x.off + 28, true);
      if (start + x.kGroesse > b.length) return fehler("Datei abgeschnitten");
      const roh = b.subarray(start, start + x.kGroesse);
      let daten;
      if (x.methode === 0) daten = roh.slice();
      else if (x.methode === 8) {
        if (!kannEntpacken()) return fehler("Entpacken kann dieser Browser nicht");
        try { daten = await durchStrom(roh, new DecompressionStream("deflate-raw")); } catch (err) { return fehler("nicht entpackbar"); }
      } else return fehler("Kompressionsart " + x.methode + " nicht unterstützt");
      if (daten.length !== x.groesse || crc32(daten) !== x.crc) return fehler("Prüfsumme falsch (Datei beschädigt)");
      return { name, daten };
    }
    return {
      namen: liste.map(x => x.name),
      hat: (name) => nachName.has(name),
      lies: (name, opts) => nachName.has(name) ? liesEintrag(nachName.get(name), opts) : Promise.resolve({ name, fehler: "fehlt" }),
      alle: (opts) => liste.map(x => () => liesEintrag(x, opts)),   // je Datei eine Funktion, die sie entpackt
    };
  }
  /* Alles auf einmal entpacken.  opts: {nur(name) → true für Einträge, die entpackt werden sollen, maxGroesse (Bytes)}
     →  [{name, daten: Uint8Array}] bzw. [{name, fehler}] für einen einzelnen unlesbaren Eintrag. Ordner werden übersprungen. */
  async function entpacken(bytes, opts) {
    opts = opts || {};
    const z = oeffnen(bytes), out = [], lesen = z.alle(opts);
    for (const [k, name] of z.namen.entries()) if (!opts.nur || opts.nur(name)) out.push(await lesen[k]());
    return out;
  }

  // Beginnt die Datei wie eine ZIP-Datei?
  const istZip = (b) => b && b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);

  return { crc32, packer, packen, oeffnen, entpacken, istZip, kannPacken, kannEntpacken };
});
