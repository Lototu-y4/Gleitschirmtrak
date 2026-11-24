/* Start- und Landeerkennung (Eigenbau, kein zugelassenes Instrument).
   Ohne Abhängigkeiten und ohne Bezug zur Oberfläche; läuft im Browser (globales Objekt "StartLandung")
   und in Node (require("./startlandung.js")).

   Eingang: Geschwindigkeit über Grund, GPS-Höhe und Höhe über Grund (AGL, null = unbekannt).
   Zeiten in Sekunden (Wanduhr, z. B. Date.now() / 1000), Geschwindigkeit in m/s, Höhen in m.

   Start ("in der Luft"):
     - Geschwindigkeit mindestens startGeschwKmh, seit mindestens startDauerS (kurze Einbrüche bis TOLERANZ_S erlaubt),
     - und die Höhenbedingung hält seit mindestens startHaltS:
         AGL bekannt:   AGL mindestens startAglM (eine Autofahrt am Boden startet so nie),
         AGL unbekannt: GPS-Höhe hat sich seit Beginn der Bewegung um mindestens startHoeheM geändert.
     - Der Flug beginnt mit der Bewegung (Startlauf), höchstens VORLAUF_MAX_S vor der Höhenbedingung.
   Am Boden (für Landung und Fehlstart):
     - Geschwindigkeit unter landGeschwKmh, AGL höchstens landAglM (falls bekannt),
       GPS-Höhe schwankt dabei höchstens um landHoehenBandM.
   Fehlstart: automatisch erkannter Start, und innerhalb von fehlstartFensterS danach steht der Schirm wieder beim
     Startplatz: unter landGeschwKmh und höchstens fehlstartAglM über Grund (ohne Geländedaten: GPS-Höhe höchstens
     fehlstartAglM von der Höhe beim Startlauf entfernt), fehlstartRuheS lang → Ereignis "fehlstart", zurück zu "wartet".
     Strenger als die Landung, damit ein Pilot, der bei starkem Wind knapp über dem Hang fast stillsteht, nicht gelöscht wird.
   Landung: nur wenn landungAuto und der Flug einmal "in der Luft" war (ein von Hand gestarteter Flug endet also
     nicht schon am Startplatz), Bodenphase mindestens landDauerS → Ereignis "landung", Zustand "aus".

   Zustände: "aus" (nichts erkennen) → warten() → "wartet" → Start → "fliegt" → Landung → "aus".
   flugBegonnen() setzt "fliegt" für einen von Hand gestarteten oder fortgesetzten Flug. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StartLandung = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STANDARD = Object.freeze({
    landungAuto: true,        // Landung automatisch erkennen (Flug beenden und speichern)
    startGeschwKmh: 15,       // km/h über Grund, ab hier "in Bewegung"
    startDauerS: 8,           // s, so lange muss die Bewegung mindestens anhalten
    startAglM: 25,            // m über Grund
    startHaltS: 4,            // s, so lange muss die Höhenbedingung mindestens gelten
    startHoeheM: 20,          // m Höhenänderung seit Beginn der Bewegung (nur ohne Geländedaten)
    fehlstartFensterS: 60,    // s nach dem erkannten Start: Stillstand darin = Fehlstart
    fehlstartRuheS: 10,       // s Stillstand für einen Fehlstart
    fehlstartAglM: 15,        // m: Fehlstart nur so nah am Boden (ohne Geländedaten: so nah an der Höhe beim Startlauf)
    landGeschwKmh: 5,         // km/h über Grund, darunter "steht"
    landDauerS: 30,           // s am Boden bis zur Landung
    landAglM: 40,             // m über Grund höchstens (falls bekannt)
    landHoehenBandM: 8,       // m, so viel darf die GPS-Höhe am Boden schwanken
  });
  const GRENZEN = {
    startGeschwKmh: [5, 60], startDauerS: [2, 60], startAglM: [5, 300], startHaltS: [0, 60], startHoeheM: [5, 300],
    fehlstartFensterS: [0, 600], fehlstartRuheS: [3, 120], fehlstartAglM: [2, 100], landGeschwKmh: [1, 20], landDauerS: [5, 600], landAglM: [5, 300],
    landHoehenBandM: [2, 50],
  };
  const TOLERANZ_S = 2;       // s, so lange darf eine Bedingung kurz nicht erfüllt sein (GPS-Rauschen)
  const MAX_LUECKE_S = 5;     // s ohne Messpunkt → laufende Phasen verwerfen
  const VORLAUF_MAX_S = 60;   // s, so weit darf der Flugbeginn vor der Höhenbedingung liegen

  function normalisiere(e) {
    const out = {};
    e = e && typeof e === "object" ? e : {};
    for (const k of Object.keys(STANDARD)) {
      if (typeof STANDARD[k] === "boolean") { out[k] = typeof e[k] === "boolean" ? e[k] : STANDARD[k]; continue; }
      const v = Number(e[k]);
      const [lo, hi] = GRENZEN[k];
      out[k] = Number.isFinite(v) && e[k] !== null && e[k] !== "" ? Math.min(hi, Math.max(lo, v)) : STANDARD[k];
    }
    return out;
  }

  // Bedingung mit Toleranz: {seit, letztWahr}; liefert die neue Phase (oder null)
  function phase(p, wahr, t) {
    if (wahr) return p ? (p.letztWahr = t, p) : { seit: t, letztWahr: t };
    return p && t - p.letztWahr <= TOLERANZ_S ? p : null;
  }
  const dauer = (p, t) => p && p.letztWahr === t ? t - p.seit : 0;   // nur, solange die Bedingung gerade gilt
  const zahl = (x) => typeof x === "number" && Number.isFinite(x);

  function createStartLandeDetektor(einstellungen) {
    let e = normalisiere(einstellungen);
    const hoerer = { start: [], fehlstart: [], landung: [], fehler: [] };
    let zustand = "aus";
    let auto = false;            // Flug wurde automatisch gestartet (nur dann gibt es Fehlstarts)
    let inDerLuft = false;       // Startbedingung in diesem Flug schon einmal erfüllt
    let flugBeginn = null, erkanntBei = null;
    let bew = null, hoch = null, ruhe = null, fruhe = null;
    let hRef = null;             // GPS-Höhe zu Beginn der Bewegung
    let hStart = null;           // GPS-Höhe beim Startlauf des automatisch erkannten Starts (für den Fehlstart)
    let tZuletzt = null;
    let letzt = { geschwKmh: null, hoehe: null, agl: null };
    const zaehler = { starts: 0, fehlstarts: 0, landungen: 0 };

    function emit(name, daten) {
      for (const cb of hoerer[name].slice()) {
        try { cb(daten); }
        catch (err) {
          if (name !== "fehler" && hoerer.fehler.length) emit("fehler", { ereignis: name, fehler: err });
          else if (typeof console !== "undefined") console.error("StartLandung: Fehler im Ereignis " + name, err);
        }
      }
    }
    function phasenZuruecksetzen() { bew = null; hoch = null; ruhe = null; fruhe = null; hRef = null; }
    function flugZuruecksetzen(z) { zustand = z; auto = false; inDerLuft = false; flugBeginn = null; erkanntBei = null; hStart = null; phasenZuruecksetzen(); }

    // Startbedingung prüfen; liefert {startT, grund} oder null
    function startPruefen(t, kmh, h, agl) {
      const hatteBew = !!bew;
      bew = phase(bew, kmh !== null && kmh >= e.startGeschwKmh, t);
      if (!bew) hRef = null;
      else if (!hatteBew || hRef === null) hRef = zahl(h) ? h : null;
      let hochWahr = false, grund = null;
      if (zahl(agl)) { hochWahr = agl >= e.startAglM; grund = "Höhe über Grund " + Math.round(agl) + " m"; }
      else if (bew && hRef !== null && zahl(h)) { hochWahr = Math.abs(h - hRef) >= e.startHoeheM; grund = "Höhenänderung " + Math.round(h - hRef) + " m (ohne Geländedaten)"; }
      hoch = phase(hoch, hochWahr, t);
      if (dauer(bew, t) >= e.startDauerS && hoch && hoch.letztWahr === t && t - hoch.seit >= e.startHaltS)
        return { startT: Math.max(bew.seit, hoch.seit - VORLAUF_MAX_S), grund };
      return null;
    }

    function update(p) {
      if (!p || !zahl(p.t)) return getZustand();
      const t = p.t;
      if (tZuletzt !== null && (t - tZuletzt > MAX_LUECKE_S || t < tZuletzt)) phasenZuruecksetzen();   // Lücke oder Uhrsprung
      tZuletzt = t;
      const kmh = zahl(p.geschwindigkeit) ? p.geschwindigkeit * 3.6 : null;
      const h = zahl(p.hoehe) ? p.hoehe : null, agl = zahl(p.agl) ? p.agl : null;
      letzt = { geschwKmh: kmh, hoehe: h, agl };
      if (zustand === "aus") return getZustand();

      if (zustand === "wartet" || !inDerLuft) {
        const s = startPruefen(t, kmh, h, agl);
        if (s) {
          const hLauf = hRef;
          phasenZuruecksetzen(); inDerLuft = true;
          if (zustand === "wartet") {
            zustand = "fliegt"; auto = true; flugBeginn = s.startT; erkanntBei = t; hStart = hLauf; zaehler.starts++;
            emit("start", { t, startT: s.startT, grund: s.grund });
          }
          return getZustand();
        }
      }
      if (zustand !== "fliegt") return getZustand();

      // Bodenphase: steht, niedrig (falls bekannt), Höhe ruhig
      const amBoden = kmh !== null && kmh < e.landGeschwKmh && (agl === null || agl <= e.landAglM);
      ruhe = phase(ruhe, amBoden, t);
      if (ruhe && amBoden && h !== null) {
        if (ruhe.hMin === undefined) { ruhe.hMin = h; ruhe.hMax = h; }
        ruhe.hMin = Math.min(ruhe.hMin, h); ruhe.hMax = Math.max(ruhe.hMax, h);
        if (ruhe.hMax - ruhe.hMin > e.landHoehenBandM) ruhe = { seit: t, letztWahr: t, hMin: h, hMax: h };   // Höhe ändert sich: neu beginnen
      }
      const ruheS = dauer(ruhe, t);
      // Fehlstart: wieder beim Startplatz (nah am Boden bzw. an der Höhe beim Startlauf) und steht
      if (auto && erkanntBei !== null) {
        const amStartplatz = kmh !== null && kmh < e.landGeschwKmh
          && (agl !== null ? agl <= e.fehlstartAglM : hStart !== null && h !== null && Math.abs(h - hStart) <= e.fehlstartAglM);
        fruhe = phase(fruhe, amStartplatz, t);
        if (fruhe && fruhe.seit <= erkanntBei + e.fehlstartFensterS && dauer(fruhe, t) >= e.fehlstartRuheS) {
          const d = { t, startT: flugBeginn, erkanntBei };
          zaehler.fehlstarts++;
          flugZuruecksetzen("wartet");
          emit("fehlstart", d);
          return getZustand();
        }
      }
      if (e.landungAuto && inDerLuft && ruheS >= e.landDauerS) {
        const d = { t, landeT: ruhe.seit, startT: flugBeginn, auto };
        zaehler.landungen++;
        flugZuruecksetzen("aus");
        emit("landung", d);
      }
      return getZustand();
    }

    function getZustand() {
      const t = tZuletzt;
      return { zustand, auto, inDerLuft, flugBeginn, erkanntBei, letzt: Object.assign({}, letzt),
               hoeheAenderung: hRef !== null && zahl(letzt.hoehe) ? letzt.hoehe - hRef : null,
               bewegtS: dauer(bew, t), hochS: dauer(hoch, t), ruheS: dauer(ruhe, t) };
    }
    function on(name, cb) {
      if (!hoerer[name]) throw new Error("Unbekanntes Ereignis: " + name);
      if (typeof cb !== "function") throw new Error("Rückruf muss eine Funktion sein");
      hoerer[name].push(cb);
      return () => { const i = hoerer[name].indexOf(cb); if (i >= 0) hoerer[name].splice(i, 1); };
    }
    return {
      update, getZustand, on,
      // Starterkennung scharf schalten: auf einen Start warten
      warten() { flugZuruecksetzen("wartet"); },
      // Flug von Hand gestartet oder fortgesetzt: kein Fehlstart; Landung erst, wenn er einmal "in der Luft" war
      flugBegonnen(t) { flugZuruecksetzen("fliegt"); flugBeginn = zahl(t) ? t : tZuletzt; },
      stopp() { flugZuruecksetzen("aus"); },
      setEinstellungen(neu) { e = normalisiere(Object.assign({}, e, neu)); return Object.assign({}, e); },
      getEinstellungen() { return Object.assign({}, e); },
      statistik() { return Object.assign({}, zaehler); },
    };
  }

  return { createStartLandeDetektor, STANDARD, GRENZEN, normalisiere, TOLERANZ_S, MAX_LUECKE_S, VORLAUF_MAX_S };
});
