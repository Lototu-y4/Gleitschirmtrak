/* Prüft die XContest-Bewertung (xcontest.js) an eigenen IGC-Flügen gegen langsamere, genauere Rechnungen.
   Aufruf:  node werkzeuge/xc-pruefung.js <Ordner mit .igc> [--exakt]
     - "normal": wie in der App
     - "dicht":  grobe Suche mit viel mehr Punkten (freie Strecke 3000, Dreiecke 1000), dann gleich verfeinert
     - --exakt:  freie Strecke zusätzlich exakt auf allen Punkten (dauert pro Flug bis zu Minuten)
   Ausgegeben werden nur Datum, Art, km und Punkte (keine Namen, keine Positionen). */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Igc = require("../igc.js");
const XC = require("../xcontest.js");

const ORDNER = process.argv[2];
const EXAKT = process.argv.includes("--exakt");
if (!ORDNER) { console.error("Aufruf: node werkzeuge/xc-pruefung.js <igc-Ordner> [--exakt]"); process.exit(1); }

const fmt = (v) => v ? (v.kurz.padEnd(13) + v.km.toFixed(2).padStart(7) + " km " + v.punkte.toFixed(2).padStart(7) + " P") : "–".padEnd(33);
let maxP = 0, maxFrei = 0;
const dateien = fs.readdirSync(ORDNER).filter(x => /\.igc$/i.test(x)).sort();
for (const [nr, f] of dateien.entries()) {
  const r = Igc.parseIgc(fs.readFileSync(path.join(ORDNER, f), "utf8"));
  const pkt = r.fixes.filter(x => x.gueltig);
  const a = XC.bewerte(pkt);
  const b = XC.bewerte(pkt, { zielFrei: 3000, zielDreieck: 1000 });
  const dp = b.bestes.punkte - a.bestes.punkte;
  maxP = Math.max(maxP, dp);
  let zeile = `${String(nr + 1).padStart(2)} 20${r.datum ? r.datum.slice(4) + "-" + r.datum.slice(2, 4) + "-" + r.datum.slice(0, 2) : "??"}  n=${String(pkt.length).padStart(5)}`
    + `  normal ${fmt(a.bestes)} ${String(a.rechenzeitMs).padStart(5)} ms  |  dicht ${fmt(b.bestes)} ${String(b.rechenzeitMs).padStart(6)} ms  Δ ${dp.toFixed(2)}`;
  if (EXAKT) {
    const t0 = Date.now(), e = XC.freiExakt(pkt);
    const df = e.km - a.varianten.frei.km;
    maxFrei = Math.max(maxFrei, df);
    zeile += `  |  frei exakt ${e.km.toFixed(2)} km (App ${a.varianten.frei.km.toFixed(2)}, Δ ${df.toFixed(2)}) ${Date.now() - t0} ms`;
  }
  console.log(zeile);
}
console.log(`\nGrösste Verbesserung durch dichte Suche: ${maxP.toFixed(2)} Punkte` + (EXAKT ? `; freie Strecke exakt − App: höchstens ${maxFrei.toFixed(2)} km` : ""));
