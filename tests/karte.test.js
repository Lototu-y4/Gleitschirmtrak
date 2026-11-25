// Tests der Kartenberechnungen (karte.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../karte.js");

const nahe = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + ` ${a} statt ${b} (±${tol})`);

test("Web Mercator: bekannte Kachel und Hin-/Rückweg", () => {
  // Kachel 13/4265/2884 (Bern) aus der WMTS-Prüfung
  const w = K.zuWelt(46.905, 7.45, 13);
  assert.equal(Math.floor(w.x / 256), 4265);
  assert.equal(Math.floor(w.y / 256), 2884);
  const r = K.ausWelt(w.x, w.y, 13);
  nahe(r.lat, 46.905, 1e-9); nahe(r.lon, 7.45, 1e-9);
  nahe(K.lonZuX(-180, 0), 0, 1e-9); nahe(K.latZuY(0, 1), 256, 1e-9);
});

test("Meter pro Pixel und Massstab", () => {
  nahe(K.meterProPixel(0, 0), 156543.03, 0.01);
  nahe(K.meterProPixel(46.8, 12), 26.16, 0.05);
  const m = K.massstab(26.16, 120);   // 120 px ≈ 3.1 km → 2 km
  assert.equal(m.meter, 2000); assert.equal(m.text, "2 km"); nahe(m.px, 76.5, 0.1);
  assert.equal(K.massstab(1, 120).text, "100 m");
});

test("Gebiet Schweiz", () => {
  assert.ok(K.imGebiet(46.68, 7.86));        // Interlaken
  assert.ok(K.imGebiet(45.83, 6.86) === true); // Rand bei Chamonix liegt noch im Rand von 10 km? (Breite 45.83 > 45.72)
  assert.ok(!K.imGebiet(45.60, 10.70));      // Gardasee
  assert.ok(!K.imGebiet(NaN, 8));
  assert.ok(K.kachelImGebiet(13, 4265, 2884));
  assert.ok(!K.kachelImGebiet(13, 0, 0));
});

test("Ansicht: Bild ↔ Welt mit Drehung", () => {
  const v = { z: 12, cx: 100000, cy: 50000, ax: 200, ay: 300, rot: 90 };
  // Kurs 90° (Osten) oben: ein Punkt östlich der Position erscheint über ihr
  const b = K.weltZuBild(v, 100100, 50000);
  nahe(b.x, 200, 1e-9); nahe(b.y, 200, 1e-9);
  for (const [x, y] of [[0, 0], [400, 600], [123, 45]]) {
    const w = K.bildZuWelt(v, x, y), z = K.weltZuBild(v, w.x, w.y);
    nahe(z.x, x, 1e-9); nahe(z.y, y, 1e-9);
  }
  // ohne Drehung: Norden oben
  const n = K.weltZuBild(Object.assign({}, v, { rot: 0 }), 100000, 49900);
  nahe(n.x, 200, 1e-9); nahe(n.y, 200, 1e-9);
});

test("Kacheln für eine gedrehte Ansicht: deckt alle Ecken, nächste zuerst", () => {
  const c = K.zuWelt(46.68, 7.86, 12);
  for (const rot of [0, 33, 90, 200]) {
    const v = { z: 12, cx: c.x, cy: c.y, ax: 195, ay: 260, rot };
    const k = K.kachelnFuerAnsicht(v, 390, 420);
    const set = new Set(k.map(t => t.x + "/" + t.y));
    for (const [bx, by] of [[0, 0], [390, 0], [0, 420], [390, 420], [195, 260]]) {
      const w = K.bildZuWelt(v, bx, by);
      assert.ok(set.has(Math.floor(w.x / 256) + "/" + Math.floor(w.y / 256)), `Ecke ${bx},${by} bei ${rot}°`);
    }
    assert.equal(k[0].x, Math.floor(c.x / 256)); assert.equal(k[0].y, Math.floor(c.y / 256));
    assert.ok(k.length <= 12, "nicht zu viele Kacheln: " + k.length);
  }
});

test("Kacheln im Umkreis: Anzahl und Begrenzung auf das Gebiet", () => {
  const k = K.kachelnUmkreis(46.68, 7.86, 30000, 8, 14);
  const proStufe = {};
  for (const t of k) proStufe[t.z] = (proStufe[t.z] || 0) + 1;
  assert.ok(proStufe[14] > 1000 && proStufe[14] < 1700, "z14: " + proStufe[14]);
  assert.ok(proStufe[12] > 60 && proStufe[12] < 140, "z12: " + proStufe[12]);
  for (const t of k) assert.ok(K.kachelImGebiet(t.z, t.x, t.y));
  // am Rand (Genf) wird abgeschnitten
  const g = K.kachelnUmkreis(46.20, 6.14, 30000, 12, 12);
  assert.ok(g.length < proStufe[12], "Genf: " + g.length);
});

test("Distanz, Peilung, nötige Gleitzahl", () => {
  // 1' Breite ≈ 1853 m
  nahe(K.distanz(46, 8, 46 + 1 / 60, 8), 1853.2, 1);
  nahe(K.peilung(46, 8, 47, 8), 0, 1e-9);
  nahe(K.peilung(46, 8, 46, 8.1), 90, 0.05);
  nahe(K.peilung(46, 8, 45.9, 8), 180, 1e-9);
  nahe(K.peilung(46, 8, 46, 7.9), 270, 0.05);
  const g = K.noetigeGleitzahl(10000, 2000, 1000);
  assert.equal(g.gz, 10); assert.equal(g.hoeheUeber, 1000);
  assert.equal(K.noetigeGleitzahl(10000, 900, 1000).gz, null);
  assert.equal(K.noetigeGleitzahl(10000, null, 1000).gz, null);
});

test("LV95 ↔ WGS84 (Beispiel von swisstopo)", () => {
  // swisstopo-Beispiel: 46° 2' 38.87" N, 8° 43' 49.79" E ↔ E 2'700'000, N 1'100'000 (Näherung ~1 m)
  const lat = 46 + 2 / 60 + 38.87 / 3600, lon = 8 + 43 / 60 + 49.79 / 3600;
  const c = K.wgs84ZuLv95(lat, lon);
  nahe(c.e, 2699999.76, 1.5); nahe(c.n, 1099999.97, 1.5);
  const w = K.lv95ZuWgs84(2700000, 1100000);
  nahe(w.lat, lat, 2e-5); nahe(w.lon, lon, 2e-5);
});

test("Koordinaten aus Text lesen", () => {
  let r = K.leseKoordinaten("46.68, 7.86");
  assert.equal(r.format, "WGS84"); assert.equal(r.lat, 46.68); assert.equal(r.lon, 7.86);
  r = K.leseKoordinaten("46,68 7,86");
  assert.equal(r.lat, 46.68); assert.equal(r.lon, 7.86);
  r = K.leseKoordinaten("2'700'000 / 1'100'000");
  assert.equal(r.format, "LV95"); nahe(r.lat, 46.0441, 1e-3); nahe(r.lon, 8.7305, 1e-3);
  r = K.leseKoordinaten("1100000 2700000");   // vertauscht
  assert.equal(r.format, "LV95"); nahe(r.lon, 8.7305, 1e-3);
  r = K.leseKoordinaten("700000/100000");
  assert.equal(r.format, "LV03"); nahe(r.lat, 46.0441, 1e-3);
  assert.equal(K.leseKoordinaten("hallo"), null);
  assert.equal(K.leseKoordinaten(""), null);
  assert.equal(K.leseKoordinaten("123, 456"), null);
  const w = K.lv95ZuWgs84(2700000, 1100000);
  assert.equal(K.formatKoordinaten(w.lat, w.lon), "2'700'000 / 1'100'000");
  assert.equal(K.formatKoordinaten(45.5, 10.7), "45.50000, 10.70000");   // ausserhalb: WGS84
});

test("Spur: Mindestdistanz und Ausdünnen", () => {
  const s = [];
  assert.ok(K.spurHinzu(s, 46, 8, 15, 100));
  assert.ok(!K.spurHinzu(s, 46.00005, 8, 15, 100));   // 5.6 m
  for (let i = 1; i <= 150; i++) K.spurHinzu(s, 46 + i * 0.001, 8, 15, 100);
  assert.ok(s.length <= 100, "Länge " + s.length);
  assert.equal(s[s.length - 1].lat, 46 + 150 * 0.001);   // neuester Punkt bleibt
  assert.equal(s[0].lat, 46);                           // ältester auch
});

test("passendeAnsicht: ganze Spur ins Bild, grösste passende Zoomstufe, Mitte", () => {
  const pkt = [{ lat: 46.60, lon: 7.80 }, { lat: 46.70, lon: 7.95 }, { lat: 46.65, lon: 7.90 }];
  const a = K.passendeAnsicht(pkt, 400, 300, 6, 15, 20);
  // Breite der Spur auf Stufe z muss passen, auf z+1 nicht mehr
  const breite = (z) => K.lonZuX(7.95, z) - K.lonZuX(7.80, z), hoehe = (z) => K.latZuY(46.60, z) - K.latZuY(46.70, z);
  assert.ok(breite(a.z) <= 360 && hoehe(a.z) <= 260);
  assert.ok(breite(a.z + 1) > 360 || hoehe(a.z + 1) > 260);
  assert.ok(Math.abs(a.lon - 7.875) < 1e-9);
  assert.ok(a.lat > 46.6 && a.lat < 46.7);
  assert.equal(K.passendeAnsicht([], 400, 300, 6, 15, 20), null);
  assert.equal(K.passendeAnsicht([{ lat: 46.6, lon: 7.8 }], 400, 300, 6, 15, 20).z, 15, "ein Punkt: höchste Stufe");
});
