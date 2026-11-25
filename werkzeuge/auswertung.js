/* Kreiserkennung und Windschätzung über echte IGC-Flüge laufen lassen.
   Aufruf:  node werkzeuge/auswertung.js <Ordner mit .igc> <Ausgabeordner>
   Erzeugt <Ausgabeordner>/bericht.html (alle Flüge, mit Grafiken), je Flug eine .svg und zusammenfassung.json.
   Die IGC-Dateien werden nur gelesen. Pilotenname und Positionen kommen nicht in den Bericht. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const igc = require("../igc.js");
const Kreisen = require("../kreisen.js");
const Wind = require("../wind.js");

const [, , EIN, AUS] = process.argv;
if (!EIN || !AUS) { console.error("Aufruf: node werkzeuge/auswertung.js <igc-Ordner> <Ausgabeordner>"); process.exit(1); }
fs.mkdirSync(AUS, { recursive: true });

const UTC_OFFSET_H = 2;   // alle Flüge zwischen Ende März und Ende Oktober → MESZ
const zeit = (t) => { const s = ((Math.round(t) + UTC_OFFSET_H * 3600) % 86400 + 86400) % 86400; return [s / 3600 | 0, (s / 60 | 0) % 60, s % 60].map(x => String(x).padStart(2, "0")).join(":"); };
const dauer = (s) => (s >= 60 ? Math.floor(s / 60) + " min " : "") + Math.round(s % 60) + " s";
const KOMPASS = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const kompass = (g) => KOMPASS[Math.round(((g % 360) + 360) % 360 / 22.5) % 16];
const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const winkelDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const f1 = (x) => Number.isFinite(x) ? x.toFixed(1) : "–";

// Startzeit / Landezeit: erste und letzte Stelle mit 20 s am Stück über 15 km/h
function startLandung(v) {
  const schnell = v.map(x => x.geschw !== null && x.geschw * 3.6 >= 15);
  let s = null, l = null, lauf = 0;
  for (let i = 0; i < v.length; i++) { lauf = schnell[i] ? lauf + 1 : 0; if (lauf >= 20) { s = v[i - 19].t; break; } }
  lauf = 0;
  for (let i = v.length - 1; i >= 0; i--) { lauf = schnell[i] ? lauf + 1 : 0; if (lauf >= 20) { l = v[i + 19].t; break; } }
  return { start: s, landung: l };
}

// Steigphasen aus der GPS-Höhe: 30-s-Mittel des Steigens über 0.8 m/s, mindestens 45 s
function steigphasen(fixes) {
  const out = [];
  let von = null;
  for (let i = 0; i < fixes.length; i++) {
    let j = i; while (j > 0 && fixes[i].t - fixes[j - 1].t <= 30) j--;
    const dt = fixes[i].t - fixes[j].t;
    const w = dt >= 20 ? (fixes[i].gHoehe - fixes[j].gHoehe) / dt : 0;
    if (w >= 0.8) { if (von === null) von = fixes[j].t; }
    else if (von !== null) { if (fixes[i].t - von >= 45) out.push({ von, bis: fixes[i].t }); von = null; }
  }
  return out;
}
const ueberlappung = (a, b) => Math.max(0, Math.min(a.bis, b.bis) - Math.max(a.von, b.von));

function analysiere(datei) {
  const roh = igc.parseIgc(fs.readFileSync(datei, "utf8"));
  const fixes = roh.fixes.filter(f => f.gueltig && Number.isFinite(f.gHoehe));
  const v = igc.geschwVektoren(fixes);
  const sl = startLandung(v);
  const det = Kreisen.createKreisDetektor();
  const sch = Wind.createWindSchaetzer();
  const schLogger = Wind.createWindSchaetzer();   // Gegenprobe mit GSP/CCO aus der Datei (falls CCO brauchbar)
  const phasen = [], winde = [];
  let ccoAbw = [];
  for (let i = 0; i < v.length; i++) {
    const e = fixes[i].ext;
    if (v[i].kurs !== null && v[i].geschw > 3 && Number.isFinite(e.CCO)) ccoAbw.push(winkelDiff(v[i].kurs, e.CCO));
  }
  const ccoBrauchbar = ccoAbw.length > 100 && med(ccoAbw) < 15;
  const loggerPunkte = (punkte) => punkte.map(p => {
    const f = fixes.find(x => x.t === p.t);
    return f && Number.isFinite(f.ext.GSP) && Number.isFinite(f.ext.CCO) ? { t: p.t, geschw: f.ext.GSP / 3.6, kurs: f.ext.CCO, hoehe: p.hoehe } : null;
  }).filter(Boolean);
  let aktPhase = null;
  const fenster = (fen, quelle, nummer) => {
    const r = sch.verarbeite(fen, quelle);
    if (!r) return;
    r.phase = aktPhase; r.nummer = nummer;
    if (ccoBrauchbar) { const r2 = schLogger.verarbeite(Object.assign({}, fen, { punkte: loggerPunkte(fen.punkte) }), quelle); r.logger = r2; }
    winde.push(r);
  };
  det.on("kreisBeginn", (b) => { aktPhase = phasen.length; phasen.push({ beginn: b.beginn, erkannt: b.t, richtung: b.richtung }); });
  det.on("vollkreis", (x) => fenster(x.fenster, "vollkreis", x.nummer));
  det.on("kreisEnde", (x) => {
    const p = phasen[phasen.length - 1];
    const h0 = x.punkte.length ? x.punkte[0].hoehe : null, h1 = x.punkte.length ? x.punkte[x.punkte.length - 1].hoehe : null;
    Object.assign(p, { ende: x.ende, dauer: x.dauer, winkel: x.winkel, kreise: x.anzahlKreise, grund: x.grund, h0, h1,
      steigen: x.dauer > 0 ? (h1 - h0) / x.dauer : NaN });
    fenster(x.fenster, "kreisEnde", null);
    aktPhase = null;
  });
  // Phasenwahl Thermik/Gleiten wie in der App (automatischer Seitenwechsel)
  const pw = Kreisen.createPhasenwahl(det);
  const seiten = [];   // Thermik-Episoden: Seite von/bis, Thermik beginn/ende, Höhen, Kreise, Gründe
  pw.on("modus", (m) => {
    if (m.modus === "thermik") seiten.push({ seiteVon: m.t, grundEin: m.grund, verz: m.t - m.thermik.beginn });
    else { const e = seiten[seiten.length - 1]; Object.assign(e, m.letzteThermik, { seiteBis: m.t, grundAus: m.grund }); }
  });
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x.geschw === null) det.tick(x.t);
    else det.update({ t: x.t, kursGrad: x.kurs, geschwindigkeit: x.geschw, ost: x.ost, nord: x.nord, hoehe: fixes[i].gHoehe, lat: fixes[i].lat, lon: fixes[i].lon });
    pw.tick(x.t, fixes[i].gHoehe);
  }
  const tEnde = fixes[fixes.length - 1].t + 60;
  det.tick(tEnde); pw.tick(tEnde, null);
  for (const e of seiten) {
    e.gewinn = Number.isFinite(e.hoeheEnde) && Number.isFinite(e.hoeheBeginn) ? e.hoeheEnde - e.hoeheBeginn : NaN;
    e.dauer = e.ende - e.beginn;
    e.anzeige = e.seiteBis - e.seiteVon;
    e.ort = sl.start !== null && e.beginn < sl.start + 120 ? "kurz nach Start" : sl.landung !== null && e.ende > sl.landung - 180 ? "kurz vor Landung" : "";
  }

  // Einordnung der Kreisabschnitte
  for (const p of phasen) {
    p.ort = sl.start !== null && p.beginn < sl.start + 120 ? "kurz nach Start"
          : sl.landung !== null && p.ende > sl.landung - 180 ? "kurz vor Landung"
          : sl.start === null || p.beginn < sl.start || p.ende > sl.landung ? "am Boden" : "";
    p.kurz = p.winkel < 360;
  }
  const steig = steigphasen(fixes);
  const kreisIntervalle = phasen.map(p => ({ von: p.beginn, bis: p.ende }));
  const steigZeit = steig.reduce((s, x) => s + x.bis - x.von, 0);
  const steigImKreis = steig.reduce((s, x) => s + kreisIntervalle.reduce((a, k) => a + ueberlappung(x, k), 0), 0);
  const steigOhneKreis = steig.filter(x => kreisIntervalle.reduce((a, k) => a + ueberlappung(x, k), 0) < 0.3 * (x.bis - x.von));
  // Seitenwechsel bewerten: Thermik-Referenz = Kreisabschnitte mit mindestens 2 vollen Kreisen und Steigen > 0.3 m/s
  const seitenIv = seiten.map(e => ({ von: e.seiteVon, bis: e.seiteBis }));
  const ref = phasen.filter(p => p.kreise >= 2 && p.steigen > 0.3).map(p => ({ von: p.beginn, bis: p.ende }));
  const refZeit = ref.reduce((a, r) => a + r.bis - r.von, 0);
  const refAufThermik = ref.reduce((a, r) => a + seitenIv.reduce((b, x) => b + ueberlappung(r, x), 0), 0);
  const soarZeit = steigOhneKreis.reduce((a, x) => a + x.bis - x.von, 0);
  const soarAufThermik = steigOhneKreis.reduce((a, x) => a + seitenIv.reduce((b, y) => b + ueberlappung(x, y), 0), 0);
  const flugZeit = sl.start !== null ? sl.landung - sl.start : 0;
  const thermikSeitenZeit = seitenIv.reduce((a, x) => a + x.bis - x.von, 0);

  // Konsistenz: aufeinanderfolgende gute Schätzungen im selben Kreisabschnitt
  const ok = winde.filter(w => w.ok);
  const folge = [];
  for (let i = 1; i < ok.length; i++) if (ok[i].phase === ok[i - 1].phase && ok[i].phase !== null) {
    folge.push({ dv: Math.hypot(ok[i].wind.ost - ok[i - 1].wind.ost, ok[i].wind.nord - ok[i - 1].wind.nord) * 3.6,
                 ds: Math.abs(ok[i].staerkeKmh - ok[i - 1].staerkeKmh), dr: winkelDiff(ok[i].richtungVon, ok[i - 1].richtungVon),
                 stark: Math.min(ok[i].staerkeKmh, ok[i - 1].staerkeKmh) >= 8 });
  }
  // Wind über die Höhe in 250-m-Stufen (Vektormittel der guten/mittleren Schätzungen)
  const stufen = {};
  for (const w of ok) { const s = Math.floor(w.hoehe / 250) * 250; (stufen[s] = stufen[s] || []).push(w); }
  const profil = Object.keys(stufen).map(Number).sort((a, b) => a - b).map(s => {
    const l = stufen[s], o = l.reduce((a, w) => a + w.wind.ost, 0) / l.length, n = l.reduce((a, w) => a + w.wind.nord, 0) / l.length;
    return { hoehe: s, n: l.length, staerkeKmh: Math.hypot(o, n) * 3.6, von: (Math.atan2(o, n) * 180 / Math.PI + 540) % 360,
             streuungKmh: Math.sqrt(l.reduce((a, w) => a + ((w.wind.ost - o) ** 2 + (w.wind.nord - n) ** 2), 0) / l.length) * 3.6 };
  });
  const logger = winde.filter(w => w.ok && w.logger && w.logger.ok).map(w => Math.hypot(w.wind.ost - w.logger.wind.ost, w.wind.nord - w.logger.wind.nord) * 3.6);
  return { datei: path.basename(datei), datum: roh.datum, fixes, v, sl, phasen, winde, statistik: sch.statistik, steig, steigZeit, steigImKreis,
           steigOhneKreis, folge, profil, ccoBrauchbar, ccoMedian: med(ccoAbw), loggerDiff: logger, kstat: det.statistik(),
           seiten, refZeit, refAufThermik, soarZeit, soarAufThermik, flugZeit, thermikSeitenZeit };
}

/* ---------- Grafik: Höhe über Zeit mit Kreisabschnitten, daneben Wind über Höhe ---------- */
function grafik(a) {
  const W = 1000, H = 400, L = 56, R1 = 690, L2 = 740, R2 = 980, T = 30, B = 322;
  const t0 = a.fixes[0].t, t1 = a.fixes[a.fixes.length - 1].t;
  let hmin = Infinity, hmax = -Infinity;
  for (const f of a.fixes) { hmin = Math.min(hmin, f.gHoehe); hmax = Math.max(hmax, f.gHoehe); }
  hmin = Math.floor(hmin / 100) * 100; hmax = Math.ceil(hmax / 100) * 100 + 50;
  const x = (t) => L + (t - t0) / Math.max(1, t1 - t0) * (R1 - L);
  const y = (h) => B - (h - hmin) / Math.max(1, hmax - hmin) * (B - T);
  const ok = a.winde.filter(w => w.ok);
  const vmax = Math.max(20, Math.ceil(Math.max(0, ...ok.map(w => w.staerkeKmh)) / 10) * 10);
  const xw = (v) => L2 + v / vmax * (R2 - L2);
  const s = [];
  s.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Höhe und Kreisabschnitte, Wind über Höhe" style="max-width:100%;height:auto;font:12px system-ui,sans-serif">`);
  s.push(`<style>.ax{stroke:var(--achse,#888);stroke-width:1}.gr{stroke:var(--gitter,#8884);stroke-width:1}.tx{fill:var(--text2,#555)}.ln{fill:none;stroke:var(--linie,#333);stroke-width:1.2}</style>`);
  // Gitter Höhe
  const hs = (hmax - hmin) > 1200 ? 500 : 200;
  for (let h = Math.ceil(hmin / hs) * hs; h <= hmax; h += hs) {
    s.push(`<line class="gr" x1="${L}" x2="${R2}" y1="${y(h)}" y2="${y(h)}"/><text class="tx" x="${L - 6}" y="${y(h) + 4}" text-anchor="end">${h}</text>`);
  }
  // Zeitachse alle 15 min
  const step = 900;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) s.push(`<line class="gr" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${B}"/><text class="tx" x="${x(t)}" y="${B + 16}" text-anchor="middle">${zeit(t).slice(0, 5)}</text>`);
  // Start/Landung
  for (const [t, n] of [[a.sl.start, "Start"], [a.sl.landung, "Landung"]]) if (t !== null) s.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${B}" stroke="#999" stroke-dasharray="3 3"/><text class="tx" x="${x(t) + 3}" y="${T + 10}">${n}</text>`);
  // Steigphasen (GPS) als Band unten
  for (const st of a.steig) s.push(`<rect x="${x(st.von)}" y="${B - 6}" width="${Math.max(1, x(st.bis) - x(st.von))}" height="6" fill="#16a34a" opacity=".8"/>`);
  // Kreisabschnitte
  for (const p of a.phasen) {
    const farbe = p.kurz ? "#f59e0b" : p.richtung === "rechts" ? "#2563eb" : "#db2777";
    s.push(`<rect x="${x(p.beginn)}" y="${T}" width="${Math.max(1.5, x(p.ende) - x(p.beginn))}" height="${B - T - 8}" fill="${farbe}" opacity="${p.kurz ? 0.35 : 0.22}"><title>${zeit(p.beginn)} ${p.richtung}, ${dauer(p.dauer)}, ${p.kreise} Kreise, ${f1(p.steigen)} m/s</title></rect>`);
  }
  // Höhenlinie
  const pts = [];
  const schritt = Math.max(1, Math.floor(a.fixes.length / 1500));
  for (let i = 0; i < a.fixes.length; i += schritt) pts.push(x(a.fixes[i].t).toFixed(1) + "," + y(a.fixes[i].gHoehe).toFixed(1));
  s.push(`<polyline class="ln" points="${pts.join(" ")}"/>`);
  // Seite Thermik (automatischer Seitenwechsel) als Band oben
  for (const e of a.seiten) s.push(`<rect x="${x(e.seiteVon)}" y="${T - 12}" width="${Math.max(1.5, x(e.seiteBis) - x(e.seiteVon))}" height="8" fill="${e.kreise > 0 ? "#0d9488" : "#f97316"}"><title>Seite Thermik ${zeit(e.seiteVon)}–${zeit(e.seiteBis)} · ${e.kreise} Kreise · ${Number.isFinite(e.gewinn) ? Math.round(e.gewinn) + " m" : ""} · ${esc(e.grundEin)} → ${esc(e.grundAus)}</title></rect>`);
  // Windschätzungen als Punkte auf der Höhenlinie
  for (const w of a.winde) s.push(`<circle cx="${x(w.t)}" cy="${y(w.hoehe)}" r="2.6" fill="${w.ok ? (w.qualitaet === "gut" ? "#16a34a" : "#ca8a04") : "#dc2626"}"><title>${zeit(w.t)} ${w.ok ? Math.round(w.staerkeKmh) + " km/h aus " + Math.round(w.richtungVon) + "°" : "verworfen: " + esc(w.gruende.join(", "))}</title></circle>`);
  s.push(`<line class="ax" x1="${L}" x2="${R1}" y1="${B}" y2="${B}"/><line class="ax" x1="${L}" x2="${L}" y1="${T}" y2="${B}"/>`);
  s.push(`<text class="tx" x="${L}" y="${H - 34}">Uhrzeit (MESZ) · GPS-Höhe m · Punkte: Windschätzung gut (grün), mittel (gelb), verworfen (rot)</text>`);
  s.push(`<text class="tx" x="${L}" y="${H - 18}">Balken: Kreisen rechts (blau), links (pink), unter 360° (orange) · grün unten: Steigen ≥ 0.8 m/s (GPS)</text>`);
  s.push(`<text class="tx" x="${L}" y="${H - 2}">Band ganz oben: Seite „Thermik“ (türkis; orange = ohne vollen Kreis), sonst Seite „Gleiten“</text>`);
  // Wind über Höhe
  for (let v = 0; v <= vmax; v += 10) s.push(`<line class="gr" x1="${xw(v)}" x2="${xw(v)}" y1="${T}" y2="${B}"/><text class="tx" x="${xw(v)}" y="${B + 16}" text-anchor="middle">${v}</text>`);
  s.push(`<line class="ax" x1="${L2}" x2="${R2}" y1="${B}" y2="${B}"/><line class="ax" x1="${L2}" x2="${L2}" y1="${T}" y2="${B}"/>`);
  s.push(`<text class="tx" x="${L2}" y="${H - 34}">Wind km/h über Höhe</text><text class="tx" x="${L2}" y="${H - 18}">Strich zeigt, wohin er weht (Nord oben)</text>`);
  for (const w of ok) {
    const cx = xw(w.staerkeKmh), cy = y(w.hoehe), r = 9, a2 = w.richtungNach * Math.PI / 180;
    const dx = Math.sin(a2) * r, dy = -Math.cos(a2) * r;
    const farbe = w.qualitaet === "gut" ? "#16a34a" : "#ca8a04";
    s.push(`<g stroke="${farbe}" stroke-width="1.6" fill="${farbe}"><line x1="${(cx - dx).toFixed(1)}" y1="${(cy - dy).toFixed(1)}" x2="${(cx + dx).toFixed(1)}" y2="${(cy + dy).toFixed(1)}"/><circle cx="${(cx + dx).toFixed(1)}" cy="${(cy + dy).toFixed(1)}" r="2"/><title>${zeit(w.t)} · ${Math.round(w.hoehe)} m · ${f1(w.staerkeKmh)} km/h aus ${Math.round(w.richtungVon)}° (${kompass(w.richtungVon)}) · ${w.qualitaet}</title></g>`);
  }
  s.push(`</svg>`);
  return s.join("");
}

/* ---------- Bericht ---------- */
const dateien = fs.readdirSync(EIN).filter(f => /\.igc$/i.test(f)).sort();
const alle = [];
for (const f of dateien) {
  try { alle.push(analysiere(path.join(EIN, f))); }
  catch (err) { console.error("Fehler in " + f + ": " + err.message); }
}

const sum = { fluege: alle.length, phasen: 0, kurz: 0, kurzSinken: 0, rand: 0, kreise: 0, fenster: 0, gut: 0, mittel: 0, schlecht: 0, nichtGueltig: 0, gruende: {},
              steigZeit: 0, steigImKreis: 0, steigOhneKreis: 0, folge: [], logger: [], verz: [],
              ep: 0, epOhneKreis: 0, epKurz: 0, epSinken: 0, epRand: 0, epVerz: [], refZeit: 0, refAufThermik: 0, soarZeit: 0, soarAufThermik: 0, flugZeit: 0, thermikSeitenZeit: 0 };
for (const a of alle) {
  sum.phasen += a.phasen.length; sum.kurz += a.phasen.filter(p => p.kurz).length;
  sum.kurzSinken += a.phasen.filter(p => p.kurz && p.steigen < 0).length;
  sum.rand += a.phasen.filter(p => p.ort).length;
  sum.kreise += a.phasen.reduce((s, p) => s + p.kreise, 0);
  for (const k of ["fenster", "gut", "mittel", "schlecht", "nichtGueltig"]) sum[k] += a.statistik[k];
  for (const [g, n] of Object.entries(a.statistik.gruende)) sum.gruende[g] = (sum.gruende[g] || 0) + n;
  sum.steigZeit += a.steigZeit; sum.steigImKreis += a.steigImKreis; sum.steigOhneKreis += a.steigOhneKreis.length;
  sum.folge.push(...a.folge); sum.logger.push(...a.loggerDiff);
  sum.verz.push(...a.phasen.map(p => p.erkannt - p.beginn));
  sum.ep += a.seiten.length; sum.epOhneKreis += a.seiten.filter(e => e.kreise === 0).length;
  sum.epKurz += a.seiten.filter(e => e.anzeige < 45).length; sum.epSinken += a.seiten.filter(e => e.gewinn < 0).length;
  sum.epRand += a.seiten.filter(e => e.ort).length; sum.epVerz.push(...a.seiten.map(e => e.verz));
  for (const k of ["refZeit", "refAufThermik", "soarZeit", "soarAufThermik", "flugZeit", "thermikSeitenZeit"]) sum[k] += a[k];
}

const h = [];
h.push(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wind und Kreisen – Auswertung</title><style>
:root{--bg:#fff;--text:#111;--text2:#555;--karte:#f4f5f7;--linie:#333;--gitter:#8883;--achse:#888}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--text:#eee;--text2:#aab;--karte:#1a1d23;--linie:#ddd;--gitter:#fff2;--achse:#999}}
body{background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif;margin:0 auto;max-width:1060px;padding:16px}
h1{font-size:1.5rem}h2{margin-top:2.2em;border-top:1px solid var(--gitter);padding-top:1em}h3{font-size:1rem;margin:1.2em 0 .4em}
table{border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:13px;margin:.4em 0 1em;width:100%}
th,td{padding:3px 6px;border-bottom:1px solid var(--gitter);text-align:right;white-space:nowrap}th{color:var(--text2);font-weight:600}
td.l,th.l{text-align:left}.warn{background:#f59e0b22;padding:10px 12px;border-radius:8px}.k{background:var(--karte);padding:10px 12px;border-radius:8px}
.scroll{overflow-x:auto}.q-gut{color:#16a34a}.q-mittel{color:#ca8a04}.q-schlecht{color:#dc2626}small{color:var(--text2)}
</style></head><body>`);
h.push(`<h1>Kreiserkennung und Windschätzung an ${alle.length} eigenen Flügen</h1>`);
h.push(`<p class="warn"><b>Ohne Referenz:</b> Es gibt zu diesen Flügen keinen gemessenen Wind und die Dateien enthalten keinen Steuerkurs (Feld HDT ist immer 0). Die Windwerte sind deshalb nicht überprüft, ihre Genauigkeit ist <b>nicht belegt</b>. Geprüft wird nur die innere Stimmigkeit: passen Kreise zu Steigphasen, sind aufeinanderfolgende Schätzungen ähnlich, ist der Wind über die Höhe plausibel. Die Daten stammen vom iPhone-GPS (Wingman, 1 Hz), nicht vom XCTracer (2 Hz) – Schwellen, die hier passen, sind für das Gerät nur vorläufig.</p>`);
h.push(`<div class="k"><b>Einstellungen dieser Auswertung</b> (Standardwerte der App)<br><small>Kreiserkennung: ${esc(JSON.stringify(Kreisen.STANDARD))}<br>Wind: ${esc(JSON.stringify(Wind.STANDARD))}<br>Geschwindigkeitsvektoren aus Positionsdifferenzen (zentral, 1 Hz). Zeiten in MESZ (UTC+2).</small></div>`);

const prozent = (a, b) => b ? Math.round(a / b * 100) + " %" : "–";
const fS = sum.folge.filter(f => f.stark);
h.push(`<h2>Zusammenfassung</h2><table><tbody>
<tr><td class="l">Kreisabschnitte erkannt</td><td>${sum.phasen}</td><td class="l">davon mindestens ein voller Kreis: ${sum.phasen - sum.kurz}; unter 360°: ${sum.kurz} (davon ${sum.kurzSinken} mit Sinken)</td></tr>
<tr><td class="l">Abschnitte kurz nach Start, kurz vor Landung oder am Boden</td><td>${sum.rand}</td><td class="l">mögliche Fehlerkennungen bei Start/Landeanflug</td></tr>
<tr><td class="l">Volle Kreise insgesamt</td><td>${sum.kreise}</td><td class="l"></td></tr>
<tr><td class="l">Verzögerung „Kreisen beginnt“ ab Drehbeginn</td><td>${f1(med(sum.verz))} s</td><td class="l">Median; 90 % unter ${f1([...sum.verz].sort((a, b) => a - b)[Math.floor(sum.verz.length * 0.9)])} s</td></tr>
<tr><td class="l">Steigzeit (GPS ≥ 0.8 m/s, ≥ 45 s) innerhalb von Kreisabschnitten</td><td>${prozent(sum.steigImKreis, sum.steigZeit)}</td><td class="l">${sum.steigOhneKreis} Steigphasen ganz oder fast ohne erkanntes Kreisen (Hang- oder Geradeaus-Steigen?)</td></tr>
<tr><td class="l">Seite „Thermik“ (automatischer Wechsel)</td><td>${sum.ep}</td><td class="l">${f1(sum.ep / Math.max(1, sum.flugZeit) * 3600)} pro Flugstunde; ${prozent(sum.thermikSeitenZeit, sum.flugZeit)} der Flugzeit; Wechsel ${f1(med(sum.epVerz))} s nach Drehbeginn (Median)</td></tr>
<tr><td class="l">Thermiken (≥ 2 Kreise, Steigen) auf der Thermik-Seite</td><td>${prozent(sum.refAufThermik, sum.refZeit)}</td><td class="l">Anteil der Kreiszeit in steigenden Thermiken</td></tr>
<tr><td class="l">Steigen ohne Kreisen (Hang, Soaring) auf der Thermik-Seite</td><td>${prozent(sum.soarAufThermik, sum.soarZeit)}</td><td class="l">sollte klein sein: dort bleibt „Gleiten“</td></tr>
<tr><td class="l">Fragliche Thermik-Episoden</td><td>${sum.epOhneKreis + sum.epSinken}</td><td class="l">ohne vollen Kreis ${sum.epOhneKreis}; mit Höhenverlust ${sum.epSinken}; kürzer als 45 s angezeigt ${sum.epKurz}; kurz nach Start oder vor Landung ${sum.epRand}</td></tr>
<tr><td class="l">Windfenster</td><td>${sum.fenster}</td><td class="l">gut ${sum.gut}, mittel ${sum.mittel}, schlecht ${sum.schlecht}, nicht gültig ${sum.nichtGueltig}</td></tr>
<tr><td class="l">Aufeinanderfolgende Schätzungen im selben Abschnitt</td><td>${sum.folge.length}</td><td class="l">Vektorunterschied Median ${f1(med(sum.folge.map(f => f.dv)))} km/h; Stärke ${f1(med(sum.folge.map(f => f.ds)))} km/h; Richtung (beide ≥ 8 km/h) ${f1(med(fS.map(f => f.dr)))}°</td></tr>
<tr><td class="l">Gegenprobe mit Geschwindigkeit/Kurs aus der Datei (GSP/CCO)</td><td>${sum.logger.length}</td><td class="l">Unterschied zum Wind aus Positionen: Median ${f1(med(sum.logger))} km/h (nur Flüge, in denen CCO zum Positionskurs passt)</td></tr>
</tbody></table>`);
h.push(`<h3>Warum Windfenster verworfen wurden</h3><table><thead><tr><th class="l">Grund</th><th>Anzahl</th></tr></thead><tbody>${Object.entries(sum.gruende).sort((a, b) => b[1] - a[1]).map(([g, n]) => `<tr><td class="l">${esc(g.replace(/#/g, "…"))}</td><td>${n}</td></tr>`).join("")}</tbody></table>`);

for (const a of alle) {
  const svg = grafik(a);
  const name = (a.datei.match(/\d{4}-\d{2}-\d{2}/) || [a.datei])[0];
  fs.writeFileSync(path.join(AUS, name + ".svg"), svg);
  const dauerFlug = a.sl.start !== null ? (a.sl.landung - a.sl.start) : 0;
  h.push(`<h2>Flug ${esc(name)} <small>${zeit(a.fixes[0].t)}–${zeit(a.fixes[a.fixes.length - 1].t)}, ${dauer(dauerFlug)} in der Luft, ${a.fixes.length} Fixes, ${a.fixes[0].gHoehe}–${Math.max(...a.fixes.map(f => f.gHoehe))} m</small></h2>`);
  h.push(`<div class="scroll">${svg}</div>`);
  h.push(`<h3>Seitenwechsel: ${a.seiten.length}× Thermik <small>(${prozent(a.thermikSeitenZeit, a.flugZeit)} der Flugzeit; steigende Thermiken ${prozent(a.refAufThermik, a.refZeit)} abgedeckt; Steigen ohne Kreisen ${prozent(a.soarAufThermik, a.soarZeit)} auf Thermik-Seite)</small></h3><div class="scroll"><table><thead><tr><th class="l">Thermik-Seite</th><th>angezeigt</th><th>nach Drehbeginn</th><th>Kreise</th><th>Höhengewinn</th><th>Ø Steigen</th><th class="l">Wechsel hin</th><th class="l">Wechsel zurück</th><th class="l">Hinweis</th></tr></thead><tbody>`
    + a.seiten.map(e => `<tr><td class="l">${zeit(e.seiteVon)}–${zeit(e.seiteBis)}</td><td>${dauer(e.anzeige)}</td><td>${Math.round(e.verz)} s</td><td>${e.kreise}</td><td>${Number.isFinite(e.gewinn) ? Math.round(e.gewinn) + " m" : "–"}</td><td>${Number.isFinite(e.gewinn) && e.dauer > 0 ? f1(e.gewinn / e.dauer) + " m/s" : "–"}</td><td class="l">${esc(e.grundEin)}</td><td class="l">${esc(e.grundAus)}</td><td class="l">${[e.ort, e.kreise === 0 ? "ohne vollen Kreis" : "", e.gewinn < 0 ? "Höhenverlust" : "", e.anzeige < 45 ? "kurz" : ""].filter(Boolean).join(", ")}</td></tr>`).join("")
    + `</tbody></table></div>`);
  h.push(`<h3>Kreisabschnitte (${a.phasen.length})</h3><div class="scroll"><table><thead><tr><th class="l">Beginn</th><th>Dauer</th><th>Kreise</th><th>Winkel</th><th class="l">Richtung</th><th>Höhe Beginn</th><th>mittl. Steigen</th><th class="l">Ende</th><th class="l">Hinweis</th></tr></thead><tbody>`
    + a.phasen.map(p => `<tr><td class="l">${zeit(p.beginn)}</td><td>${dauer(p.dauer)}</td><td>${p.kreise}</td><td>${Math.round(p.winkel)}°</td><td class="l">${p.richtung}</td><td>${p.h0} m</td><td>${f1(p.steigen)} m/s</td><td class="l">${{ geradeaus: "geradeaus", richtungswechsel: "Richtungswechsel", datenluecke: "Datenlücke" }[p.grund] || p.grund}</td><td class="l">${[p.ort, p.kurz ? "unter 360°" : "", p.steigen < 0 ? "Sinken" : ""].filter(Boolean).join(", ")}</td></tr>`).join("")
    + `</tbody></table></div>`);
  h.push(`<h3>Windschätzungen (${a.winde.length} Fenster, ${a.winde.filter(w => w.ok).length} brauchbar)</h3><div class="scroll"><table><thead><tr><th class="l">Zeit</th><th>Höhe</th><th>Wind</th><th>aus</th><th class="l"></th><th>Fluggeschw.</th><th class="l">Qualität</th><th>Lücke</th><th>Restfehler</th><th>Punkte</th><th class="l">Fenster</th><th class="l">Gründe</th></tr></thead><tbody>`
    + a.winde.map(w => `<tr><td class="l">${zeit(w.t)}</td><td>${Math.round(w.hoehe)} m</td><td>${w.wind ? f1(w.staerkeKmh) + " km/h" : "–"}</td><td>${w.wind ? Math.round(w.richtungVon) + "°" : "–"}</td><td class="l">${w.wind ? kompass(w.richtungVon) : ""}</td><td>${w.wind ? f1(w.fluggeschwKmh) + " km/h" : "–"}</td><td class="l q-${w.qualitaet}">${w.qualitaet}</td><td>${w.wind ? Math.round(w.groessteLuecke) + "°" : "–"}</td><td>${w.wind ? f1(w.restfehler * 100) + " %" : "–"}</td><td>${w.n || 0}</td><td class="l">${w.quelle === "vollkreis" ? "Kreis " + w.nummer : "Rest " + Math.round(w.winkelFenster) + "°"}</td><td class="l"><small>${esc(w.gruende.join(", "))}</small></td></tr>`).join("")
    + `</tbody></table></div>`);
  if (a.profil.length) h.push(`<h3>Wind über die Höhe (Vektormittel je 250 m)</h3><table><thead><tr><th>Höhe</th><th>Schätzungen</th><th>Wind</th><th>aus</th><th class="l"></th><th>Streuung</th></tr></thead><tbody>`
    + a.profil.map(p => `<tr><td>${p.hoehe}–${p.hoehe + 250} m</td><td>${p.n}</td><td>${f1(p.staerkeKmh)} km/h</td><td>${Math.round(p.von)}°</td><td class="l">${kompass(p.von)}</td><td>${f1(p.streuungKmh)} km/h</td></tr>`).join("") + `</tbody></table>`);
  const fs2 = a.folge.filter(f => f.stark);
  h.push(`<p><small>Konsistenz im selben Aufwind: ${a.folge.length} Paare, Vektorunterschied Median ${f1(med(a.folge.map(f => f.dv)))} km/h, Richtung ${f1(med(fs2.map(f => f.dr)))}° (Paare ab 8 km/h). `
    + `Steigzeit im Kreisen: ${prozent(a.steigImKreis, a.steigZeit)}; Steigphasen ohne Kreisen: ${a.steigOhneKreis.map(s => zeit(s.von) + " (" + dauer(s.bis - s.von) + ")").join(", ") || "keine"}. `
    + `CCO-Kurs der Datei ${a.ccoBrauchbar ? "passt" : "passt nicht"} zum Positionskurs (Median-Abweichung ${f1(a.ccoMedian)}°)${a.loggerDiff.length ? "; Wind aus GSP/CCO weicht im Median um " + f1(med(a.loggerDiff)) + " km/h ab" : ""}. `
    + `Verworfen: ${esc(Object.entries(a.statistik.gruende).map(([g, n]) => g.replace(/#/g, "…") + " " + n).join(", ") || "nichts")}.</small></p>`);
}
h.push(`</body></html>`);
fs.writeFileSync(path.join(AUS, "bericht.html"), h.join("\n"));
fs.writeFileSync(path.join(AUS, "zusammenfassung.json"), JSON.stringify({ summe: Object.assign({}, sum, { folge: undefined, logger: undefined, verz: undefined }),
  fluege: alle.map(a => ({ datei: a.datei, phasen: a.phasen.length, kurz: a.phasen.filter(p => p.kurz).length, winde: a.winde.length, brauchbar: a.winde.filter(w => w.ok).length,
    profil: a.profil, steigImKreis: a.steigZeit ? a.steigImKreis / a.steigZeit : null, folgeMedianKmh: med(a.folge.map(f => f.dv)), ccoBrauchbar: a.ccoBrauchbar })) }, null, 1));

// Kurzfassung auf der Konsole
console.log(`Flüge ${alle.length} · Kreisabschnitte ${sum.phasen} (unter 360°: ${sum.kurz}, davon mit Sinken ${sum.kurzSinken}; bei Start/Landung/Boden: ${sum.rand}) · volle Kreise ${sum.kreise}`);
console.log(`Verzögerung Kreisbeginn: Median ${f1(med(sum.verz))} s · Steigzeit im Kreisen ${prozent(sum.steigImKreis, sum.steigZeit)} · Steigphasen ohne Kreisen ${sum.steigOhneKreis}`);
console.log(`Windfenster ${sum.fenster}: gut ${sum.gut}, mittel ${sum.mittel}, schlecht ${sum.schlecht}, nicht gültig ${sum.nichtGueltig}`);
console.log(`Gründe: ${JSON.stringify(sum.gruende)}`);
console.log(`Folge-Schätzungen im selben Abschnitt: ${sum.folge.length}, Vektorunterschied Median ${f1(med(sum.folge.map(f => f.dv)))} km/h, Richtung (≥8 km/h) ${f1(med(fS.map(f => f.dr)))}°`);
console.log(`Gegenprobe GSP/CCO: ${sum.logger.length} Schätzungen, Unterschied Median ${f1(med(sum.logger))} km/h`);
console.log(`Seite Thermik: ${sum.ep} Episoden (${f1(sum.ep / Math.max(1, sum.flugZeit) * 3600)}/h, ${prozent(sum.thermikSeitenZeit, sum.flugZeit)} der Flugzeit), Wechsel Median ${f1(med(sum.epVerz))} s nach Drehbeginn; `
  + `steigende Thermiken abgedeckt ${prozent(sum.refAufThermik, sum.refZeit)}; Steigen ohne Kreisen auf Thermik-Seite ${prozent(sum.soarAufThermik, sum.soarZeit)}; `
  + `ohne vollen Kreis ${sum.epOhneKreis}, Höhenverlust ${sum.epSinken}, < 45 s ${sum.epKurz}, Start/Landung ${sum.epRand}`);
for (const a of alle) console.log(`  ${a.datei.slice(10, 20)}: ${a.seiten.length}× Thermik, ${prozent(a.thermikSeitenZeit, a.flugZeit)} der Flugzeit, Thermiken abgedeckt ${prozent(a.refAufThermik, a.refZeit)}, Soaring auf Thermik ${prozent(a.soarAufThermik, a.soarZeit)} (${Math.round(a.soarZeit)} s Steigen ohne Kreisen), fraglich ${a.seiten.filter(e => e.kreise === 0 || e.gewinn < 0).length}`);
for (const a of alle) console.log(`${a.datei.slice(10, 20)}: ${a.phasen.length} Abschnitte (${a.phasen.filter(p => p.kurz).length} kurz), Wind ${a.winde.filter(w => w.ok).length}/${a.winde.length}, Profil ${a.profil.map(p => p.hoehe + ":" + Math.round(p.staerkeKmh) + "/" + Math.round(p.von)).join(" ")}, Folge-Median ${f1(med(a.folge.map(f => f.dv)))} km/h, CCO ${a.ccoBrauchbar ? "ok" : "–"}`);
