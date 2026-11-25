// Tests für zip.js (Sicherung des Logbuchs).  Ausführen:  node --test tests/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const Zip = require("../zip.js");

const text = (b) => new TextDecoder().decode(b);

test("CRC-32: Prüfwert und Vergleich mit zlib", () => {
  assert.equal(Zip.crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  assert.equal(Zip.crc32(new Uint8Array(0)), 0);
  if (zlib.crc32) {
    const b = new Uint8Array(5000).map((_, i) => (i * 7919) & 255);
    assert.equal(Zip.crc32(b), zlib.crc32(b));
  }
});

test("Packen und wieder Entpacken: komprimiert, unkomprimiert, Umlaute, leere und binäre Dateien", async () => {
  const bin = new Uint8Array(3000).map((_, i) => (i * 31) & 255);
  const dateien = [
    { name: "logbuch.json", daten: JSON.stringify({ a: "x".repeat(2000) }) },
    { name: "IGC/2026-07-14 1032 Amisbühl.igc", daten: "B1200004641000N00752000EA0145001500\r\n".repeat(100), zeit: new Date(2026, 6, 14, 10, 32, 7) },
    { name: "leer.txt", daten: "" },
    { name: "daten/bin.dat", daten: bin },
  ];
  for (const komprimieren of [true, false]) {
    const z = await Zip.packen(dateien, { komprimieren });
    assert.ok(Zip.istZip(z));
    const e = await Zip.entpacken(z);
    assert.deepEqual(e.map(x => x.name), dateien.map(d => d.name));
    assert.equal(text(e[0].daten), dateien[0].daten);
    assert.equal(text(e[1].daten), dateien[1].daten);
    assert.equal(e[2].daten.length, 0);
    assert.deepEqual([...e[3].daten], [...bin]);
    if (komprimieren && Zip.kannPacken()) assert.ok(z.length < 3000, "komprimiert kleiner (" + z.length + " Bytes)");
  }
});

test("Entpacken: Auswahl, Grössenlimit, beschädigte Einträge, keine ZIP-Datei", async () => {
  const z = await Zip.packen([{ name: "a.igc", daten: "A".repeat(500) }, { name: "b.txt", daten: "B".repeat(500) }], { komprimieren: false });
  assert.deepEqual((await Zip.entpacken(z, { nur: n => n.endsWith(".igc") })).map(x => x.name), ["a.igc"]);
  assert.equal((await Zip.entpacken(z, { maxGroesse: 100 }))[0].fehler, "zu gross");
  const kaputt = z.slice(); kaputt[40] ^= 0xFF;   // ein Byte in den Daten von a.igc
  const e = await Zip.entpacken(kaputt);
  assert.match(e[0].fehler, /Prüfsumme/);
  assert.equal(text(e[1].daten), "B".repeat(500), "andere Einträge bleiben lesbar");
  await assert.rejects(Zip.entpacken(new TextEncoder().encode("AXXX\r\nB1200")), /keine ZIP-Datei/);
  assert.equal(Zip.istZip(new TextEncoder().encode("AXXX")), false);
  await assert.rejects(Zip.packen([{ name: "x", daten: "1" }, { name: "x", daten: "2" }]), /doppelt/);
});

test("Liest eine mit Windows (Compress-Archive, Deflate, \\ im Pfad) erstellte ZIP-Datei", async () => {
  const ref = Buffer.from("UEsDBBQAAAAIAIQ9eV1EYjmlHgAAAB4AAAAMAAAAb3JkbmVyXGIuaWdjc4yIiDAwMOTl8nBzCXF1cQxxtTI0MTA3MtMBCQIAUEsDBBQAAAAIAIQ9eV3/zJtOEwAAACYCAAAFAAAAYS50eHTzSMzJyVcIT80pUfAYZY4ysTMBUEsBAhQAFAAAAAgAhD15XURiOaUeAAAAHgAAAAwAAAAAAAAAAAAAAAAAAAAAAG9yZG5lclxiLmlnY1BLAQIUABQAAAAIAIQ9eV3/zJtOEwAAACYCAAAFAAAAAAAAAAAAAAAAAEgAAABhLnR4dFBLBQYAAAAAAgACAG0AAAB+AAAAAAA=", "base64");
  const e = await Zip.entpacken(new Uint8Array(ref));
  assert.deepEqual(e.map(x => x.name), ["ordner/b.igc", "a.txt"]);
  assert.equal(text(e[0].daten), "AXXX001\r\nHFDTEDATE:140726,01\r\n");
  assert.equal(text(e[1].daten), "Hallo Welt ".repeat(50));
});

test("Schrittweise: packer gibt dieselbe Datei wie packen, oeffnen entpackt nur, was gelesen wird", async () => {
  const dateien = [{ name: "a.json", daten: "{}".repeat(300), zeit: 0 }, { name: "IGC/b.igc", daten: "B".repeat(400), zeit: 0 }];
  const p = Zip.packer();
  const r = await p.hinzu(dateien[0]); await p.hinzu(dateien[1]);
  assert.equal(r.groesse, 600);
  const teile = p.ende();
  assert.deepEqual(Buffer.concat(teile.map(t => Buffer.from(t))), Buffer.from(await Zip.packen(dateien)));
  await assert.rejects(p.hinzu({ name: "c", daten: "x" }), /abgeschlossen/);
  const z = Zip.oeffnen(new Uint8Array(Buffer.concat(teile.map(t => Buffer.from(t)))));
  assert.deepEqual(z.namen, ["a.json", "IGC/b.igc"]);
  assert.equal(z.hat("a.json"), true);
  assert.equal(z.hat("x"), false);
  assert.equal(text((await z.lies("IGC/b.igc")).daten), "B".repeat(400));
  assert.equal((await z.lies("x")).fehler, "fehlt");
  assert.equal((await z.lies("a.json", { maxGroesse: 10 })).fehler, "zu gross");
  // ein unkomprimiert gespeichertes Uint8Array wird kopiert, spätere Änderungen am Original ändern die ZIP-Datei nicht
  const bin = new Uint8Array([1, 2, 3]), q = Zip.packer({ komprimieren: false });
  await q.hinzu({ name: "bin", daten: bin }); bin[0] = 9;
  const zq = Zip.oeffnen(new Uint8Array(Buffer.concat(q.ende().map(t => Buffer.from(t)))));
  assert.deepEqual([...(await zq.lies("bin")).daten], [1, 2, 3]);
});
