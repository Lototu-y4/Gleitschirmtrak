// Tests der XContest-Bewertung (xcontest.js) mit erfundenen Tracks.  Ausführen:  node --test tests/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const XC = require("../xcontest.js");
const { zufall } = require("./sim.js");

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} ≉ ${b} (±${eps})`);
const R = 6371008.8, RAD = Math.PI / 180, LAT0 = 46.7, LON0 = 7.9;
// lokale Meter (Ost, Nord) um LAT0/LON0 → Position
const pos = (ost, nord) => ({ lat: LAT0 + nord / R / RAD, lon: LON0 + ost / (R * Math.cos(LAT0 * RAD)) / RAD });
// Gerade Linien zwischen Eckpunkten, alle schritt Meter ein Punkt
function strecke(ecken, schritt) {
  const out = [];
  for (let k = 0; k + 1 < ecken.length; k++) {
    const [a, b] = [ecken[k], ecken[k + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / schritt));
    for (let i = 0; i < n; i++) out.push(pos(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n));
  }
  out.push(pos(...ecken[ecken.length - 1]));
  return out;
}
const km = (P, i, j) => XC.wgs84(P[i].lat, P[i].lon, P[j].lat, P[j].lon) / 1000;

test("Vincenty: bekannte Strecke und Gleichheit mit der Kugel auf wenige Promille", () => {
  // Flinders Peak → Buninyong (Vincenty 1975, Beispiel von Geoscience Australia): 54 972.271 m
  near(XC.wgs84(-37.95103342, 144.42486789, -37.65282114, 143.92649554), 54972.271, 0.01);
  const d1 = XC.wgs84(46.5, 7.5, 47.0, 8.2), d2 = XC.haversine(46.5, 7.5, 47.0, 8.2);
  assert.ok(Math.abs(d1 - d2) / d1 < 0.004);
  assert.equal(XC.wgs84(46.5, 7.5, 46.5, 7.5), 0);
});

test("Gerade Strecke: freie Distanz = Anfang bis Ende", () => {
  const P = strecke([[0, 0], [30000, 10000]], 50);
  const r = XC.bewerte(P);
  near(r.varianten.frei.km, km(P, 0, P.length - 1), 0.011);
  assert.equal(r.bestes.typ, "frei");
  assert.equal(r.bestes.punkte, r.bestes.km);
});

test("Hin und zurück zählt als geschlossenes flaches Dreieck (Faktor 1.4)", () => {
  const P = strecke([[0, 0], [10000, 0], [0, 0]], 50);
  const r = XC.bewerte(P);
  assert.equal(r.bestes.typ, "flachZu");
  const weit = P.findIndex(p => p.lon === Math.max(...P.map(q => q.lon)));
  near(r.bestes.km, 2 * km(P, 0, weit), 0.011);
  near(r.bestes.punkte, r.bestes.km * 1.4, 0.011);
  assert.equal(r.varianten.fai, null, "zwei gleiche Wendepunkte sind nie FAI");
});

test("Gleichseitiges, geschlossenes Dreieck: geschlossenes FAI (1.6)", () => {
  const s = 10000, h = s * Math.sqrt(3) / 2;
  const P = strecke([[0, 0], [s, 0], [s / 2, h], [0, 0]], 40);
  const r = XC.bewerte(P);
  assert.equal(r.bestes.typ, "faiZu");
  near(r.bestes.km, 30, 0.1);
  near(r.bestes.punkte, Math.round(r.bestes.km * 1.6 * 100) / 100, 1e-9);
  near(r.bestes.schluss.distM, 0, 1);
});

test("Dreieck mit Lücke: Distanz = Umfang − Schlussabstand, unter 5 % geschlossen, darüber offen", () => {
  const s = 10000, h = s * Math.sqrt(3) / 2;
  // Ende 2 km neben dem Start (≈ 6.7 % des Umfangs): FAI 1.4, nicht geschlossen
  const P = strecke([[0, 0], [s, 0], [s / 2, h], [2000 * Math.cos(2.1), 2000 * Math.sin(2.1)]], 40);
  const r = XC.bewerte(P);
  const v = r.varianten.fai;
  assert.ok(v, "FAI-Dreieck gefunden");
  near(v.km, (v.umfangM - v.schluss.distM) / 1000, 0.006);
  assert.ok(v.schluss.distM / v.umfangM < 0.2 && v.schluss.distM / v.umfangM >= 0.05 - 1e-9 || r.varianten.faiZu, "Schluss passt zur Art");
  assert.ok(r.bestes.punkte >= v.punkte);
});

test("Spitzes Dreieck: das grosse ist flach, ein kleineres FAI-Dreieck darin ist kürzer", () => {
  const P = strecke([[0, 0], [12000, 0], [12000, 2500], [0, 0]], 40);
  const r = XC.bewerte(P);
  const v = r.varianten.flachZu, p = v.seitenM.reduce((a, b) => a + b);
  assert.ok(Math.min(...v.seitenM) < 0.28 * p, "das grosse Dreieck ist nicht FAI");
  near(v.km, 26.8, 0.1);
  // FAI geht nur mit einem Teil des Tracks; Start und Ziel dürfen irgendwo vor bzw. nach den Wendepunkten liegen,
  // hier beide am Startplatz → Schluss 0
  const f = r.varianten.faiZu, pf = f.seitenM.reduce((a, b) => a + b);
  assert.ok(Math.min(...f.seitenM) >= 0.28 * pf);
  assert.ok(f.km < v.km);
  assert.equal(r.bestes.typ, "flachZu", "1.4 × 26.8 schlägt 1.6 × 11.5");
});

// Brute Force auf kleinen Tracks: alle 5-Tupel (frei) und alle Tripel mit exaktem Schluss (Dreiecke), auf der Kugel gesucht
function bruteForce(P) {
  const n = P.length, d = (i, j) => XC.haversine(P[i].lat, P[i].lon, P[j].lat, P[j].lon);
  let bf = -1, bfi = null;
  for (let a = 0; a < n; a++) for (let b = a; b < n; b++) for (let c = b; c < n; c++) for (let e = c; e < n; e++) for (let f = e; f < n; f++) {
    const w = d(a, b) + d(b, c) + d(c, e) + d(e, f);
    if (w > bf) { bf = w; bfi = [a, b, c, e, f]; }
  }
  const C = (i, k) => { let m = Infinity; for (let s = 0; s <= i; s++) for (let f = k; f < n; f++) m = Math.min(m, d(s, f)); return m; };
  const best = { flach: -1, fai: -1, flachZu: -1, faiZu: -1 };
  for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) {
    const c = C(i, k);
    for (let j = i + 1; j < k; j++) {
      const x = d(i, j), y = d(j, k), z = d(k, i), p = x + y + z, fai = Math.min(x, y, z) >= 0.28 * p;
      if (c < 0.2 * p) { best.flach = Math.max(best.flach, 1.2 * (p - c)); if (fai) best.fai = Math.max(best.fai, 1.4 * (p - c)); }
      if (c < 0.05 * p) { best.flachZu = Math.max(best.flachZu, 1.4 * (p - c)); if (fai) best.faiZu = Math.max(best.faiZu, 1.6 * (p - c)); }
    }
  }
  return { frei: bf, best };
}

test("Zufällige kurze Tracks: gleiches Ergebnis wie Brute Force", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const z = zufall(seed);
    // Zufallsweg mit 26 Punkten, Schritte 200–1500 m, dazu gelegentlich Rückkehr Richtung Start
    const P = [pos(0, 0)];
    let x = 0, y = 0, kurs = z.u() * 2 * Math.PI;
    for (let i = 1; i < 26; i++) {
      kurs += (z.u() - 0.5) * 2.2;
      if (i > 16 && z.u() < 0.5) kurs = Math.atan2(-x, -y);
      const L = 200 + z.u() * 1300;
      x += L * Math.sin(kurs); y += L * Math.cos(kurs);
      P.push(pos(x, y));
    }
    const r = XC.bewerte(P), b = bruteForce(P);
    near(r.varianten.frei.distM, b.frei, b.frei * 0.004 + 1, "frei seed " + seed);
    for (const t of ["flach", "fai", "flachZu", "faiZu"]) {
      const v = r.varianten[t];
      if (b.best[t] < 0) { assert.equal(v, null, t + " seed " + seed + " sollte fehlen"); continue; }
      assert.ok(v, t + " seed " + seed + " fehlt (Brute Force " + (b.best[t] / 1000).toFixed(2) + " P)");
      near(v.punkte, b.best[t] / 1000, b.best[t] / 1000 * 0.004 + 0.02, t + " seed " + seed);
    }
  }
});

test("Zu wenige Punkte: kein Ergebnis, kein Fehler", () => {
  const r = XC.bewerte([pos(0, 0), pos(10, 0)]);
  assert.equal(r.bestes, null);
});
