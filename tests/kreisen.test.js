// Tests der Kreiserkennung (kreisen.js) mit erfundenen Daten.
// Ausführen:  node --test tests/          (Erkennungszeiten stehen als Diagnose "#" in der Ausgabe)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../kreisen.js");
const { simuliere, windVektor } = require("./sim.js");

// Detektor über simulierte Daten laufen lassen und alle Ereignisse mitschreiben
function lauf(daten, einst, tickBis) {
  const d = K.createKreisDetektor(einst);
  const ev = { kreisBeginn: [], kreisEnde: [], vollkreis: [], phasenwechsel: [] };
  for (const n of Object.keys(ev)) d.on(n, (x) => ev[n].push(x));
  for (const p of daten) d.update(p);
  if (tickBis) for (let t = daten[daten.length - 1].t + 1; t <= tickBis; t += 1) d.tick(t);
  return { d, ev };
}
const T0 = 1000;

test("Standardwerte und Normalisierung der Einstellungen", () => {
  const e = K.normalisiere({ drehrateMin: "12", beginnWinkel: 9999, windMinWinkel: 100, endeHaltezeitS: null });
  assert.equal(e.drehrateMin, 12);
  assert.equal(e.beginnWinkel, 360);
  assert.equal(e.windMinWinkel, 180);
  assert.equal(e.endeHaltezeitS, K.STANDARD.endeHaltezeitS);
  assert.deepEqual(K.normalisiere(undefined), Object.assign({}, K.STANDARD));
});

test("Kursdifferenz über 360/0 hinweg", () => {
  assert.equal(K.kursDiff(350, 10), 20);
  assert.equal(K.kursDiff(10, 350), -20);
  assert.equal(K.kursDiff(0, 180), 180);
  assert.equal(K.kursDiff(359, 1), 2);
  assert.equal(K.kursDiff(1, 359), -2);
});

test("Einzelner Rechtskreis: Beginn, Ende, ein Vollkreis, Zeiten", (t) => {
  // 20 s gerade, 400° mit 20 °/s, 30 s gerade
  const daten = simuliere([{ dauer: 20, rate: 0 }, { dauer: 20, rate: 20 }, { dauer: 30, rate: 0 }], { seed: 3, rauschenKurs: 2, rauschenGeschw: 0.2 });
  const { ev } = lauf(daten);
  assert.equal(ev.kreisBeginn.length, 1);
  assert.equal(ev.kreisEnde.length, 1);
  assert.equal(ev.vollkreis.length, 1);
  const b = ev.kreisBeginn[0], e = ev.kreisEnde[0];
  assert.equal(b.richtung, "rechts");
  assert.ok(Math.abs(b.beginn - (T0 + 20)) <= 2.5, "Beginn " + (b.beginn - T0));
  assert.ok(Math.abs(e.ende - (T0 + 40)) <= 2.5, "Ende " + (e.ende - T0));
  assert.equal(e.grund, "geradeaus");
  assert.equal(e.anzahlKreise, 1);
  assert.ok(e.winkel > 340 && e.winkel < 420, "Winkel " + e.winkel);
  // Ende wird erst nach der Haltezeit gemeldet
  assert.ok(e.t - e.ende >= K.STANDARD.endeHaltezeitS && e.t - e.ende <= K.STANDARD.endeHaltezeitS + 1);
  assert.deepEqual(ev.phasenwechsel.map(x => x.phase), ["kreisen", "gleiten"]);
  t.diagnostic(`Einzelkreis 20°/s: Beginn erkannt ${(b.t - T0 - 20).toFixed(1)} s nach Drehbeginn (Beginn datiert auf ${(b.beginn - T0 - 20).toFixed(1)} s), `
    + `Ende gemeldet ${(e.t - T0 - 40).toFixed(1)} s nach Drehende`);
});

test("Mehrere Linkskreise mit Wind: ein Abschnitt, Anzahl Kreise, Vollkreis-Fenster", () => {
  const daten = simuliere([{ dauer: 15, rate: 0 }, { dauer: 102, rate: -18 }, { dauer: 20, rate: 0 }],
    { seed: 5, wind: windVektor(15, 270), rauschenKurs: 2, rauschenGeschw: 0.2 });
  const { ev } = lauf(daten);
  assert.equal(ev.kreisBeginn.length, 1);
  assert.equal(ev.kreisEnde.length, 1);
  assert.equal(ev.kreisBeginn[0].richtung, "links");
  assert.equal(ev.vollkreis.length, 5);            // 102 s × 18 °/s = 1836°, abzüglich Ein- und Ausleiten = 5 Kreise
  assert.equal(ev.kreisEnde[0].anzahlKreise, 5);
  for (const v of ev.vollkreis) {
    assert.equal(v.fenster.gueltigFuerWind, true);
    assert.ok(v.fenster.punkte.length >= 38 && v.fenster.punkte.length <= 46, "Punkte " + v.fenster.punkte.length);   // 20 s × 2 Hz
  }
  assert.ok(ev.kreisEnde[0].punkte.length > 190);
});

test("Rest am Ende: ab 270° für den Wind gültig, darunter nicht", () => {
  // 360 + 300 = 660°
  const a = lauf(simuliere([{ dauer: 10, rate: 0 }, { dauer: 33, rate: 20 }, { dauer: 20, rate: 0 }], { seed: 7 })).ev;
  assert.equal(a.vollkreis.length, 1);
  assert.equal(a.kreisEnde[0].fenster.gueltigFuerWind, true);
  assert.ok(a.kreisEnde[0].fenster.winkel >= 270);
  // 360 + 150 = 510°
  const b = lauf(simuliere([{ dauer: 10, rate: 0 }, { dauer: 25.5, rate: 20 }, { dauer: 20, rate: 0 }], { seed: 7 })).ev;
  assert.equal(b.vollkreis.length, 1);
  assert.equal(b.kreisEnde[0].fenster.gueltigFuerWind, false);
  // nur 300° insgesamt: Kreisen ja, Wind aus dem Rest ja
  const c = lauf(simuliere([{ dauer: 10, rate: 0 }, { dauer: 15, rate: 20 }, { dauer: 20, rate: 0 }], { seed: 7 })).ev;
  assert.equal(c.kreisBeginn.length, 1);
  assert.equal(c.vollkreis.length, 0);
  assert.equal(c.kreisEnde[0].fenster.gueltigFuerWind, true);
});

test("Achter: Richtungswechsel beendet den Kreis, kein gültiges Windfenster", () => {
  const daten = simuliere([{ dauer: 10, rate: 0 }, { dauer: 15, rate: 20 }, { dauer: 15, rate: -20 }, { dauer: 15, rate: 20 }, { dauer: 20, rate: 0 }],
    { seed: 11, rauschenKurs: 2 });
  const { ev } = lauf(daten);
  assert.equal(ev.vollkreis.length, 0);
  assert.ok(ev.kreisEnde.length >= 2);
  assert.ok(ev.kreisEnde.filter(x => x.grund === "richtungswechsel").length >= 2);
  for (const k of ev.kreisEnde) assert.equal(k.fenster.gueltigFuerWind, false, "Fenster " + k.grund);
  // Drehrichtungen wechseln ab
  const r = ev.kreisBeginn.map(x => x.richtung);
  for (let i = 1; i < r.length; i++) assert.notEqual(r[i], r[i - 1]);
});

test("S-Kurven und Wenden im Hangflug werden nicht als Kreis erkannt", (t) => {
  const faelle = {
    "S-Kurven ±120° mit 15 °/s": [{ dauer: 10, rate: 0 }, ...Array.from({ length: 8 }, (_, i) => ({ dauer: 8, rate: i % 2 ? -15 : 15 })), { dauer: 10, rate: 0 }],
    "Hangwenden 180° mit 15 °/s, 30 s gerade": [{ dauer: 30, rate: 0 }, { dauer: 12, rate: 15 }, { dauer: 30, rate: 0 }, { dauer: 12, rate: -15 }, { dauer: 30, rate: 0 }, { dauer: 12, rate: 15 }, { dauer: 30, rate: 0 }],
    "Hangwenden 220° mit 25 °/s": [{ dauer: 30, rate: 0 }, { dauer: 8.8, rate: 25 }, { dauer: 30, rate: 0 }, { dauer: 8.8, rate: -25 }, { dauer: 30, rate: 0 }],
    "Achter-Wenden ohne Geradeaus 200°": [{ dauer: 10, rate: 0 }, ...Array.from({ length: 6 }, (_, i) => ({ dauer: 10, rate: i % 2 ? -20 : 20 })), { dauer: 10, rate: 0 }],
  };
  for (const [name, ab] of Object.entries(faelle)) {
    for (const seed of [1, 2, 3]) {
      const { ev } = lauf(simuliere(ab, { seed, wind: windVektor(20, 300), rauschenKurs: 3, rauschenGeschw: 0.3 }));
      assert.equal(ev.kreisBeginn.length, 0, name + " (seed " + seed + ")");
    }
  }
  t.diagnostic("Grenze: Wenden ab etwa " + K.STANDARD.beginnWinkel + "° Kursänderung lösen 'Kreisen beginnt' aus (Einstellung beginnWinkel)");
});

test("Hysterese: kurzes Geradeaus im Kreis beendet nicht, langes schon", () => {
  // 2 Kreise, 5 s gerade (< 8 s), 2 Kreise, dann gerade
  const a = lauf(simuliere([{ dauer: 10, rate: 0 }, { dauer: 38, rate: 20 }, { dauer: 5, rate: 0 }, { dauer: 38, rate: 20 }, { dauer: 25, rate: 0 }], { seed: 2, rauschenKurs: 2 })).ev;
  assert.equal(a.kreisBeginn.length, 1);
  assert.equal(a.kreisEnde.length, 1);
  assert.equal(a.vollkreis.length, 4);   // 2 × 760° = 1520° (gerade Strecke dazwischen zählt nicht)
  assert.equal(a.kreisEnde[0].anzahlKreise, 4);
  // 12 s gerade (> 8 s) → zwei Abschnitte
  const b = lauf(simuliere([{ dauer: 10, rate: 0 }, { dauer: 38, rate: 20 }, { dauer: 12, rate: 0 }, { dauer: 38, rate: 20 }, { dauer: 25, rate: 0 }], { seed: 2, rauschenKurs: 2 })).ev;
  assert.equal(b.kreisBeginn.length, 2);
  assert.equal(b.kreisEnde.length, 2);
  // kein Flackern: Phase wechselt genau zweimal pro Abschnitt
  assert.equal(b.phasenwechsel.length, 4);
});

test("Kurssprung 360/0: Geradeausflug nach Norden mit Rauschen, Kreis durch Nord", () => {
  const nord = lauf(simuliere([{ dauer: 120, rate: 0 }], { seed: 4, startKurs: 0, rauschenKurs: 4 }));
  assert.equal(nord.ev.kreisBeginn.length, 0);
  assert.ok(Math.abs(nord.d.getZustand().drehrate) < 8);
  // Rechtskreis ab Kurs 350° und Linkskreis ab 10°
  for (const [start, rate, ri] of [[350, 20, "rechts"], [10, -20, "links"]]) {
    const { ev } = lauf(simuliere([{ dauer: 5, rate: 0 }, { dauer: 40, rate }, { dauer: 20, rate: 0 }], { seed: 4, startKurs: start, rauschenKurs: 2 }));
    assert.equal(ev.kreisBeginn.length, 1);
    assert.equal(ev.kreisBeginn[0].richtung, ri);
    assert.equal(ev.vollkreis.length, 2);
    assert.ok(Math.abs(ev.kreisEnde[0].winkel - 800) < 60, "Winkel " + ev.kreisEnde[0].winkel);
  }
});

test("Datenlücken: kurze Lücke hält den Kreis, lange beendet ihn, tick ohne Daten beendet ihn", () => {
  // Lücke 4 s mitten im Kreisen: kein Ende
  const a = lauf(simuliere([{ dauer: 10, rate: 0 }, { dauer: 60, rate: 20 }, { dauer: 20, rate: 0 }], { seed: 6, luecken: [[40, 44]] })).ev;
  assert.equal(a.kreisEnde.length, 1);
  assert.equal(a.kreisEnde[0].grund, "geradeaus");
  // Lücke 20 s: Kreis endet wegen Datenlücke, danach neuer Kreis
  const b = lauf(simuliere([{ dauer: 10, rate: 0 }, { dauer: 80, rate: 20 }, { dauer: 20, rate: 0 }], { seed: 6, luecken: [[40, 60]] })).ev;
  assert.equal(b.kreisEnde[0].grund, "datenluecke");
  assert.equal(b.kreisBeginn.length, 2);
  // Daten hören mitten im Kreis auf; tick() lässt die Zeit weiterlaufen
  const daten = simuliere([{ dauer: 10, rate: 0 }, { dauer: 30, rate: 20 }], { seed: 6 });
  const c = lauf(daten, undefined, daten[daten.length - 1].t + 15);
  assert.equal(c.ev.kreisEnde.length, 1);
  assert.equal(c.ev.kreisEnde[0].grund, "datenluecke");
  assert.equal(c.d.getZustand().phase, "gleiten");
  // ungültige Werte und Zeitsprünge rückwärts werden ignoriert
  const d = K.createKreisDetektor();
  d.update({ t: 10, kursGrad: 0, geschwindigkeit: 10 });
  assert.doesNotThrow(() => { d.update({ t: 9, kursGrad: 90, geschwindigkeit: 10 }); d.update({ t: NaN }); d.update(null); d.update({ t: 11, kursGrad: null, geschwindigkeit: null }); });
  assert.equal(d.getZustand().phase, "gleiten");
});

test("Langsam über Grund: Kurs unbrauchbar, kein Kreis", () => {
  const daten = simuliere([{ dauer: 60, rate: 0 }], { seed: 8, fluggeschwKmh: 3, rauschenKurs: 60 });
  assert.equal(lauf(daten).ev.kreisBeginn.length, 0);
});

test("Zustand, Ereignisse abmelden, Einstellungen ändern", () => {
  const d = K.createKreisDetektor();
  let n = 0;
  const ab = d.on("phasenwechsel", () => n++);
  assert.throws(() => d.on("gibtsnicht", () => {}));
  const daten = simuliere([{ dauer: 10, rate: 0 }, { dauer: 40, rate: -20 }], { seed: 9 });
  let zMitte = null;
  for (const p of daten) { d.update(p); if (p.t === T0 + 40) zMitte = d.getZustand(); }
  assert.equal(n, 1);
  assert.equal(zMitte.phase, "kreisen");
  assert.equal(zMitte.drehrichtung, "links");
  assert.ok(zMitte.dauer > 20 && zMitte.dauer < 32);
  assert.ok(zMitte.winkel > 450 && zMitte.winkel < 650, "Winkel " + zMitte.winkel);
  assert.equal(zMitte.anzahlKreise, 1);
  assert.ok(Number.isFinite(zMitte.kursVorBeginn));
  assert.ok(Math.abs(K.kursDiff(zMitte.kursVorBeginn, 0)) < 15, "Kurs vor Beginn " + zMitte.kursVorBeginn);
  ab();
  d.setEinstellungen({ endeHaltezeitS: 2 });
  assert.equal(d.getEinstellungen().endeHaltezeitS, 2);
  for (let t = T0 + 51; t < T0 + 60; t++) d.tick(t);
  assert.equal(d.getZustand().phase, "gleiten");
  assert.equal(n, 1, "abgemeldeter Rückruf wird nicht mehr aufgerufen");
  // Fehler in einem Rückruf stört den Detektor nicht
  const d2 = K.createKreisDetektor();
  const fehler = [];
  d2.on("fehler", (f) => fehler.push(f));
  d2.on("kreisBeginn", () => { throw new Error("absichtlich"); });
  for (const p of simuliere([{ dauer: 10, rate: 0 }, { dauer: 30, rate: 20 }], { seed: 9 })) d2.update(p);
  assert.equal(fehler.length, 1);
  assert.equal(d2.getZustand().phase, "kreisen");
});

test("Erkennungszeiten bei verschiedenen Drehraten (Bericht)", (t) => {
  const zeilen = [];
  for (const rate of [10, 12, 15, 20, 25, 30]) {
    const verz = [], endeVerz = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const dauerKreis = 3 * 360 / rate;
      const { ev } = lauf(simuliere([{ dauer: 20, rate: 0 }, { dauer: dauerKreis, rate }, { dauer: 30, rate: 0 }],
        { seed, wind: windVektor(15, 250), rauschenKurs: 3, rauschenGeschw: 0.3 }));
      assert.equal(ev.kreisBeginn.length, 1, "Rate " + rate);
      verz.push(ev.kreisBeginn[0].t - (T0 + 20));
      endeVerz.push(ev.kreisEnde[0].t - (T0 + 20 + dauerKreis));
    }
    const m = (a) => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1);
    zeilen.push(`${rate} °/s: Kreis erkannt nach ${m(verz)} s (${Math.min(...verz).toFixed(1)}–${Math.max(...verz).toFixed(1)}), `
      + `das sind ${(Number(m(verz)) * rate).toFixed(0)}° bzw. ${(Number(m(verz)) / (360 / rate) * 100).toFixed(0)} % eines Kreises; Ende gemeldet nach ${m(endeVerz)} s`);
  }
  for (const z of zeilen) t.diagnostic(z);
});

test("Wind grösser als Fluggeschwindigkeit: Kurs über Grund dreht nicht ganz herum (bekannte Grenze, Bericht)", (t) => {
  for (const kmh of [20, 30, 40]) {
    const { ev } = lauf(simuliere([{ dauer: 10, rate: 0 }, { dauer: 90, rate: 20 }, { dauer: 20, rate: 0 }],
      { seed: 1, fluggeschwKmh: 34, wind: windVektor(kmh, 270), rauschenKurs: 2, rauschenGeschw: 0.2 }));
    t.diagnostic(`Wind ${kmh} km/h bei 34 km/h Fluggeschwindigkeit, 5 Kreise geflogen: ${ev.kreisBeginn.length} Kreisphase(n), ${ev.vollkreis.length} Vollkreise erkannt`);
  }
});
