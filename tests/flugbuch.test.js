// Tests der Logbuch-Auswertung (flugbuch.js) mit erfundenen Flügen.  Ausführen:  node --test tests/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const FB = require("../flugbuch.js");

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} ≉ ${b} (±${eps})`);
const R = 6371008.8, RAD = Math.PI / 180;

/* Flug aus Phasen, 1 Hz: [{dauer (s), geschw (m/s über Grund), rate (°/s), vz (m/s)}].
   Gibt Punkte {t, lat, lon, h} wie punkteAusApp / punkteAusIgc. */
function flug(phasen, o) {
  o = Object.assign({ lat: 46.68, lon: 7.86, h: 1500, t0: Date.UTC(2026, 6, 14, 11, 0, 0) / 1000, kurs: 90 }, o);
  const out = [];
  let x = 0, y = 0, h = o.h, kurs = o.kurs, t = o.t0;
  const p = () => out.push({ t, lat: o.lat + y / R / RAD, lon: o.lon + x / (R * Math.cos(o.lat * RAD)) / RAD, h });
  p();
  for (const ph of phasen) {
    for (let s = 0; s < ph.dauer; s++) {
      kurs += ph.rate || 0;
      x += ph.geschw * Math.sin(kurs * RAD); y += ph.geschw * Math.cos(kurs * RAD); h += ph.vz || 0; t += 1;
      p();
    }
  }
  return out;
}
const BODEN = (dauer) => ({ dauer, geschw: 0, vz: 0 });
const GLEITEN = (dauer) => ({ dauer, geschw: 10, vz: -1 });
const THERMIK = (dauer, vz) => ({ dauer, geschw: 10, rate: 18, vz });

test("Einfacher Flug: Start und Landung erkannt, Dauer, Höhen, eine Thermik, Gleitzahl 10", () => {
  const P = flug([BODEN(60), { dauer: 5, geschw: 5, vz: 0 }, GLEITEN(300), THERMIK(300, 2), GLEITEN(300), BODEN(90)]);
  const w = FB.analysiere(P);
  assert.equal(w.startErkannt, true);
  assert.equal(w.landungErkannt, true);
  near(w.dauerS, 905, 4, "Dauer vom Startlauf bis zum Stillstand");
  near(w.hMax, 1800, 3);
  near(w.start.h, 1500, 2);
  near(w.gewinnUeberStart, 300, 4);
  near(w.gewinnKumuliert, 600, 15);
  assert.equal(w.thermiken.anzahl, 1);
  near(w.thermiken.liste[0].gewinnM, 600, 30);
  near(w.thermiken.steigenMittel, 2, 0.15);
  near(w.gleiten.gz, 10, 0.6);
  assert.equal(w.gleiten.abschnitte, 2);
  near(w.streckeM, 9025, 30);
  // XContest: geradeaus 3 km, Thermik, geradeaus 3 km in gedrehter Richtung → freie Strecke etwa 6 km oder Dreieck
  assert.ok(w.xc.bestes && w.xc.bestes.km > 3);
  assert.equal(w.xc.bestes.wp.length, w.xc.bestes.typ === "frei" ? 5 : 3);
});

test("Probierkreise ohne Höhengewinn zählen nicht als Thermik, aber auch nicht als Gleiten", () => {
  const P = flug([BODEN(30), { dauer: 5, geschw: 5 }, GLEITEN(200), THERMIK(80, -0.5), GLEITEN(200), THERMIK(240, 1.5), GLEITEN(200), BODEN(60)]);
  const w = FB.analysiere(P);
  assert.equal(w.thermiken.anzahl, 1, "nur die steigende Thermik");
  near(w.thermiken.steigenMittel, 1.5, 0.15);
  near(w.gleiten.gz, 10, 0.6, "Kreise mit Sinken verfälschen die Gleitzahl nicht");
});

test("Soaren auf Starthöhe: ohne Geländedaten spät erkannt, mit bekanntem Start (aus dem Flug) richtig", () => {
  const P = flug([BODEN(30), { dauer: 5, geschw: 5 }, { dauer: 180, geschw: 8, vz: 0 }, GLEITEN(300), BODEN(60)]);
  const ohne = FB.analysiere(P);
  assert.ok(ohne.dauerS < 420, "ohne Geländedaten beginnt der Flug erst beim Gleiten (" + ohne.dauerS + " s)");
  const mit = FB.analysiere(P, { startT: P[0].t + 30 });
  assert.equal(mit.startErkannt, true);
  assert.equal(mit.landungErkannt, true);
  near(mit.dauerS, 485, 4);
  near(mit.start.h, 1500, 2);
  // bekannter Start ausserhalb des Tracks: wird ignoriert
  assert.equal(FB.analysiere(P, { startT: P[0].t - 1000 }).dauerS, ohne.dauerS);
});

test("Ohne Bewegung: ganzer Track, Start nicht erkannt", () => {
  const P = flug([BODEN(120)]);
  const w = FB.analysiere(P);
  assert.equal(w.startErkannt, false);
  assert.equal(w.thermiken.anzahl, 0);
  assert.equal(w.gleiten.gz, null);
});

test("App-Fixes: Datum, Mitternacht, doppelte Sekunden, ungültige Fixes, fehlende Höhe", () => {
  const fx = [
    { utc: "235958", date: "130726", lat: 46.7, lon: 7.9, q: 1, alt: 1000 },
    { utc: "235958", date: "130726", lat: 46.7, lon: 7.9, q: 1, alt: 1001 },   // gleiche Sekunde
    { utc: "235959", date: null, lat: 46.7, lon: 7.9, q: 0, alt: 1002 },       // kein Fix
    { utc: "000000", date: "130726", lat: 46.7001, lon: 7.9, q: 1, alt: null }, // Datum noch vom Vortag
    { utc: "000001", date: "140726", lat: 46.7002, lon: 7.9, q: 1, alt: 1004 },
  ];
  const p = FB.punkteAusApp(fx, Date.UTC(2026, 6, 13, 23, 0));
  assert.equal(p.length, 3);
  assert.equal(p[0].t, Date.UTC(2026, 6, 13, 23, 59, 58) / 1000);
  assert.equal(p[1].t, Date.UTC(2026, 6, 14, 0, 0, 0) / 1000);
  assert.equal(p[2].t, Date.UTC(2026, 6, 14, 0, 0, 1) / 1000);
  assert.equal(p[1].h, 1000, "fehlende Höhe mit der vorigen gefüllt");
  // ohne Datum in den Fixes: Datum aus dem Beginn der Aufzeichnung
  const q = FB.punkteAusApp([{ utc: "101010", date: null, lat: 46, lon: 7, q: 1, alt: 5 }], Date.UTC(2026, 4, 2, 10, 0));
  assert.equal(q[0].t, Date.UTC(2026, 4, 2, 10, 10, 10) / 1000);
});

test("IGC: Datum, GNSS-Höhe, Druckhöhe als Ersatz, Kopf, Fehler", () => {
  const b = (hhmmss, lat, gps, baro) => "B" + hhmmss + lat + "00752000E" + "A" + baro + gps;
  const zeilen = ["AXXX001", "HFDTEDATE:140726,01", "HFPLTPILOTINCHARGE:Test Pilot", "HFGTYGLIDERTYPE:Testschirm"];
  for (let i = 0; i < 12; i++) zeilen.push(b("1200" + String(i).padStart(2, "0"), "4641" + String(i).padStart(3, "0") + "N", "01500", "01450"));
  const r = FB.punkteAusIgc(zeilen.join("\r\n"));
  assert.equal(r.punkte.length, 12);
  assert.equal(r.punkte[0].t, Date.UTC(2026, 6, 14, 12, 0, 0) / 1000);
  assert.equal(r.punkte[0].h, 1500);
  assert.equal(r.hoeheQuelle, "gps");
  assert.equal(r.kopf.pilot, "Test Pilot");
  assert.equal(r.kopf.schirm, "Testschirm");
  const ohneGps = zeilen.map(z => z[0] === "B" ? z.slice(0, 30) + "00000" : z).join("\n");
  const r2 = FB.punkteAusIgc(ohneGps);
  assert.equal(r2.hoeheQuelle, "baro");
  assert.equal(r2.punkte[0].h, 1450);
  assert.throws(() => FB.punkteAusIgc("AXXX\nHFDTE140726\n"), /keine Positionen/);
  assert.throws(() => FB.punkteAusIgc(zeilen.filter(z => !z.startsWith("HFDTE")).join("\n")), /kein Datum/);
});

test("Kumulierter Höhengewinn mit Hysterese: Rauschen zählt nicht", () => {
  assert.equal(FB.kumuliert([0, 3, 0, 3, 0, 3, 0], 5), 0);
  assert.equal(FB.kumuliert([0, 100, 50, 150], 5), 200);
  assert.equal(FB.kumuliert([100, 90, 80], 5), 0);
});

test("Name, Saison, Duplikat", () => {
  const w = { startT: Date.UTC(2026, 6, 14, 10, 32) / 1000, start: { lat: 46.68, lon: 7.86 } };
  assert.equal(FB.standardName(w, [{ name: "Weit weg", lat: 46.9, lon: 7.86 }, { name: "Amisbühl", lat: 46.681, lon: 7.861 }]), "Amisbühl");
  assert.match(FB.standardName(w, []), /^Flug \d\d:\d\d$/);
  assert.equal(FB.saisonVon(w.startT), 2026);
  assert.equal(FB.istDuplikat(w, { startT: w.startT + 60, start: { lat: 46.6805, lon: 7.86 } }), true);
  assert.equal(FB.istDuplikat(w, { startT: w.startT + 600, start: w.start }), false);
  assert.equal(FB.istDuplikat(w, { startT: w.startT, start: { lat: 46.70, lon: 7.86 } }), false);
});

test("Statistik: gesamt und pro Kalenderjahr, gewichtete Mittel, Rekorde", () => {
  const werte = (jahr, dauerS, hMax, km, th, glDist, glVerlust) => ({
    startT: Date.UTC(jahr, 6, 1, 10) / 1000, dauerS, hMax, gewinnUeberStart: hMax - 1000, gewinnKumuliert: 500, streckeM: 1000,
    xc: { bestes: { km, punkte: km * 1.2 } },
    thermiken: { anzahl: th.length, gewinnM: th.reduce((s, x) => s + x.g, 0), zeitS: th.reduce((s, x) => s + x.z, 0), liste: th.map(x => ({ steigen: x.g / x.z })) },
    gleiten: { distM: glDist, verlustM: glVerlust },
  });
  const f = [
    { id: 1, name: "A", werte: werte(2025, 3600, 2500, 20, [{ g: 400, z: 200 }], 10000, 1000) },
    { id: 2, name: "B", werte: werte(2026, 1800, 3100, 10, [{ g: 300, z: 300 }, { g: 300, z: 100 }], 8000, 1000) },
    { id: 3, name: "C", werte: werte(2026, 600, 1800, 5, [], 0, 0) },
  ];
  const s = FB.statistik(f);
  assert.equal(s.gesamt.anzahl, 3);
  assert.equal(s.gesamt.dauerS, 6000);
  near(s.gesamt.xcKm, 35, 1e-9);
  near(s.gesamt.steigenMittel, 1000 / 600, 0.01);
  near(s.gesamt.gzMittel, 9, 1e-9);
  assert.equal(s.gesamt.hMax.id, 2);
  assert.equal(s.gesamt.dauerMax.id, 1);
  assert.equal(s.gesamt.steigenBest.wert, 3);
  assert.deepEqual(s.saisons.map(x => x.jahr), [2026, 2025]);
  assert.equal(s.saisons[0].anzahl, 2);
  near(s.saisons[0].xcPunkte, 18, 1e-9);
  assert.equal(FB.statistik([]).gesamt.anzahl, 0);
});

test("Sicherung: Dateinamen eindeutig und ohne verbotene Zeichen", () => {
  const v = new Set(), t = new Date(2026, 6, 14, 10, 32).getTime() / 1000;
  const f = (name) => ({ name, werte: { startT: t } });
  assert.equal(FB.sicherungsName(f("Amisbühl"), v), "2026-07-14 1032 Amisbühl");
  assert.equal(FB.sicherungsName(f("Amisbühl"), v), "2026-07-14 1032 Amisbühl (2)");
  assert.equal(FB.sicherungsName(f("amisbühl"), v), "2026-07-14 1032 amisbühl (3)", "Gross/klein zählt als gleich (Windows, iOS)");
  assert.equal(FB.sicherungsName(f('a/b:c*?"<>|\\  d.'), v), "2026-07-14 1032 a_b_c_______ d");
  assert.equal(FB.sicherungsName(f(""), v), "2026-07-14 1032");
});

test("Sicherung: Verzeichnis schreiben und wieder lesen, fehlerhafte Einträge, fremde und neuere Dateien", () => {
  const P = flug([BODEN(30), { dauer: 5, geschw: 5 }, GLEITEN(200), THERMIK(200, 2), GLEITEN(200), BODEN(60)]);
  const werte = FB.analysiere(P);
  const a = { id: "i1", sid: null, quelle: "igc", name: "Importiert", werte };
  const b = { id: 1752487920000, sid: 1752487920000, quelle: "aufzeichnung", name: "Aufgezeichnet", startBekannt: 1752487950, werte };
  const kaputt = { id: "i2", quelle: "igc", name: "Ohne Werte" };
  const v = FB.sicherungVerzeichnis([{ flug: a, igc: "IGC/a.igc" }, { flug: b, igc: "IGC/b.igc", daten: "daten/1752487920000.json" }, { flug: kaputt, igc: "IGC/c.igc" }],
    "2026-11-25.1", Date.UTC(2026, 10, 25, 8));
  const r = FB.sicherungLesen(JSON.stringify(v));
  assert.equal(r.erstellt, "2026-11-25T08:00:00.000Z");
  assert.equal(r.app, "2026-11-25.1");
  assert.equal(r.eintraege.length, 2);
  assert.deepEqual(r.eintraege[0].flug, a);
  assert.deepEqual(r.eintraege[1].flug, b, "Werte, bekannter Start und ids bleiben genau gleich");
  assert.equal(r.eintraege[1].daten, "daten/1752487920000.json");
  assert.deepEqual(r.fehler, ["Ohne Werte"]);
  // aufgezeichneter Flug ohne Rohdaten-Datei ist unbrauchbar
  assert.equal(FB.sicherungLesen(JSON.stringify(FB.sicherungVerzeichnis([{ flug: b, igc: "IGC/b.igc" }], "", 0))).eintraege.length, 0);
  assert.throws(() => FB.sicherungLesen("{kaputt"), /nicht lesbar/);
  assert.throws(() => FB.sicherungLesen(JSON.stringify({ format: "anderes", fluege: [] })), /keine Logbuch-Sicherung/);
  assert.throws(() => FB.sicherungLesen(JSON.stringify(Object.assign({}, v, { version: 99 }))), /neueren App-Version/);
  // Rohdaten einer Aufzeichnung
  const d = FB.aufzeichnungLesen(JSON.stringify({ session: { id: b.sid, start: b.sid }, fixes: [{ utc: "120000" }] }), b.sid);
  assert.equal(d.fixes.length, 1);
  assert.throws(() => FB.aufzeichnungLesen(JSON.stringify({ session: { id: 5 }, fixes: [] }), b.sid), /passt nicht/);
});
