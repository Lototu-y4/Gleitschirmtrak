# Flug-Anzeige XCTracer (Eigenbau)

Ergänzende Flug-Anzeige für das Vario XCTracer Mini V über Web Bluetooth, gedacht für Bluefy auf dem iPhone.
**Eigenbau ohne Zulassung – nur als Ergänzung zu einem Hauptinstrument.**

Online: <https://lototu-y4.github.io/Gleitschirmtrak/>

## Bedienung

- **Start:**
  - Mit dem Vario verbinden und den Verbindungsstatus auf einen Blick sehen.
  - „Flug starten“ öffnet die Fluganzeige und startet sofort die Aufzeichnung.
  - „Starterkennung einschalten“ öffnet die Fluganzeige, die Aufzeichnung beginnt aber erst mit dem erkannten Start (siehe „Start- und Landeerkennung“). Solange die App wartet, stehen hier „Zur Fluganzeige“, „Jetzt starten“ und „Starterkennung ausschalten“.
  - Während des Flugs stehen hier „Zur Fluganzeige“ und „Flug beenden“.
  - Ein unterbrochener Flug (z. B. nach einem Neuladen) wird hier zum Fortsetzen angeboten.
- **Fluganzeige:**
  - Seiten „Gleiten“, „Thermik“, „Karte“, „Luftraum“ und „Info“, durch seitliches Wischen oder über die Reiter unten zu wechseln.
  - Beim Kreisen wechselt die Anzeige automatisch auf „Thermik“ und danach zurück auf die Seite davor, also z. B. „Gleiten“ oder „Karte“ (siehe „Automatischer Seitenwechsel“). Wischen geht jederzeit und gilt bis zum nächsten automatischen Wechsel.
  - Die Seite „Info“ zeigt oben die Flugphase („Gleiten“, „Kreisen links/rechts“ mit Anzahl Kreise) und welche Seite die Automatik gerade wählt.
  - „Menü“ führt zurück zur Startseite, der Flug läuft dabei weiter.
- **Logbuch** (Buch-Symbol unten, siehe „Logbuch“):
  - „Flüge“: alle Flüge nach Saison, mit Summen. Antippen öffnet den Flug mit Karte, Höhenprofil und Zeitmarke, den Kennzahlen und der XContest-Wertung. Dort auch Umbenennen, IGC exportieren und Löschen.
  - „Statistik“: gesamt oder pro Saison, mit Bestwerten.
  - „+ IGC“ importiert IGC-Dateien aus anderen Geräten (auch mehrere in einer ZIP-Datei).
  - „Sicherung“ (unter der Liste): alle Flüge als ZIP-Datei sichern und wieder laden. Oben steht ein Hinweis, solange Flüge nicht gesichert sind.
- **Einstellungen:** Liste der Kategorien wie in iOS. Antippen öffnet die Unterseite, „‹ Zurück“ oder nochmaliges Tippen auf den Reiter führt zurück.
  - Darstellung: automatisch, hell oder dunkel, Wake Lock
  - Flugseiten: Anordnung der Kästen je Seite (Gleiten, Thermik, Karte, Luftraum, Info), Max. Höhe zurücksetzen
  - Karte und Ziel: Wegpunkte, Ausrichtung, Spur
  - Berechnung, Wind und Kreiserkennung, Start und Landung (je mit eigenem „Standard wiederherstellen“)
  - Gelände und Karten offline speichern
  - App: Offline-Cache, Version, neueste Version laden
- **Debug:**
  - Ausführlicher Verbindungsstatus, Datenquellen und Rohdaten
  - Gespeicherte Aufzeichnungen mit Export als .txt und .igc, Hinweis „im Logbuch“, sonst Knopf „Ins Logbuch“
  - Service-Liste und UUIDs

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | die ganze App (HTML, CSS, JavaScript), ohne Frameworks |
| `sw.js` | Service Worker: Offline-Cache, „Netz zuerst, Cache als Rückfall“ |
| `manifest.webmanifest` | Web-App-Manifest |
| `kreisen.js` | Kreiserkennung (Zustandsmaschine, ohne Abhängigkeiten, auch in Node lauffähig) |
| `wind.js` | Windschätzung aus Kreisen, Güte, Gültigkeit, Pfeilwinkel (ohne Abhängigkeiten) |
| `startlandung.js` | Start-, Fehlstart- und Landeerkennung (Zustandsmaschine, ohne Abhängigkeiten) |
| `karte.js` | Karte: Kachelrechnung (Web Mercator), Distanz, Peilung, Gleitzahl, LV95 ↔ WGS84, Zeichnen auf ein Canvas (ohne Abhängigkeiten) |
| `tests/karte.test.js` | Tests der Kartenberechnungen |
| `tests/startlandung.test.js` | Tests der Start- und Landeerkennung mit erfundenen Flügen, Autofahrt, Fehlstart, Datenlücke |
| `tests/core.test.js` | Tests für Parser, Prüfsumme, Berechnungen, IGC-Export und Geländeabfrage |
| `tests/kreisen.test.js`, `tests/phasenwahl.test.js`, `tests/wind.test.js`, `tests/sim.js` | Tests der Kreiserkennung, des Seitenwechsels und der Windschätzung mit simulierten Flügen |
| `igc.js`, `tests/igc.test.js` | IGC-Dateien lesen (B-Records, I-Record-Erweiterungen, Kopf), für App und Node |
| `xcontest.js`, `tests/xcontest.test.js` | Distanz und Punkte nach XContest World (freie Strecke, Dreiecke), Tests gegen Brute Force |
| `flugbuch.js`, `tests/flugbuch.test.js` | Logbuch: Flug auswerten (Start/Landung, Höhen, Thermiken, Gleitzahl, XContest), Statistik, Verzeichnis der Sicherung |
| `zip.js`, `tests/zip.test.js` | ZIP-Dateien schreiben und lesen (Sicherung des Logbuchs), ohne Abhängigkeiten |
| `werkzeuge/xc-pruefung.js` | prüft die XContest-Wertung an eigenen IGC-Flügen gegen eine dichtere und eine exakte Rechnung |
| `werkzeuge/auswertung.js` | lässt Kreiserkennung und Windschätzung über eigene IGC-Flüge laufen und schreibt einen Bericht mit Grafiken |
| `terrain/` | Geländekacheln für „Höhe über Grund“ (`index.json` + `tiles/*.u16.gz`, 1140 Kacheln, ~220 MB), Kopie von `agl-terrain/output/tiles_25m/` |
| `agl-terrain/` | Werkzeug, das die Kacheln aus swisstopo-Daten erzeugt und prüft (eigene README) |

## Daten

- `$GPGGA`: Position, GPS-Höhe (über Meer), Satelliten, HDOP, Fix-Qualität
- `$GPRMC`: Geschwindigkeit (Knoten → km/h), Kurs über Grund, Datum/Zeit, Status A/V
- `$LXWP0`: Vario in m/s (Feldbedeutung nach dem XCTracer-Parser von XCSoar). Die Barometerhöhe wird nicht angezeigt. Sie bleibt im Rohlog und geht als Druckhöhe (ISA) in die IGC-Datei.
- `$LXWPW`: Laut Handbuch des XC Tracer Mini V „the same as LXWP0, but with the information of the calculated wind“. Eine Feldbeschreibung (Reihenfolge, Einheit, „woher“ oder „wohin“) gibt es nicht. Die App liest daraus deshalb nur Vario und Baro wie bei LXWP0. Die Windfelder zeigt sie roh auf der Debug-Seite, deutet sie aber nicht.
- Zeilen mit falscher oder fehlender Prüfsumme werden verworfen und gezählt (Seite „Rohdaten“).

## Berechnungen

- **Integriertes Steigen:** zeitgewichteter Mittelwert des Varios über ein gleitendes Fenster (Standard 16 s, 5–120 s).
- **Gleitzahl über Grund:** mittlere Geschwindigkeit über Grund geteilt durch das mittlere Sinken im Fenster (Standard 10 s, 5–60 s).
  Beim Steigen ist das Ergebnis negativ.
  Ein Strich erscheint, wenn der Betrag über der Schwelle liegt (Standard 60), das Fenster noch nicht gefüllt ist oder Daten fehlen.
- **Ø Geschwindigkeit über Grund:** zeitgewichteter Mittelwert der GPS-Geschwindigkeit über ein gleitendes Fenster (Standard 10 s, 5–120 s).
- **Höhengewinn in dieser Thermik:** GPS-Höhe jetzt minus GPS-Höhe beim Andrehen in die Thermik. Die Thermik beginnt mit der Drehung, die zum Wechsel auf „Thermik“ geführt hat, und bleibt über einen Wechsel der Drehrichtung im Bart hinweg dieselbe. Darunter stehen Dauer und mittleres Steigen. Ausserhalb der Thermik zeigt der Kasten einen Strich und darunter das Ergebnis der letzten Thermik.
- **Zeit seit Start:** Zeit seit „Flug starten“ oder seit dem Beginn des erkannten Starts (gleich lang wie die Aufzeichnung).
- **Regeln für alle Fenster:**
  - Jeder Messwert gilt bis zum nächsten, höchstens aber 2 s.
  - Längere Lücken zählen nicht mit.
  - Ein Fenster gilt erst als gefüllt, wenn es zu mindestens 90 % abgedeckt ist.
- Kommen mehr als 2 s keine Daten, werden die Werte abgedunkelt und mit „Keine Daten“ markiert.

## Wind und Kreiserkennung

**Nur eine Schätzung, gegen keinen gemessenen Wind geprüft.** Das Vario liefert keine Fluggeschwindigkeit (das Feld im LXWP0 ist leer). Der Wind wird darum aus der Bewegung über Grund beim Kreisen geschätzt.

### Kreiserkennung (`kreisen.js`)

- **Eingang:** jeder gültige `$GPRMC` (Kurs über Grund, Geschwindigkeit) mit der letzten GPS-Höhe.
- **Drehrate:** Kursänderung, über 2 s gemittelt. Der Sprung 359° → 1° zählt als +2°. Unter 5 km/h über Grund ist der Kurs unbrauchbar.
- **Stufe 1, „Kreisen beginnt“:**
  - Die Drehrate liegt mindestens 4 s lang über 8 °/s in gleicher Richtung (kurze Einbrüche bis 2 s sind erlaubt).
  - **und** der Kurs hat sich dabei um mindestens **250°** geändert.
  - Erst der Winkel trennt Thermikkreise von Wenden im Hangflug. Bei 20 °/s meldet die Erkennung nach etwa 14 s, also nach rund 80 % eines Kreises (siehe Auswertung unten).
- **Ende:** wenn die Drehrate 8 s lang nicht mehr in Kreisrichtung über der Schwelle liegt (Hysterese), oder sofort, wenn 4 s lang anhaltend in die Gegenrichtung gedreht wird (Achter).
- **Stufe 2, Fenster für den Wind:**
  - Jede volle 360°-Drehung löst `vollkreis` aus, mit genau diesen 360° als Fenster.
  - Beim Ende liefert `kreisEnde` den Rest seit dem letzten Vollkreis. Er gilt für den Wind, wenn er mindestens 270° umfasst und weder mit einem Richtungswechsel begonnen noch geendet hat.
- **Schnittstelle:** `Kreisen.createKreisDetektor(einstellungen)` mit
  - `update({t, kursGrad, geschwindigkeit, lat, lon, hoehe})` (t in s, Geschwindigkeit in m/s), `tick(t)` (Zeit ohne Daten, für Datenlücken), `getZustand()`, `on(name, cb)` (gibt die Abmeldefunktion zurück), `off`, `setEinstellungen`, `statistik()`.
  - Ereignisse: `kreisBeginn`, `kreisEnde` (mit allen Messpunkten und dem Windfenster), `vollkreis`, `phasenwechsel`, `fehler`.
- **Globale Phase:** `FlugPhase.wert` und `FlugPhase.abonnieren(cb)` in `index.html`, mit `phase` (Kreiserkennung) und `modus` (Thermik/Gleiten aus der Phasenwahl). Der automatische Seitenwechsel hängt selbst an diesem Abonnement.

### Automatischer Seitenwechsel (`Kreisen.createPhasenwahl`)

Die Phasenwahl entscheidet aus den Ereignissen der Kreiserkennung zwischen „thermik“ und „gleiten“. Die App wechselt nur im Moment eines solchen Wechsels die Seite. Wer dazwischen wischt, bleibt auf seiner Seite, bis die Phase das nächste Mal wechselt.

- **Gleiten → Thermik:** sobald „Kreisen beginnt“ (250° in eine Richtung, siehe oben). Ausnahmen:
  - Die Drehung entstand aus einem Richtungswechsel, oder in den letzten 120 s gab es ein Achter-Muster. Dann erst beim ersten vollen Kreis (360°).
  - Einstellung „erst nach dem ersten vollen Kreis“: immer erst bei 360°.
- **Thermik → zurück:** sobald das Kreisen endet. Die Kreiserkennung hat da schon 8 s Geradeausflug abgewartet.
  Zurück geht es auf die Seite, die vor dem Wechsel auf „Thermik“ offen war (z. B. „Karte“), sonst auf „Gleiten“.
- **Wechsel der Drehrichtung im Bart:**
  - Die Thermik bleibt bis zu 30 s erhalten, bis in der neuen Richtung ein voller Kreis gelingt.
  - Kommt stattdessen ein weiterer Richtungswechsel oder läuft die Zeit ab, war es ein Achter (Soaring): zurück auf Gleiten und 120 s Achter-Sperre.
  - Geht es nach dem Richtungswechsel geradeaus weiter, wechselt die Anzeige wie bei einem normalen Kreisende nach 8 s.
- **Bleibt „Gleiten“:** Geradeaus steigen (Hangaufwind), S-Kurven, Hangwenden und lange Achter ohne volle Kreise.
- **Einstellungen** (unter „Wind und Kreiserkennung“): Automatik ein/aus, Eintritt früh oder erst nach vollem Kreis, Haltezeit nach Richtungswechsel, Achter-Sperre.
- **Standardseiten:**
  - Gleiten: Steigen, integriertes Steigen, Höhe über Grund, Gleitzahl über Grund, Ø Geschwindigkeit, Zeit seit Start.
  - Thermik: Raster „2 × 4, oberster Kasten breit“ mit Steigen (breit), integriertes Steigen, GPS-Höhe, Höhe über Grund, Höhengewinn Thermik, Wind, Zeit seit Start.
  - Alle Kästen bleiben in den Einstellungen frei wählbar.
  - Die frühere Seite „Flug“ wird nicht übernommen; „Gleiten“ und „Thermik“ beginnen mit diesen Standardkästen.

### Windschätzung (`wind.js`)

- **Prinzip:** Beim Kreisen mit etwa gleicher Fahrt liegen die Geschwindigkeitsvektoren über Grund (Ost/Nord) auf einem Kreis. Der Mittelpunkt ist der Wind, der Radius die Fluggeschwindigkeit.
- **Anpassung:**
  - Ein Vorfilter wirft grobe Ausreisser weg.
  - Dann folgt ein algebraischer Kreis nach Taubin, bis zu dreimal ohne Ausreisser neu angepasst (3 robuste σ).
  - Zum Schluss wird der Kreis geometrisch verfeinert (Gauss-Newton).
  - Messpunkte unter 5 km/h über Grund werden verworfen.
- **Ergebnis:**
  - Windvektor, Stärke (km/h), `richtungVon` (woher) und `richtungNach` (wohin)
  - Fluggeschwindigkeit (Radius), Punktzahl, grösste Winkellücke um den Mittelpunkt
  - Restfehler (Streuung des Abstands zum Kreis relativ zum Radius), Zeit und mittlere GPS-Höhe
- **Güte:** Die schlechteste der drei Stufen zählt. Bei „schlecht“ wird kein Wert angezeigt.

  | | gut | mittel | sonst |
  |---|---|---|---|
  | grösste Winkellücke | ≤ 60° | ≤ 90° | schlecht |
  | Restfehler | ≤ 8 % | ≤ 15 % | schlecht |
  | Messpunkte | ≥ 16 | ≥ 10 | schlecht |

  Ausserdem gilt eine Fluggeschwindigkeit ausserhalb von 15–70 km/h als schlecht.
  Die Grenzen sind an den eigenen Flügen gewählt. Mit grösserem Restfehler oder grösserer Lücke streuen aufeinanderfolgende Schätzungen im selben Aufwind deutlich mehr.
- **Gültigkeit:**
  - Eine Schätzung gilt 10 min und bis zu 300 m GPS-Höhenänderung.
  - Danach wird sie abgedunkelt und mit Alter und Grund markiert.
  - Ganz ausgeblendet wird sie nach weiteren 10 min oder ab der doppelten Höhenänderung (600 m).
- **Berechnet, aber nicht angezeigt:** Gegen-/Rückenwind, Seitenwind (`windKomponenten`) und die Fluggeschwindigkeit im Geradeausflug (`fluggeschwindigkeit`).

### Anzeige: Kachel „Wind“

- **Zahl:** Windstärke in km/h. Darunter stehen Güte und Alter („gut · vor 3 min“).
- **Pfeil:**
  - Oben im Pfeilbild ist die Flugrichtung (Kurs über Grund).
  - Standardmässig zeigt er, **wohin** der Wind weht: Gegenwind nach unten, Rückenwind nach oben, Wind von links nach rechts.
  - Pfeilwinkel = Richtung, in die der Wind weht, minus Kurs, auf 0–360 gebracht (`Wind.windPfeilWinkel`).
  - Einstellbar ist, dass der Pfeil stattdessen zeigt, **woher** der Wind kommt.
- **Beim Kreisen:** Der Pfeil dreht mit (Standard), bleibt auf dem Kurs vor dem Kreisen eingefroren, oder zeigt Nord oben mit N-Markierung.
  Unter dem Pfeil steht, was gerade oben ist: „↑ Kurs“, „↑ Kurs vor Kreis“ oder „↑ Nord“.
- **Unsicherer Kurs:** Unter 8 km/h über Grund wird der Pfeil abgedunkelt („unsicher“), die Zahl bleibt.
- **Bekannte Grenze:** Ist der Wind so stark wie die Fluggeschwindigkeit oder stärker, dreht der Kurs über Grund nicht mehr ganz herum. Dann erkennt die Kreiserkennung keine Kreise, und es gibt keine neue Schätzung. Die Anpassung selbst käme mit solchen Daten zurecht (siehe Tests).

### Auswertung eigener Flüge

```
node werkzeuge/auswertung.js flugdaten/igc flugdaten/auswertung
```

- **Ausgabe:** `bericht.html` mit Kreisabschnitten, Windtabelle, Wind über die Höhe und je einer Grafik pro Flug.
- **Datenschutz:** `flugdaten/` steht in `.gitignore`, weil die IGC-Dateien Name und Positionen enthalten.
- **Ergebnis an 18 eigenen Flügen** (iPhone-GPS 1 Hz, nicht das Vario):
  - 499 Kreisabschnitte, davon 89 unter 360° (52 davon mit Sinken, also wohl Wenden).
  - 77 % der Steigzeit lag in erkannten Kreisabschnitten.
  - Aufeinanderfolgende Windschätzungen im selben Aufwind unterscheiden sich im Median um 3 km/h.
  - Seitenwechsel: 436-mal „Thermik“ (13,5 pro Flugstunde, 40 % der Flugzeit), Wechsel im Median 13 s nach Drehbeginn.
    - Steigende Thermiken (≥ 2 Kreise) lagen zu 93 % der Kreiszeit auf der Thermik-Seite. Der Rest ist die Zeit bis zur Erkennung.
    - Steigen ohne Kreisen (Hang, Soaring) lag nur zu 4 % auf der Thermik-Seite.
    - 45 Episoden ohne vollen Kreis (einzelne Drehungen ab 250°). 132 mit Höhenverlust, meist 0–1 Kreise und höchstens 20 m, also Probierkreise in schwachem Steigen; 16 davon kurz vor der Landung.

## Start- und Landeerkennung (`startlandung.js`)

**Nur eine Erkennung aus GPS-Daten.** Sie entscheidet aus der Geschwindigkeit über Grund, der Höhe über Grund (AGL) und der Änderung der GPS-Höhe.

- **Eingang:** jeder gültige `$GPRMC` (Geschwindigkeit) mit der letzten frischen GPS-Höhe und der AGL an dieser Position. Zeiten sind Wanduhr-Zeiten der empfangenen Zeilen.
- **Start** (Standardwerte, alle einstellbar):
  - mindestens 8 s lang mindestens 15 km/h über Grund,
  - **und** seit mindestens 4 s mindestens 25 m über Grund.
  - Ohne Geländedaten (ausserhalb der Kacheln, offline ohne gespeichertes Gebiet) gilt statt der AGL eine Änderung der GPS-Höhe um mindestens 20 m seit Beginn der Bewegung.
  - Der Flug beginnt mit dem Startlauf, also mit der Bewegung, höchstens 60 s vor der Höhenbedingung. Die Daten davor hält die App bis 3 min lang bereit, Startlauf und Abheben sind also in der Aufzeichnung und in der IGC-Datei.
  - Kurze Einbrüche bis 2 s sind erlaubt. Bei einer Datenlücke über 5 s beginnt alles neu.
- **Am Boden:** unter 5 km/h, höchstens 40 m über Grund (falls bekannt), und die GPS-Höhe schwankt dabei höchstens um 8 m.
- **Fehlstart:** Die Aufzeichnung wird **gelöscht**, und die App wartet wieder auf einen Start, wenn der Schirm innerhalb von 60 s nach einem erkannten Start wieder beim Startplatz steht:
  - mindestens 10 s lang unter 5 km/h,
  - **und** höchstens 15 m über Grund, ohne Geländedaten höchstens 15 m über oder unter der Höhe beim Startlauf.
  - Das ist strenger als die Landung. Wer bei starkem Wind 25–40 m über dem Hang fast stillsteht, verliert seinen Flug nicht.
  - Nur automatisch gestartete Flüge werden so gelöscht, nie ein von Hand gestarteter oder fortgesetzter.
- **Landung** (einstellbar ein/aus, Standard ein): 30 s am Boden. Dann wird der Flug beendet und gespeichert.
  - Bei einem von Hand gestarteten Flug erst, nachdem er einmal die Startbedingung erfüllt hat. Wer am Startplatz „Flug starten“ tippt und dann wartet, wird nicht „gelandet“.
  - Ist die Landeerkennung aus, läuft der Flug bis „Flug beenden“.
- **Starterkennung als Modus:** Sie bleibt eingeschaltet, auch über ein Neuladen. Nach einer erkannten Landung und nach „Flug beenden“ wartet die App wieder auf den nächsten Start. Ausschalten während eines Flugs wirkt nach dessen Ende.
- **Neu geladen während des Flugs:** Wird ein Start erkannt und gibt es eine unterbrochene Aufzeichnung, die vor höchstens 10 min zuletzt gespeichert wurde, wird diese fortgesetzt statt eine zweite angelegt.
- **Anzeige:**
  - Die Startseite zeigt Zustand, Geschwindigkeit, AGL (ohne Geländedaten die Höhenänderung), den Stand der Landeerkennung und die letzte Meldung.
  - Die Statusleiste zeigt „Start?“, solange die App wartet.
  - Start, Fehlstart und Landung erscheinen als blaue Meldung oben und im Log.
- **Bekannte Grenzen:**
  - Seilbahn oder Sessellift über einem Tal erfüllen die Startbedingung. Hält die Fahrt länger als das Fehlstart-Fenster, wird sie als Flug gespeichert.
  - Ohne Geländedaten kann eine Autofahrt auf einer Bergstrasse (Geschwindigkeit und Höhenänderung) einen Start auslösen. Mit Geländedaten nicht, weil die AGL am Boden bleibt. Darum vor dem Flug das Gebiet offline speichern.
  - Bei starkem Gegenwind am Start kann die Geschwindigkeit über Grund unter 15 km/h bleiben. Dann wird der Start erst erkannt, wenn der Schirm schneller über Grund fliegt. Der Flug beginnt dann erst in diesem Moment, der Start selbst fehlt in der Aufzeichnung. In diesem Fall besser „Flug starten“ tippen.
  - Hängt der Schirm bei starkem Wind fast still in der Luft, gibt es keine Landung, solange die AGL über 40 m liegt oder die Höhe sich ändert.
  - Die Landung braucht 30 s Daten am Boden. Wird das Vario gleich nach dem Aufsetzen ausgeschaltet oder bricht Bluetooth ab, bleibt der Flug offen. Neue Daten, etwa nach der Heimfahrt, kämen dann noch in diesen Flug. In diesem Fall „Flug beenden“ tippen.

## Logbuch (`flugbuch.js`, `xcontest.js`)

**Nur Schätzungen aus GPS-Daten.** Die XContest-Wertung ist eine eigene Rechnung nach den veröffentlichten Regeln und wird nirgends eingereicht.

### Flüge ins Logbuch

- **Nach jeder Aufzeichnung** (Landung erkannt, „Flug beenden“, unterbrochenen Flug „Abschliessen“) wertet die App den Flug aus und trägt ihn ein. Das geschieht nur, wenn in den Daten ein Start erkannt wird (siehe unten). Sonst bleibt die Aufzeichnung unter Debug, wo „Ins Logbuch“ sie trotzdem einträgt.
- **Bisherige Aufzeichnungen** werden beim ersten Start mit dieser Version einmal übernommen: abgeschlossen, mit erkanntem Start und mindestens 3 min lang. Kurze Tests am Boden bleiben nur unter Debug.
  - Das läuft im Hintergrund, aber nicht während eines Flugs und nicht, solange das Vario verbunden ist oder die Starterkennung wartet: Jede Auswertung belegt die Anzeige kurz. Dann versucht die App es jede Minute wieder, oder sofort beim Öffnen des Logbuchs.
- **Automatisch erkannter Start:** Bei Flügen, die die App im Flug selbst erkannt hat (mit Geländedaten), gilt dieser Start. Die Erkennung ohne Geländedaten spricht z. B. beim Soaren auf Starthöhe erst spät an.
- **IGC-Import** („+ IGC“): eine oder mehrere Dateien. Die Originaldatei wird gespeichert, „IGC exportieren“ gibt genau diese Datei zurück (mit Signatur, falls vorhanden).
- **Gleicher Flug:** Starten zwei Flüge höchstens 2 min und 300 m auseinander, gilt das als derselbe Flug. Er wird beim Import übersprungen und nach einer Aufzeichnung nicht ein zweites Mal eingetragen.
- **Name:** Liegt ein Wegpunkt (*Einstellungen → Karte und Ziel*) höchstens 2 km vom Start entfernt, heisst der Flug wie dieser Wegpunkt, sonst „Flug 14:32“. Umbenennen im Flug.
- **Löschen** entfernt den Flug zusammen mit seiner Aufzeichnung bzw. der importierten Datei. Wer unter Debug eine Aufzeichnung löscht, die im Logbuch steht, löscht auch den Flug (die Rückfrage sagt das).
- **Speicher:** IndexedDB `flugapp`, Version 2. Neu sind die Stores `fluege` (Name, Quelle, berechnete Werte) und `igc` (Originaldateien). Die Fixes aufgezeichneter Flüge bleiben in `chunks`.
- **Neu rechnen:** Jede Auswertung trägt eine Version (`Flugbuch.ANALYSE_VERSION`). Ändert sich eine Berechnung, wird die Zahl erhöht, und die App rechnet beim nächsten Start alle Flüge im Hintergrund neu. Namen bleiben.

### Sicherung

Die App speichert das Logbuch nur im Browser. Gesichert wird von Hand, in eine Datei ausserhalb der App.

- **„Alle Flüge sichern“** erstellt eine ZIP-Datei. „Speichern …“ öffnet dann das Teilen-Menü, dort z. B. „In Dateien sichern“ (iCloud Drive). Ohne Teilen-Menü lädt der Browser die Datei herunter.
  - Zwei Schritte, weil iOS das Teilen-Menü nur direkt nach einem Tippen öffnet und das Erstellen etwas dauert.
  - Bricht man das Teilen ab, gilt nichts als gesichert. Nach einem Download fragt die App, ob die Datei angekommen ist (ob ein Download klappt, sieht sie nicht).
  - Gepackt wird Flug für Flug, beim Zurückladen wird nur entpackt, was gebraucht wird. Gemessen in der Browser-Vorschau am PC mit 100 erfundenen Flügen (80 aufgezeichnete, 1 Hz, 1.5–2.5 h): 91 MB Daten → 15.5 MB ZIP-Datei, Sichern 12 s, Zurückladen 9 s, höchstens 78 MB Arbeitsspeicher für JavaScript. Auf dem iPhone nicht gemessen.
- **Inhalt** (`logbuch-2026-11-25-0802.zip`):
  - `logbuch.json`: alle Flüge, wie sie gespeichert sind (Name, Quelle, berechnete Werte, bekannter Start).
  - `IGC/2026-07-14 1032 Amisbühl.igc`: jeder Flug als IGC-Datei, z. B. für XContest. Bei importierten Flügen ist es die Originaldatei.
  - `daten/<id>.json`: bei aufgezeichneten Flügen die GPS-Fixes, wie sie gespeichert sind, ohne die NMEA-Rohzeilen.
- **„Sicherung laden“** (oder „+ IGC“ mit der ZIP-Datei) ergänzt das Logbuch. Vorhandene Flüge bleiben unverändert, gleiche Flüge werden übersprungen. Vorher fragt die App, wie viele Flüge sie übernimmt.
  - Importierte Flüge kommen mit ihrer Originaldatei zurück, aufgezeichnete mit ihren Fixes. Name, Werte und bekannter Start sind danach genau gleich, es wird nichts neu gerechnet.
  - Die Aufzeichnung unter Debug hat danach keine Rohzeilen mehr: Der Export als .txt ist leer, .igc geht.
  - Die IGC-Kopien aufgezeichneter Flüge liest die App beim Zurückladen nicht. Ihre GNSS-Höhe ist über dem Ellipsoid (wie beim IGC-Export), die Werte im Logbuch beziehen sich auf die Höhe über Meer.
  - Eine ZIP-Datei ohne `logbuch.json` (z. B. ein Export aus einem anderen Programm) wird wie mehrere IGC-Dateien importiert.
- **Hinweis zum Sichern:** Ein Flug gilt als nicht gesichert, wenn er nach dem Erstellen der letzten Sicherung dazukam oder umbenannt wurde. Datum und Zahl der letzten Sicherung stehen im Browser-Speicher (`flugapp.logbuch.sicherung`) und gehen mit ihm verloren.
- **Dauerhafter Speicher:** Beim Öffnen des Logbuchs und beim Sichern fragt die App den Browser danach (`navigator.storage.persist()`). Die Antwort steht unter „Speicher“. „Dauerhaft“ heisst, dass der Browser die Daten nicht von sich aus löscht. Auf dem iPhone ist das nicht zugesichert, deshalb bleibt die Sicherung nötig.
- **ZIP-Datei:** eigener Packer (`zip.js`) mit Deflate über `CompressionStream`. Alte Browser ohne `CompressionStream` speichern unkomprimiert, ohne `DecompressionStream` lesen sie nur unkomprimierte ZIP-Dateien. Kein ZIP64, also höchstens 4 GB.
  - Geprüft: in Node gegen den eigenen Leser und gegen `zlib.crc32`, eine von Windows erstellte ZIP-Datei wird gelesen, die eigene lässt sich mit dem Windows-Entpacker und `tar` öffnen.

### Auswertung eines Flugs

- **Track:**
  - Aufzeichnung: GPS-Fixes mit GPS-Höhe über Meer. Das Datum kommt aus dem RMC, sonst aus dem Beginn der Aufzeichnung, über Mitternacht fortlaufend.
  - IGC: B-Records mit gültigem Fix und GNSS-Höhe. Hat die Datei keine GNSS-Höhe, gilt die Druckhöhe.
  - Für Steigen und Höhengewinn wird die Höhe über ±2 s geglättet.
- **Start und Landung:** gleiche Erkennung wie im Flug (`startlandung.js`), aber ohne Geländedaten. Die Geschwindigkeit kommt aus den Positionen.
  - Start: 8 s mindestens 15 km/h und 20 m Höhenänderung. Er beginnt mit dem Startlauf.
  - Landung: 30 s am Boden. Endet die Datei früher, gilt der letzte Punkt.
  - Mehrere Flüge in einer Datei zählen vom ersten Start bis zur letzten Landung. Ohne erkannten Start gilt der ganze Track, die Detailseite sagt das.
- **Dauer:** Start bis Landung.
- **Max. Höhe:** höchster Punkt, ungeglättet.
- **Höhengewinn über Start:** max. Höhe minus Starthöhe.
- **Höhengewinn kumuliert:** alle Anstiege zusammengezählt. Ein Anstieg zählt erst ab 5 m, so dass GPS-Rauschen nicht mitzählt.
- **Thermiken:**
  - Die Kreisphasen kommen aus der Phasenwahl, wie beim automatischen Wechsel auf „Thermik“.
  - Als Thermik zählt eine Kreisphase mit mindestens +30 m vom Andrehen bis zum höchsten Punkt (wie die Thermik-Punkte auf der Karte).
  - Ø Steigen = Summe der Höhengewinne / Summe der Zeiten bis zum höchsten Punkt.
- **Ø Gleitzahl im Gleiten:**
  - Strecke über Grund geteilt durch den Höhenverlust, summiert über alle Abschnitte zwischen den Kreisphasen.
  - Ein Abschnitt zählt ab 30 s und 10 m Höhenverlust. Probierkreise mit Sinken zählen nicht als Gleiten.
  - Das ist eine Gleitzahl über Grund, also mit Wind. Hangsoaring ohne Kreise zählt als Gleiten und macht die Gleitzahl zu gut.
- **Strecke geflogen:** Weg über Grund von Punkt zu Punkt.

### XContest-Distanz (`xcontest.js`)

- **Regeln:** [XContest World](https://www.xcontest.org/world/en/rules/), Abschnitte 2.5, 4.1 und 4.2.
  - Freie Strecke über bis zu 3 Wendepunkte: Faktor 1.0.
  - Flaches Dreieck: 1.2.
  - FAI-Dreieck (kürzeste Seite mindestens 28 % des Umfangs): 1.4.
  - Geschlossenes flaches Dreieck (Schlussabstand unter 5 %): 1.4.
  - Geschlossenes FAI-Dreieck (unter 5 %): 1.6.
  - Ein Dreieck zählt nur mit einem Schlussabstand unter 20 % des Umfangs. Distanz = Umfang − Schlussabstand.
  - Start und Ziel dürfen irgendwo vor dem ersten und nach dem dritten Wendepunkt liegen. Ein Hin- und Rückflug ist deshalb ein geschlossenes flaches Dreieck.
  - Es gilt die Art mit den meisten Punkten. Distanz auf 0.01 km gerundet, Punkte = Distanz × Faktor auf 2 Stellen.
  - Distanzen auf dem WGS84-Ellipsoid (Vincenty).
- **Track:** vom ersten Punkt der Datei (Boden am Startplatz zählt mit, wie bei XContest) bis zur erkannten Landung. Eine Autofahrt nach der Landung zählt nicht.
- **Suche:**
  - Zuerst grob auf einem ausgedünnten Track: freie Strecke mit dynamischer Programmierung, Dreiecke über alle Tripel.
  - Dann wird jeder Wendepunkt auf dem ganzen Track abwechselnd optimal gesetzt, bis sich nichts mehr ändert.
  - Der Schlussabstand wird exakt gesucht (Branch and Bound über Abschnitte).
  - Dauer pro Flug: 0.2–0.8 s auf einem PC (auf dem iPhone nicht gemessen, vermutlich länger). Die Rechnung läuft einmal, das Ergebnis wird gespeichert.
- **Geprüft:**
  - `tests/xcontest.test.js` vergleicht mit Brute Force (alle 5-Tupel und alle Dreiecke) auf zufälligen Tracks.
  - `node werkzeuge/xc-pruefung.js flugdaten/igc --exakt`: An den 18 eigenen Flügen ändert eine viel dichtere grobe Suche nichts (Abweichung 0.00 Punkte). Die freie Strecke stimmt mit der exakten Rechnung auf allen Punkten überein (0.00 km).

### Anzeige eines Flugs

- **Karte** (Landeskarte):
  - ganzer Track. Bis zur Zeitmarke ist er kräftig, danach blass.
  - Thermiken als Punkte, XContest-Route gestrichelt mit Wendepunkten. Antippen einer Zeile in der Tabelle „XContest-Wertung“ zeigt diese Art.
  - Verschieben, Zoomen mit zwei Fingern oder + und −, ⤢ zeigt wieder den ganzen Flug. Antippen des Tracks setzt die Zeitmarke dorthin.
  - Ausserhalb der Schweiz gibt es keine Kartenbilder, der Track steht auf neutralem Hintergrund.
- **Höhenprofil:**
  - Thermiken orange hinterlegt, vor dem Start und nach der Landung grau.
  - Ziehen oder Antippen setzt die Zeitmarke.
  - ▶ spielt den Flug ab, ×10 / ×30 / ×100.
- **An der Zeitmarke:** Uhrzeit, Höhe, Steigen (±3 s), Geschwindigkeit über Grund, Höhe über Grund (mit Geländedaten), laufende Thermik.

### Statistik

- **Gesamt oder pro Saison.** Eine Saison ist ein Kalenderjahr (Ortszeit).
- **Werte:**
  - Anzahl, Flugzeit (Summe und Ø)
  - XContest-km und -Punkte (Summe der besten Wertung je Flug)
  - Thermiken, Ø Steigen (gewichtet nach Zeit in Thermik), Ø Gleitzahl (gewichtet nach Höhenverlust)
  - kumulierter Höhengewinn
- **Bestwerte:** bester XContest-Flug, längster Flug, grösste Höhe, grösster Höhengewinn über Start, stärkste Thermik. Antippen öffnet den Flug.

### Bekannte Grenzen

- **iOS kann die IndexedDB löschen**, wenn der Speicher knapp wird. Dann ist auch das Logbuch weg, bis man eine Sicherung lädt (siehe „Sicherung“). Was nach der letzten Sicherung dazukam, ist verloren.
- **Sicherung auf dem iPhone nicht ausprobiert:** Erstellen und Zurückladen sind in der Browser-Vorschau am PC geprüft (alles löschen, zurückladen, Einträge, Punkte und Fixes gleich). Teilen-Menü, „In Dateien sichern“ und die Dateiauswahl auf dem iPhone sind nicht ausprobiert.
- **Start ohne Geländedaten** (von Hand gestartete Aufzeichnungen und IGC-Importe): Bleibt die Geschwindigkeit über Grund am Start unter 15 km/h (starker Gegenwind), oder bleibt der Schirm lange auf Starthöhe (Soaren), beginnt der Flug im Logbuch erst später. Die XContest-Distanz rechnet trotzdem ab dem ersten Punkt.
- **Mit xcontest.org verglichen ist noch nichts.** Geprüft ist die Optimierung (siehe oben), nicht, ob XContest dieselben Punkte vergibt.
- **Datei beginnt in der Luft:** Startet die Aufzeichnung erst nach dem Abheben, beginnt auch der Flug dort.

## Karte (`karte.js`)

**Nur eine Orientierungshilfe, kein Navigationsgerät.** Die Segelflugkarte ist nur ein Bild: Die App kennt keine Luftraumgrenzen und warnt nicht. Massgebend sind die gültige Karte und die DABS.

- **Seite „Karte“:** grosse Karte (Landeskarte swisstopo), darunter GPS-Höhe, Steigen, integriertes Steigen und Höhe über Grund.
- **Seite „Luftraum“:** grosse Karte (Segelflugkarte BAZL), darunter GPS-Höhe und Uhrzeit.
- **Auf der Karte:**
  - eigene Position als gelber Pfeil in Flugrichtung, unter 5 km/h als Punkt
  - geflogene Spur des aufgezeichneten Flugs (abschaltbar)
  - Thermiken dieses Flugs (nur Landeskarte): Mittelpunkt der Positionen beim Kreisen und grösster Höhengewinn, ab +30 m. Die laufende Thermik ist immer zu sehen.
  - Ziel mit gestrichelter Linie und oben einer Leiste mit Distanz, nötiger Gleitzahl und Name
  - Massstab, Nordpfeil (bei „Kurs oben“) und Quelle
- **Ausrichtung:** „Kurs oben“ (Standard) oder „Nord oben“. Bei „Kurs oben“ dreht die Karte nur im Geradeausflug ab 8 km/h. Beim Kreisen bleibt sie stehen, nur der Pfeil dreht.
- **Bedienung:** Die Karte folgt immer der eigenen Position und lässt sich nicht verschieben, damit Wischen weiter die Seite wechselt.
  - Zoom mit den Knöpfen + und −. Landeskarte Zoom 8–15 (Standard 12, etwa 10 km Bildbreite), Segelflugkarte 8–13 (Standard 11). Über Zoom 12 wird die Segelflugkarte nur vergrössert und unscharf.
  - **Lang drücken** (0,7 s) setzt dort das Ziel. Oben erscheint 8 s lang „Rückgängig“.
- **Ziel und Wegpunkte:** *Einstellungen → Karte und Ziel*. Wegpunkte mit Name und Koordinaten speichern, „Aktuelle Position“ übernimmt die Position vom Vario (sonst vom Handy). Koordinaten als WGS84 (`46.68, 7.86`), LV95 (`2'630'000 / 1'170'000`) oder LV03 (`630000 170000`).
- **Nötige Gleitzahl:** Distanz geteilt durch (GPS-Höhe − Geländehöhe am Ziel). Ohne Wind und ohne Sicherheitsreserve. Unter der Zielhöhe steht „unter Ziel“. Auch als Kasten „Ziel“ für jede Seite wählbar.
- **Gebiet:** Schweiz mit etwa 10 km Rand (45.72–47.90° N, 5.85–10.60° E). Ausserhalb lädt die Karte nichts und zeigt „ausserhalb der Schweiz“.
- **Kartenbilder:** `wmts.geo.admin.ch` (Web Mercator, 256-px-Kacheln). Laden zuerst aus dem Speicher, dann aus der IndexedDB (`flugapp-karte`), dann aus dem Netz. Bilder aus dem Netz werden gespeichert.
- **Offline:** *Gebiet offline speichern* lädt nach dem Gelände auch die Karten im selben Radius: Landeskarte ab Zoom 8 bis zur gewählten Stufe, Segelflugkarte Zoom 8–12. Bei 30 km Radius etwa:

  | | bis Zoom | Grösse |
  |---|---|---|
  | Landeskarte | 13 / 14 / 15 | ca. 15 / 55 / 210 MB |
  | Segelflugkarte | 12 | ca. 20 MB |

  Über 80 MB neue Daten fragt die App vorher nach. Gebiete über 250 MB lehnt sie ab („Radius oder Zoom verkleinern“), z. B. 60 km bis Zoom 14.
  iOS kann gespeicherte Daten löschen, wenn wenig Speicher frei ist. Vor dem Flug unter *Einstellungen* nachsehen, ob die Bilder noch da sind.
- **Dunkelmodus:** Die Karte wird leicht abgedunkelt.
- **Quellen:** Landeskarte © swisstopo, Segelflugkarte © BAZL (Open Government Data, Quellenangabe auf der Karte). Grosse Downloads sollen laut den Nutzungsbedingungen der Bundes-Geodateninfrastruktur vorher mit info@geo.admin.ch abgesprochen werden. Darum gibt es nur „Gebiet speichern“ und nicht die ganze Schweiz.
- **Bekannte Grenzen:**
  - Spur und Thermiken gibt es nur während einer Aufzeichnung. Nach einem Neuladen beginnt die Spur neu.
  - Die Position kommt vom Vario-GPS. Ohne Daten wird der Kasten abgedunkelt („Keine Daten“).

## Höhe über Grund (AGL)

- **Berechnung:** GPS-Höhe über Meer (GGA Feld 9) minus Geländehöhe an der aktuellen Position.
  Der Geoid-Abstand wird dabei **nicht** addiert, weil das Gelände ebenfalls Höhen über Meer (LN02) enthält.
- **Gelände:** swisstopo swissALTIRegio, als 25-m-Raster in WGS84 (Schweiz mit ca. 10 km Rand).
  - Pro Rasterzelle steht der höchste Wert, das Gelände ist also eher zu hoch und die AGL eher zu klein.
  - Zwischen den vier Nachbarpunkten wird bilinear interpoliert. Das kann an Gipfeln und Graten wieder etwas tiefer liegen (siehe `agl-terrain/BERICHT.md`).
- **Kachel laden:** zuerst aus dem Speicher, dann aus der IndexedDB (`flugapp-terrain`), dann aus dem Netz.
  - Kacheln aus dem Netz werden in der IndexedDB gespeichert.
  - Die 8 Nachbarkacheln der aktuellen Position werden im Hintergrund mitgeladen.
- **Ohne Netz** geht es nur mit vorher gespeicherten Kacheln: *Einstellungen → Gelände und Karten offline → Gebiet offline speichern* (Radius um die aktuelle Position oder um eingegebene Koordinaten; 30 km ≈ 12 MB).
- Der Service Worker und „Neueste Version laden“ lassen die Geländedaten in Ruhe.
- Ausserhalb der Kacheln (z. B. Gardasee) zeigt der Kasten „ausserhalb der Geländedaten“.
- **Nur eine Näherung:** Das Modell enthält keine Bäume, Gebäude, Leitungen oder Seilbahnen, und die GPS-Höhe schwankt um mehrere Meter.
- Quelle: Bundesamt für Landestopografie swisstopo (swissALTIRegio, Open Government Data).
- **Kacheln aktualisieren:** in `agl-terrain/` neu erzeugen (siehe dortige README) und `output/tiles_25m/` nach `terrain/` kopieren.

## Tests

```
node --test tests/*.test.js
```

Die Tests der Kreiserkennung und Windschätzung schreiben erreichte Genauigkeiten und Erkennungszeiten als Diagnosezeilen (`ℹ`) in die Ausgabe.

Die Tests laden die reinen Funktionen direkt aus `index.html`, aus dem Block zwischen `/*CORE-BEGIN*/` und `/*CORE-END*/`.
Der Gelände-Test vergleicht mit Werten aus `agl-terrain/scripts/agl/terrain.py` an echten Kacheln. Fehlt `terrain/`, wird er übersprungen.

## IGC-Export

- Der Export folgt der FAI/IGC-Spezifikation (2nd Edition with AL9):
  - Hersteller-Code `XEB` für nicht zugelassene Geräte
  - B-Records mit 35 Zeichen im 1-Hz-Takt
  - Zeilenende CRLF
- GNSS-Höhe:
  - Sendet das GPS den Geoid-Abstand, wird die Höhe über dem Ellipsoid berechnet (`HFALGALTGPS:ELL`).
  - Sonst wird die Höhe über Meer verwendet (`GEO`).
- Die Datei ist **nicht signiert und nicht für Wettbewerbe** gedacht. Sie hat keinen G-Record und ist mit `HFFRSSECURITYSUSPECT` und einem L-Record gekennzeichnet.

## Veröffentlichen

Die Dateien liegen im Repository auf dem Branch `main`, GitHub Pages veröffentlicht sie aus dem Ordner `/ (root)`.
Nach einem Push ist die neue Version nach etwa einer Minute online.
Die App lädt mit Netz immer die neueste Version. Ohne Netz kommt sie aus dem Offline-Cache, falls der Browser Service Worker unterstützt.
