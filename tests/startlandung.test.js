// Tests der Start- und Landeerkennung mit erfundenen Daten (1 Hz).
// Ausführen:  node --test tests/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const SL = require("../startlandung.js");
const { zufall } = require("./sim.js");
const T0 = 1000;

/* Abschnitte: [{dauer (s), kmh, agl (m | null = unbekannt), steigen (m/s)}]; Geschwindigkeit und Höhe leicht verrauscht.
   Liefert Messpunkte {t, geschwindigkeit (m/s), hoehe, agl}. luecken: [[von, bis]] in s ohne Daten. */
function daten(abschnitte, opts) {
  const o = Object.assign({ seed: 1, rauschenKmh: 1, rauschenH: 1.5, startHoehe: 1500, luecken: [] }, opts);
  const z = zufall(o.seed), out = [];
  let t = 0, h = o.startHoehe;
  for (const a of abschnitte) {
    for (let i = 0; i < a.dauer; i++, t++) {
      h += a.steigen || 0;
      const kmh = Math.max(0, a.kmh + o.rauschenKmh * z.normal());
      if (o.luecken.some(([v, b]) => t >= v && t < b)) continue;
      out.push({ t: T0 + t, geschwindigkeit: kmh / 3.6, hoehe: h + o.rauschenH * z.normal(),
                 agl: a.agl === null ? null : a.agl + (a.aglSteigen || 0) * i + o.rauschenH * z.normal() });
    }
  }
  return out;
}
function lauf(punkte, vorbereiten, einst) {
  const d = SL.createStartLandeDetektor(einst);
  const ev = [];
  for (const n of ["start", "fehlstart", "landung"]) d.on(n, (x) => ev.push(Object.assign({ name: n }, x)));
  (vorbereiten || ((x) => x.warten()))(d);
  for (const p of punkte) d.update(p);
  return { d, ev, namen: ev.map(x => x.name) };
}
// typischer Flug: 60 s stehen, 6 s Startlauf, 120 s abfliegen und aufsteigen, 10 min fliegen, Landeanflug, stehen
const FLUG = [
  { dauer: 60, kmh: 0, agl: 2 },
  { dauer: 6, kmh: 12, agl: 2 },
  { dauer: 120, kmh: 32, agl: 5, aglSteigen: 1.5 },
  { dauer: 600, kmh: 35, agl: 300, steigen: 0.2 },
  { dauer: 60, kmh: 30, agl: 60, aglSteigen: -1, steigen: -1 },
  { dauer: 90, kmh: 0.5, agl: 1 },
];

test("Einstellungen", () => {
  assert.deepEqual(SL.normalisiere(null), Object.assign({}, SL.STANDARD));
  const e = SL.normalisiere({ landungAuto: false, startGeschwKmh: 999, landDauerS: "45", startAglM: "quatsch" });
  assert.equal(e.landungAuto, false);
  assert.equal(e.startGeschwKmh, 60);
  assert.equal(e.landDauerS, 45);
  assert.equal(e.startAglM, SL.STANDARD.startAglM);
  assert.equal(SL.normalisiere({ landungAuto: "false" }).landungAuto, true, "nur echte Wahrheitswerte");
});

test("Normaler Flug: Start mit Startlauf erkannt, Landung erkannt", (t) => {
  const r = lauf(daten(FLUG));
  assert.deepEqual(r.namen, ["start", "landung"]);
  const s = r.ev[0], l = r.ev[1];
  assert.ok(s.startT >= T0 + 58 && s.startT <= T0 + 70, "Flugbeginn beim Startlauf: " + (s.startT - T0));
  assert.ok(s.t - T0 < 60 + 6 + 40, "Start erkannt nach " + (s.t - T0 - 60) + " s");
  assert.match(s.grund, /Höhe über Grund/);
  const bodenAb = T0 + 60 + 6 + 120 + 600 + 60;
  assert.ok(Math.abs(l.landeT - bodenAb) <= 3, "Landezeit " + (l.landeT - bodenAb));
  assert.ok(l.t - bodenAb >= 30 && l.t - bodenAb < 35, "Landung gemeldet nach " + (l.t - bodenAb) + " s");
  assert.equal(r.d.getZustand().zustand, "aus");
  t.diagnostic(`Start ${s.t - s.startT} s nach Beginn des Startlaufs gemeldet, Landung ${l.t - bodenAb} s nach dem Aufsetzen`);
});

test("Landeerkennung aus: Flug läuft weiter", () => {
  const r = lauf(daten(FLUG), null, { landungAuto: false });
  assert.deepEqual(r.namen, ["start"]);
  assert.equal(r.d.getZustand().zustand, "fliegt");
});

test("Autofahrt am Boden (AGL bekannt, Höhe ändert sich): kein Start", () => {
  const r = lauf(daten([{ dauer: 30, kmh: 0, agl: 1 }, { dauer: 900, kmh: 50, agl: 2, steigen: -1 }, { dauer: 60, kmh: 0, agl: 1 }]));
  assert.deepEqual(r.namen, []);
  assert.equal(r.d.getZustand().zustand, "wartet");
});

test("Brücke: kurz hoch über Grund reicht nicht", () => {
  const r = lauf(daten([{ dauer: 60, kmh: 60, agl: 1 }, { dauer: 3, kmh: 60, agl: 40 }, { dauer: 60, kmh: 60, agl: 1 }], { rauschenH: 0.5 }));
  assert.deepEqual(r.namen, []);
});

test("Abgebrochener Startversuch ohne Abheben: kein Start", () => {
  const r = lauf(daten([{ dauer: 30, kmh: 0, agl: 2 }, { dauer: 8, kmh: 14, agl: 3 }, { dauer: 60, kmh: 0, agl: 3 }]));
  assert.deepEqual(r.namen, []);
});

test("Fehlstart: kurz in der Luft, gleich wieder stehen → Flug verwerfen und neu warten", () => {
  const r = lauf(daten([
    { dauer: 20, kmh: 0, agl: 2 },
    { dauer: 25, kmh: 25, agl: 30 },       // z. B. kurz abgehoben oder Messfehler
    { dauer: 30, kmh: 0, agl: 3 },          // steht wieder am Hang
    ...FLUG,                                // danach echter Flug
  ]));
  assert.deepEqual(r.namen, ["start", "fehlstart", "start", "landung"]);
  assert.ok(r.ev[1].t - r.ev[0].t < 60, "Fehlstart nach " + (r.ev[1].t - r.ev[0].t) + " s");
  assert.ok(r.ev[2].startT > r.ev[1].t, "zweiter Start nach dem Fehlstart");
});

test("Starker Wind: knapp über dem Hang fast stillstehen ist kein Fehlstart", () => {
  const r = lauf(daten([
    { dauer: 20, kmh: 0, agl: 2 },
    { dauer: 20, kmh: 20, agl: 30 },        // Start erkannt
    { dauer: 30, kmh: 2, agl: 30 },         // hängt 30 m über Grund vor dem Hang
    { dauer: 200, kmh: 20, agl: 80 },
  ], { rauschenKmh: 0.5 }));
  assert.deepEqual(r.namen, ["start"]);
  assert.equal(r.d.getZustand().zustand, "fliegt");
});

test("Ohne Geländedaten: Fehlstart nur zurück auf der Höhe des Startlaufs", () => {
  const hoch = lauf(daten([
    { dauer: 20, kmh: 0, agl: null },
    { dauer: 25, kmh: 25, agl: null, steigen: -1.5 },   // abfliegen, 37 m unter dem Startplatz
    { dauer: 30, kmh: 2, agl: null },                    // steht in der Luft
  ], { rauschenKmh: 0.5 }));
  assert.deepEqual(hoch.namen, ["start"], "nicht beim Startplatz: kein Fehlstart");
  const zurueck = lauf(daten([
    { dauer: 20, kmh: 0, agl: null },
    { dauer: 20, kmh: 25, agl: null, steigen: -2 },
    { dauer: 20, kmh: 3, agl: null, steigen: 2 },      // zurück auf die Höhe des Startlaufs
    { dauer: 30, kmh: 0, agl: null },
  ], { rauschenKmh: 0.5 }));
  assert.deepEqual(zurueck.namen, ["start", "fehlstart"]);
});

test("Nach dem Fehlstart-Fenster: Stillstand ist eine Landung, kein Fehlstart", () => {
  const r = lauf(daten([{ dauer: 20, kmh: 0, agl: 2 }, { dauer: 200, kmh: 30, agl: 80 }, { dauer: 60, kmh: 0, agl: 2 }]));
  assert.deepEqual(r.namen, ["start", "landung"]);
});

test("Stehen in der Luft bei starkem Wind (AGL hoch, Höhe schwankt): keine Landung", () => {
  const r = lauf(daten([{ dauer: 20, kmh: 0, agl: 2 }, { dauer: 120, kmh: 30, agl: 80 },
                         { dauer: 300, kmh: 2, agl: 80 }, { dauer: 300, kmh: 1, agl: null, steigen: 0.5 }], { rauschenKmh: 0.5 }));
  assert.deepEqual(r.namen, ["start"]);
});

test("Ohne Geländedaten: Start über die Höhenänderung, Landung über ruhige Höhe", () => {
  const ohne = FLUG.map(a => Object.assign({}, a, { agl: null, steigen: a.kmh > 20 && a.dauer === 120 ? -1 : a.steigen }));
  const r = lauf(daten(ohne));
  assert.deepEqual(r.namen, ["start", "landung"]);
  assert.match(r.ev[0].grund, /Höhenänderung/);
  assert.ok(r.ev[0].startT >= T0 + 58 && r.ev[0].startT <= T0 + 70, "Flugbeginn " + (r.ev[0].startT - T0));
});

test("Datenlücke: laufende Phasen beginnen neu", () => {
  // Bewegung und AGL vor und nach einer 20-s-Lücke je nur 5 s: ohne Lücke wäre das ein Start
  const r = lauf(daten([{ dauer: 20, kmh: 0, agl: 2 }, { dauer: 30, kmh: 30, agl: 50 }, { dauer: 30, kmh: 0, agl: 2 }],
                       { luecken: [[25, 45]] }));
  assert.deepEqual(r.namen, []);
});

test("Von Hand gestartet: keine Landung am Startplatz, Landung erst nach dem Flug, nie Fehlstart", () => {
  const r = lauf(daten(FLUG), (d) => d.flugBegonnen(T0));
  assert.deepEqual(r.namen, ["landung"]);
  assert.equal(r.ev[0].auto, false);
  const nurStehen = lauf(daten([{ dauer: 300, kmh: 0, agl: 2 }]), (d) => d.flugBegonnen(T0));
  assert.deepEqual(nurStehen.namen, []);
  assert.equal(nurStehen.d.getZustand().zustand, "fliegt");
});

test("Aus: erkennt nichts", () => {
  const r = lauf(daten(FLUG), () => {});
  assert.deepEqual(r.namen, []);
  assert.equal(r.d.getZustand().zustand, "aus");
});

test("Nach der Landung wieder warten: zweiter Flug wird erkannt", () => {
  const d = SL.createStartLandeDetektor();
  const ev = [];
  d.on("start", () => ev.push("start"));
  d.on("landung", () => { ev.push("landung"); d.warten(); });
  d.warten();
  const p1 = daten(FLUG), p2 = daten(FLUG, { seed: 2 }).map(p => Object.assign({}, p, { t: p.t + 2000 }));
  for (const p of p1) d.update(p);
  // eine Lücke zwischen den Flügen (Fahrt nach oben ohne Verbindung) setzt nur die Phasen zurück
  for (const p of p2) d.update(p);
  assert.deepEqual(ev, ["start", "landung", "start", "landung"]);
});

test("Fehler in einem Rückruf: Ereignis fehler, Erkennung läuft weiter", () => {
  const d = SL.createStartLandeDetektor();
  const fehler = [];
  d.on("fehler", (f) => fehler.push(f.ereignis));
  d.on("start", () => { throw new Error("Test"); });
  d.warten();
  for (const p of daten(FLUG)) d.update(p);
  assert.deepEqual(fehler, ["start"]);
  assert.equal(d.getZustand().zustand, "aus", "Landung trotzdem erkannt");
});
