// Node-Hilfsprogramm für den Python<->JS-Vergleich:
//   node js/abfrage_cli.mjs <tiles-ordner> <punkte.json> <ergebnis.json> [nearest]
// punkte.json = [[lat, lon], ...]; ergebnis.json = [Meter|null, ...]
// Liest die Kacheln von der Festplatte (gleicher Code wie im Browser, nur anderer Byte-Lader).
import { readFile, writeFile } from "node:fs/promises";
import { Gelaende } from "./terrain.js";

const [ordner, punkteDatei, ausDatei, modus] = process.argv.slice(2);
const basis = ordner.replace(/\\/g, "/").replace(/\/?$/, "/");

async function ladeBytes(url) {
  try {
    const b = await readFile(url);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

const index = JSON.parse(await readFile(basis + "index.json", "utf8"));
const g = new Gelaende(index, basis, ladeBytes, 80);
const punkte = JSON.parse(await readFile(punkteDatei, "utf8"));
const interpol = modus !== "nearest";
const aus = [];
for (const [lat, lon] of punkte) aus.push(await g.hoeheAnAsync(lat, lon, interpol));
await writeFile(ausDatei, JSON.stringify(aus));
