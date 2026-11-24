/* Windschätzung aus der Bewegung über Grund beim Kreisen (Eigenbau, kein zugelassenes Instrument).
   Ohne Abhängigkeiten; läuft im Browser (globales Objekt "Wind") und in Node (require("./wind.js")).

   Idee: Kreist der Schirm mit annähernd konstanter Fluggeschwindigkeit, liegen die Geschwindigkeitsvektoren
   über Grund (Ost/Nord, m/s) auf einem Kreis. Mittelpunkt = Windvektor, Radius = Fluggeschwindigkeit durch die Luft.
   Anpassung: algebraischer Kreis nach Taubin, ein Durchgang ohne Ausreisser, danach geometrische Verfeinerung
   (Gauss-Newton auf den Abstand der Punkte zum Kreis).

   Richtungen in Grad, 0 = Nord, im Uhrzeigersinn:
     richtungNach = Richtung, IN die der Wind weht (Richtung des Windvektors)
     richtungVon  = Richtung, AUS der der Wind kommt (meteorologisch, richtungNach + 180) */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Wind = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const RAD = Math.PI / 180;

  const STANDARD = Object.freeze({
    // Schätzung
    minGeschwKmh: 5,          // Messpunkte mit kleinerer Geschwindigkeit über Grund werden verworfen
    minPunkteGut: 16, minPunkteMittel: 10,
    lueckeGut: 60, lueckeMittel: 90,        // grösste Winkellücke der Punkte um den Mittelpunkt (°)
    restGut: 0.08, restMittel: 0.15,        // Restfehler: Streuung des Abstands zum Kreis / Radius
    // (Werte an 18 eigenen Flügen gewählt: darüber streuen aufeinanderfolgende Schätzungen im selben Aufwind deutlich stärker)
    fluggeschwMinKmh: 15, fluggeschwMaxKmh: 70,   // plausible Fluggeschwindigkeit (Radius)
    // Gültigkeit und Anzeige
    maxAlterMin: 10,          // so lange gilt eine Schätzung
    maxHoeheM: 300,           // so viel GPS-Höhenänderung gegenüber der Schätzung ist erlaubt
    ausblendenMin: 10,        // abgelaufene Werte bleiben so lange zusätzlich abgedunkelt sichtbar
    kursUnsicherKmh: 8,       // darunter ist der Kurs unsicher: Pfeil abgedunkelt
    pfeilKonvention: "nach",  // "nach" = wohin der Wind weht, "von" = woher er kommt
    pfeilKreisen: "mitdrehen" // "mitdrehen" | "eingefroren" | "nord"
  });
  const GRENZEN = {
    minGeschwKmh: [0, 30], minPunkteGut: [5, 200], minPunkteMittel: [5, 200], lueckeGut: [10, 180], lueckeMittel: [10, 240],
    restGut: [0.005, 0.5], restMittel: [0.005, 0.5], fluggeschwMinKmh: [5, 100], fluggeschwMaxKmh: [10, 150],
    maxAlterMin: [1, 120], maxHoeheM: [20, 3000], ausblendenMin: [0, 120], kursUnsicherKmh: [0, 50],
  };
  const AUSWAHL = { pfeilKonvention: ["nach", "von"], pfeilKreisen: ["mitdrehen", "eingefroren", "nord"] };

  function normalisiere(e) {
    e = e && typeof e === "object" ? e : {};
    const out = {};
    for (const k of Object.keys(STANDARD)) {
      if (AUSWAHL[k]) { out[k] = AUSWAHL[k].includes(e[k]) ? e[k] : STANDARD[k]; continue; }
      const v = Number(e[k]);
      const [lo, hi] = GRENZEN[k];
      out[k] = Number.isFinite(v) && e[k] !== null && e[k] !== "" ? Math.min(hi, Math.max(lo, v)) : STANDARD[k];
    }
    if (out.minPunkteMittel > out.minPunkteGut) out.minPunkteMittel = out.minPunkteGut;
    if (out.lueckeMittel < out.lueckeGut) out.lueckeMittel = out.lueckeGut;
    if (out.restMittel < out.restGut) out.restMittel = out.restGut;
    if (out.fluggeschwMaxKmh <= out.fluggeschwMinKmh) out.fluggeschwMaxKmh = out.fluggeschwMinKmh + 5;
    return out;
  }

  const norm360 = (w) => ((w % 360) + 360) % 360;
  // Richtung eines Vektors (ost, nord) in Grad, 0 = Nord
  const richtungVonVektor = (ost, nord) => norm360(Math.atan2(ost, nord) / RAD);
  // Geschwindigkeit (m/s) und Kurs (°) → Vektor
  function geschwVektor(geschwMs, kursGrad) {
    return { ost: geschwMs * Math.sin(kursGrad * RAD), nord: geschwMs * Math.cos(kursGrad * RAD) };
  }

  /* Pfeilwinkel relativ zur Flugrichtung: 0 = oben (Flugrichtung), im Uhrzeigersinn.
     richtungGrad = Richtung, in die der Pfeil zeigen soll (z. B. wohin der Wind weht), kursGrad = Kurs über Grund. */
  function windPfeilWinkel(richtungGrad, kursGrad) {
    return norm360(richtungGrad - kursGrad);
  }

  /* ---------- Kreisanpassung ---------- */
  // Algebraischer Kreis nach Taubin (Newton-Verfahren nach N. Chernov). pts: [{x, y}]
  function kreisTaubin(pts) {
    const n = pts.length;
    if (n < 3) return { ok: false, grund: "weniger als 3 Punkte" };
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= n; my /= n;
    let Mxx = 0, Myy = 0, Mxy = 0, Mxz = 0, Myz = 0, Mzz = 0;
    for (const p of pts) {
      const X = p.x - mx, Y = p.y - my, Z = X * X + Y * Y;
      Mxy += X * Y; Mxx += X * X; Myy += Y * Y; Mxz += X * Z; Myz += Y * Z; Mzz += Z * Z;
    }
    Mxx /= n; Myy /= n; Mxy /= n; Mxz /= n; Myz /= n; Mzz /= n;
    const Mz = Mxx + Myy, Cov_xy = Mxx * Myy - Mxy * Mxy, Var_z = Mzz - Mz * Mz;
    if (!(Mz > 1e-12)) return { ok: false, grund: "alle Punkte gleich" };
    const A3 = 4 * Mz, A2 = -3 * Mz * Mz - Mzz;
    const A1 = Var_z * Mz + 4 * Cov_xy * Mz - Mxz * Mxz - Myz * Myz;
    const A0 = Mxz * (Mxz * Myy - Myz * Mxy) + Myz * (Myz * Mxx - Mxz * Mxy) - Var_z * Cov_xy;
    const A22 = A2 + A2, A33 = A3 + A3 + A3;
    let x = 0, y = 1e20;
    for (let i = 0; i < 99; i++) {
      const yold = y;
      y = A0 + x * (A1 + x * (A2 + x * A3));
      if (Math.abs(y) > Math.abs(yold)) { x = 0; break; }
      const Dy = A1 + x * (A22 + x * A33);
      const xold = x;
      x = xold - y / Dy;
      if (!Number.isFinite(x)) { x = 0; break; }
      if (Math.abs((x - xold) / x) < 1e-12) break;
      if (x < 0) { x = 0; break; }
    }
    const DET = x * x - x * Mz + Cov_xy;
    if (Math.abs(DET) < 1e-14 * Math.max(1, Mz * Mz)) return { ok: false, grund: "Punkte liegen auf einer Geraden" };
    const cx = (Mxz * (Myy - x) - Myz * Mxy) / DET / 2;
    const cy = (Myz * (Mxx - x) - Mxz * Mxy) / DET / 2;
    const r = Math.sqrt(cx * cx + cy * cy + Mz);
    if (!Number.isFinite(r)) return { ok: false, grund: "Anpassung nicht berechenbar" };
    return { ok: true, cx: cx + mx, cy: cy + my, r };
  }

  // Geometrische Verfeinerung (Gauss-Newton mit Dämpfung) der Summe (|p − c| − r)²
  function kreisGeometrisch(pts, start) {
    let cx = start.cx, cy = start.cy, r = start.r;
    const kosten = (cx, cy, r) => { let s = 0; for (const p of pts) { const d = Math.hypot(p.x - cx, p.y - cy) - r; s += d * d; } return s; };
    let f = kosten(cx, cy, r), lambda = 1e-3;
    for (let it = 0; it < 30; it++) {
      let a11 = 0, a12 = 0, a13 = 0, a22 = 0, a23 = 0, a33 = 0, b1 = 0, b2 = 0, b3 = 0;
      for (const p of pts) {
        const dx = p.x - cx, dy = p.y - cy, rho = Math.hypot(dx, dy) || 1e-12;
        const res = rho - r;
        const j1 = -dx / rho, j2 = -dy / rho, j3 = -1;
        a11 += j1 * j1; a12 += j1 * j2; a13 += j1 * j3; a22 += j2 * j2; a23 += j2 * j3; a33 += j3 * j3;
        b1 -= j1 * res; b2 -= j2 * res; b3 -= j3 * res;
      }
      let besser = false;
      for (let tries = 0; tries < 8 && !besser; tries++) {
        const m11 = a11 * (1 + lambda), m22 = a22 * (1 + lambda), m33 = a33 * (1 + lambda);
        const det = m11 * (m22 * m33 - a23 * a23) - a12 * (a12 * m33 - a23 * a13) + a13 * (a12 * a23 - m22 * a13);
        if (Math.abs(det) < 1e-18) { lambda *= 10; continue; }
        const d1 = (b1 * (m22 * m33 - a23 * a23) - a12 * (b2 * m33 - a23 * b3) + a13 * (b2 * a23 - m22 * b3)) / det;
        const d2 = (m11 * (b2 * m33 - a23 * b3) - b1 * (a12 * m33 - a23 * a13) + a13 * (a12 * b3 - b2 * a13)) / det;
        const d3 = (m11 * (m22 * b3 - b2 * a23) - a12 * (a12 * b3 - b2 * a13) + b1 * (a12 * a23 - m22 * a13)) / det;
        const nf = kosten(cx + d1, cy + d2, r + d3);
        if (nf < f) {
          cx += d1; cy += d2; r += d3;
          const fertig = (f - nf) < 1e-12 * Math.max(1, f);
          f = nf; lambda = Math.max(1e-9, lambda / 10); besser = true;
          if (fertig) return { ok: true, cx, cy, r: Math.abs(r) };
        } else lambda *= 10;
      }
      if (!besser) break;
    }
    return { ok: true, cx, cy, r: Math.abs(r) };
  }

  function median(a) {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Robuste Kreisanpassung: Taubin → Ausreisser entfernen und neu anpassen (höchstens 3 Durchgänge) → geometrisch verfeinern.
  // Ausreisser = Abstand zum Kreis weicht um mehr als 3 robuste Standardabweichungen (MAD), mindestens 0.3 m/s, vom Median ab.
  function kreisAnpassung(pts) {
    // Vorfilter gegen grobe Ausreisser (ein einzelner weit entfernter Punkt verzerrt die algebraische Anpassung stark):
    // Abstand zum komponentenweisen Median; weicht er um mehr als max(5 σ, 60 % des Median-Abstands) ab, fällt der Punkt weg.
    let vor = pts;
    if (pts.length >= 8) {
      const c0x = median(pts.map(p => p.x)), c0y = median(pts.map(p => p.y));
      const d = pts.map(p => Math.hypot(p.x - c0x, p.y - c0y));
      const md = median(d), sigma = 1.4826 * median(d.map(x => Math.abs(x - md)));
      const gut = pts.filter((p, i) => Math.abs(d[i] - md) <= Math.max(5 * sigma, 0.6 * md));
      if (gut.length >= Math.max(5, pts.length * 0.6)) vor = gut;
    }
    const t1 = kreisTaubin(vor);
    if (!t1.ok) return Object.assign({ ausreisser: 0, punkte: pts }, t1);
    let basis = t1, punkte = vor;
    for (let durchgang = 0; durchgang < 3; durchgang++) {
      const res = punkte.map(p => Math.hypot(p.x - basis.cx, p.y - basis.cy) - basis.r);
      const med = median(res);
      const sigma = 1.4826 * median(res.map(r => Math.abs(r - med)));
      const grenze = Math.max(3 * sigma, 0.3);   // m/s
      const gut = punkte.filter((p, i) => Math.abs(res[i] - med) <= grenze);
      if (gut.length === punkte.length || gut.length < Math.max(5, pts.length * 0.6)) break;
      const t2 = kreisTaubin(gut);
      if (!t2.ok) break;
      basis = t2; punkte = gut;
    }
    const g = kreisGeometrisch(punkte, basis);
    // Verfeinerung nur übernehmen, wenn sie plausibel bleibt (kein Weglaufen bei sehr kurzen Bögen)
    const fertig = g.ok && Number.isFinite(g.r) && Math.hypot(g.cx - basis.cx, g.cy - basis.cy) < 5 * Math.max(1, basis.r) ? g : basis;
    return { ok: true, cx: fertig.cx, cy: fertig.cy, r: fertig.r, ausreisser: pts.length - punkte.length, punkte };
  }

  // Grösste Lücke (°) zwischen den Winkeln der Punkte um den Mittelpunkt
  function groessteLuecke(pts, cx, cy) {
    if (pts.length < 2) return 360;
    const w = pts.map(p => norm360(Math.atan2(p.x - cx, p.y - cy) / RAD)).sort((a, b) => a - b);
    let max = 360 - w[w.length - 1] + w[0];
    for (let i = 1; i < w.length; i++) max = Math.max(max, w[i] - w[i - 1]);
    return max;
  }

  const STUFEN = ["schlecht", "mittel", "gut"];

  /* Wind aus den Messpunkten eines Kreises schätzen.
     punkte: [{t, ost, nord (m/s)} oder {t, geschw (m/s), kurs (°)}, optional hoehe]
     Ergebnis enthält immer qualitaet und gruende; ok = true nur bei Qualität mittel oder gut. */
  function schaetzeWind(punkte, einstellungen) {
    const e = normalisiere(einstellungen);
    const alle = [];
    for (const p of punkte || []) {
      let ost = p.ost, nord = p.nord;
      if (!(Number.isFinite(ost) && Number.isFinite(nord)) && Number.isFinite(p.geschw) && Number.isFinite(p.kurs)) {
        const v = geschwVektor(p.geschw, p.kurs); ost = v.ost; nord = v.nord;
      }
      if (Number.isFinite(ost) && Number.isFinite(nord)) alle.push({ x: ost, y: nord, t: p.t, hoehe: p.hoehe });
    }
    const brauchbar = alle.filter(p => Math.hypot(p.x, p.y) * 3.6 >= e.minGeschwKmh);
    const basis = { ok: false, qualitaet: "schlecht", gruende: [], nGesamt: (punkte || []).length, nLangsam: alle.length - brauchbar.length,
                    t: brauchbar.length ? brauchbar[brauchbar.length - 1].t : null, hoehe: null };
    const hs = brauchbar.map(p => p.hoehe).filter(Number.isFinite);
    basis.hoehe = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;
    if (brauchbar.length < 5) { basis.gruende.push("zu wenige Messpunkte (" + brauchbar.length + ")"); return basis; }

    const fit = kreisAnpassung(brauchbar);
    if (!fit.ok) { basis.gruende.push("Kreisanpassung: " + fit.grund); return basis; }

    const abst = fit.punkte.map(p => Math.hypot(p.x - fit.cx, p.y - fit.cy) - fit.r);
    const rms = Math.sqrt(abst.reduce((s, d) => s + d * d, 0) / abst.length);
    const restfehler = fit.r > 0 ? rms / fit.r : Infinity;
    const luecke = groessteLuecke(fit.punkte, fit.cx, fit.cy);
    const n = fit.punkte.length;

    const stufe = (wert, gut, mittel, kleinerBesser) => kleinerBesser
      ? (wert <= gut ? 2 : wert <= mittel ? 1 : 0)
      : (wert >= gut ? 2 : wert >= mittel ? 1 : 0);
    const sL = stufe(luecke, e.lueckeGut, e.lueckeMittel, true);
    const sR = stufe(restfehler, e.restGut, e.restMittel, true);
    const sN = stufe(n, e.minPunkteGut, e.minPunkteMittel, false);
    const gruende = [];
    if (sL < 2) gruende.push("Winkellücke " + Math.round(luecke) + "°");
    if (sR < 2) gruende.push("Restfehler " + (restfehler * 100).toFixed(1) + " %");
    if (sN < 2) gruende.push("nur " + n + " Punkte");
    let q = Math.min(sL, sR, sN);
    const vKmh = fit.r * 3.6;
    if (vKmh < e.fluggeschwMinKmh || vKmh > e.fluggeschwMaxKmh) { q = 0; gruende.push("Fluggeschwindigkeit " + Math.round(vKmh) + " km/h unplausibel"); }

    const staerkeMs = Math.hypot(fit.cx, fit.cy);
    const nach = richtungVonVektor(fit.cx, fit.cy);
    return Object.assign(basis, {
      ok: q > 0, qualitaet: STUFEN[q], gruende,
      wind: { ost: fit.cx, nord: fit.cy }, staerkeMs, staerkeKmh: staerkeMs * 3.6,
      richtungNach: nach, richtungVon: norm360(nach + 180),
      fluggeschwMs: fit.r, fluggeschwKmh: vKmh,
      n, nAusreisser: fit.ausreisser, groessteLuecke: luecke, abdeckung: 360 - luecke, restfehler,
      tVon: brauchbar[0].t,
    });
  }

  /* Gegen-/Rückenwind und Seitenwind bezogen auf einen Kurs (werden berechnet, aber nicht angezeigt).
     gegenwindMs > 0 = Gegenwind, < 0 = Rückenwind; seitenwindMs > 0 = Wind weht nach rechts (kommt von links). */
  function windKomponenten(wind, kursGrad) {
    const s = Math.sin(kursGrad * RAD), c = Math.cos(kursGrad * RAD);
    const laengs = wind.ost * s + wind.nord * c;
    const quer = wind.ost * c - wind.nord * s;
    return { gegenwindMs: -laengs, seitenwindMs: quer };
  }
  // Fluggeschwindigkeit durch die Luft aus Geschwindigkeit über Grund und Wind (nur sinnvoll mit gültigem Wind)
  function fluggeschwindigkeit(grund, wind) {
    return Math.hypot(grund.ost - wind.ost, grund.nord - wind.nord);
  }

  /* Gültigkeit einer Schätzung jetzt.
     zustand: "keine" | "aktuell" | "abgelaufen" (abgedunkelt mit Alter) | "aus" (ganz ausgeblendet)
     t in Sekunden (gleiche Zeitbasis wie die Schätzung), hoehe = aktuelle GPS-Höhe (oder null). */
  function gueltigkeit(s, jetzt, einstellungen) {
    const e = normalisiere(einstellungen);
    if (!s || !s.ok) return { zustand: "keine", alterS: null, hoehenDiff: null, grund: "keine Schätzung" };
    const alterS = Math.max(0, jetzt.t - s.t);
    const hoehenDiff = Number.isFinite(jetzt.hoehe) && Number.isFinite(s.hoehe) ? jetzt.hoehe - s.hoehe : null;
    const dh = hoehenDiff === null ? 0 : Math.abs(hoehenDiff);
    if (alterS > (e.maxAlterMin + e.ausblendenMin) * 60 || dh > 2 * e.maxHoeheM)
      return { zustand: "aus", alterS, hoehenDiff, grund: alterS > (e.maxAlterMin + e.ausblendenMin) * 60 ? "zu alt" : "Höhe zu weit weg" };
    if (alterS > e.maxAlterMin * 60) return { zustand: "abgelaufen", alterS, hoehenDiff, grund: "älter als " + e.maxAlterMin + " min" };
    if (dh > e.maxHoeheM) return { zustand: "abgelaufen", alterS, hoehenDiff, grund: "Höhe " + (hoehenDiff > 0 ? "+" : "−") + Math.round(dh) + " m" };
    return { zustand: "aktuell", alterS, hoehenDiff, grund: null };
  }

  function fmtAlter(sek) {
    if (!Number.isFinite(sek)) return "";
    if (sek < 15) return "gerade eben";
    if (sek < 60) return "vor " + Math.round(sek / 10) * 10 + " s";
    return "vor " + Math.floor(sek / 60) + " min";
  }

  /* Darstellung des Pfeils.
     lage: {kurs (°|null), geschwKmh, phase ("gleiten"|"kreisen"), kursEingefroren (°|null)}
     Ergebnis: {sichtbar, winkel (0 = oben, im Uhrzeigersinn), bezug ("kurs"|"eingefroren"|"nord"), beschriftung, gedimmt, grund} */
  function pfeil(s, lage, einstellungen) {
    const e = normalisiere(einstellungen);
    if (!s || !s.ok) return { sichtbar: false, winkel: null, bezug: null, beschriftung: "", gedimmt: false, grund: "keine Schätzung" };
    if (s.staerkeKmh < 2) return { sichtbar: false, winkel: null, bezug: null, beschriftung: "", gedimmt: false, grund: "fast windstill, Richtung unbestimmt" };
    const richtung = e.pfeilKonvention === "von" ? s.richtungVon : s.richtungNach;
    const modus = lage && lage.phase === "kreisen" ? e.pfeilKreisen : "mitdrehen";
    if (modus === "nord") return { sichtbar: true, winkel: norm360(richtung), bezug: "nord", beschriftung: "↑ Nord", gedimmt: false, grund: null };
    if (modus === "eingefroren" && Number.isFinite(lage.kursEingefroren))
      return { sichtbar: true, winkel: windPfeilWinkel(richtung, lage.kursEingefroren), bezug: "eingefroren", beschriftung: "↑ Kurs vor Kreis", gedimmt: false, grund: null };
    const kurs = lage ? lage.kurs : null;
    if (!Number.isFinite(kurs)) return { sichtbar: false, winkel: null, bezug: "kurs", beschriftung: "↑ Kurs", gedimmt: true, grund: "kein Kurs" };
    const unsicher = !(Number.isFinite(lage.geschwKmh) && lage.geschwKmh >= e.kursUnsicherKmh);
    return { sichtbar: true, winkel: windPfeilWinkel(richtung, kurs), bezug: "kurs", beschriftung: "↑ Kurs", gedimmt: unsicher,
             grund: unsicher ? "Kurs unsicher (unter " + e.kursUnsicherKmh + " km/h)" : null };
  }

  /* Verwaltet die Schätzungen eines Flugs: nimmt Fenster der Kreiserkennung ('vollkreis', 'kreisEnde') entgegen,
     behält die neueste brauchbare Schätzung und zählt verworfene Kreise mit Grund. */
  function createWindSchaetzer(einstellungen) {
    let e = normalisiere(einstellungen);
    let aktuell = null;
    const verlauf = [];
    const statistik = { fenster: 0, gut: 0, mittel: 0, schlecht: 0, nichtGueltig: 0, gruende: {} };
    const zaehle = (g) => { statistik.gruende[g] = (statistik.gruende[g] || 0) + 1; };
    function verarbeite(fenster, quelle) {
      statistik.fenster++;
      if (!fenster || !fenster.gueltigFuerWind) {
        statistik.nichtGueltig++;
        zaehle(fenster && fenster.grund ? fenster.grund : "Fenster nicht gültig");
        return null;
      }
      const r = schaetzeWind(fenster.punkte, e);
      r.quelle = quelle || null;
      r.winkelFenster = fenster.winkel;
      statistik[r.qualitaet]++;
      if (!r.ok) for (const g of r.gruende) zaehle(g.replace(/[\d.,]+/g, "#"));
      verlauf.push(r);
      if (verlauf.length > 500) verlauf.shift();
      if (r.ok) aktuell = r;
      return r;
    }
    return {
      verarbeite,
      get aktuell() { return aktuell; },
      verlauf,
      statistik,
      setEinstellungen(neu) { e = normalisiere(Object.assign({}, e, neu)); },
      reset() { aktuell = null; verlauf.length = 0; for (const k of ["fenster", "gut", "mittel", "schlecht", "nichtGueltig"]) statistik[k] = 0; statistik.gruende = {}; },
    };
  }

  return { STANDARD, GRENZEN, AUSWAHL, normalisiere, geschwVektor, richtungVonVektor, windPfeilWinkel,
           kreisTaubin, kreisGeometrisch, kreisAnpassung, groessteLuecke, schaetzeWind, windKomponenten,
           fluggeschwindigkeit, gueltigkeit, fmtAlter, pfeil, createWindSchaetzer, norm360 };
});
