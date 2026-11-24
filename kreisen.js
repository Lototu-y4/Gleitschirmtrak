/* Kreiserkennung aus dem Kurs über Grund (Eigenbau, kein zugelassenes Instrument).
   Ohne Abhängigkeiten und ohne Bezug zur Oberfläche; läuft im Browser (globales Objekt "Kreisen")
   und in Node (require("./kreisen.js")).

   Zwei Stufen:
   1. "Kreisen beginnt" (schnell): geglättete Drehrate des Kurses über Grund mindestens drehrateMin
      in gleicher Richtung, seit mindestens beginnDauerS Sekunden UND mit mindestens beginnWinkel Grad
      aufsummierter Kursänderung. Der Winkel trennt Thermikkreise von Wenden im Hangflug (siehe README).
      Ende des Kreisens erst, wenn die Drehrate endeHaltezeitS Sekunden lang nicht mehr in Kreisrichtung
      über der Schwelle lag (Hysterese), oder sofort bei anhaltender Gegendrehung (Achter).
   2. "Gültiger Kreis für den Wind": jede volle 360°-Drehung löst 'vollkreis' aus (Fenster = genau diese
      360°). Beim Ende wird der Rest seit dem letzten Vollkreis mitgeliefert und ist für den Wind gültig,
      wenn er mindestens windMinWinkel Grad umfasst und nicht durch einen Richtungswechsel endete.

   Zeiten in Sekunden, Kurs in Grad (0 = Nord, im Uhrzeigersinn), Geschwindigkeit über Grund in m/s.
   Rechtskreis = Kurs nimmt zu (Uhrzeigersinn von oben gesehen). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Kreisen = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STANDARD = Object.freeze({
    drehrateMin: 8,         // °/s, Schwelle der geglätteten Drehrate
    glaettungS: 2,          // s, über diese Zeit wird die Drehrate gemittelt
    beginnDauerS: 4,        // s, so lange muss die Drehung mindestens anhalten
    beginnWinkel: 250,      // °, so viel Kursänderung bis "Kreisen beginnt" (trennt Hangflug-Wenden ab)
    beginnToleranzS: 2,     // s, so lange darf die Drehrate vor dem Beginn kurz unter die Schwelle fallen
    endeHaltezeitS: 8,      // s unter der Schwelle bis "Kreisen endet" (Hysterese)
    windMinWinkel: 270,     // °, Mindestwinkel eines Kreisrests für die Windschätzung (180–360)
    minGeschwKmh: 5,        // km/h, darunter ist der Kurs unbrauchbar (Messpunkt zählt nicht für die Drehrate)
    maxLueckeS: 3,          // s, grössere Abstände zwischen Messpunkten gelten als Datenlücke
  });
  const GRENZEN = {
    drehrateMin: [2, 40], glaettungS: [0.5, 10], beginnDauerS: [1, 30], beginnWinkel: [30, 360],
    beginnToleranzS: [0, 10], endeHaltezeitS: [1, 60], windMinWinkel: [180, 360], minGeschwKmh: [0, 30], maxLueckeS: [0.5, 10],
  };
  const MAX_PUNKTE = 7200;        // höchstens so viele Messpunkte pro Kreisphase (1 h bei 2 Hz)
  const KURS_VERLAUF_S = 120;     // so lange wird der Kurs für "Kurs vor dem Kreisen" gemerkt

  function normalisiere(e) {
    const out = {};
    e = e && typeof e === "object" ? e : {};
    for (const k of Object.keys(STANDARD)) {
      const v = Number(e[k]);
      const [lo, hi] = GRENZEN[k];
      out[k] = Number.isFinite(v) && e[k] !== null && e[k] !== "" ? Math.min(hi, Math.max(lo, v)) : STANDARD[k];
    }
    return out;
  }

  // Kursdifferenz b − a auf (−180, 180]
  function kursDiff(a, b) {
    let d = ((b - a) % 360 + 360) % 360;
    if (d > 180) d -= 360;
    return d;
  }
  function ersteHoehe(punkte) { for (const p of punkte) if (Number.isFinite(p.hoehe)) return p.hoehe; return null; }
  const richtungsName = (sg) => sg > 0 ? "rechts" : sg < 0 ? "links" : null;

  function createKreisDetektor(einstellungen) {
    let e = normalisiere(einstellungen);
    const hoerer = { kreisBeginn: [], kreisEnde: [], vollkreis: [], phasenwechsel: [], fehler: [] };

    let tZuletzt = null;          // Zeit des letzten update/tick
    let letzterKurs = null;       // {t, kurs} letzter brauchbarer Kurs
    let tLetzterKurs = null;
    let rateFenster = [];         // {t, d, dt}
    let drehrate = null;          // °/s, geglättet, + = rechts
    let kursVerlauf = [];         // {t, kurs}
    let juengste = [];            // {p: Messpunkt, d: Kursänderung oder null} der letzten Sekunden
    let lueckeAb = null;          // letzter brauchbarer Kurs vor der jüngsten Datenlücke
    let kand = null;              // möglicher Kreisbeginn
    let kreis = null;             // laufende Kreisphase
    let letzterKreis = null;      // Zusammenfassung der letzten beendeten Kreisphase
    const zaehler = { kreisphasen: 0, vollkreise: 0, richtungswechsel: 0, datenluecken: 0, punkte: 0 };

    function emit(name, daten) {
      for (const cb of hoerer[name].slice()) {
        try { cb(daten); }
        catch (err) {
          if (name !== "fehler" && hoerer.fehler.length) emit("fehler", { ereignis: name, fehler: err });
          else if (typeof console !== "undefined") console.error("Kreisen: Fehler im Ereignis " + name, err);
        }
      }
    }

    // Neuer Kandidat: die Drehung, die schon im Glättungsfenster steckt, zählt mit (sonst käme der Beginn um die Glättung zu spät)
    function neuerKandidat(sg, t) {
      const start = rateFenster.length ? rateFenster[0].t - rateFenster[0].dt : t;
      const punkte = [];
      let w = 0;
      for (const j of juengste) {
        if (j.p.t < start - 1e-9) continue;
        if (punkte.length && j.d !== null) w += j.d * sg;
        punkte.push(Object.assign({}, j.p, { w }));
      }
      return { sg, start, seit: t, letztOben: t, winkel: Math.max(0, w), punkte };
    }
    // Kandidat (Beginn oder Gegendrehung) fortschreiben; Ergebnis: lebt er noch?
    function fortschreiben(k, t, d, oben, sg) {
      if (d !== null) k.winkel += d * k.sg;
      if (oben && sg === k.sg) k.letztOben = t;
      return t - k.letztOben <= e.beginnToleranzS;
    }
    function erfuellt(k, t) { return t - k.start >= e.beginnDauerS && k.winkel >= e.beginnWinkel; }

    function kursUm(t) {   // letzter bekannter Kurs zum Zeitpunkt t oder davor
      for (let i = kursVerlauf.length - 1; i >= 0; i--) if (kursVerlauf[i].t <= t) return kursVerlauf[i].kurs;
      return kursVerlauf.length ? kursVerlauf[0].kurs : null;
    }

    function beginneKreis(t) {
      const k = kand; kand = null;
      kreis = { sg: k.sg, beginn: k.start, erkannt: t, letztOben: k.letztOben, winkel: k.winkel, anzahl: 0,
                punkte: k.punkte, gegen: null, kursVorBeginn: kursUm(k.start - e.glaettungS), ausWechsel: !!k.ausWechsel,
                hoeheBeginn: ersteHoehe(k.punkte) };
      // Winkelstand der Punkte des Kandidaten (w) bleibt gültig, weil der Kreis mit dem Kandidaten beginnt
      zaehler.kreisphasen++;
      const info = { t, beginn: kreis.beginn, richtung: richtungsName(kreis.sg), winkel: kreis.winkel,
                     ausWechsel: kreis.ausWechsel, hoeheBeginn: kreis.hoeheBeginn,
                     verzoegerung: t - kreis.beginn, kursVorBeginn: kreis.kursVorBeginn };
      emit("kreisBeginn", info);
      emit("phasenwechsel", { t, phase: "kreisen", vorher: "gleiten", richtung: info.richtung });
      pruefeVollkreis(t);
    }

    function pruefeVollkreis(t) {
      while (kreis && kreis.winkel >= (kreis.anzahl + 1) * 360) {
        kreis.anzahl++; zaehler.vollkreise++;
        const von = (kreis.anzahl - 1) * 360, bis = kreis.anzahl * 360;
        const p = kreis.punkte;
        let i0 = p.findIndex(x => x.w >= von); if (i0 > 0) i0--;
        let i1 = p.findIndex(x => x.w >= bis); if (i1 < 0) i1 = p.length - 1;
        const punkte = p.slice(Math.max(0, i0), i1 + 1);
        if (kreis.hoeheBeginn === null) kreis.hoeheBeginn = ersteHoehe(kreis.punkte);
        emit("vollkreis", { t, nummer: kreis.anzahl, richtung: richtungsName(kreis.sg), beginn: kreis.beginn,
          ausWechsel: kreis.ausWechsel, hoeheBeginn: kreis.hoeheBeginn,
          fenster: { punkte, winkel: 360, gueltigFuerWind: true, von: punkte.length ? punkte[0].t : t, bis: punkte.length ? punkte[punkte.length - 1].t : t } });
      }
    }

    function beendeKreis(t, ende, grund) {
      const k = kreis; kreis = null;
      const punkte = k.punkte.filter(p => p.t <= ende + 1e-9);
      const winkel = punkte.length ? punkte[punkte.length - 1].w : 0;
      const grenze = k.anzahl * 360;
      let i0 = punkte.findIndex(p => p.w >= grenze); if (i0 > 0) i0--;
      const rest = i0 < 0 ? [] : punkte.slice(i0);
      const restWinkel = Math.max(0, winkel - grenze);
      // Achter: Teile, die mit einem Richtungswechsel enden oder beginnen, zählen nicht (volle 360° schon vorher als 'vollkreis')
      const achter = grund === "richtungswechsel" || k.ausWechsel;
      const gueltig = !achter && restWinkel >= e.windMinWinkel;
      if (grund === "richtungswechsel") zaehler.richtungswechsel++;
      if (grund === "datenluecke") zaehler.datenluecken++;
      let hoeheEnde = null;
      for (let i = punkte.length - 1; i >= 0 && hoeheEnde === null; i--) if (Number.isFinite(punkte[i].hoehe)) hoeheEnde = punkte[i].hoehe;
      const info = { t, beginn: k.beginn, ende, dauer: ende - k.beginn, richtung: richtungsName(k.sg), winkel,
        ausWechsel: k.ausWechsel, hoeheBeginn: k.hoeheBeginn, hoeheEnde,
        anzahlKreise: k.anzahl, grund, punkte, kursVorBeginn: k.kursVorBeginn,
        fenster: { punkte: rest, winkel: restWinkel, gueltigFuerWind: gueltig, von: rest.length ? rest[0].t : ende, bis: ende,
                   grund: gueltig ? null : achter ? "Richtungswechsel (Achter)" : "Rest kleiner als " + e.windMinWinkel + "°" } };
      letzterKreis = { beginn: k.beginn, ende, dauer: info.dauer, richtung: info.richtung, winkel, anzahlKreise: k.anzahl, grund, ausWechsel: k.ausWechsel };
      emit("kreisEnde", info);
      emit("phasenwechsel", { t, phase: "gleiten", vorher: "kreisen", richtung: null, grund });
    }

    // Ein Schritt der Zustandsmaschine. d = Kursänderung seit dem letzten Punkt (oder null), rate = geglättet (oder null)
    function schritt(t, d, rate, punkt) {
      const oben = rate !== null && Math.abs(rate) >= e.drehrateMin;
      const sg = rate === null || rate === 0 ? 0 : Math.sign(rate);

      if (kreis) {
        if (punkt) {
          if (d !== null) kreis.winkel += d * kreis.sg;
          kreis.punkte.push(Object.assign({}, punkt, { w: kreis.winkel }));
          if (kreis.punkte.length > MAX_PUNKTE) kreis.punkte.shift();
        }
        if (oben && sg === kreis.sg) { kreis.letztOben = t; kreis.gegen = null; }
        else if (oben && sg === -kreis.sg) {
          if (!kreis.gegen) kreis.gegen = neuerKandidat(sg, t);
          else { fortschreiben(kreis.gegen, t, d, oben, sg); if (punkt) kreis.gegen.punkte.push(Object.assign({}, punkt, { w: kreis.gegen.winkel })); }
        } else if (kreis.gegen) {
          const lebt = fortschreiben(kreis.gegen, t, d, oben, sg);
          if (punkt) kreis.gegen.punkte.push(Object.assign({}, punkt, { w: kreis.gegen.winkel }));
          if (!lebt) kreis.gegen = null;
        }
        if (kreis.gegen && t - kreis.gegen.seit >= e.beginnDauerS) {   // Gegendrehung hält beginnDauerS über der Schwelle an
          // Achter: Kreis endet dort, wo die Gegendrehung begann; die Gegendrehung wird zum neuen Kandidaten
          const g = kreis.gegen;
          beendeKreis(t, g.start, "richtungswechsel");
          kand = g; kand.ausWechsel = true;
          if (erfuellt(kand, t)) beginneKreis(t);
          return;
        }
        pruefeVollkreis(t);
        if (t - kreis.letztOben > e.endeHaltezeitS) {
          const luecke = tLetzterKurs === null || t - tLetzterKurs > e.maxLueckeS || (lueckeAb !== null && lueckeAb >= kreis.letztOben - 1e-9);
          beendeKreis(t, kreis.letztOben, luecke ? "datenluecke" : "geradeaus");
        }
        return;
      }

      // Phase "gleiten"
      if (kand && oben && sg !== kand.sg) kand = null;
      if (kand) {
        const lebt = fortschreiben(kand, t, d, oben, sg);
        if (punkt) kand.punkte.push(Object.assign({}, punkt, { w: kand.winkel }));
        if (!lebt) kand = null;
      }
      if (!kand && oben && punkt) kand = neuerKandidat(sg, t);
      if (kand && erfuellt(kand, t)) beginneKreis(t);
    }

    function update(m) {
      if (!m || !Number.isFinite(m.t)) return getZustand();
      const t = m.t;
      if (tZuletzt !== null && t <= tZuletzt) return getZustand();   // doppelt oder rückwärts: ignorieren
      tZuletzt = t;
      zaehler.punkte++;
      const g = Number.isFinite(m.geschwindigkeit) ? m.geschwindigkeit : null;
      const kurs = Number.isFinite(m.kursGrad) ? ((m.kursGrad % 360) + 360) % 360 : null;
      const kursOk = kurs !== null && g !== null && g * 3.6 >= e.minGeschwKmh;
      let ost = Number.isFinite(m.ost) ? m.ost : null, nord = Number.isFinite(m.nord) ? m.nord : null;
      if ((ost === null || nord === null) && kurs !== null && g !== null) {
        ost = g * Math.sin(kurs * Math.PI / 180); nord = g * Math.cos(kurs * Math.PI / 180);
      }
      const punkt = { t, kurs, geschw: g, ost, nord, hoehe: Number.isFinite(m.hoehe) ? m.hoehe : null,
                      lat: Number.isFinite(m.lat) ? m.lat : null, lon: Number.isFinite(m.lon) ? m.lon : null };

      let d = null;
      if (kursOk) {
        if (letzterKurs && t - letzterKurs.t <= e.maxLueckeS) {
          d = kursDiff(letzterKurs.kurs, kurs);
          rateFenster.push({ t, d, dt: t - letzterKurs.t });
        } else {
          if (tLetzterKurs !== null) lueckeAb = tLetzterKurs;
          rateFenster = [];
        }
        letzterKurs = { t, kurs }; tLetzterKurs = t;
        kursVerlauf.push({ t, kurs });
        while (kursVerlauf.length && t - kursVerlauf[0].t > KURS_VERLAUF_S) kursVerlauf.shift();
      } else {
        letzterKurs = null; rateFenster = [];   // kein Kursvergleich über unbrauchbare Punkte hinweg
      }
      while (rateFenster.length && t - rateFenster[0].t >= e.glaettungS) rateFenster.shift();
      juengste.push({ p: punkt, d });
      while (juengste.length && t - juengste[0].p.t > e.glaettungS + e.maxLueckeS + 1) juengste.shift();
      let sd = 0, sdt = 0;
      for (const r of rateFenster) { sd += r.d; sdt += r.dt; }
      drehrate = sdt >= Math.min(e.glaettungS * 0.5, 1) - 1e-9 && sdt > 0 ? sd / sdt : null;
      schritt(t, d, kursOk ? drehrate : null, punkt);
      return getZustand();
    }

    // Zeit ohne neue Daten voranschreiben lassen (z. B. jede Sekunde), damit ein Kreis auch bei Datenlücke endet
    function tick(t) {
      if (!Number.isFinite(t) || (tZuletzt !== null && t <= tZuletzt)) return getZustand();
      if (tLetzterKurs !== null && t - tLetzterKurs > e.maxLueckeS) { drehrate = null; rateFenster = []; letzterKurs = null; lueckeAb = tLetzterKurs; }
      if (kreis || kand) schritt(t, null, null, null);
      return getZustand();
    }

    function getZustand() {
      const jetzt = tZuletzt;
      if (kreis) {
        return { phase: "kreisen", drehrichtung: richtungsName(kreis.sg), winkel: kreis.winkel, beginn: kreis.beginn,
                 dauer: jetzt - kreis.beginn, anzahlKreise: kreis.anzahl, drehrate, t: jetzt,
                 erkanntNach: kreis.erkannt - kreis.beginn, kursVorBeginn: kreis.kursVorBeginn, letzterKreis };
      }
      return { phase: "gleiten", drehrichtung: null, winkel: 0, beginn: null, dauer: 0, anzahlKreise: 0, drehrate, t: jetzt,
               kandidat: kand ? { richtung: richtungsName(kand.sg), winkel: kand.winkel, seit: kand.start } : null,
               kursVorBeginn: null, letzterKreis };
    }

    function on(name, cb) {
      if (!hoerer[name]) throw new Error("Unbekanntes Ereignis: " + name);
      if (typeof cb !== "function") throw new Error("Rückruf muss eine Funktion sein");
      hoerer[name].push(cb);
      return () => off(name, cb);
    }
    function off(name, cb) { const l = hoerer[name]; if (!l) return; const i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); }

    function reset() {
      tZuletzt = null; letzterKurs = null; tLetzterKurs = null; rateFenster = []; drehrate = null;
      kursVerlauf = []; juengste = []; lueckeAb = null; kand = null; kreis = null; letzterKreis = null;
    }

    return {
      update, tick, getZustand, on, off, reset,
      setEinstellungen(neu) { e = normalisiere(Object.assign({}, e, neu)); return Object.assign({}, e); },
      getEinstellungen() { return Object.assign({}, e); },
      statistik() { return Object.assign({}, zaehler); },
    };
  }

  /* ===================================================================
     Phasenwahl: entscheidet aus den Ereignissen der Kreiserkennung, ob die Anzeige "thermik" oder "gleiten" zeigen soll
     (Grundlage für den automatischen Seitenwechsel) und führt Buch über die aktuelle Thermik (Beginn, Anfangshöhe).

     Regeln:
     - Gleiten → Thermik: bei "Kreisen beginnt" (früh), ausser die Drehung entstand aus einem Richtungswechsel
       oder es gab in den letzten achterSperreS Sekunden ein Achter-Muster; dann erst beim ersten vollen Kreis (360°).
       Mit eintritt = "vollkreis" immer erst beim ersten vollen Kreis.
     - Thermik → Gleiten: sobald das Kreisen endet (die Kreiserkennung hat dann schon endeHaltezeitS gewartet).
       Endet es mit einem Richtungswechsel (Wechsel der Drehrichtung im Bart), bleibt die Thermik bis zu wechselHaltS
       Sekunden erhalten, bis in der neuen Richtung ein voller Kreis gelingt. Kommt stattdessen ein weiterer
       Richtungswechsel oder läuft die Zeit ab, war es ein Achter (Soaring) → Gleiten und Achter-Sperre.
     - Geradeaus steigen (Hangaufwind) oder Achter ohne volle Kreise bleiben "gleiten".
     Zeiten in Sekunden wie beim Detektor; tick(t, hoehe) regelmässig aufrufen (z. B. nach jedem update). */
  const STANDARD_SEITE = Object.freeze({
    autoWechsel: true,        // Seite automatisch wechseln (nur für die App; die Phasenwahl selbst läuft immer)
    eintritt: "beginn",       // "beginn" = bei "Kreisen beginnt", "vollkreis" = erst nach dem ersten vollen Kreis
    wechselHaltS: 30,         // s, Thermik nach einem Richtungswechsel so lange halten
    achterSperreS: 120,       // s, nach einem Achter-Muster nur mit vollem Kreis in die Thermik
  });
  const GRENZEN_SEITE = { wechselHaltS: [0, 120], achterSperreS: [0, 600] };
  function normalisiereSeite(e) {
    e = e && typeof e === "object" ? e : {};
    const out = {
      autoWechsel: e.autoWechsel === undefined || e.autoWechsel === null ? STANDARD_SEITE.autoWechsel : !!e.autoWechsel,
      eintritt: e.eintritt === "vollkreis" || e.eintritt === "beginn" ? e.eintritt : STANDARD_SEITE.eintritt,
    };
    for (const k of Object.keys(GRENZEN_SEITE)) {
      const v = Number(e[k]), [lo, hi] = GRENZEN_SEITE[k];
      out[k] = Number.isFinite(v) && e[k] !== null && e[k] !== "" ? Math.min(hi, Math.max(lo, v)) : STANDARD_SEITE[k];
    }
    return out;
  }

  function createPhasenwahl(detektor, einstellungen) {
    let e = normalisiereSeite(einstellungen);
    const hoerer = { modus: [], fehler: [] };
    let modus = "gleiten";
    let thermik = null;          // {beginn, hoeheBeginn, kreise, eintritt (t), eintrittVerzoegerung}
    let letzteThermik = null;    // wie thermik, dazu ende, hoeheEnde, grund
    let warteSeit = null;        // Thermik nach Richtungswechsel: seit wann auf einen vollen Kreis gewartet wird
    let sperreBis = -Infinity;   // bis dahin nur mit vollem Kreis in die Thermik (nach Achter)
    let letzteHoehe = null, tZuletzt = null;
    let ruhigSeit = null;        // während des Wartens: seit wann weder gekreist noch angedreht wird
    let wechsel = 0;

    function emit(name, d) {
      for (const cb of hoerer[name].slice()) {
        try { cb(d); }
        catch (err) {
          if (name !== "fehler" && hoerer.fehler.length) emit("fehler", { ereignis: name, fehler: err });
          else if (typeof console !== "undefined") console.error("Phasenwahl: Fehler im Ereignis " + name, err);
        }
      }
    }
    function setze(neu, t, grund, info) {
      if (neu === modus) return;
      const vorher = modus;
      modus = neu; wechsel++; warteSeit = null; ruhigSeit = null;
      if (neu === "thermik") {
        thermik = { beginn: info.beginn, hoeheBeginn: Number.isFinite(info.hoeheBeginn) ? info.hoeheBeginn : letzteHoehe,
                    kreise: info.nummer || 0, eintritt: t, eintrittVerzoegerung: t - info.beginn };
      } else if (thermik) {
        const hoeheEnde = info && Number.isFinite(info.hoeheEnde) ? info.hoeheEnde : letzteHoehe;
        letzteThermik = Object.assign({}, thermik, { ende: info && Number.isFinite(info.ende) ? info.ende : t, hoeheEnde, grund });
        thermik = null;
      }
      emit("modus", { t, modus: neu, vorher, grund, thermik: thermik ? Object.assign({}, thermik) : null,
                      letzteThermik: letzteThermik ? Object.assign({}, letzteThermik) : null });
    }

    const ab = [
      detektor.on("kreisBeginn", (b) => {
        if (modus === "gleiten" && e.eintritt === "beginn" && !b.ausWechsel && b.t >= sperreBis) setze("thermik", b.t, "Kreisen beginnt", b);
      }),
      detektor.on("vollkreis", (v) => {
        if (modus === "thermik") { warteSeit = null; thermik.kreise++; }
        else setze("thermik", v.t, "voller Kreis", v);
      }),
      detektor.on("kreisEnde", (x) => {
        if (x.grund === "richtungswechsel") {
          if (modus === "thermik" && warteSeit === null) { warteSeit = x.t; return; }   // Wechsel der Drehrichtung im Bart?
          sperreBis = x.t + e.achterSperreS;                                         // Wechsel ohne vollen Kreis dazwischen: Achter
          if (modus === "thermik") setze("gleiten", x.t, "Achter", x);
          return;
        }
        if (modus === "thermik") setze("gleiten", x.t, x.grund === "datenluecke" ? "Datenlücke" : "Kreisen beendet", x);
      }),
    ];

    function tick(t, hoehe) {
      if (Number.isFinite(hoehe)) letzteHoehe = hoehe;
      if (Number.isFinite(t)) tZuletzt = t;
      if (modus === "thermik" && warteSeit !== null) {
        // nach dem Richtungswechsel geradeaus weiter (keine Drehung mehr): wie ein normales Kreisende behandeln
        const z = detektor.getZustand();
        if (z.phase === "gleiten" && !z.kandidat) { if (ruhigSeit === null) ruhigSeit = t; }
        else ruhigSeit = null;
        if (ruhigSeit !== null && t - ruhigSeit > detektor.getEinstellungen().endeHaltezeitS) setze("gleiten", t, "Kreisen beendet", null);
        else if (t - warteSeit > e.wechselHaltS) {
          sperreBis = t + e.achterSperreS;
          setze("gleiten", t, "nach Richtungswechsel kein voller Kreis", null);
        }
      }
      return getZustand();
    }
    function getZustand() {
      return { modus, thermik: thermik ? Object.assign({}, thermik) : null, letzteThermik: letzteThermik ? Object.assign({}, letzteThermik) : null,
               wartetAufVollkreis: warteSeit !== null, achterSperre: tZuletzt !== null && tZuletzt < sperreBis, wechsel };
    }
    function on(name, cb) {
      if (!hoerer[name]) throw new Error("Unbekanntes Ereignis: " + name);
      if (typeof cb !== "function") throw new Error("Rückruf muss eine Funktion sein");
      hoerer[name].push(cb);
      return () => { const i = hoerer[name].indexOf(cb); if (i >= 0) hoerer[name].splice(i, 1); };
    }
    return {
      tick, getZustand, on,
      setEinstellungen(neu) { e = normalisiereSeite(Object.assign({}, e, neu)); return Object.assign({}, e); },
      getEinstellungen() { return Object.assign({}, e); },
      abmelden() { for (const f of ab) f(); },
    };
  }

  return { createKreisDetektor, STANDARD, GRENZEN, normalisiere, kursDiff,
           createPhasenwahl, STANDARD_SEITE, GRENZEN_SEITE, normalisiereSeite };

});
