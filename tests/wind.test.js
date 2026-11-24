// Tests der Windschätzung (wind.js) mit erfundenen Daten. Genauigkeiten stehen als Diagnose "#" in der Ausgabe.
// Ausführen:  node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../wind.js");
const K = require("../kreisen.js");
const { simuliere, windVektor, zufall } = require("./sim.js");

const winkelFehler = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} ≉ ${b} (±${eps})`);

/* ---------------- Pfeilwinkel ---------------- */
test("windPfeilWinkel: Gegenwind, Rückenwind, Wind von links, Wind von rechts", () => {
  // Kurs Nord (0°). Pfeil zeigt, wohin der Wind weht; 0 = oben = Flugrichtung, im Uhrzeigersinn.
  assert.equal(W.windPfeilWinkel(180, 0), 180, "Gegenwind (kommt von Nord, weht nach Süd): Pfeil nach unten");
  assert.equal(W.windPfeilWinkel(0, 0), 0, "Rückenwind (weht nach Nord): Pfeil nach oben");
  assert.equal(W.windPfeilWinkel(90, 0), 90, "Wind von links (kommt von West, weht nach Ost): Pfeil nach rechts");
  assert.equal(W.windPfeilWinkel(270, 0), 270, "Wind von rechts (kommt von Ost, weht nach West): Pfeil nach links");
  // dieselben vier Fälle bei Kurs Ost (90°)
  assert.equal(W.windPfeilWinkel(270, 90), 180, "Gegenwind bei Kurs Ost");
  assert.equal(W.windPfeilWinkel(90, 90), 0, "Rückenwind bei Kurs Ost");
  assert.equal(W.windPfeilWinkel(180, 90), 90, "Wind von links bei Kurs Ost (kommt von Nord)");
  assert.equal(W.windPfeilWinkel(0, 90), 270, "Wind von rechts bei Kurs Ost (kommt von Süd)");
  // Übergang 360/0
  assert.equal(W.windPfeilWinkel(10, 350), 20);
  assert.equal(W.windPfeilWinkel(350, 10), 340);
  assert.equal(W.windPfeilWinkel(720, -360), 0);
});

test("Richtungen: 'von' und 'nach', Geschwindigkeitsvektor", () => {
  const v = W.geschwVektor(10, 90);
  near(v.ost, 10, 1e-9); near(v.nord, 0, 1e-9);
  near(W.richtungVonVektor(0, -5), 180, 1e-9);
  near(W.richtungVonVektor(-5, 0), 270, 1e-9);
  // Wind aus West (270) mit 18 km/h weht nach Ost
  const w = windVektor(18, 270);
  const s = W.schaetzeWind(Array.from({ length: 40 }, (_, i) => {
    const a = i * 9 * Math.PI / 180; return { t: i, ost: 10 * Math.sin(a) + w.ost, nord: 10 * Math.cos(a) + w.nord };
  }));
  assert.equal(s.ok, true);
  near(s.richtungNach, 90, 1e-6); near(s.richtungVon, 270, 1e-6); near(s.staerkeKmh, 18, 1e-6); near(s.fluggeschwKmh, 36, 1e-6);
});

/* ---------------- Kreisanpassung ---------------- */
test("Kreisanpassung: exakte Punkte, Teilbogen, Gerade", () => {
  const pts = Array.from({ length: 12 }, (_, i) => ({ x: 3 + 7 * Math.cos(i * 0.5), y: -2 + 7 * Math.sin(i * 0.5) }));
  const f = W.kreisAnpassung(pts);
  near(f.cx, 3, 1e-6); near(f.cy, -2, 1e-6); near(f.r, 7, 1e-6);
  const g = W.kreisTaubin(pts.slice(0, 5));   // Teilbogen von 2 rad
  near(g.cx, 3, 1e-6); near(g.r, 7, 1e-6);
  assert.equal(W.kreisTaubin(Array.from({ length: 10 }, (_, i) => ({ x: i, y: 2 * i }))).ok, false);
  assert.equal(W.kreisTaubin([{ x: 1, y: 1 }, { x: 2, y: 2 }]).ok, false);
  near(W.groessteLuecke(pts, 3, -2), (360 - 11 * 0.5 * 180 / Math.PI), 1e-6);
});

test("Ausreisser werden entfernt", () => {
  const z = zufall(4);
  const pts = Array.from({ length: 40 }, (_, i) => ({ ost: 2 + 9 * Math.sin(i * 0.157) + 0.1 * z.normal(), nord: 1 + 9 * Math.cos(i * 0.157) + 0.1 * z.normal() }));
  pts[5] = { ost: 25, nord: 25 }; pts[17] = { ost: -2, nord: 3 };
  const s = W.schaetzeWind(pts);
  assert.equal(s.nAusreisser, 2);
  near(s.wind.ost, 2, 0.15); near(s.wind.nord, 1, 0.15); near(s.fluggeschwMs, 9, 0.15);
});

/* ---------------- Simulierte Kreisflüge ---------------- */
// Kreisflug simulieren, durch die Kreiserkennung schicken und jeden 'vollkreis' schätzen
function ueberDetektor(opts, rate, kreise) {
  const daten = simuliere([{ dauer: 10, rate: 0 }, { dauer: kreise * 360 / Math.abs(rate) + 3, rate }, { dauer: 15, rate: 0 }], opts);
  const d = K.createKreisDetektor();
  const schaetzer = W.createWindSchaetzer();
  const erg = [];
  d.on("vollkreis", (v) => { const r = schaetzer.verarbeite(v.fenster, "vollkreis"); if (r) erg.push(r); });
  for (const p of daten) d.update(p);
  return erg;
}
// direkt: Punkte eines Kreises (ohne Kreiserkennung) – nötig, wenn Wind ≥ Fluggeschwindigkeit
function direkt(opts, rate) {
  const daten = simuliere([{ dauer: 360 / Math.abs(rate), rate }], Object.assign({ rampeS: 0 }, opts));
  return [W.schaetzeWind(daten.map(p => ({ t: p.t, geschw: p.geschwindigkeit, kurs: p.kursGrad, hoehe: p.hoehe })))];
}

const FAELLE = [
  { name: "windstill", kmh: 0, von: 0 },
  { name: "schwacher Wind 8 km/h", kmh: 8, von: 230 },
  { name: "Wind 20 km/h (> halbe Fluggeschw.)", kmh: 20, von: 300 },
  { name: "Wind 28 km/h (0.8 × Fluggeschw.)", kmh: 28, von: 45 },
  { name: "Wind 42 km/h (> Fluggeschw.)", kmh: 42, von: 160, direkt: true },
];
const V_KMH = 34;

for (const rauschen of [false, true]) {
  test(`Kreisflug mit bekanntem Wind ${rauschen ? "MIT" : "ohne"} Messrauschen, Links- und Rechtskreise, 2 Hz`, (t) => {
    for (const f of FAELLE) {
      for (const rate of [20, -20]) {
        const fehler = { staerke: [], richtung: [], v: [] }, qual = {};
        let anzahl = 0;
        for (const seed of rauschen ? [1, 2, 3, 4, 5, 6, 7, 8] : [1]) {
          const opts = { seed, fluggeschwKmh: V_KMH, wind: windVektor(f.kmh, f.von), startKurs: seed * 37 % 360,
                         rauschenGeschw: rauschen ? 0.3 : 0, rauschenKurs: rauschen ? 3 : 0 };
          const erg = f.direkt ? direkt(opts, rate) : ueberDetektor(opts, rate, 2);
          assert.ok(erg.length >= 1, `${f.name}: keine Schätzung (Rate ${rate})`);
          for (const s of erg) {
            anzahl++;
            qual[s.qualitaet] = (qual[s.qualitaet] || 0) + 1;
            assert.ok(s.ok, `${f.name} Rate ${rate}: Qualität ${s.qualitaet} (${s.gruende.join(", ")})`);
            fehler.staerke.push(Math.abs(s.staerkeKmh - f.kmh));
            fehler.v.push(Math.abs(s.fluggeschwKmh - V_KMH));
            if (f.kmh >= 5) fehler.richtung.push(winkelFehler(s.richtungVon, f.von));
          }
        }
        const max = (a) => a.length ? Math.max(...a) : 0, mit = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
        // Toleranzen: ohne Rauschen praktisch exakt (nur Rundung/Abtastung), mit Rauschen (σ 0.3 m/s und 3°) wenige km/h
        const tolS = rauschen ? 3 : 0.3, tolV = rauschen ? 3 : 0.3, tolR = rauschen ? (f.kmh < 10 ? 25 : 8) : 1;
        assert.ok(max(fehler.staerke) <= tolS, `${f.name}: Windstärke Fehler ${max(fehler.staerke).toFixed(2)} km/h`);
        assert.ok(max(fehler.v) <= tolV, `${f.name}: Fluggeschw. Fehler ${max(fehler.v).toFixed(2)} km/h`);
        assert.ok(max(fehler.richtung) <= tolR, `${f.name}: Richtung Fehler ${max(fehler.richtung).toFixed(1)}°`);
        t.diagnostic(`${f.name}, ${rate > 0 ? "rechts" : "links"}${f.direkt ? " (Punkte direkt, ohne Kreiserkennung)" : ""}: ${anzahl} Schätzungen, `
          + `Fehler Windstärke Ø ${mit(fehler.staerke).toFixed(2)} / max ${max(fehler.staerke).toFixed(2)} km/h, `
          + (fehler.richtung.length ? `Richtung Ø ${mit(fehler.richtung).toFixed(1)} / max ${max(fehler.richtung).toFixed(1)}°, ` : "Richtung –, ")
          + `Fluggeschw. Ø ${mit(fehler.v).toFixed(2)} / max ${max(fehler.v).toFixed(2)} km/h, Qualität ${JSON.stringify(qual)}`);
      }
    }
  });
}

test("Wind fast so gross wie die Fluggeschwindigkeit: langsame Punkte fehlen (Bericht)", (t) => {
  for (const kmh of [30, 34, 38]) {
    const s = direkt({ seed: 1, fluggeschwKmh: V_KMH, wind: windVektor(kmh, 90), rauschenGeschw: 0.3, rauschenKurs: 3 }, 20)[0];
    t.diagnostic(`Wind ${kmh} km/h bei ${V_KMH} km/h: Qualität ${s.qualitaet}, ${s.nLangsam} Punkte unter 5 km/h verworfen, Lücke ${Math.round(s.groessteLuecke)}°, `
      + `Wind ${s.staerkeKmh.toFixed(1)} km/h, Fluggeschw. ${s.fluggeschwKmh.toFixed(1)} km/h`);
  }
});

test("Fluggeschwindigkeit schwankt im Kreis um ±10 %: Schätzung bleibt brauchbar (Bericht)", (t) => {
  const erg = ueberDetektor({ seed: 2, fluggeschwKmh: V_KMH, wind: windVektor(15, 200), geschwSchwankung: 0.1, rauschenGeschw: 0.3, rauschenKurs: 3 }, 20, 3);
  for (const s of erg) {
    assert.ok(Math.abs(s.staerkeKmh - 15) < 6);
    t.diagnostic(`±10 % Fahrt: Wind ${s.staerkeKmh.toFixed(1)} km/h aus ${Math.round(s.richtungVon)}° (wahr 15 aus 200°), Restfehler ${(s.restfehler * 100).toFixed(1)} %, Qualität ${s.qualitaet}`);
  }
});

/* ---------------- Qualität ---------------- */
test("Qualität: Halbkreis, zu wenige Punkte, unplausible Fluggeschwindigkeit, starkes Rauschen", () => {
  const z = zufall(1);
  const bogen = (grad, n, r, rausch) => Array.from({ length: n }, (_, i) => {
    const a = i / (n - 1) * grad * Math.PI / 180;
    return { ost: 2 + r * Math.sin(a) + rausch * z.normal(), nord: r * Math.cos(a) + rausch * z.normal() };
  });
  const halb = W.schaetzeWind(bogen(180, 30, 9, 0.05));
  assert.equal(halb.qualitaet, "schlecht"); assert.equal(halb.ok, false);
  assert.ok(halb.gruende.some(g => g.startsWith("Winkellücke")));
  assert.equal(W.schaetzeWind(bogen(360, 4, 9, 0)).ok, false);
  const wenig = W.schaetzeWind(bogen(330, 12, 9, 0));
  assert.equal(wenig.qualitaet, "mittel");
  const schnell = W.schaetzeWind(bogen(360, 40, 30, 0));   // 108 km/h Fluggeschwindigkeit
  assert.equal(schnell.ok, false);
  assert.ok(schnell.gruende.some(g => g.includes("unplausibel")));
  const laut = W.schaetzeWind(bogen(360, 40, 9, 2.0));
  assert.equal(laut.ok, false);
  const gut = W.schaetzeWind(bogen(355, 40, 9, 0.2));
  assert.equal(gut.qualitaet, "gut");
  // langsame Punkte werden verworfen
  const mitLangsam = bogen(355, 40, 9, 0).concat([{ ost: 0.3, nord: 0.2 }, { ost: -0.5, nord: 0.1 }]);
  assert.equal(W.schaetzeWind(mitLangsam).nLangsam, 2);
  assert.equal(W.schaetzeWind([]).ok, false);
  assert.equal(W.schaetzeWind(null).ok, false);
});

test("Einstellungen der Windschätzung: Grenzen und Auswahl", () => {
  const e = W.normalisiere({ pfeilKonvention: "quer", pfeilKreisen: "nord", maxAlterMin: -5, lueckeGut: 150, lueckeMittel: 90 });
  assert.equal(e.pfeilKonvention, "nach");
  assert.equal(e.pfeilKreisen, "nord");
  assert.equal(e.maxAlterMin, 1);
  assert.equal(e.lueckeMittel, 150);
  assert.deepEqual(W.normalisiere(null), Object.assign({}, W.STANDARD));
});

/* ---------------- Gültigkeit und Pfeil ---------------- */
test("Gültigkeit: aktuell, abgelaufen nach Zeit oder Höhe, ausgeblendet", () => {
  const s = { ok: true, t: 1000, hoehe: 2000 };
  assert.equal(W.gueltigkeit(null, { t: 0 }).zustand, "keine");
  assert.equal(W.gueltigkeit({ ok: false }, { t: 0 }).zustand, "keine");
  assert.equal(W.gueltigkeit(s, { t: 1000 + 9 * 60, hoehe: 2100 }).zustand, "aktuell");
  const alt = W.gueltigkeit(s, { t: 1000 + 11 * 60, hoehe: 2000 });
  assert.equal(alt.zustand, "abgelaufen"); assert.match(alt.grund, /älter/);
  const hoch = W.gueltigkeit(s, { t: 1060, hoehe: 2350 });
  assert.equal(hoch.zustand, "abgelaufen"); assert.match(hoch.grund, /\+350 m/);
  assert.equal(W.gueltigkeit(s, { t: 1060, hoehe: 1650 }).zustand, "abgelaufen");
  assert.equal(W.gueltigkeit(s, { t: 1000 + 21 * 60, hoehe: 2000 }).zustand, "aus");
  assert.equal(W.gueltigkeit(s, { t: 1060, hoehe: 2700 }).zustand, "aus");
  assert.equal(W.gueltigkeit(s, { t: 1060, hoehe: null }).zustand, "aktuell", "ohne GPS-Höhe zählt nur das Alter");
  assert.equal(W.gueltigkeit(s, { t: 1000 + 5 * 60, hoehe: 2000 }, { maxAlterMin: 4 }).zustand, "abgelaufen");
  assert.equal(W.fmtAlter(185), "vor 3 min");
  assert.equal(W.fmtAlter(34), "vor 30 s");
  assert.equal(W.fmtAlter(3), "gerade eben");
});

test("Pfeil: Konvention, Bezug beim Kreisen, unsicherer Kurs, windstill", () => {
  const s = { ok: true, staerkeKmh: 15, richtungNach: 90, richtungVon: 270 };   // Wind aus West
  const gleiten = { kurs: 0, geschwKmh: 30, phase: "gleiten", kursEingefroren: null };
  let p = W.pfeil(s, gleiten);
  assert.deepEqual([p.sichtbar, p.winkel, p.bezug, p.gedimmt], [true, 90, "kurs", false]);
  p = W.pfeil(s, gleiten, { pfeilKonvention: "von" });
  assert.equal(p.winkel, 270, "zeigt woher der Wind kommt (links)");
  // Kreisen: mitdrehen
  const kreisen = { kurs: 180, geschwKmh: 30, phase: "kreisen", kursEingefroren: 0 };
  assert.equal(W.pfeil(s, kreisen).winkel, 270);
  assert.equal(W.pfeil(s, kreisen).beschriftung, "↑ Kurs");
  // eingefroren auf den Kurs vor dem Kreisen
  p = W.pfeil(s, kreisen, { pfeilKreisen: "eingefroren" });
  assert.deepEqual([p.winkel, p.bezug, p.beschriftung], [90, "eingefroren", "↑ Kurs vor Kreis"]);
  // Nord oben
  p = W.pfeil(s, kreisen, { pfeilKreisen: "nord" });
  assert.deepEqual([p.winkel, p.bezug, p.beschriftung], [90, "nord", "↑ Nord"]);
  // im Gleitflug gilt immer der Kurs, auch mit Einstellung Nord
  assert.equal(W.pfeil(s, gleiten, { pfeilKreisen: "nord" }).bezug, "kurs");
  // unsicherer Kurs
  p = W.pfeil(s, { kurs: 0, geschwKmh: 5, phase: "gleiten" });
  assert.equal(p.gedimmt, true); assert.equal(p.sichtbar, true);
  assert.equal(W.pfeil(s, { kurs: null, geschwKmh: 0, phase: "gleiten" }).sichtbar, false);
  // Nord-Modus braucht keinen Kurs
  assert.equal(W.pfeil(s, { kurs: null, geschwKmh: 0, phase: "kreisen" }, { pfeilKreisen: "nord" }).gedimmt, false);
  // windstill: keine Richtung
  assert.equal(W.pfeil({ ok: true, staerkeKmh: 1, richtungNach: 0, richtungVon: 180 }, gleiten).sichtbar, false);
  assert.equal(W.pfeil(null, gleiten).sichtbar, false);
});

test("Gegen-/Rückenwind, Seitenwind und Fluggeschwindigkeit (berechnet, nicht angezeigt)", () => {
  const w = windVektor(18, 0);   // aus Nord, 5 m/s
  let k = W.windKomponenten(w, 0);
  near(k.gegenwindMs, 5, 1e-9); near(k.seitenwindMs, 0, 1e-9);
  k = W.windKomponenten(w, 180);
  near(k.gegenwindMs, -5, 1e-9);
  k = W.windKomponenten(windVektor(18, 270), 0);   // aus West, Kurs Nord: weht nach rechts
  near(k.seitenwindMs, 5, 1e-9); near(k.gegenwindMs, 0, 1e-9);
  near(W.fluggeschwindigkeit({ ost: 0, nord: 5 }, w), 10, 1e-9);
});

test("Schätzer: verwirft ungültige und schlechte Fenster, behält letzte gute Schätzung", () => {
  const sch = W.createWindSchaetzer();
  const kreis = Array.from({ length: 40 }, (_, i) => ({ t: i, ost: 3 + 9 * Math.sin(i * 0.157), nord: 9 * Math.cos(i * 0.157), hoehe: 1800 }));
  assert.equal(sch.verarbeite({ punkte: kreis, gueltigFuerWind: false, grund: "Richtungswechsel (Achter)" }), null);
  const r = sch.verarbeite({ punkte: kreis, gueltigFuerWind: true, winkel: 360 }, "vollkreis");
  assert.equal(r.ok, true); assert.equal(sch.aktuell, r); near(r.hoehe, 1800, 1e-9); assert.equal(r.t, 39);
  const schlecht = sch.verarbeite({ punkte: kreis.slice(0, 12), gueltigFuerWind: true, winkel: 100 });
  assert.equal(schlecht.ok, false);
  assert.equal(sch.aktuell, r, "schlechte Schätzung ersetzt die gute nicht");
  assert.equal(sch.statistik.fenster, 3); assert.equal(sch.statistik.nichtGueltig, 1);
  assert.equal(sch.statistik.gruende["Richtungswechsel (Achter)"], 1);
  assert.equal(sch.statistik.schlecht, 1);
  sch.reset();
  assert.equal(sch.aktuell, null);
});
