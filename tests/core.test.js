// Tests für die reinen Funktionen in index.html (Block zwischen /*CORE-BEGIN*/ und /*CORE-END*/).
// Ausführen:  node --test tests/core.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = /\/\*CORE-BEGIN\*\/([\s\S]*?)\/\*CORE-END\*\//.exec(html);
assert.ok(m, "CORE-Block in index.html nicht gefunden");
const Core = vm.runInNewContext(m[1] + "\n;Core");

// Hilfen: NMEA-Zeile mit korrekter Prüfsumme bauen
const nmea = (body) => "$" + body + "*" + Core.nmeaChecksum(body);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

/* ---------------- Prüfsumme ---------------- */
test("Prüfsumme: bekannte Zeilen sind gültig", () => {
  // Beispiel aus XCSoar XCTracer/Parser.cpp
  assert.equal(Core.checkLine("$LXWP0,N,,119.9,0.16,,,,,,259,,*64").ok, true);
  // klassische NMEA-Beispiele
  assert.equal(Core.checkLine("$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47").ok, true);
  assert.equal(Core.checkLine("$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A").ok, true);
  assert.equal(Core.checkLine("$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6a").ok, true, "Kleinbuchstaben-Hex");
});
test("Prüfsumme: Fehlerfälle werden erkannt", () => {
  assert.equal(Core.checkLine("$LXWP0,N,,119.9,0.17,,,,,,259,,*64").reason, "bad");
  assert.equal(Core.checkLine("$LXWP0,N,,119.9,0.16,,,,,,259,,").reason, "nocs");
  assert.equal(Core.checkLine("LXWP0,N*00").reason, "format");
  assert.equal(Core.checkLine("$LXWP0,N*G1").reason, "format");
  assert.equal(Core.parseSentence("$LXWP0,N,,119.9,0.17,,,,,,259,,*64").ok, false);
});

/* ---------------- Parser ---------------- */
test("GGA: Position, Höhe, Satelliten, HDOP", () => {
  const p = Core.parseSentence("$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47");
  assert.equal(p.ok, true); assert.equal(p.type, "gga");
  const g = p.data;
  near(g.lat, 48 + 7.038 / 60); near(g.lon, 11 + 31 / 60);
  assert.equal(g.quality, 1); assert.equal(g.sats, 8); assert.equal(g.hdop, 0.9);
  assert.equal(g.alt, 545.4); assert.equal(g.geoidSep, 46.9);
  assert.equal(g.time.hhmmss, "123519");
  assert.equal(Core.ggaHasFix(g), true);
});
test("GGA: Süd/West negativ, GN-Talker, kein Fix, leere Felder", () => {
  const g = Core.parseSentence(nmea("GNGGA,000001.00,3352.1280,S,15112.5560,W,1,05,1.4,12.0,M,,M,,")).data;
  assert.ok(g.lat < 0 && g.lon < 0); assert.equal(g.geoidSep, null);
  const nofix = Core.parseSentence(nmea("GPGGA,120000.00,,,,,0,00,99.99,,,,,,")).data;
  assert.equal(nofix.quality, 0); assert.equal(nofix.lat, null); assert.equal(nofix.alt, null);
  assert.equal(Core.ggaHasFix(nofix), false);
  // Höhe in anderer Einheit als M wird nicht übernommen (nichts erfinden)
  assert.equal(Core.parseSentence(nmea("GPGGA,120000,4700.000,N,00800.000,E,1,07,1.0,1000,F,,,,")).data.alt, null);
  // zu wenige Felder → verworfen
  assert.equal(Core.parseSentence(nmea("GPGGA,120000,4700.000,N")).ok, false);
});
test("RMC: Geschwindigkeit, Kurs, Datum, Status", () => {
  const r = Core.parseSentence("$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A").data;
  assert.equal(r.valid, true); assert.equal(r.speedKn, 22.4); assert.equal(r.course, 84.4);
  assert.equal(r.date.ddmmyy, "230394");
  near(r.speedKn * Core.KN_TO_KMH, 41.4848);
  near(r.speedKn * Core.KN_TO_MS, 22.4 * 1852 / 3600);
  const v = Core.parseSentence(nmea("GPRMC,123520,V,,,,,,,230394,,,N")).data;
  assert.equal(v.valid, false); assert.equal(v.speedKn, null);
});
test("LXWP0: Vario und Baro-Höhe (XCTracer und allgemein)", () => {
  const x = Core.parseSentence("$LXWP0,N,,119.9,0.16,,,,,,259,,*64").data;
  assert.equal(x.vario, 0.16); assert.equal(x.baroAlt, 119.9);
  const lx = Core.parseSentence(nmea("LXWP0,Y,222.3,1665.5,1.71,1.8,1.9,2.0,2.1,2.2,239,174,10.1")).data;
  assert.equal(lx.vario, 1.71);
  const neg = Core.parseSentence(nmea("LXWP0,N,,850.2,-2.35,,,,,,,,")).data;
  assert.equal(neg.vario, -2.35);
  const empty = Core.parseSentence(nmea("LXWP0,N,,850.2,,,,,,,,,")).data;
  assert.equal(empty.vario, null);
  assert.equal(Core.parseSentence(nmea("PFLAU,0,1,1,1,0,,0,,")).type, "other");
});

/* ---------------- Gleitende Fenster ---------------- */
// Hilfen: Proben mit fester Rate erzeugen
function series(buf, t0, t1, hz, fn) {
  for (let t = t0; t <= t1 + 1e-9; t += 1000 / hz) Core.pushSample(buf, t, fn(t), 200000);
  return buf;
}
const HOLD = 2000, COV = 0.9;

test("Integriertes Steigen: konstantes Steigen und Sinken", () => {
  const up = series([], 0, 30000, 10, () => 2.0);
  const r = Core.windowMean(up, 30000, 16000, HOLD, COV);
  assert.equal(r.state, "ok"); near(r.mean, 2.0);
  const down = series([], 0, 30000, 10, () => -1.3);
  near(Core.windowMean(down, 30000, 16000, HOLD, COV).mean, -1.3);
});
test("Integriertes Steigen: zeitgewichtet, nicht nach Anzahl Proben", () => {
  // viele Proben mit 0 m/s, dann eine einzelne Probe mit 5 m/s, die 0.9 s gilt
  const buf = [];
  series(buf, 0, 9000, 10, () => 0);           // 0 … 9 s: 0 m/s mit 10 Hz (91 Proben)
  series(buf, 9100, 9100, 1, () => 5);          // 9.1 … 10 s: 5 m/s, eine einzige Probe
  const r = Core.windowMean(buf, 10000, 10000, HOLD, COV);
  // 9.1 s × 0 + 0.9 s × 5 = 4.5 → / 10 s = 0.45 (Proben-Mittel wäre 5/92 ≈ 0.054)
  near(r.mean, 0.45, 1e-9);
});
test("Integriertes Steigen: Fenster füllt sich am Anfang", () => {
  const buf = series([], 1000, 9000, 10, () => 1);
  const r = Core.windowMean(buf, 9000, 16000, HOLD, COV);
  assert.equal(r.state, "filling"); assert.equal(r.valid, false); near(r.mean, 1);
});
test("Integriertes Steigen: Datenlücke", () => {
  const buf = [];
  series(buf, 0, 10000, 10, () => 1);
  series(buf, 15000, 26000, 10, () => 1);       // 5 s ohne Daten, davon 3 s ungedeckt (2 s Haltezeit)
  const r = Core.windowMean(buf, 26000, 16000, HOLD, COV);   // Fenster 10…26 s
  assert.equal(r.state, "gap"); near(r.coverage, 13 / 16, 1e-3);
  // kurze Lücke (1.5 s) wird von der Haltezeit überbrückt
  const b2 = [];
  series(b2, 0, 10000, 10, () => 1); series(b2, 11500, 26000, 10, () => 1);
  assert.equal(Core.windowMean(b2, 26000, 16000, HOLD, COV).state, "ok");
});
test("Fenster: veraltete Daten (Strom abgerissen) → keine gültige Anzeige", () => {
  const buf = series([], 0, 20000, 10, () => 3);
  const r = Core.windowMean(buf, 30000, 16000, HOLD, COV);   // seit 10 s nichts mehr
  assert.equal(r.valid, false);
  assert.equal(Core.windowMean(buf, 60000, 16000, HOLD, COV).state, "nodata");
  assert.equal(Core.windowMean([], 1000, 16000, HOLD, COV).state, "nodata");
});
test("pushSample hält Puffer klein, behält eine Probe vor dem Fenster", () => {
  const buf = [];
  for (let t = 0; t <= 300000; t += 100) Core.pushSample(buf, t, 1, 127000);
  assert.ok(buf.length <= 1272 && buf.length > 1200, String(buf.length));
  assert.ok(buf[0].t <= 300000 - 127000);
});

/* ---------------- Gleitzahl ---------------- */
function glideFor(speedMs, vario, opts = {}) {
  const sp = [], va = [];
  const t1 = opts.t1 || 20000;
  series(sp, opts.speedFrom || 0, t1, 1, () => speedMs);       // GPS 1 Hz
  series(va, opts.varioFrom || 0, t1, 10, () => vario);        // Vario 10 Hz
  const W = 10000;
  return Core.glideRatio(Core.windowMean(sp, t1, W, HOLD, COV), Core.windowMean(va, t1, W, HOLD, COV), opts.max || 60);
}
test("Gleitzahl: Geradeausflug", () => {
  const g = glideFor(10, -1.0);                // 36 km/h, 1 m/s Sinken
  assert.equal(g.state, "ok"); near(g.value, 10);
  near(glideFor(9.5, -1.1).value, 9.5 / 1.1);
});
test("Gleitzahl: Steigen ergibt negativen Wert", () => {
  const g = glideFor(8, 2.0);
  assert.equal(g.state, "ok"); near(g.value, -4);
});
test("Gleitzahl: Randfälle", () => {
  assert.equal(glideFor(10, 0).state, "limit", "Vario 0 → unendlich → Strich");
  assert.equal(glideFor(10, -0.1).state, "limit", "100 > 60 → Strich");
  assert.equal(glideFor(10, -0.1, { max: 200 }).state, "ok");
  assert.equal(glideFor(12, -0.2).state, "ok", "Betrag genau 60 wird noch angezeigt");
  assert.equal(glideFor(0, -1.2).value, 0, "Stillstand über Grund bei Sinken → 0");
  assert.equal(glideFor(10, -1, { speedFrom: 15000 }).state, "filling");
  const noSpeed = Core.glideRatio({ state: "nodata", valid: false, mean: null }, { state: "ok", valid: true, mean: -1 }, 60);
  assert.equal(noSpeed.state, "nodata");
  // Datenlücke im GPS
  const sp = [], va = [];
  series(sp, 0, 8000, 1, () => 10); series(sp, 14000, 20000, 1, () => 10);
  series(va, 0, 20000, 10, () => -1);
  const gap = Core.glideRatio(Core.windowMean(sp, 20000, 10000, HOLD, COV), Core.windowMean(va, 20000, 10000, HOLD, COV), 60);
  assert.equal(gap.state, "gap");
});

/* ---------------- Formatierung ---------------- */
test("Formatierung: Vorzeichen, Gleitzahl, Kurs, Dauer", () => {
  assert.equal(Core.fmtSigned(1.24, 1).text, "+1.2");
  assert.equal(Core.fmtSigned(-0.86, 1).text, Core.MINUS + "0.9");
  assert.equal(Core.fmtSigned(-0.04, 1).text, "0.0"); assert.equal(Core.fmtSigned(-0.04, 1).sign, 0);
  assert.equal(Core.fmtSigned(null, 1), null);
  assert.equal(Core.fmtGlide(8.26), "8.3"); assert.equal(Core.fmtGlide(12.4), "12");
  assert.equal(Core.fmtGlide(-4), Core.MINUS + "4.0"); assert.equal(Core.fmtGlide(-0.01), "0.0");
  assert.equal(Core.compass8(0), "N"); assert.equal(Core.compass8(90), "O"); assert.equal(Core.compass8(359), "N");
  assert.equal(Core.compass8(225), "SW");
  assert.equal(Core.fmtDuration(3723000), "1:02:03");
  assert.equal(Core.nextMax(null, 100), 100); assert.equal(Core.nextMax(100, 90), 100); assert.equal(Core.nextMax(100, null), 100);
});

/* ---------------- IGC ---------------- */
test("IGC: Koordinaten und Höhen nach Spezifikation", () => {
  assert.equal(Core.igcLat(48 + 7.038 / 60), "4807038N");
  assert.equal(Core.igcLon(11 + 31 / 60), "01131000E");
  assert.equal(Core.igcLat(-(33 + 52.128 / 60)), "3352128S");
  assert.equal(Core.igcLon(-(151 + 12.556 / 60)), "15112556W");
  assert.equal(Core.igcLat(46 + 59.99996 / 60), "4700000N", "Rundung auf 60.000' trägt in die Grade über");
  assert.equal(Core.igcAlt(545.4), "00545");
  assert.equal(Core.igcAlt(-12), "-0012");
  assert.equal(Core.igcAlt(null), "00000");
  assert.equal(Core.igcAlt(123456), "99999");
});
test("IGC: Datei mit Kopf, Kennzeichnung, B-Records im 1-Hz-Takt", () => {
  const fixes = [];
  // 5 Hz GPS über 3 Sekunden → genau 3 B-Records erwartet
  for (let s = 0; s < 3; s++) for (let k = 0; k < 5; k++)
    fixes.push({ utc: "1200" + String(s).padStart(2, "0"), date: "221126", lat: 46.5 + s * 1e-4, lon: 7.25, q: 1, alt: 1500 + s, sep: 48.2, pAlt: 1480 + s });
  const r = Core.buildIgc(fixes, { pilot: "Jürg Müller", glider: "Testschirm", version: "t1" });
  assert.equal(r.bCount, 3);
  const lines = r.text.split("\r\n");
  assert.equal(lines[lines.length - 1], "", "endet mit CRLF");
  assert.ok(!/[^\r]\n/.test(r.text), "nur CRLF als Zeilenende");
  assert.ok(lines[0].startsWith("AXEBBLEAPP"), lines[0]);
  assert.ok(lines.includes("HFDTEDATE:221126,01"));
  assert.ok(lines.includes("HFPLTPILOTINCHARGE:Juerg Mueller"), "Umlaute ersetzt");
  assert.ok(lines.includes("HFDTMGPSDATUM:WGS84"));
  assert.ok(lines.some(l => l.startsWith("HFFRSSECURITYSUSPECT:") && l.includes("NICHT SIGNIERT") && l.includes("WETTBEWERB")));
  assert.ok(lines.includes("HFALGALTGPS:ELL"), "Geoid-Abstand vorhanden → Ellipsoid-Höhe");
  assert.ok(lines.includes("HFALPALTPRESSURE:ISA"));
  assert.ok(!lines.some(l => l.startsWith("G")), "kein G-Record");
  const b = lines.filter(l => l.startsWith("B"));
  assert.equal(b.length, 3);
  for (const l of b) assert.equal(l.length, 35, l);
  assert.equal(b[0], "B120000" + "4630000N" + "00715000E" + "A" + "01480" + "01548");
  assert.equal(r.fileName, "2026-11-22-XEB-BLEAPP-01.igc");
  // nur gültige IGC-Zeichen (0x20–0x7D ohne ! $ * \ ^)
  for (const l of lines) assert.ok(!/[^\x20-\x7D]|[!$*\\^]/.test(l), "ungültiges Zeichen in: " + l);
});
test("IGC: Fix-Verlust, fehlender Geoid-Abstand, kein Baro, Datum-Rückfall", () => {
  const fixes = [
    { utc: "235958", date: null, lat: null, lon: null, q: 0, alt: null, sep: null, pAlt: null },  // vor erstem Fix: ausgelassen
    { utc: "235959", date: null, lat: 47, lon: 8, q: 1, alt: 900, sep: null, pAlt: null },
    { utc: "000000", date: null, lat: null, lon: null, q: 0, alt: null, sep: null, pAlt: null },  // Fix verloren
    { utc: "000001", date: null, lat: 47.001, lon: 8, q: 1, alt: -5, sep: null, pAlt: null },
  ];
  const r = Core.buildIgc(fixes, { fallbackDate: "311226" });
  const b = r.text.split("\r\n").filter(l => l.startsWith("B"));
  assert.equal(b.length, 3);
  assert.equal(b[1], "B000000" + "4700000N" + "00800000E" + "V" + "00000" + "00000", "letzte Position wiederholt, V, GNSS-Höhe 0");
  assert.ok(b[2].endsWith("A00000-0005"));
  assert.ok(r.text.includes("HFALGALTGPS:GEO"), "ohne Geoid-Abstand → Höhe über Meer (GEO)");
  assert.ok(r.text.includes("HFALPALTPRESSURE:NIL"));
  assert.ok(r.text.includes("HFDTEDATE:311226,01"));
  assert.equal(Core.buildIgc([], {}).bCount, 0);
});
test("ddmmyyUTC", () => {
  assert.equal(Core.ddmmyyUTC(Date.UTC(2026, 10, 22, 23, 59)), "221126");
});
