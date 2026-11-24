// Tests für das Lesen von IGC-Dateien (werkzeuge/igc.js).  Ausführen:  node --test tests/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const igc = require("../werkzeuge/igc.js");
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("Koordinaten DDMMmmm / DDDMMmmm mit Halbkugel", () => {
  near(igc.parseKoordinate("4716218N", 2), 47 + 16.218 / 60, 1e-12);
  near(igc.parseKoordinate("00733664E", 3), 7 + 33.664 / 60, 1e-12);
  near(igc.parseKoordinate("3352000S", 2), -(33 + 52 / 60), 1e-12);
  near(igc.parseKoordinate("12030500W", 3), -(120 + 30.5 / 60), 1e-12);
  assert.equal(igc.parseKoordinate("4760000N", 2), null, "Minuten ≥ 60");
  assert.equal(igc.parseKoordinate("471621N", 2), null);
  assert.equal(igc.parseKoordinate("4716218X", 2), null);
});

test("I-Record und B-Records mit Erweiterungen, negative Höhe, Mitternacht", () => {
  const text = [
    "AXWM000", "HFDTE120926", "HFPLTPILOTINCHARGE:Test",
    "I053638FXA3941VXA4244GSP4547CCO4850HDT",
    "B2359584716218N00733664EA0118001180002003021082000",
    "B2359594716217N00733669EA-0012-00150020030211220000",
    "B0000004716216N00733674EV0118101181002003020058000",
    "Bkaputt",
    "LXXX Kommentar",
  ].join("\r\n");
  const r = igc.parseIgc(text);
  assert.equal(r.datum, "120926");
  assert.deepEqual(r.ext.map(e => e.code), ["FXA", "VXA", "GSP", "CCO", "HDT"]);
  assert.equal(r.fixes.length, 3);
  assert.equal(r.verworfen, 1);
  const [a, b, c] = r.fixes;
  assert.equal(a.t, 23 * 3600 + 59 * 60 + 58);
  assert.equal(a.pHoehe, 1180); assert.equal(a.gHoehe, 1180);
  assert.equal(a.ext.GSP, 21); assert.equal(a.ext.CCO, 82); assert.equal(a.ext.FXA, 2);
  assert.equal(b.pHoehe, -12); assert.equal(b.gHoehe, -15);
  assert.equal(c.t, 86400, "nach Mitternacht fortlaufend");
  assert.equal(c.gueltig, false);
  assert.equal(a.gueltig, true);
});

test("Lokale Meter und Geschwindigkeitsvektoren aus Positionen", () => {
  // Geradeaus nach Ost mit 10 m/s, 1 Hz, auf 47° Breite
  const lat = 47, k = Math.PI / 180, R = igc.R_ERDE;
  const fixes = Array.from({ length: 10 }, (_, i) => ({ t: 100 + i, lat, lon: 7 + (10 * i) / (R * Math.cos(lat * k)) / k }));
  const m = igc.lokaleMeter(fixes);
  near(m[9].ost, 90, 1e-6); near(m[9].nord, 0, 1e-6);
  const v = igc.geschwVektoren(fixes);
  for (const x of v) { near(x.geschw, 10, 1e-6); near(x.kurs, 90, 1e-6); }
  // Lücke > maxDt: einseitige Differenz, einzelner Punkt ohne Nachbarn → null
  const mitLuecke = [fixes[0], fixes[1], Object.assign({}, fixes[2], { t: 120 }), Object.assign({}, fixes[3], { t: 140 })];
  const w = igc.geschwVektoren(mitLuecke);
  near(w[0].geschw, 10, 1e-6);
  assert.equal(w[3].geschw, null);
  assert.equal(w[2].geschw, null);
});
