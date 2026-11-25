/* Logbuch: Auswertung einzelner Flüge und Statistik (Eigenbau, nur Schätzungen aus GPS-Daten).
   Ohne Oberfläche; läuft im Browser (globales Objekt "Flugbuch", braucht Igc, Kreisen, StartLandung, XContest)
   und in Node (require("./flugbuch.js")).

   Ablauf für einen Flug:
     1. Punkte {t (s, UTC), lat, lon, h (m)} aus einer App-Aufzeichnung (punkteAusApp) oder einer IGC-Datei (punkteAusIgc).
     2. analysiere(punkte): Start und Landung mit derselben Erkennung wie im Flug (startlandung.js, ohne Geländedaten),
        dann nur den Flug dazwischen auswerten:
          - Dauer, max. Höhe, Höhengewinn über Start (max. Höhe − Starthöhe) und kumuliert (alle Steigphasen, 5 m Hysterese)
          - Distanz und Punkte nach XContest World (xcontest.js), auf dem Track vom ersten Punkt bis zur Landung
          - Thermiken: Kreisphasen der Phasenwahl wie in der Fluganzeige (kreisen.js), gezählt ab +30 m Höhengewinn
            bis zum höchsten Punkt. Ø Steigen = Summe Höhengewinn / Summe Zeit in diesen Thermiken.
          - Gleiten: Abschnitte ausserhalb jeder Kreisphase, mindestens 30 s und 10 m Höhenverlust.
            Gleitzahl über Grund = Summe Strecke über Grund / Summe Höhenverlust (mit Wind, ohne Fahrt durch die Luft).
     3. statistik(fluege): Gesamt und pro Saison (Kalenderjahr, Ortszeit).
   Höhen: App-Aufzeichnung GPS-Höhe über Meer; IGC GNSS-Höhe, ohne diese die Druckhöhe. Für Steigwerte geglättet (±2 s). */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./igc.js"), require("./kreisen.js"), require("./startlandung.js"), require("./xcontest.js"));
  else root.Flugbuch = factory(root.Igc, root.Kreisen, root.StartLandung, root.XContest);
})(typeof self !== "undefined" ? self : this, function (Igc, Kreisen, StartLandung, XContest) {
  "use strict";

  const ANALYSE_VERSION = 1;          // erhöhen, wenn sich eine Berechnung ändert: die App rechnet dann alle Flüge neu
  const THERMIK_MIN_M = 30;           // Kreisphase zählt als Thermik ab so viel Höhengewinn
  const GLEIT_MIN_S = 30, GLEIT_MIN_VERLUST_M = 10;
  const HYSTERESE_M = 5;              // kumulierter Höhengewinn: Anstiege erst ab dieser Höhe zählen (GPS-Rauschen)
  const GLAETTUNG_S = 2;              // ± Sekunden für die geglättete Höhe
  const NAME_RADIUS_M = 2000;         // Wegpunkt so nah am Start → Name des Flugs
  const DUPLIKAT_S = 120, DUPLIKAT_M = 300;
  const RAD = Math.PI / 180, R = 6371008.8;

  function distanz(a, b) {
    const dp = (b.lat - a.lat) * RAD, dl = (b.lon - a.lon) * RAD;
    const x = Math.sin(dp / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  const zahl = (v) => typeof v === "number" && Number.isFinite(v);

  /* ---------- Punkte aus den Quellen ---------- */
  // Zeit streng steigend (doppelte und rückwärts laufende Zeiten weg), fehlende Höhen mit der nächsten vorhandenen füllen
  function bereinigen(punkte) {
    const out = [];
    for (const p of punkte) {
      if (!p || !zahl(p.t) || !zahl(p.lat) || !zahl(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) continue;
      if (out.length && p.t <= out[out.length - 1].t) continue;
      out.push({ t: p.t, lat: p.lat, lon: p.lon, h: zahl(p.h) ? p.h : null });
    }
    let letzte = null;
    for (const p of out) { if (p.h !== null) letzte = p.h; else p.h = letzte; }
    letzte = null;
    for (let i = out.length - 1; i >= 0; i--) { if (out[i].h !== null) letzte = out[i].h; else out[i].h = letzte; }
    return out.every(p => p.h !== null) ? out : out.map(p => Object.assign(p, { h: p.h === null ? 0 : p.h }));
  }
  const ddmmyyZuSek = (d) => Date.UTC(2000 + +d.slice(4, 6), +d.slice(2, 4) - 1, +d.slice(0, 2)) / 1000;
  const ddmmyyAus = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, "0"); return p(d.getUTCDate()) + p(d.getUTCMonth() + 1) + p(d.getUTCFullYear() % 100); };

  /* App-Aufzeichnung: fixes [{utc "hhmmss", date "ddmmyy" | null, lat, lon, q, alt, pAlt}], startMs = Beginn der Aufzeichnung.
     Datum aus dem Fix (letztes RMC-Datum), sonst aus startMs (UTC); springt die Zeit um mehr als 12 h zurück, ist Mitternacht vorbei. */
  function punkteAusApp(fixes, startMs) {
    const ersatz = ddmmyyAus(startMs || Date.now());
    const roh = [];
    let tVor = null;
    for (const f of fixes || []) {
      if (!f || !(f.q >= 1) || !zahl(f.lat) || !zahl(f.lon) || !/^\d{6}$/.test(f.utc || "")) continue;
      const d = /^\d{6}$/.test(f.date || "") ? f.date : ersatz;
      let t = ddmmyyZuSek(d) + +f.utc.slice(0, 2) * 3600 + +f.utc.slice(2, 4) * 60 + +f.utc.slice(4, 6);
      if (tVor !== null && t < tVor - 43200) t += 86400;
      tVor = t;
      roh.push({ t, lat: f.lat, lon: f.lon, h: zahl(f.alt) ? f.alt : null });
    }
    return bereinigen(roh);
  }

  /* IGC-Datei → {punkte, kopf {pilot, schirm}, hoeheQuelle "gps" | "baro"}. Wirft einen Fehler, wenn nichts Brauchbares drin ist. */
  function punkteAusIgc(text) {
    const r = Igc.parseIgc(text);
    if (!r.fixes.length) throw new Error("keine Positionen (B-Records) in der Datei");
    if (!r.datum) throw new Error("kein Datum (HFDTE) in der Datei");
    const gueltig = r.fixes.filter(f => f.gueltig);
    const fixes = gueltig.length >= 10 ? gueltig : r.fixes;
    const mitGps = fixes.filter(f => f.gHoehe !== null && f.gHoehe !== 0).length;
    const gps = mitGps >= fixes.length * 0.5;
    const basis = ddmmyyZuSek(r.datum);
    const punkte = bereinigen(fixes.map(f => ({ t: basis + f.t, lat: f.lat, lon: f.lon, h: gps ? f.gHoehe : f.pHoehe })));
    if (punkte.length < 10) throw new Error("zu wenige gültige Positionen (" + punkte.length + ")");
    return { punkte, kopf: r.kopf, hoeheQuelle: gps ? "gps" : "baro" };
  }

  /* ---------- Hilfen ---------- */
  // gleitender Mittelwert über ±s Sekunden
  function glaetten(punkte, s) {
    const n = punkte.length, out = new Float64Array(n);
    let a = 0, b = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      while (b < n && punkte[b].t <= punkte[i].t + s) { sum += punkte[b].h; b++; }
      while (punkte[a].t < punkte[i].t - s) { sum -= punkte[a].h; a++; }
      out[i] = sum / (b - a);
    }
    return out;
  }
  // kumulierter Höhengewinn mit Hysterese: ein Anstieg zählt erst, wenn er hyst Meter erreicht, dann bis zum Gipfel
  function kumuliert(h, hyst) {
    if (!h.length) return 0;
    let tief = h[0], hoch = h[0], steigt = false, summe = 0;
    for (let i = 1; i < h.length; i++) {
      const v = h[i];
      if (!steigt) { if (v < tief) tief = v; else if (v - tief >= hyst) { steigt = true; hoch = v; } }
      else if (v > hoch) hoch = v;
      else if (hoch - v >= hyst) { summe += hoch - tief; steigt = false; tief = v; }
    }
    if (steigt) summe += hoch - tief;
    return summe;
  }
  // erster Index mit t ≥ x (binäre Suche)
  function indexAb(punkte, x) {
    let lo = 0, hi = punkte.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (punkte[m].t < x) lo = m + 1; else hi = m; }
    return Math.min(lo, punkte.length - 1);
  }

  /* Start und Landung wie in der App (startlandung.js), ohne Geländedaten: Bewegung ab 15 km/h und 20 m Höhenänderung;
     Landung nach 30 s am Boden. Mehrere Flüge in einer Datei: vom ersten Start bis zur letzten Landung.
     Ohne erkannten Start gilt der ganze Track. */
  function flugAbschnitt(punkte, v, startBekannt) {
    const det = StartLandung.createStartLandeDetektor({ landungAuto: true });
    const n = punkte.length;
    // Start schon bekannt (im Flug mit Geländedaten erkannt): ab dort nur noch die Landung suchen
    if (zahl(startBekannt) && startBekannt >= punkte[0].t && startBekannt < punkte[n - 1].t) {
      const i0 = indexAb(punkte, startBekannt);
      let ende = null;
      det.flugBegonnen(punkte[i0].t);
      det.on("landung", (l) => { if (ende === null) ende = l.landeT; });
      for (let i = i0; i < n; i++) det.update({ t: punkte[i].t, geschwindigkeit: v[i].geschw, hoehe: punkte[i].h, agl: null });
      const i1 = ende !== null ? indexAb(punkte, ende) : n - 1;
      if (i1 - i0 >= 10) return { i0, i1, startErkannt: true, landungErkannt: ende !== null };
    }
    det.warten();
    const fluege = [];
    det.on("start", (s) => fluege.push({ start: s.startT, ende: null }));
    det.on("fehlstart", () => fluege.pop());
    det.on("landung", (l) => { if (fluege.length) fluege[fluege.length - 1].ende = l.landeT; det.warten(); });
    for (let i = 0; i < n; i++) det.update({ t: punkte[i].t, geschwindigkeit: v[i].geschw, hoehe: punkte[i].h, agl: null });
    if (!fluege.length) return { i0: 0, i1: n - 1, startErkannt: false, landungErkannt: false };
    const letzter = fluege[fluege.length - 1];
    const i0 = indexAb(punkte, fluege[0].start);
    const i1 = letzter.ende !== null ? indexAb(punkte, letzter.ende) : n - 1;
    if (i1 - i0 < 10) return { i0: 0, i1: n - 1, startErkannt: false, landungErkannt: false };
    return { i0, i1, startErkannt: true, landungErkannt: letzter.ende !== null };
  }

  // Kreisphasen der Phasenwahl (wie der automatische Seitenwechsel): [{von, bis}] in s
  function kreisphasen(punkte, v) {
    const det = Kreisen.createKreisDetektor(), pw = Kreisen.createPhasenwahl(det);
    const ph = [];
    pw.on("modus", (m) => {
      if (m.modus === "thermik") ph.push({ von: m.thermik.beginn, bis: null });
      else if (ph.length && ph[ph.length - 1].bis === null) ph[ph.length - 1].bis = m.letzteThermik && zahl(m.letzteThermik.ende) ? m.letzteThermik.ende : m.t;
    });
    for (let i = 0; i < punkte.length; i++) {
      const p = punkte[i], x = v[i];
      if (x.geschw === null) det.tick(p.t);
      else det.update({ t: p.t, kursGrad: x.kurs, geschwindigkeit: x.geschw, ost: x.ost, nord: x.nord, hoehe: p.h, lat: p.lat, lon: p.lon });
      pw.tick(p.t, p.h);
    }
    const tEnde = punkte[punkte.length - 1].t;
    det.tick(tEnde + 60); pw.tick(tEnde + 60, null);
    for (const x of ph) if (x.bis === null || x.bis > tEnde) x.bis = tEnde;
    return ph.filter(x => x.bis > x.von);
  }

  // XContest-Variante kompakt speichern: Wendepunkte und Schlusspunkte als Position und Zeit
  function xcKompakt(x, P) {
    if (!x || !(x.km > 0)) return null;
    const pt = (i) => ({ lat: P[i].lat, lon: P[i].lon, t: P[i].t });
    return { typ: x.typ, name: x.name, kurz: x.kurz, faktor: x.faktor, km: x.km, punkte: x.punkte,
             wp: x.indizes.map(pt), schluss: x.schluss ? { a: pt(x.schluss.s), b: pt(x.schluss.f), km: Math.round(x.schluss.distM / 10) / 100 } : null };
  }

  /* ---------- Auswertung eines Flugs ----------
     punkte: [{t, lat, lon, h}] (bereinigt, z. B. aus punkteAusApp / punkteAusIgc). Ergebnis siehe Kopf der Datei.
     opts: {hoeheQuelle, startT (s): Start schon bekannt, z. B. im Flug mit Geländedaten erkannt – dann gilt er statt der
            Erkennung ohne Geländedaten, die z. B. beim Soaren auf Starthöhe erst spät oder gar nicht anspricht}. */
  function analysiere(punkte, opts) {
    opts = opts || {};
    if (!punkte || punkte.length < 10) throw new Error("zu wenige Positionen für eine Auswertung");
    const vAlle = Igc.geschwVektoren(punkte);
    const ab = flugAbschnitt(punkte, vAlle, opts.startT);
    const P = punkte.slice(ab.i0, ab.i1 + 1), V = vAlle.slice(ab.i0, ab.i1 + 1), n = P.length;
    const hg = glaetten(P, GLAETTUNG_S);
    const strecke = new Float64Array(n);
    for (let i = 1; i < n; i++) strecke[i] = strecke[i - 1] + distanz(P[i - 1], P[i]);

    let hMax = -Infinity, iMax = 0;
    for (let i = 0; i < n; i++) if (P[i].h > hMax) { hMax = P[i].h; iMax = i; }
    const hStart = hg[0];

    // Thermiken
    const phasen = kreisphasen(P, V);
    const thermiken = [];
    for (const ph of phasen) {
      const a = indexAb(P, ph.von), b = Math.max(a, indexAb(P, ph.bis));
      let m = a;
      for (let i = a; i <= b; i++) if (hg[i] > hg[m]) m = i;
      const gewinn = hg[m] - hg[a], dauer = P[m].t - P[a].t;
      ph.a = a; ph.b = b;
      if (gewinn < THERMIK_MIN_M || dauer <= 0) continue;
      let sLat = 0, sLon = 0;
      for (let i = a; i <= b; i++) { sLat += P[i].lat; sLon += P[i].lon; }
      thermiken.push({ von: P[a].t, bis: P[m].t, gewinnM: Math.round(gewinn), steigen: Math.round(gewinn / dauer * 100) / 100,
                       hOben: Math.round(hg[m]), lat: sLat / (b - a + 1), lon: sLon / (b - a + 1) });
    }
    const thGewinn = thermiken.reduce((s, x) => s + x.gewinnM, 0), thZeit = thermiken.reduce((s, x) => s + x.bis - x.von, 0);

    // Gleiten: Abschnitte zwischen den Kreisphasen
    let glDist = 0, glVerlust = 0, glZeit = 0, glAnzahl = 0;
    const grenzen = [];
    let vor = 0;
    for (const ph of phasen) { if (ph.a > vor) grenzen.push([vor, ph.a]); vor = Math.max(vor, ph.b); }
    if (vor < n - 1) grenzen.push([vor, n - 1]);
    for (const [a, b] of grenzen) {
      const dauer = P[b].t - P[a].t, verlust = hg[a] - hg[b];
      if (dauer < GLEIT_MIN_S || verlust < GLEIT_MIN_VERLUST_M) continue;
      glDist += strecke[b] - strecke[a]; glVerlust += verlust; glZeit += dauer; glAnzahl++;
    }

    // XContest: wie dort der Track ab dem ersten Punkt (Boden am Startplatz zählt mit), aber nur bis zur erkannten Landung
    // (eine Fahrt nach der Landung zählt nicht)
    const PX = punkte.slice(0, ab.i1 + 1);
    const xc = XContest.bewerte(PX);
    const varianten = {};
    for (const k of Object.keys(xc.varianten)) varianten[k] = xcKompakt(xc.varianten[k], PX);

    const rund = (v) => Math.round(v);
    return {
      version: ANALYSE_VERSION,
      startT: P[0].t, landeT: P[n - 1].t, dauerS: P[n - 1].t - P[0].t,
      startErkannt: ab.startErkannt, landungErkannt: ab.landungErkannt,
      start: { lat: P[0].lat, lon: P[0].lon, h: rund(hStart) },
      landung: { lat: P[n - 1].lat, lon: P[n - 1].lon, h: rund(hg[n - 1]) },
      hMax: rund(hMax), hMaxT: P[iMax].t,
      gewinnUeberStart: Math.max(0, rund(hMax - hStart)),
      gewinnKumuliert: rund(kumuliert(hg, HYSTERESE_M)),
      hoeheQuelle: opts.hoeheQuelle || "gps",
      streckeM: rund(strecke[n - 1]),
      thermiken: { anzahl: thermiken.length, gewinnM: thGewinn, zeitS: thZeit,
                   steigenMittel: thZeit > 0 ? Math.round(thGewinn / thZeit * 100) / 100 : null, liste: thermiken },
      gleiten: { gz: glVerlust > 0 ? Math.round(glDist / glVerlust * 10) / 10 : null, distM: rund(glDist), verlustM: rund(glVerlust),
                 zeitS: glZeit, abschnitte: glAnzahl },
      xc: { bestes: xcKompakt(xc.bestes, PX), varianten, rechenzeitMs: xc.rechenzeitMs },
      punkteAnzahl: n,
    };
  }

  /* ---------- Namen, Saison, Duplikate ---------- */
  function uhrzeit(sek) { const d = new Date(sek * 1000); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  // Name eines neuen Flugs: Wegpunkt in der Nähe des Starts, sonst "Flug 14:32"
  function standardName(werte, wegpunkte) {
    let best = null, bd = NAME_RADIUS_M;
    for (const w of wegpunkte || []) {
      if (!w || !zahl(w.lat) || !zahl(w.lon)) continue;
      const d = distanz(werte.start, w);
      if (d <= bd) { bd = d; best = w; }
    }
    return best ? String(best.name).slice(0, 60) : "Flug " + uhrzeit(werte.startT);
  }
  const saisonVon = (sek) => new Date(sek * 1000).getFullYear();
  // Gleicher Flug? Start höchstens 2 min und 300 m auseinander
  function istDuplikat(a, b) {
    return !!a && !!b && Math.abs(a.startT - b.startT) <= DUPLIKAT_S && distanz(a.start, b.start) <= DUPLIKAT_M;
  }

  /* ---------- Statistik ----------
     fluege: [{id, name, werte}] → {gesamt, saisons: [{jahr, …}] (neueste zuerst)} */
  function summe(fluege) {
    const s = { anzahl: 0, dauerS: 0, xcKm: 0, xcPunkte: 0, streckeM: 0, thermiken: 0, thGewinnM: 0, thZeitS: 0,
                glDistM: 0, glVerlustM: 0, gewinnKumuliertM: 0,
                hMax: null, xcBest: null, dauerMax: null, gewinnMax: null, steigenBest: null };
    const rekord = (feld, wert, f) => { if (zahl(wert) && (!s[feld] || wert > s[feld].wert)) s[feld] = { wert, id: f.id, name: f.name, startT: f.werte.startT }; };
    for (const f of fluege) {
      const w = f.werte;
      if (!w) continue;
      s.anzahl++; s.dauerS += w.dauerS; s.streckeM += w.streckeM || 0; s.gewinnKumuliertM += w.gewinnKumuliert || 0;
      if (w.xc && w.xc.bestes) { s.xcKm += w.xc.bestes.km; s.xcPunkte += w.xc.bestes.punkte; rekord("xcBest", w.xc.bestes.punkte, f); }
      s.thermiken += w.thermiken.anzahl; s.thGewinnM += w.thermiken.gewinnM; s.thZeitS += w.thermiken.zeitS;
      s.glDistM += w.gleiten.distM; s.glVerlustM += w.gleiten.verlustM;
      rekord("hMax", w.hMax, f); rekord("dauerMax", w.dauerS, f); rekord("gewinnMax", w.gewinnUeberStart, f);
      for (const t of w.thermiken.liste) rekord("steigenBest", t.steigen, f);
    }
    s.xcKm = Math.round(s.xcKm * 100) / 100; s.xcPunkte = Math.round(s.xcPunkte * 100) / 100;
    s.steigenMittel = s.thZeitS > 0 ? Math.round(s.thGewinnM / s.thZeitS * 100) / 100 : null;
    s.gzMittel = s.glVerlustM > 0 ? Math.round(s.glDistM / s.glVerlustM * 10) / 10 : null;
    s.dauerMittelS = s.anzahl ? Math.round(s.dauerS / s.anzahl) : null;
    return s;
  }
  function statistik(fluege) {
    const mit = (fluege || []).filter(f => f && f.werte);
    const jahre = new Map();
    for (const f of mit) { const j = saisonVon(f.werte.startT); if (!jahre.has(j)) jahre.set(j, []); jahre.get(j).push(f); }
    const saisons = [...jahre.keys()].sort((a, b) => b - a).map(j => Object.assign({ jahr: j }, summe(jahre.get(j))));
    return { gesamt: summe(mit), saisons };
  }

  /* ---------- Sicherung ----------
     ZIP-Datei (zip.js) mit
       logbuch.json      {format, version, erstellt (ISO), app, analyseVersion, fluege: [{flug, igc, daten}]}
                         flug = Eintrag wie gespeichert (Name, Werte, Quelle, bekannter Start …), igc/daten = Pfade in der ZIP-Datei
       IGC/…igc          jeder Flug als IGC-Datei. Importierte Flüge: die Originaldatei (daraus wird wiederhergestellt).
                         Aufgezeichnete: aus den GPS-Fixes erzeugt, nur zum Weitergeben (z. B. an XContest).
       daten/<sid>.json  aufgezeichnete Flüge: {session, fixes} wie gespeichert, ohne die NMEA-Rohzeilen.
                         Daraus wird die Aufzeichnung wiederhergestellt, damit die Werte genau gleich bleiben. */
  const SICHERUNG_FORMAT = "flugapp-logbuch", SICHERUNG_VERSION = 1;
  // Dateiname ohne Endung für die IGC-Kopie: "2026-07-14 1032 Amisbühl", eindeutig innerhalb von vergeben (Set)
  function sicherungsName(flug, vergeben) {
    const d = new Date(flug.werte.startT * 1000), p = (n) => String(n).padStart(2, "0");
    const name = String(flug.name || "").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);
    const basis = (d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + p(d.getMinutes()) + " " + name).replace(/[. ]+$/, "");
    let n = basis;
    for (let k = 2; vergeben.has(n.toLowerCase()); k++) n = basis + " (" + k + ")";
    vergeben.add(n.toLowerCase());
    return n;
  }
  function sicherungVerzeichnis(eintraege, app, jetztMs) {
    return { format: SICHERUNG_FORMAT, version: SICHERUNG_VERSION, erstellt: new Date(jetztMs).toISOString(), app: String(app || ""),
             analyseVersion: ANALYSE_VERSION, fluege: eintraege.map(e => ({ flug: e.flug, igc: e.igc, daten: e.daten || null })) };
  }
  const idOk = (v) => typeof v === "string" ? v.length > 0 && v.length <= 64 : zahl(v);
  const werteOk = (w) => !!w && zahl(w.startT) && zahl(w.dauerS) && !!w.start && zahl(w.start.lat) && zahl(w.start.lon)
    && !!w.thermiken && Array.isArray(w.thermiken.liste) && !!w.gleiten;
  // logbuch.json prüfen → {erstellt, app, eintraege: [{flug, igc, daten}], fehler: [Name]}; wirft bei fremder oder neuerer Datei
  function sicherungLesen(text) {
    let m;
    try { m = JSON.parse(text); } catch (e) { throw new Error("logbuch.json ist nicht lesbar"); }
    if (!m || m.format !== SICHERUNG_FORMAT || !Array.isArray(m.fluege)) throw new Error("keine Logbuch-Sicherung dieser App");
    if (!(m.version >= 1 && m.version <= SICHERUNG_VERSION)) throw new Error("Sicherung von einer neueren App-Version – zuerst die App aktualisieren");
    const eintraege = [], fehler = [];
    for (const [k, e] of m.fluege.entries()) {
      const f = e && e.flug;
      const ok = !!f && idOk(f.id) && typeof f.name === "string" && werteOk(f.werte)
        && (f.quelle === "igc" ? typeof e.igc === "string" : f.quelle === "aufzeichnung" && typeof e.daten === "string" && idOk(f.sid));
      if (ok) eintraege.push({ flug: Object.assign({}, f, { name: f.name.slice(0, 60) || "Flug" }), igc: e.igc || null, daten: e.daten || null });
      else fehler.push(f && typeof f.name === "string" && f.name ? f.name.slice(0, 60) : "Eintrag " + (k + 1));
    }
    return { erstellt: typeof m.erstellt === "string" ? m.erstellt : null, app: typeof m.app === "string" ? m.app : "", eintraege, fehler };
  }
  // daten/<sid>.json prüfen → {session, fixes}
  function aufzeichnungLesen(text, sid) {
    let d;
    try { d = JSON.parse(text); } catch (e) { throw new Error("Aufzeichnung nicht lesbar"); }
    if (!d || !d.session || d.session.id !== sid || !Array.isArray(d.fixes)) throw new Error("Aufzeichnung passt nicht zum Flug");
    return d;
  }

  return { ANALYSE_VERSION, THERMIK_MIN_M, punkteAusApp, punkteAusIgc, analysiere, standardName, saisonVon, istDuplikat,
           statistik, glaetten, kumuliert, distanz, indexAb,
           SICHERUNG_FORMAT, sicherungsName, sicherungVerzeichnis, sicherungLesen, aufzeichnungLesen };
});
