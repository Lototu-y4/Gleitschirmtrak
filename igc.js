/* IGC-Dateien lesen. Ohne Abhängigkeiten; läuft im Browser (globales Objekt "Igc", für den Import ins Logbuch)
   und in Node (require("./igc.js"), für Tests und werkzeuge/auswertung.js).
   Format nach FAI/IGC "Technical Specification for IGC-approved GNSS Flight Recorders":
   B-Record: B HHMMSS DDMMmmmN DDDMMmmmE V PPPPP GGGGG [Erweiterungen laut I-Record]
     - Breite DDMMmmm: Grad (2), Minuten (2), Tausendstelminuten (3), dann N/S
     - Länge DDDMMmmm: Grad (3), Minuten (2), Tausendstelminuten (3), dann E/W
     - V = Fix-Gültigkeit (A = 3D, V = 2D/kein GPS)
     - PPPPP = Druckhöhe (ISA, m), GGGGG = GNSS-Höhe (m), negativ mit führendem "-"
   I-Record: Inn SSFFCCC… = Anzahl Erweiterungen, je Startbyte, Endbyte (1-basiert, inklusive) und Kürzel.
   H-Records: HFDTE (Datum), HFPLT (Pilot), HFGTY (Schirm). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Igc = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const R_ERDE = 6371008.8;   // mittlerer Erdradius in m

  function parseKoordinate(s, gradStellen) {
    // s z. B. "4716218N" oder "00733664E"
    const re = gradStellen === 2 ? /^(\d{2})(\d{2})(\d{3})([NS])$/ : /^(\d{3})(\d{2})(\d{3})([EW])$/;
    const m = re.exec(s);
    if (!m) return null;
    const grad = +m[1], min = +m[2] + +m[3] / 1000;
    if (min >= 60 || grad > (gradStellen === 2 ? 90 : 180)) return null;
    const d = grad + min / 60;
    return (m[4] === "S" || m[4] === "W") ? -d : d;
  }

  function parseHoehe(s) {
    if (!/^-?\d{4,5}$/.test(s)) return null;
    return Number(s);
  }

  function parseIRecord(line) {
    // "I053638FXA3941VXA4244GSP4547CCO4850HDT"
    const n = Number(line.slice(1, 3));
    const ext = [];
    for (let i = 0; i < n; i++) {
      const o = 3 + i * 7;
      const s = line.slice(o, o + 7);
      if (s.length < 7) break;
      ext.push({ von: Number(s.slice(0, 2)), bis: Number(s.slice(2, 4)), code: s.slice(4, 7) });
    }
    return ext;
  }

  // Text nach dem Doppelpunkt einer H-Zeile ("HFPLTPILOTINCHARGE:Name" → "Name"), sonst nach dem Kürzel
  function kopfWert(z) {
    const i = z.indexOf(":");
    return (i >= 0 ? z.slice(i + 1) : z.slice(5)).trim();
  }

  /* Ganze Datei lesen. Zeit t = Sekunden seit Mitternacht UTC des Flugtags, über Mitternacht hinweg fortlaufend.
     Ergebnis: {datum ("ddmmyy" | null), ext, fixes [{t, lat, lon, gueltig, pHoehe, gHoehe, ext}], verworfen, kopf {pilot, schirm}} */
  function parseIgc(text) {
    const zeilen = String(text).split(/\r?\n/);
    let datum = null, ext = [], tPrev = null, tagOffset = 0;
    const fixes = [];
    const kopf = { pilot: "", schirm: "" };
    let verworfen = 0;
    for (const raw of zeilen) {
      const z = raw.trimEnd();
      if (!z) continue;
      if (z.startsWith("HFDTE") || z.startsWith("HODTE")) {
        const m = /(\d{6})/.exec(z.slice(5));
        if (m && !datum) datum = m[1];
      } else if (z.startsWith("HFPLT")) {
        kopf.pilot = kopfWert(z);
      } else if (z.startsWith("HFGTY")) {
        kopf.schirm = kopfWert(z);
      } else if (z[0] === "I") {
        ext = parseIRecord(z);
      } else if (z[0] === "B") {
        if (z.length < 35) { verworfen++; continue; }
        const hh = +z.slice(1, 3), mi = +z.slice(3, 5), ss = +z.slice(5, 7);
        if (!(hh <= 23 && mi <= 59 && ss <= 59)) { verworfen++; continue; }
        const lat = parseKoordinate(z.slice(7, 15), 2);
        const lon = parseKoordinate(z.slice(15, 24), 3);
        if (lat === null || lon === null) { verworfen++; continue; }
        let t = hh * 3600 + mi * 60 + ss + tagOffset;
        if (tPrev !== null && t < tPrev - 43200) { tagOffset += 86400; t += 86400; }   // über Mitternacht
        tPrev = t;
        const fix = { t, lat, lon, gueltig: z[24] === "A", pHoehe: parseHoehe(z.slice(25, 30)), gHoehe: parseHoehe(z.slice(30, 35)), ext: {} };
        for (const e of ext) {
          const s = z.slice(e.von - 1, e.bis);
          if (s.length === e.bis - e.von + 1 && /^-?\d+$/.test(s)) fix.ext[e.code] = Number(s);
        }
        fixes.push(fix);
      }
    }
    return { datum, ext, fixes, verworfen, kopf };
  }

  /* Position → lokale Ost/Nord-Meter (abstandstreue Zylinderprojektion um einen Bezugspunkt;
     auf wenigen 10 km genau genug für Geschwindigkeiten). */
  function lokaleMeter(fixes, bezug) {
    const b = bezug || fixes[0];
    const k = Math.PI / 180;
    const cosB = Math.cos(b.lat * k);
    return fixes.map(f => ({ ost: (f.lon - b.lon) * k * R_ERDE * cosB, nord: (f.lat - b.lat) * k * R_ERDE }));
  }

  /* Geschwindigkeitsvektoren aus Positionsdifferenzen.
     Zentrale Differenz über die beiden Nachbarn (i−1, i+1), sofern deren Abstand höchstens maxDt Sekunden ist,
     sonst einseitig. Ergebnis pro Fix: {t, ost, nord (m/s), geschw (m/s), kurs (Grad 0–360) | null}. */
  function geschwVektoren(fixes, opts) {
    const maxDt = (opts && opts.maxDt) || 3;
    const out = [];
    if (!fixes.length) return out;
    const p = lokaleMeter(fixes);
    for (let i = 0; i < fixes.length; i++) {
      let a = i - 1, b = i + 1;
      if (a < 0 || fixes[i].t - fixes[a].t > maxDt) a = i;
      if (b >= fixes.length || fixes[b].t - fixes[i].t > maxDt) b = i;
      const dt = fixes[b].t - fixes[a].t;
      if (a === b || dt <= 0) { out.push({ t: fixes[i].t, ost: null, nord: null, geschw: null, kurs: null }); continue; }
      const ost = (p[b].ost - p[a].ost) / dt, nord = (p[b].nord - p[a].nord) / dt;
      const geschw = Math.hypot(ost, nord);
      const kurs = (Math.atan2(ost, nord) * 180 / Math.PI + 360) % 360;
      out.push({ t: fixes[i].t, ost, nord, geschw, kurs });
    }
    return out;
  }

  return { parseIgc, parseKoordinate, parseIRecord, lokaleMeter, geschwVektoren, R_ERDE };
});
