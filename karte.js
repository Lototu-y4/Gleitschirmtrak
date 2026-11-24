/* Karte für die Fluganzeige (Eigenbau, kein zugelassenes Navigationsgerät).
   Ohne Abhängigkeiten; läuft im Browser (globales Objekt "Karte") und in Node (require("./karte.js")).

   Teil 1: reine Berechnungen (in Node getestet, tests/karte.test.js)
     - Web-Mercator-Weltpixel (256-px-Kacheln wie bei wmts.geo.admin.ch, EPSG:3857)
     - Gebiet Schweiz (mit Rand), Kacheln für eine gedrehte Ansicht und für einen Umkreis
     - Distanz, Peilung, nötige Gleitzahl
     - Schweizer Koordinaten LV95/LV03 ↔ WGS84 (Näherungsformeln von swisstopo, ca. 1 m genau)
     - Koordinaten aus Text lesen
   Teil 2: zeichnen auf ein Canvas (nur im Browser). Die Kacheln liefert eine Funktion von aussen,
   Speicher und Netz liegen in index.html.

   Winkel: Kurs und Peilung in Grad, 0 = Nord, im Uhrzeigersinn. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Karte = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KACHEL = 256;                    // Pixel pro Kachel
  const ERDRADIUS = 6371008.8;           // m, mittlerer Erdradius (für Distanzen)
  const MERC_R = 6378137;                // m, Radius der Web-Mercator-Kugel (für den Massstab)
  const RAD = Math.PI / 180;

  // Schweiz mit etwa 10 km Rand (wie die Geländedaten). Ausserhalb werden keine Kacheln geladen.
  const GEBIET = Object.freeze({ latMin: 45.72, latMax: 47.90, lonMin: 5.85, lonMax: 10.60 });
  const MITTE_CH = Object.freeze({ lat: 46.80, lon: 8.23 });

  // Kartenebenen von wmts.geo.admin.ch (swisstopo, BAZL). zMax = höchste vorhandene Stufe, darüber wird vergrössert.
  const EBENEN = Object.freeze({
    topo: Object.freeze({ name: "Landeskarte", layer: "ch.swisstopo.pixelkarte-farbe", ext: "jpeg", zMin: 7, zMax: 16,
                          zoomMin: 8, zoomMax: 15, zoomStandard: 12, quelle: "© swisstopo" }),
    luft: Object.freeze({ name: "Segelflugkarte", layer: "ch.bazl.segelflugkarte", ext: "png", zMin: 6, zMax: 12,
                          zoomMin: 8, zoomMax: 13, zoomStandard: 11, quelle: "© BAZL, swisstopo" }),
  });
  const kachelUrl = (ebene, z, x, y) => {
    const e = EBENEN[ebene];
    return `https://wmts.geo.admin.ch/1.0.0/${e.layer}/default/current/3857/${z}/${x}/${y}.${e.ext}`;
  };
  const kachelSchluessel = (ebene, z, x, y) => ebene + "/" + z + "/" + x + "/" + y;

  /* ---------- Web Mercator ---------- */
  const weltGroesse = (z) => KACHEL * Math.pow(2, z);
  function lonZuX(lon, z) { return (lon + 180) / 360 * weltGroesse(z); }
  function latZuY(lat, z) {
    const s = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * RAD);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * weltGroesse(z);
  }
  function xZuLon(x, z) { return x / weltGroesse(z) * 360 - 180; }
  function yZuLat(y, z) { const n = Math.PI - 2 * Math.PI * y / weltGroesse(z); return Math.atan(Math.sinh(n)) / RAD; }
  const zuWelt = (lat, lon, z) => ({ x: lonZuX(lon, z), y: latZuY(lat, z) });
  const ausWelt = (x, y, z) => ({ lat: yZuLat(y, z), lon: xZuLon(x, z) });
  // Meter am Boden pro Weltpixel bei Breite lat
  const meterProPixel = (lat, z) => 2 * Math.PI * MERC_R * Math.cos(lat * RAD) / weltGroesse(z);

  const imGebiet = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= GEBIET.latMin && lat <= GEBIET.latMax && lon >= GEBIET.lonMin && lon <= GEBIET.lonMax;

  // Kachelbereich des Gebiets auf Stufe z
  function gebietKacheln(z) {
    return { x0: Math.floor(lonZuX(GEBIET.lonMin, z) / KACHEL), x1: Math.floor(lonZuX(GEBIET.lonMax, z) / KACHEL),
             y0: Math.floor(latZuY(GEBIET.latMax, z) / KACHEL), y1: Math.floor(latZuY(GEBIET.latMin, z) / KACHEL) };
  }
  const kachelImGebiet = (z, x, y) => { const g = gebietKacheln(z); return x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1; };

  /* ---------- Ansicht: Bild (CSS-Pixel) ↔ Welt ----------
     ansicht = {z, cx, cy (Weltpixel der eigenen Position), ax, ay (Bildpunkt der eigenen Position), rot (Grad, Kurs oben = Kurs)}
     Bild = R(−rot)·(Welt − c) + a,  Welt = c + R(rot)·(Bild − a) */
  function weltZuBild(v, wx, wy) {
    const r = -v.rot * RAD, dx = wx - v.cx, dy = wy - v.cy;
    return { x: v.ax + dx * Math.cos(r) - dy * Math.sin(r), y: v.ay + dx * Math.sin(r) + dy * Math.cos(r) };
  }
  function bildZuWelt(v, bx, by) {
    const r = v.rot * RAD, dx = bx - v.ax, dy = by - v.ay;
    return { x: v.cx + dx * Math.cos(r) - dy * Math.sin(r), y: v.cy + dx * Math.sin(r) + dy * Math.cos(r) };
  }
  // Kacheln, die eine (gedrehte) Ansicht der Grösse breite × hoehe abdecken, nur im Gebiet.
  // Sortiert von der eigenen Position nach aussen (die wichtigsten zuerst laden).
  function kachelnFuerAnsicht(v, breite, hoehe) {
    const ecken = [[0, 0], [breite, 0], [0, hoehe], [breite, hoehe]].map(([bx, by]) => bildZuWelt(v, bx, by));
    const xs = ecken.map(p => p.x), ys = ecken.map(p => p.y);
    const g = gebietKacheln(v.z);
    const x0 = Math.max(g.x0, Math.floor(Math.min(...xs) / KACHEL)), x1 = Math.min(g.x1, Math.floor(Math.max(...xs) / KACHEL));
    const y0 = Math.max(g.y0, Math.floor(Math.min(...ys) / KACHEL)), y1 = Math.min(g.y1, Math.floor(Math.max(...ys) / KACHEL));
    const out = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot((x + 0.5) * KACHEL - v.cx, (y + 0.5) * KACHEL - v.cy);
      out.push({ z: v.z, x, y, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }
  // Kacheln im Umkreis (für "Gebiet offline speichern"), Stufen zVon..zBis, nur im Gebiet
  function kachelnUmkreis(lat, lon, radiusM, zVon, zBis) {
    const out = [];
    const dLat = radiusM / 111320, dLon = radiusM / (111320 * Math.cos(lat * RAD));
    for (let z = zVon; z <= zBis; z++) {
      const g = gebietKacheln(z);
      const x0 = Math.max(g.x0, Math.floor(lonZuX(lon - dLon, z) / KACHEL)), x1 = Math.min(g.x1, Math.floor(lonZuX(lon + dLon, z) / KACHEL));
      const y0 = Math.max(g.y0, Math.floor(latZuY(lat + dLat, z) / KACHEL)), y1 = Math.min(g.y1, Math.floor(latZuY(lat - dLat, z) / KACHEL));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
    }
    return out;
  }

  /* ---------- Distanz, Peilung, Gleitzahl ---------- */
  function distanz(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dp = (lat2 - lat1) * RAD, dl = (lon2 - lon1) * RAD;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * ERDRADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function peilung(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
  }
  /* Nötige Gleitzahl zum Ziel: Distanz / (eigene Höhe − Zielhöhe).
     {gz, hoeheUeber}; gz = null, wenn die Höhe fehlt oder man nicht über dem Ziel ist. */
  function noetigeGleitzahl(distM, hoeheM, zielHoeheM) {
    if (!Number.isFinite(distM) || !Number.isFinite(hoeheM) || !Number.isFinite(zielHoeheM)) return { gz: null, hoeheUeber: null };
    const dh = hoeheM - zielHoeheM;
    return { gz: dh > 0 ? distM / dh : null, hoeheUeber: dh };
  }

  /* ---------- Schweizer Koordinaten (Näherung swisstopo, "Formeln und Konstanten für die Berechnung
     der Schweizerischen schiefachsigen Zylinderprojektion", ca. 1 m genau) ---------- */
  function wgs84ZuLv95(lat, lon) {
    const p = (lat * 3600 - 169028.66) / 10000, l = (lon * 3600 - 26782.5) / 10000;
    const e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l * l * l;
    const n = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p * p * p;
    return { e, n };
  }
  function lv95ZuWgs84(e, n) {
    const y = (e - 2600000) / 1e6, x = (n - 1200000) / 1e6;
    const l = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
    const p = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x * x * x;
    return { lat: p * 100 / 36, lon: l * 100 / 36 };
  }

  /* Koordinaten aus Text: "46.68, 7.86" (WGS84, Breite zuerst), "2'630'000 / 1'170'000" (LV95),
     "630000 170000" (LV03). Gibt {lat, lon, format} oder null. */
  function leseKoordinaten(text) {
    if (typeof text !== "string") return null;
    const t = text.trim().replace(/[’'`´]/g, "");
    let m = /^(-?\d+(?:[.,]\d+)?)\s*(?:[,;/]\s*|\s+)(-?\d+(?:[.,]\d+)?)$/.exec(t);
    if (!m) return null;
    const a = parseFloat(m[1].replace(",", ".")), b = parseFloat(m[2].replace(",", "."));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    let e = null, n = null, format = null;
    if (a >= 2400000 && a <= 2900000 && b >= 1050000 && b <= 1350000) { e = a; n = b; format = "LV95"; }
    else if (b >= 2400000 && b <= 2900000 && a >= 1050000 && a <= 1350000) { e = b; n = a; format = "LV95"; }
    else if (a >= 400000 && a <= 900000 && b >= 50000 && b <= 350000) { e = a + 2000000; n = b + 1000000; format = "LV03"; }
    else if (b >= 400000 && b <= 900000 && a >= 50000 && a <= 350000) { e = b + 2000000; n = a + 1000000; format = "LV03"; }
    if (e !== null) { const w = lv95ZuWgs84(e, n); return { lat: w.lat, lon: w.lon, format }; }
    if (a >= -90 && a <= 90 && b >= -180 && b <= 180) return { lat: a, lon: b, format: "WGS84" };
    return null;
  }
  // Anzeige: LV95 im Gebiet, sonst WGS84
  function formatKoordinaten(lat, lon) {
    if (imGebiet(lat, lon)) {
      const c = wgs84ZuLv95(lat, lon), f = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
      return f(c.e) + " / " + f(c.n);
    }
    return lat.toFixed(5) + ", " + lon.toFixed(5);
  }

  /* ---------- Spur: neue Punkte nur ab einer Mindestdistanz, höchstens maxPunkte (dann ausdünnen) ---------- */
  function spurHinzu(spur, lat, lon, minM, maxPunkte) {
    const l = spur[spur.length - 1];
    if (l && distanz(l.lat, l.lon, lat, lon) < minM) return false;
    spur.push({ lat, lon });
    if (spur.length > maxPunkte) {   // jeden zweiten Punkt der älteren Hälfte weglassen
      const h = Math.floor(spur.length / 2), alt = spur.slice(0, h).filter((_, i) => i % 2 === 0);
      spur.splice(0, h, ...alt);
    }
    return true;
  }

  /* ---------- Massstab: runde Länge, die etwa in maxPx passt ---------- */
  function massstab(mProPx, maxPx) {
    const roh = mProPx * maxPx, p = Math.pow(10, Math.floor(Math.log10(roh)));
    const m = [5, 2, 1].map(f => f * p).find(v => v <= roh) || p;
    return { meter: m, px: m / mProPx, text: m >= 1000 ? (m / 1000) + " km" : m + " m" };
  }

  /* =====================================================================
     Zeichnen (nur im Browser)
     daten = {
       ebene, z, breite, hoehe (CSS-Pixel), dpr,
       pos: {lat, lon} | null, kurs (Grad, Pfeil) | null, kartenKurs (Grad, oben bei "Kurs oben"; beim Kreisen festgehalten) | null,
       ausrichtung: "kurs"|"nord",
       kachel(ebene, z, x, y, nurNachsehen) → Bild oder null (fehlende Kacheln lädt die Funktion selbst nach, ausser nurNachsehen),
       spur: [{lat, lon}], thermiken: [{lat, lon, text}], ziel: {lat, lon} | null,
       farben: {hinter, spur, pfeil, pfeilRand, ziel, thermik, text, textHinter}, dunkel: bool
     }
     Gibt die Ansicht zurück (für bildZuWelt beim langen Drücken) und ob Kacheln gefehlt haben.
     ===================================================================== */
  function zeichne(ctx, d) {
    const W = d.breite, H = d.hoehe, f = d.farben;
    ctx.setTransform(d.dpr, 0, 0, d.dpr, 0, 0);
    ctx.fillStyle = f.hinter; ctx.fillRect(0, 0, W, H);
    const pos = d.pos || MITTE_CH;
    const kursOben = d.ausrichtung === "kurs" && d.pos && Number.isFinite(d.kartenKurs);
    const c = zuWelt(pos.lat, pos.lon, d.z);
    const v = { z: d.z, cx: c.x, cy: c.y, ax: W / 2, ay: kursOben ? H * 0.62 : H / 2, rot: kursOben ? d.kartenKurs : 0 };

    // Kacheln (fehlende: gröbere Stufe vergrössert zeigen, bis zu 5 Stufen zurück)
    const E = EBENEN[d.ebene];
    let fehlend = 0;
    ctx.save();
    ctx.translate(v.ax, v.ay); ctx.rotate(-v.rot * RAD); ctx.translate(-v.cx, -v.cy);
    ctx.imageSmoothingEnabled = true;
    for (const k of kachelnFuerAnsicht(v, W, H)) {
      let zq = Math.min(k.z, E.zMax), bild = null, s = 0;
      for (; zq >= Math.max(E.zMin, k.z - 6); zq--) {
        s = k.z - zq;
        bild = d.kachel(d.ebene, zq, k.x >> s, k.y >> s, zq !== Math.min(k.z, E.zMax));   // gröbere Stufen nur nachsehen
        if (bild) break;
        if (zq === Math.min(k.z, E.zMax)) fehlend++;
      }
      const px = k.x * KACHEL, py = k.y * KACHEL;
      if (bild) {
        const t = KACHEL >> s, sx = (k.x - ((k.x >> s) << s)) * t, sy = (k.y - ((k.y >> s) << s)) * t;
        // 0.5 px Überlappung gegen feine Fugen zwischen den Kacheln
        ctx.drawImage(bild, sx, sy, t, t, px - 0.25, py - 0.25, KACHEL + 0.5, KACHEL + 0.5);
      }
    }
    if (d.dunkel) { ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fillRect(v.cx - 4 * W - 4 * H, v.cy - 4 * W - 4 * H, 8 * (W + H), 8 * (W + H)); }

    // Spur
    if (d.spur && d.spur.length > 1) {
      ctx.beginPath();
      d.spur.forEach((p, i) => { const w = zuWelt(p.lat, p.lon, d.z); i ? ctx.lineTo(w.x, w.y) : ctx.moveTo(w.x, w.y); });
      if (d.pos) ctx.lineTo(c.x, c.y);
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = f.spur; ctx.lineWidth = 3; ctx.stroke();
    }
    // Linie zum Ziel
    let zw = null;
    if (d.ziel) {
      zw = zuWelt(d.ziel.lat, d.ziel.lon, d.z);
      if (d.pos) {
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(zw.x, zw.y);
        ctx.setLineDash([10, 7]); ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 5; ctx.stroke();
        ctx.strokeStyle = f.ziel; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore();

    // Punkte und Beschriftungen ungedreht zeichnen (Text bleibt lesbar)
    ctx.font = "800 14px -apple-system, BlinkMacSystemFont, sans-serif"; ctx.textBaseline = "middle";
    for (const t of d.thermiken || []) {
      const w = zuWelt(t.lat, t.lon, d.z), b = weltZuBild(v, w.x, w.y);
      if (b.x < -40 || b.y < -20 || b.x > W + 40 || b.y > H + 20) continue;
      ctx.beginPath(); ctx.arc(b.x, b.y, 7, 0, 2 * Math.PI);
      ctx.fillStyle = f.thermik; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = "#fff"; ctx.stroke();
      if (t.text) beschriftung(ctx, t.text, b.x + 11, b.y, f);
    }
    if (zw) {
      const b = weltZuBild(v, zw.x, zw.y);
      if (b.x > -30 && b.y > -30 && b.x < W + 30 && b.y < H + 30) {
        ctx.beginPath(); ctx.arc(b.x, b.y, 11, 0, 2 * Math.PI); ctx.lineWidth = 6; ctx.strokeStyle = "#fff"; ctx.stroke();
        ctx.lineWidth = 3.5; ctx.strokeStyle = f.ziel; ctx.stroke();
        ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, 2 * Math.PI); ctx.fillStyle = f.ziel; ctx.fill();
      }
    }

    // eigene Position: Pfeil (zeigt in Flugrichtung), ohne Kurs ein Punkt
    if (d.pos) {
      ctx.save(); ctx.translate(v.ax, v.ay);
      if (Number.isFinite(d.kurs)) {
        ctx.rotate((d.kurs - v.rot) * RAD);
        ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(12, 13); ctx.lineTo(0, 6); ctx.lineTo(-12, 13); ctx.closePath();
      } else { ctx.beginPath(); ctx.arc(0, 0, 9, 0, 2 * Math.PI); }
      ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = f.pfeilRand; ctx.fillStyle = f.pfeil; ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // Nordpfeil oben rechts (nur wenn die Karte gedreht ist)
    if (v.rot) {
      const nx = W - 26, ny = 26;
      ctx.save(); ctx.translate(nx, ny);
      ctx.beginPath(); ctx.arc(0, 0, 19, 0, 2 * Math.PI); ctx.fillStyle = f.textHinter; ctx.fill();
      ctx.rotate(-v.rot * RAD);
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(6, 2); ctx.lineTo(-6, 2); ctx.closePath(); ctx.fillStyle = "#e53935"; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(6, 2); ctx.lineTo(-6, 2); ctx.closePath(); ctx.fillStyle = f.text; ctx.fill();
      ctx.restore();
    }

    // Massstab unten links, Quelle unten rechts
    const ms = massstab(meterProPixel(pos.lat, d.z), Math.min(120, W * 0.3));
    ctx.fillStyle = f.textHinter; ctx.fillRect(6, H - 26, ms.px + 12, 20);
    ctx.fillStyle = f.text; ctx.fillRect(12, H - 12, ms.px, 3); ctx.fillRect(12, H - 17, 2, 8); ctx.fillRect(12 + ms.px - 2, H - 17, 2, 8);
    ctx.font = "700 11px -apple-system, sans-serif"; ctx.textBaseline = "alphabetic"; ctx.fillText(ms.text, 16, H - 15);
    ctx.font = "600 10px -apple-system, sans-serif";
    const q = E.quelle, qw = ctx.measureText(q).width;
    ctx.fillStyle = f.textHinter; ctx.fillRect(W - qw - 10, H - 16, qw + 8, 14);
    ctx.fillStyle = f.text; ctx.fillText(q, W - qw - 6, H - 5);

    return { ansicht: v, fehlend };
  }
  function beschriftung(ctx, text, x, y, f) {
    const w = ctx.measureText(text).width;
    ctx.fillStyle = f.textHinter; ctx.fillRect(x - 3, y - 10, w + 6, 20);
    ctx.fillStyle = f.text; ctx.fillText(text, x, y + 1);
  }

  return {
    KACHEL, GEBIET, MITTE_CH, EBENEN, kachelUrl, kachelSchluessel,
    lonZuX, latZuY, xZuLon, yZuLat, zuWelt, ausWelt, meterProPixel, imGebiet, gebietKacheln, kachelImGebiet,
    weltZuBild, bildZuWelt, kachelnFuerAnsicht, kachelnUmkreis,
    distanz, peilung, noetigeGleitzahl, wgs84ZuLv95, lv95ZuWgs84, leseKoordinaten, formatKoordinaten,
    spurHinzu, massstab, zeichne,
  };
});
