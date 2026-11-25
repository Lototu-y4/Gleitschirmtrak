/* Distanz und Punkte nach den Regeln von XContest World (https://www.xcontest.org/world/en/rules/, Abschnitte 2.5, 4.1, 4.2).
   Ohne Abhängigkeiten; läuft im Browser (globales Objekt "XContest") und in Node (require("./xcontest.js")).

   Regeln:
     - Freie Strecke: Start, bis zu 3 Wendepunkte und Ziel liegen irgendwo auf dem Track, in Flugreihenfolge,
       so dass die Summe der Teilstrecken am grössten wird. 1 km = 1.0 Punkte.
     - Dreieck: 3 Wendepunkte auf dem Track. Es zählt nur, wenn ein Punkt vor dem ersten und ein Punkt nach dem
       dritten Wendepunkt weniger als 20 % des Dreiecksumfangs auseinanderliegen (Schlussabstand).
       Distanz = Umfang − Schlussabstand.
         flaches Dreieck 1.2, FAI-Dreieck (kürzeste Seite mindestens 28 % des Umfangs) 1.4,
         geschlossen (Schlussabstand unter 5 %): flach 1.4, FAI 1.6.
     - Es gilt die Art mit den meisten Punkten. Distanz auf 0.01 km gerundet, Punkte = gerundete Distanz × Faktor,
       auf 2 Stellen gerundet.
   Distanzen am Schluss auf dem WGS84-Ellipsoid (Vincenty); gesucht wird auf der Kugel (schneller, gleiche Lage).

   Suche:
     1. Track räumlich ausdünnen (ein Punkt erst, wenn er weit genug vom letzten entfernt ist; Thermiken fallen zusammen).
     2. Grob: freie Strecke mit dynamischer Programmierung, Dreiecke über alle Tripel (Schlussabstand aus einer
        Tabelle "kleinster Abstand vor i / nach k").
     3. Fein: die besten groben Lösungen auf dem ganzen Track verbessern. Jeder Punkt wird abwechselnd über seinen
        ganzen erlaubten Bereich optimal gesetzt, bis sich nichts mehr ändert; der Schlussabstand wird jeweils exakt
        gesucht (Raster mit der groben Lösung als Obergrenze). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.XContest = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const RAD = Math.PI / 180;
  const R_KUGEL = 6371008.8;

  const TYPEN = Object.freeze({
    frei:    Object.freeze({ id: "frei",    name: "Freie Strecke",                 kurz: "Frei",           faktor: 1.0 }),
    flach:   Object.freeze({ id: "flach",   name: "Flaches Dreieck",               kurz: "Flach",          faktor: 1.2, schluss: 0.20 }),
    fai:     Object.freeze({ id: "fai",     name: "FAI-Dreieck",                   kurz: "FAI",            faktor: 1.4, schluss: 0.20, fai: 0.28 }),
    flachZu: Object.freeze({ id: "flachZu", name: "Geschlossenes flaches Dreieck", kurz: "Flach geschl.",  faktor: 1.4, schluss: 0.05 }),
    faiZu:   Object.freeze({ id: "faiZu",   name: "Geschlossenes FAI-Dreieck",     kurz: "FAI geschl.",    faktor: 1.6, schluss: 0.05, fai: 0.28 }),
  });
  const DREIECKE = ["flach", "fai", "flachZu", "faiZu"];

  const ZIEL_FREI = 900;      // so viele Punkte nach dem Ausdünnen für die grobe freie Strecke
  const ZIEL_DREIECK = 380;   // … für die groben Dreiecke (Aufwand wächst mit der dritten Potenz)
  const KANDIDATEN = 4;       // so viele grobe Lösungen je Art werden fein verbessert

  /* ---------- Distanzen ---------- */
  function haversine(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dp = p2 - p1, dl = (lon2 - lon1) * RAD;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R_KUGEL * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  // Inverse Aufgabe nach Vincenty (1975) auf WGS84, in m. Konvergiert sie nicht (fast gegenüberliegende Punkte), Kugel.
  function wgs84(lat1, lon1, lat2, lon2) {
    const a = 6378137, f = 1 / 298.257223563, b = a * (1 - f);
    const L = (lon2 - lon1) * RAD;
    const U1 = Math.atan((1 - f) * Math.tan(lat1 * RAD)), U2 = Math.atan((1 - f) * Math.tan(lat2 * RAD));
    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
    let lam = L, lamP, iter = 100, sinS, cosS, sig, cosSqA, cos2SM;
    do {
      const sinL = Math.sin(lam), cosL = Math.cos(lam);
      sinS = Math.sqrt((cosU2 * sinL) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosL) ** 2);
      if (sinS === 0) return 0;
      cosS = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
      sig = Math.atan2(sinS, cosS);
      const sinA = cosU1 * cosU2 * sinL / sinS;
      cosSqA = 1 - sinA * sinA;
      cos2SM = cosSqA !== 0 ? cosS - 2 * sinU1 * sinU2 / cosSqA : 0;
      const C = f / 16 * cosSqA * (4 + f * (4 - 3 * cosSqA));
      lamP = lam;
      lam = L + (1 - C) * f * sinA * (sig + C * sinS * (cos2SM + C * cosS * (-1 + 2 * cos2SM * cos2SM)));
    } while (Math.abs(lam - lamP) > 1e-12 && --iter > 0);
    if (iter === 0) return haversine(lat1, lon1, lat2, lon2);
    const uSq = cosSqA * (a * a - b * b) / (b * b);
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const dS = B * sinS * (cos2SM + B / 4 * (cosS * (-1 + 2 * cos2SM * cos2SM) - B / 6 * cos2SM * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2SM * cos2SM)));
    return b * A * (sig - dS);
  }

  /* ---------- Vorbereitung: Bogenmass, Kosinus, lokale Meter (für das Raster beim Schlussabstand) ---------- */
  function vorbereiten(punkte) {
    const n = punkte.length;
    const la = new Float64Array(n), lo = new Float64Array(n), co = new Float64Array(n), x = new Float64Array(n), y = new Float64Array(n);
    let sLat = 0, sLon = 0;
    for (let i = 0; i < n; i++) { sLat += punkte[i].lat; sLon += punkte[i].lon; }
    const lat0 = sLat / n, lon0 = sLon / n, k0 = Math.cos(lat0 * RAD);
    for (let i = 0; i < n; i++) {
      la[i] = punkte[i].lat * RAD; lo[i] = punkte[i].lon * RAD; co[i] = Math.cos(la[i]);
      x[i] = (punkte[i].lon - lon0) * RAD * R_KUGEL * k0; y[i] = (punkte[i].lat - lat0) * RAD * R_KUGEL;
    }
    // Kugeldistanz zwischen zwei Indizes
    const d = (i, j) => {
      const sa = Math.sin((la[j] - la[i]) / 2), sb = Math.sin((lo[j] - lo[i]) / 2);
      const a = sa * sa + co[i] * co[j] * sb * sb;
      return 2 * R_KUGEL * Math.asin(a < 1 ? Math.sqrt(a) : 1);
    };
    return { n, d, x, y, punkte };
  }

  // Räumlich ausdünnen: Indizes, erster und letzter immer dabei; Abstand so gewählt, dass etwa ziel Punkte bleiben
  function ausduennen(T, ziel) {
    const n = T.n;
    if (n <= ziel) return Array.from({ length: n }, (_, i) => i);
    const mit = (r) => {
      const out = [0];
      let lx = T.x[0], ly = T.y[0];
      for (let i = 1; i < n - 1; i++) {
        const dx = T.x[i] - lx, dy = T.y[i] - ly;
        if (dx * dx + dy * dy >= r * r) { out.push(i); lx = T.x[i]; ly = T.y[i]; }
      }
      out.push(n - 1);
      return out;
    };
    let lang = 0;
    for (let i = 1; i < n; i++) lang += Math.hypot(T.x[i] - T.x[i - 1], T.y[i] - T.y[i - 1]);
    let lo = 0, hi = Math.max(1, lang / 2), best = null;
    let r = Math.max(1, lang / ziel);
    for (let it = 0; it < 30; it++) {
      const k = mit(r);
      if (!best || Math.abs(k.length - ziel) < Math.abs(best.length - ziel)) best = k;
      if (k.length > ziel * 1.1) lo = r; else if (k.length < ziel * 0.9) hi = r; else return k;
      r = (lo + hi) / 2;
    }
    return best;
  }

  /* ---------- Freie Strecke ---------- */
  // Grob: dynamische Programmierung über 4 Teilstrecken; liefert die besten Lösungen mit verschiedenem Ziel
  function freiGrob(T, K) {
    const m = K.length, L = 4;
    const best = [new Float64Array(m)];   // Stufe 0: Start, Wert 0
    const arg = [null];
    for (let l = 1; l <= L; l++) {
      const b = new Float64Array(m).fill(-Infinity), g = new Int32Array(m).fill(-1), vor = best[l - 1];
      for (let j = 1; j < m; j++) {
        const kj = K[j];
        let bw = -Infinity, ba = -1;
        for (let i = 0; i < j; i++) {
          if (vor[i] === -Infinity) continue;
          const w = vor[i] + T.d(K[i], kj);
          if (w > bw) { bw = w; ba = i; }
        }
        b[j] = bw; g[j] = ba;
      }
      best.push(b); arg.push(g);
    }
    const enden = Array.from({ length: m }, (_, j) => j).filter(j => best[L][j] > -Infinity).sort((a, b) => best[L][b] - best[L][a]);
    const out = [];
    for (const e of enden) {
      const idx = [e];
      for (let l = L; l >= 1; l--) idx.unshift(arg[l][idx[0]]);
      out.push(idx.map(i => K[i]));
      if (out.length >= KANDIDATEN) break;
    }
    return out;
  }
  // Fein: jeden der 5 Punkte über seinen ganzen erlaubten Bereich optimal setzen, bis sich nichts mehr ändert
  function freiFein(T, p) {
    p = p.slice();
    const n = T.n;
    for (let runde = 0; runde < 50; runde++) {
      let geaendert = false;
      for (let k = 0; k < 5; k++) {
        const von = k === 0 ? 0 : p[k - 1], bis = k === 4 ? n - 1 : p[k + 1];
        let bw = -1, bx = p[k];
        for (let x = von; x <= bis; x++) {
          const w = (k > 0 ? T.d(p[k - 1], x) : 0) + (k < 4 ? T.d(x, p[k + 1]) : 0);
          if (w > bw + 1e-9) { bw = w; bx = x; }
        }
        const alt = (k > 0 ? T.d(p[k - 1], p[k]) : 0) + (k < 4 ? T.d(p[k], p[k + 1]) : 0);
        if (bx !== p[k] && bw > alt + 1e-6) { p[k] = bx; geaendert = true; }
      }
      if (!geaendert) break;
    }
    return p;
  }

  /* ---------- Dreiecke ---------- */
  // Grob: alle Tripel auf den ausgedünnten Punkten. Schlussabstand C[i][k] = kleinster Abstand zwischen einem Punkt ≤ i
  // und einem Punkt ≥ k. Je Art die besten Kandidaten.
  function dreieckGrob(T, K) {
    const m = K.length;
    const D = new Float64Array(m * m);
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) { const v = T.d(K[i], K[j]); D[i * m + j] = v; D[j * m + i] = v; }
    const C = new Float64Array(m * m).fill(Infinity), CS = new Int32Array(m * m), CF = new Int32Array(m * m);
    for (let i = 0; i < m; i++) {
      for (let k = m - 1; k > i; k--) {
        let c = D[i * m + k], s = i, f = k;
        if (i > 0 && C[(i - 1) * m + k] < c) { c = C[(i - 1) * m + k]; s = CS[(i - 1) * m + k]; f = CF[(i - 1) * m + k]; }
        if (k < m - 1 && C[i * m + k + 1] < c) { c = C[i * m + k + 1]; s = CS[i * m + k + 1]; f = CF[i * m + k + 1]; }
        C[i * m + k] = c; CS[i * m + k] = s; CF[i * m + k] = f;
      }
    }
    const listen = {};
    for (const t of DREIECKE) listen[t] = [];
    const eintragen = (t, wert, kand) => {
      const l = listen[t];
      if (l.length >= KANDIDATEN && wert <= l[l.length - 1].wert) return;
      l.push({ wert, kand }); l.sort((a, b) => b.wert - a.wert);
      if (l.length > KANDIDATEN) l.pop();
    };
    for (let i = 0; i < m; i++) {
      for (let k = i + 2; k < m; k++) {
        const dik = D[i * m + k], c = C[i * m + k];
        let pF = -1, jF = -1, pA = -1, jA = -1;
        for (let j = i + 1; j < k; j++) {
          const a = D[i * m + j], b = D[j * m + k], p = a + b + dik;
          if (p > pF) { pF = p; jF = j; }
          if (p > pA && a >= 0.28 * p && b >= 0.28 * p && dik >= 0.28 * p) { pA = p; jA = j; }
        }
        if (jF < 0) continue;
        const kandF = () => ({ i1: K[i], i2: K[jF], i3: K[k], s: K[CS[i * m + k]], f: K[CF[i * m + k]] });
        if (c < 0.20 * pF) eintragen("flach", 1.2 * (pF - c), kandF());
        if (c < 0.05 * pF) eintragen("flachZu", 1.4 * (pF - c), kandF());
        if (jA >= 0) {
          const kandA = () => ({ i1: K[i], i2: K[jA], i3: K[k], s: K[CS[i * m + k]], f: K[CF[i * m + k]] });
          if (c < 0.20 * pA) eintragen("fai", 1.4 * (pA - c), kandA());
          if (c < 0.05 * pA) eintragen("faiZu", 1.6 * (pA - c), kandA());
        }
      }
    }
    return listen;
  }

  /* Abschnitte der ausgedünnten Punkte: Abschnitt a = Punkte K[a] … K[a+1]−1. Alle liegen näher als rad[a]
     (lokale Meter) bei K[a], weil beim Ausdünnen erst ein Punkt in grösserem Abstand behalten wird. */
  function abschnitte(T, K) {
    const m = K.length, rad = new Float64Array(m);
    for (let a = 0; a < m; a++) {
      const ende = a + 1 < m ? K[a + 1] : T.n, k = K[a];
      let r2 = 0;
      for (let i = k; i < ende; i++) { const dx = T.x[i] - T.x[k], dy = T.y[i] - T.y[k]; if (dx * dx + dy * dy > r2) r2 = dx * dx + dy * dy; }
      rad[a] = Math.sqrt(r2);
    }
    return { K, rad };
  }

  // Exakter Schlussabstand: kleinster Abstand zwischen einem Punkt in [0, i1] und einem in [i3, n−1].
  // (s0, f0): ein zulässiges Paar als Startwert. Branch and Bound über Abschnittspaare: Untergrenze =
  // Abstand der Abschnittsanfänge minus beide Radien (mit 5 % Reserve für die lokale Projektion); nur Paare
  // unter dem bisher Besten werden Punkt für Punkt durchsucht.
  function schlussExakt(T, i1, i3, s0, f0) {
    let best = T.d(s0, f0), bs = s0, bf = f0;
    const di = T.d(i1, i3);
    if (di < best) { best = di; bs = i1; bf = i3; }
    const { K, rad } = T.abschnitte, m = K.length;
    const ende = (a) => a + 1 < m ? K[a + 1] - 1 : T.n - 1;
    const lb = [], pa = [], pb = [];
    for (let a = 0; a < m && K[a] <= i1; a++) {
      const xa = T.x[K[a]], ya = T.y[K[a]];
      for (let b = m - 1; b >= 0 && ende(b) >= i3; b--) {
        const u = (Math.hypot(xa - T.x[K[b]], ya - T.y[K[b]]) - rad[a] - rad[b]) * 0.95;
        if (u < best) { lb.push(u); pa.push(a); pb.push(b); }
      }
    }
    const ord = Array.from(lb.keys()).sort((p, q) => lb[p] - lb[q]);
    for (const o of ord) {
      if (lb[o] >= best) break;
      const a = pa[o], b = pb[o];
      const s1 = Math.min(ende(a), i1), f1 = Math.max(K[b], i3), f2 = ende(b);
      for (let s = K[a]; s <= s1; s++) for (let f = f1; f <= f2; f++) {
        const v = T.d(s, f);
        if (v < best) { best = v; bs = s; bf = f; }
      }
    }
    return { c: best, s: bs, f: bf };
  }

  // Fein: Wendepunkte abwechselnd optimal setzen (Schlusspaar dabei fest, damit der Abstand nicht wächst),
  // dann den Schlussabstand exakt neu suchen. Wert = Umfang − Schlussabstand, Bedingungen der Art eingehalten.
  function dreieckFein(T, typ, k0) {
    const q = typ.schluss, fai = typ.fai || 0;
    let { i1, i2, i3, s, f } = k0;
    let sc = schlussExakt(T, i1, i3, s, f);
    s = sc.s; f = sc.f; let c = sc.c;
    const umfang = (a, b, e) => T.d(a, b) + T.d(b, e) + T.d(e, a);
    const gueltig = (a, b, e, cc) => {
      const x = T.d(a, b), y = T.d(b, e), z = T.d(e, a), p = x + y + z;
      if (!(cc < q * p)) return -Infinity;
      if (fai && (x < fai * p || y < fai * p || z < fai * p)) return -Infinity;
      return p - cc;
    };
    let wert = gueltig(i1, i2, i3, c);
    if (wert === -Infinity) return null;
    for (let runde = 0; runde < 50; runde++) {
      let geaendert = false;
      // Wendepunkt 2 im Bereich (i1, i3)
      for (let x = i1 + 1; x < i3; x++) { const w = gueltig(i1, x, i3, c); if (w > wert + 1e-6) { wert = w; i2 = x; geaendert = true; } }
      // Wendepunkt 1 vor i2. Vor dem Schlusspunkt s wandert dieser mit (Paar x–f ist dann zulässig, Abstand d(x, f)).
      for (let x = 0; x < i2; x++) {
        const cx = x >= s ? c : T.d(x, f), w = gueltig(x, i2, i3, cx);
        if (w > wert + 1e-6) { wert = w; i1 = x; if (x < s) { s = x; c = cx; } geaendert = true; }
      }
      // Wendepunkt 3 nach i2. Nach dem Schlusspunkt f wandert dieser mit (Paar s–x).
      for (let x = i2 + 1; x < T.n; x++) {
        const cx = x <= f ? c : T.d(s, x), w = gueltig(i1, i2, x, cx);
        if (w > wert + 1e-6) { wert = w; i3 = x; if (x > f) { f = x; c = cx; } geaendert = true; }
      }
      // Schlussabstand neu (kann nur kleiner werden, das alte Paar bleibt zulässig)
      sc = schlussExakt(T, i1, i3, s, f);
      if (sc.c < c - 1e-6) { c = sc.c; s = sc.s; f = sc.f; wert = gueltig(i1, i2, i3, c); geaendert = true; }
      if (!geaendert) break;
    }
    return { i1, i2, i3, s, f, wert, umfang: umfang(i1, i2, i3), c };
  }

  /* ---------- Ergebnis auf dem Ellipsoid ---------- */
  const rund2 = (v) => Math.round(v * 100) / 100;
  function bewerteFrei(P, p) {
    let m = 0;
    for (let k = 0; k < 4; k++) m += wgs84(P[p[k]].lat, P[p[k]].lon, P[p[k + 1]].lat, P[p[k + 1]].lon);
    const km = rund2(m / 1000);
    return { typ: "frei", name: TYPEN.frei.name, kurz: TYPEN.frei.kurz, faktor: 1, distM: m, km, punkte: rund2(km * 1), indizes: p.slice(), schluss: null };
  }
  function bewerteDreieck(P, typ, r) {
    const g = (a, b) => wgs84(P[a].lat, P[a].lon, P[b].lat, P[b].lon);
    const x = g(r.i1, r.i2), y = g(r.i2, r.i3), z = g(r.i3, r.i1), p = x + y + z, c = g(r.s, r.f);
    if (!(c < typ.schluss * p)) return null;
    if (typ.fai && (x < typ.fai * p || y < typ.fai * p || z < typ.fai * p)) return null;
    const km = rund2((p - c) / 1000);
    return { typ: typ.id, name: typ.name, kurz: typ.kurz, faktor: typ.faktor, distM: p - c, km, punkte: rund2(km * typ.faktor),
             indizes: [r.i1, r.i2, r.i3], schluss: { s: r.s, f: r.f, distM: c }, umfangM: p, seitenM: [x, y, z] };
  }

  /* Hauptfunktion. punkte: [{lat, lon}] in Flugreihenfolge (nur der Flug, ohne Boden davor und danach).
     Ergebnis: {bestes, varianten: {frei, flach, fai, flachZu, faiZu} (je null, wenn nicht möglich), rechenzeitMs}
       Variante: {typ, name, kurz, faktor, distM, km, punkte, indizes (Wendepunkte, bei frei 5 Punkte), schluss {s, f, distM} | null, …} */
  function bewerte(punkte, opts) {
    opts = opts || {};
    const zielFrei = opts.zielFrei || ZIEL_FREI, zielDreieck = opts.zielDreieck || ZIEL_DREIECK;
    const t0 = Date.now();
    const P = (punkte || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const leer = { bestes: null, varianten: { frei: null, flach: null, fai: null, flachZu: null, faiZu: null }, rechenzeitMs: 0 };
    if (P.length < 5) return leer;
    const T = vorbereiten(P);
    const varianten = {};
    // freie Strecke
    let bf = null;
    for (const k of freiGrob(T, ausduennen(T, zielFrei))) {
      const v = bewerteFrei(P, freiFein(T, k));
      if (!bf || v.distM > bf.distM) bf = v;
    }
    varianten.frei = bf;
    // Dreiecke
    const KD = ausduennen(T, zielDreieck);
    T.abschnitte = abschnitte(T, KD);
    const grob = dreieckGrob(T, KD);
    for (const t of DREIECKE) {
      let b = null;
      for (const k of grob[t]) {
        const r = dreieckFein(T, TYPEN[t], k.kand);
        if (!r) continue;
        const v = bewerteDreieck(P, TYPEN[t], r);
        if (v && (!b || v.punkte > b.punkte)) b = v;
      }
      varianten[t] = b;
    }
    let bestes = null;
    for (const t of ["frei", ...DREIECKE]) { const v = varianten[t]; if (v && (!bestes || v.punkte > bestes.punkte)) bestes = v; }
    return { bestes, varianten, rechenzeitMs: Date.now() - t0 };
  }

  /* Nur zum Prüfen (werkzeuge/xc-pruefung.js): freie Strecke exakt auf allen Punkten (dynamische Programmierung,
     Aufwand n² – für lange Flüge Minuten). Gibt die Distanz in m auf dem Ellipsoid und die 5 Indizes. */
  function freiExakt(punkte) {
    const P = punkte.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const T = vorbereiten(P), K = Array.from({ length: T.n }, (_, i) => i);
    const k = freiGrob(T, K)[0];
    return bewerteFrei(P, freiFein(T, k));
  }

  return { TYPEN, bewerte, haversine, wgs84, freiExakt };
});
