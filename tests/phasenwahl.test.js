// Tests der Phasenwahl Thermik/Gleiten (Grundlage des automatischen Seitenwechsels) mit erfundenen Daten.
// Ausführen:  node --test tests/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../kreisen.js");
const { simuliere, windVektor } = require("./sim.js");
const T0 = 1000;

// Daten durch Detektor und Phasenwahl schicken; liefert Moduswechsel, Thermik-Zeit und Episoden
function lauf(abschnitte, simOpts, seite) {
  const daten = simuliere(abschnitte, Object.assign({ seed: 1, rauschenKurs: 3, rauschenGeschw: 0.3, wind: windVektor(15, 250) }, simOpts));
  const det = K.createKreisDetektor();
  const pw = K.createPhasenwahl(det, seite);
  const wechsel = [], episoden = [];
  pw.on("modus", (m) => { wechsel.push({ t: m.t - T0, modus: m.modus, grund: m.grund }); if (m.modus === "gleiten") episoden.push(m.letzteThermik); });
  let thermikZeit = 0, letzt = null;
  for (const p of daten) {
    det.update(p);
    const z = pw.tick(p.t, p.hoehe);
    if (letzt !== null && z.modus === "thermik") thermikZeit += p.t - letzt;
    letzt = p.t;
  }
  const ende = daten[daten.length - 1].t;
  for (let t = ende + 1; t <= ende + 40; t++) { det.tick(t); pw.tick(t, null); }
  return { wechsel, episoden, thermikZeit, pw, gesamt: ende - daten[0].t };
}

test("Einstellungen der Phasenwahl", () => {
  assert.deepEqual(K.normalisiereSeite(null), Object.assign({}, K.STANDARD_SEITE));
  const e = K.normalisiereSeite({ autoWechsel: false, eintritt: "quatsch", wechselHaltS: 999, achterSperreS: "60" });
  assert.deepEqual(e, { autoWechsel: false, eintritt: "beginn", wechselHaltS: 120, achterSperreS: 60 });
});

test("Thermik: früher Wechsel, Rückkehr nach dem Kreisen, Höhengewinn", (t) => {
  // 20 s gerade, 5 Rechtskreise mit 20 °/s, 40 s gerade; 1.5 m/s Steigen durchgehend
  const r = lauf([{ dauer: 20, rate: 0 }, { dauer: 90, rate: 20 }, { dauer: 40, rate: 0 }], { steigen: 1.5 });
  assert.deepEqual(r.wechsel.map(w => w.modus), ["thermik", "gleiten"]);
  const ein = r.wechsel[0].t - 20, aus = r.wechsel[1].t - 110;
  assert.ok(ein > 8 && ein < 16, "Wechsel zur Thermik nach " + ein + " s");
  assert.ok(aus > 5 && aus < 13, "Wechsel zurück nach " + aus + " s");
  const ep = r.episoden[0];
  assert.equal(ep.kreise, 5);
  const gewinn = ep.hoeheEnde - ep.hoeheBeginn;
  assert.ok(Math.abs(gewinn - 1.5 * (ep.ende - ep.beginn)) < 5, "Höhengewinn " + gewinn);
  assert.ok(Math.abs(ep.beginn - (T0 + 20)) < 3, "Thermik beginnt mit dem Andrehen");
  t.diagnostic(`Thermik-Seite ${ein.toFixed(1)} s nach Drehbeginn, Gleiten-Seite ${aus.toFixed(1)} s nach Drehende, Höhengewinn ${gewinn.toFixed(0)} m`);
});

test("Wechsel der Drehrichtung im Bart: bleibt eine Thermik", () => {
  const r = lauf([{ dauer: 20, rate: 0 }, { dauer: 54, rate: 20 }, { dauer: 60, rate: -18 }, { dauer: 40, rate: 0 }], { steigen: 1 });
  assert.deepEqual(r.wechsel.map(w => w.modus), ["thermik", "gleiten"]);
  assert.ok(r.episoden[0].kreise >= 4, "Kreise " + r.episoden[0].kreise);   // 2 × ~3 Kreise, je Richtung erst ab vollen 360°
});

test("Richtungswechsel und dann geradeaus: zurück zu Gleiten ohne lange Wartezeit", () => {
  const r = lauf([{ dauer: 20, rate: 0 }, { dauer: 54, rate: 20 }, { dauer: 6, rate: -20 }, { dauer: 60, rate: 0 }]);
  assert.deepEqual(r.wechsel.map(w => w.modus), ["thermik", "gleiten"]);
  assert.ok(r.wechsel[1].t < 54 + 20 + 6 + 20, "zurück nach " + r.wechsel[1].t + " s");
});

test("Soaring mit langen Achten (ohne volle Kreise): Gleiten", (t) => {
  // Bögen von 200° (unter der Kreisschwelle): nie Thermik
  const kurz = lauf([{ dauer: 20, rate: 0 }, ...Array.from({ length: 10 }, (_, i) => ({ dauer: 12.5, rate: i % 2 ? -16 : 16 })), { dauer: 20, rate: 0 }]);
  assert.equal(kurz.wechsel.length, 0);
  // Bögen von 300° (lösen "Kreisen beginnt" aus): höchstens eine kurze Thermik am Anfang, danach Gleiten (Achter-Sperre)
  const lang = lauf([{ dauer: 20, rate: 0 }, ...Array.from({ length: 10 }, (_, i) => ({ dauer: 15, rate: i % 2 ? -20 : 20 })), { dauer: 20, rate: 0 }]);
  assert.ok(lang.episoden.length <= 1, "Episoden " + lang.episoden.length);
  assert.ok(lang.thermikZeit < 0.25 * lang.gesamt, "Thermik-Zeit " + lang.thermikZeit.toFixed(0) + " von " + lang.gesamt.toFixed(0) + " s");
  assert.equal(lang.pw.getZustand().modus, "gleiten");
  // mit Eintritt erst nach vollem Kreis: gar keine Thermik
  const voll = lauf([{ dauer: 20, rate: 0 }, ...Array.from({ length: 10 }, (_, i) => ({ dauer: 15, rate: i % 2 ? -20 : 20 })), { dauer: 20, rate: 0 }], {}, { eintritt: "vollkreis" });
  assert.equal(voll.wechsel.length, 0);
  t.diagnostic(`Achter 300°: ${lang.episoden.length} Thermik-Episode(n), ${lang.thermikZeit.toFixed(0)} s von ${lang.gesamt.toFixed(0)} s auf der Thermik-Seite`);
});

test("Nach Achtern: echte Thermik kommt trotzdem (beim ersten vollen Kreis)", () => {
  const r = lauf([{ dauer: 20, rate: 0 }, ...Array.from({ length: 4 }, (_, i) => ({ dauer: 15, rate: i % 2 ? -20 : 20 })), { dauer: 10, rate: 0 },
                  { dauer: 90, rate: 20 }, { dauer: 30, rate: 0 }]);
  const letzte = r.episoden[r.episoden.length - 1];
  assert.ok(letzte.kreise >= 4);
  assert.equal(letzte.grund, "Kreisen beendet");
});

test("Geradeaus steigen (Hangaufwind) und S-Kurven: Gleiten", () => {
  assert.equal(lauf([{ dauer: 180, rate: 0 }], { steigen: 2 }).wechsel.length, 0);
  assert.equal(lauf([{ dauer: 10, rate: 0 }, ...Array.from({ length: 8 }, (_, i) => ({ dauer: 8, rate: i % 2 ? -15 : 15 })), { dauer: 10, rate: 0 }], { steigen: 1 }).wechsel.length, 0);
  // Hangwenden 180° mit Geraden dazwischen
  assert.equal(lauf([{ dauer: 30, rate: 0 }, { dauer: 12, rate: 15 }, { dauer: 30, rate: 0 }, { dauer: 12, rate: -15 }, { dauer: 30, rate: 0 }, { dauer: 12, rate: 15 }, { dauer: 30, rate: 0 }], { steigen: 1.5 }).wechsel.length, 0);
});

test("Eintritt erst nach vollem Kreis (Einstellung)", () => {
  const r = lauf([{ dauer: 20, rate: 0 }, { dauer: 90, rate: 20 }, { dauer: 40, rate: 0 }], {}, { eintritt: "vollkreis" });
  const ein = r.wechsel[0].t - 20;
  assert.ok(ein > 17 && ein < 22, "Wechsel nach " + ein + " s");
});

test("Datenlücke im Kreis beendet die Thermik", () => {
  const r = lauf([{ dauer: 20, rate: 0 }, { dauer: 90, rate: 20 }], { luecken: [[60, 200]] });
  assert.equal(r.wechsel[r.wechsel.length - 1].modus, "gleiten");
  assert.equal(r.wechsel[r.wechsel.length - 1].grund, "Datenlücke");
});

test("Zustand und Abmelden", () => {
  const det = K.createKreisDetektor();
  const pw = K.createPhasenwahl(det);
  assert.equal(pw.getZustand().modus, "gleiten");
  assert.equal(pw.getZustand().thermik, null);
  assert.throws(() => pw.on("unbekannt", () => {}));
  let n = 0;
  const ab = pw.on("modus", () => n++);
  for (const p of simuliere([{ dauer: 10, rate: 0 }, { dauer: 30, rate: 20 }], { seed: 2 })) { det.update(p); pw.tick(p.t, p.hoehe); }
  assert.equal(n, 1);
  const z = pw.getZustand();
  assert.equal(z.modus, "thermik");
  assert.ok(Number.isFinite(z.thermik.hoeheBeginn));
  ab(); pw.abmelden();
  for (let t = T0 + 41; t < T0 + 80; t++) { det.tick(t); pw.tick(t, null); }
  assert.equal(n, 1);
});
