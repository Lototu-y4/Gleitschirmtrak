# Kurzbericht

Quelle der Geländedaten: **Federal Office of Topography swisstopo** (swissALTIRegio).

> **Sicherheitshinweis:** Das Modell enthält keine Bäume und keine Gebäude, und die GPS-Höhe des iPhones schwankt. Die berechnete
> Höhe über Grund ist eine Näherung und darf nicht als einziges Sicherheitsinstrument gelten.

## Umfang der Ausgabe

| | Anzahl | Grösse |
|---|---|---|
| `output/tiles_25m` (ganze Schweiz + Puffer, 25 m) | 1140 Kacheln | **219,3 MB** gesamt, Mittel 192 kB, grösste Kachel 249 kB (`16_34`), `index.json` 18 kB |
| `output/tiles_10m_testgebiet` (10 m, nur um die Flüge) | 51 Kacheln | 64,4 MB, grösste 1,43 MB (`16_28`) |
| `raw/` (Rohdaten, nicht ins Git) | 24 Streifen | 1,9 GB |

## Was funktioniert hat

* **Download** über die STAC-API (Item `swissaltiregio`, COG `swissaltiregio_2056_5728.tif`, 10 GB); nur der Ausschnitt Schweiz + Puffer
  wurde per Range-Request geholt (1,9 GB, 5,3 min). Die URL wird live aus der STAC-API gelesen.
* **Umrechnung** LV95 → WGS84, Max-Resampling, uint16 in Dezimetern. 1140 Kacheln in 15 s.
  Max-Resampling ist per Test belegt (synthetische 900-m-Spitze überlebt, Mittelwert-Resampling würde sie verlieren).
* **JavaScript = Python** an 300 Zufallspunkten (bilinear und „nächster Punkt“): **identisch** (max. Abweichung 0,0000 cm;
  Toleranz war 1 mm), `null`-Fälle stimmen überein. Ausserdem im Chromium-Browser mit `fetch` + `DecompressionStream` geprüft
  (gleiche Werte wie Python).
* **Bekannte Höhen** (25 m, `output/verifikation/verifikation_25m.md`):

| Ort | publiziert | Rohdaten-Max (150 m) | Gitter-Max (175 m) | bilinear am Gipfelpunkt |
|---|---|---|---|---|
| Dufourspitze | 4634 | 4634,2 | 4634,2 | 4627,8 |
| Matterhorn | 4478 | 4477,0 | 4477,1 | 4476,0 |
| Weisshorn | 4506 | 4504,0 | 4504,0 | 4492,7 |
| Finsteraarhorn | 4274 | 4274,2 | 4274,3 | 4269,6 |
| Jungfrau | 4158 | 4157,1 | 4157,2 | 4152,1 |
| Piz Bernina | 4049 | 4047,1 | 4047,2 | 4037,1 |
| Säntis | 2502 | 2501,8 | 2501,8 | 2501,6 |

  Toleranzen: publiziert ↔ Rohdaten-Max ≤ 4 m (erreicht: ≤ 2,0 m); Gitter-Max ≥ Rohdaten-Max − 0,1 m (erreicht, Aufrunden gibt
  +0,0…+0,1 m). Die publizierten Höhen sind gerundet und die Gipfelkoordinaten ungenau, deshalb zählt der Vergleich Gitter ↔ Rohdaten.
  **Seespiegel** (häufigster Wert der Seefläche, Toleranz ±1,0 m): Genfersee 372,2 · Bodensee 395,6 · Zürichsee 406,0 ·
  Neuenburgersee 429,3 · Vierwaldstättersee 433,6 · Lago Maggiore 193,5 · Thunersee 557,7 – alle bestanden. Die Nennwerte stammen aus
  dem Gedächtnis (± wenige dm saisonal), nicht aus einer Quelle geprüft.
* **Nähte**: alle 2205 Randpunkt-Paare identisch (nach dem Angleichen; vorher wichen 24 von 1116 Ost-Nähten ab).
* **Tests**: 21 pytest-Tests bestanden (IGC-Parser, Umrechnung/Max/Nodata/Dezimeter, Abfrage, JS=Python, Grössenübersicht, Nähte, Zip-Slip).

## Flüge (18 IGC-Dateien, `output/analyse/`)

* 17 Flüge liegen in den Kacheln, **1 Flug (2026-08-07, Gardasee, Italien) liegt ausserhalb** → alle Werte `null`, kein Absturz.
* **Höhenbezug:** Wingman (iOS, iPhone 14 Pro Max) schreibt in **Druckhöhe und GPS-Höhe denselben Wert** (in allen 116 625 Fixes gleich),
  ein `HFALG`-Header fehlt. swissALTIRegio ist LN02-orthometrisch (Dateiname `…_2056_5728`). Ein ellipsoidischer GPS-Wert läge in der
  Schweiz etwa 47–53 m über LN02; gemessen wurde am Landeplatz **Median +2,7 m** (Mittel +5,1 m, Streuung 8,1 m, Bereich −6,7 … +27,7 m,
  15 Flüge mit stehenden Fixes am Ende). Das passt zu Höhen über Meer (Geoid), nicht zu ellipsoidisch. Der Rest ist
  iPhone-Höhengenauigkeit/Luftdruck-Drift, Geoid-Modell ≠ LN02 und Landewiesen mit Hang. **Der Versatz wurde nicht angewendet.**
  Das ist eine Schlussfolgerung aus der Grössenordnung, nicht aus einem Gerätehandbuch.
* **AGL am Landeplatz** (25 m, bilinear): Median +2,7 m, aber Flug zu Flug zwischen −6,7 und +27,7 m. Der Ausreisser (2026-07-21, +27,7 m) ist
  nicht erklärt; die Aufzeichnung endet dort sehr nahe am Boden, ob dort das Gelände korrekt abgebildet ist, konnte ich nicht klären.
  Bei 2 Flügen (07-11, 07-16) endet die Aufzeichnung ohne stehende Fixes, bei allen Flügen beginnt sie schon in Bewegung → „AGL am Start“ ist
  der AGL am ersten Fix (typisch +3 … +20 m; 2026-08-05 beginnt in der Luft: 338 m).
* **Negative AGL** (25 m, bilinear): 130 von 107 186 Fixes (0,12 %), fast alle am Landeplatz (Sensorrauschen/Versatz, −1 … −8 m). Nur **1** Abschnitt
  ausserhalb von Start/Landung hat AGL < 0 (2026-06-20, Mythen, 6 s, −5,6 m): dort liegt das 25-m-Max-Gelände ~30 m über dem Rohdaten-Gelände
  (steile Felswand) – ein Rasterartefakt. `auffaelligkeiten.csv` listet 15 Abschnitte mit AGL < 10 m ausserhalb Start/Landung, alle im Raum Mythen/Haggenegg (47,02–47,04 N, 8,68–8,70 E), also an wenigen Stellen mit sehr steilem Fels.

### Vergleich der Varianten (alle Flüge zusammen, Differenz zur Roh-Referenz = bilinear auf den LV95-10-m-Daten)

| Variante | AGL min | Fixes mit AGL<0 | Ø AGL-Differenz zu roh | 5 %-Quantil | 95 %-Quantil | AGL-Landung: Median / Streuung |
|---|---|---|---|---|---|---|
| 25 m bilinear | −7,7 | 130 | −10,6 m | −27,5 | −1,4 | +2,7 / 8,1 |
| 25 m nächster Punkt | −35,8 | 153 | −10,6 m | −29,8 | −0,5 | +2,8 / 8,0 |
| 10 m bilinear | −5,0 | 93 | −4,5 m | −12,0 | −0,4 | +2,8 / 8,2 |
| 10 m nächster Punkt | −5,6 | 83 | −4,5 m | −13,0 | +0,1 | +3,2 / 8,2 |
| Roh 10 m bilinear (Referenz) | −2,4 | 30 | – | – | – | +3,9 / 7,8 |

* Max-Resampling macht die AGL **systematisch kleiner**: 25 m im Mittel ~10,6 m, 10 m ~4,5 m kleiner als die Referenz; bei 99 % der Fixes ist die 25-m-AGL
  kleiner. Das ist die gewünschte konservative Richtung – im Steilgelände aber sehr stark (bis ~35 m) und es erzeugt Schein-Negativwerte.
* Landepunkt-Fehler: Die **Streuung** zwischen den Flügen (~8 m) ändert sich kaum mit der Auflösung; sie wird von der GPS-Höhe dominiert, nicht vom Gelände.
  Der Median-Betrag |AGL| am Landeplatz sinkt von 6,2 m (25 m) auf 4,4 m (10 m) und 3,9 m (Roh).
* **Interpolation:** Bilinear mischt Maximum-Werte mit ihren niedrigeren Nachbarn. An Gipfeln liegt der interpolierte Wert dadurch **unter** dem Gitter-Maximum
  (z. B. Dufourspitze 4627,8 statt 4634,2 m; Weisshorn −12 m). An Zufallspunkten in den Kacheln liegt der 25-m-Wert im Mittel +6,5 m über der Roh-Referenz,
  aber das 1 %-Quantil bei −56 m: Die Eigenschaft „Gelände eher zu hoch“ gilt für die Gitterwerte, **nicht punktweise nach Interpolation**. Für eine strikt
  konservative App wäre „Maximum der vier Nachbarpunkte“ statt bilinear sinnvoller; das ist nicht umgesetzt, weil bilinear verlangt war.

## Was nicht funktioniert hat / Korrekturen unterwegs

* Venv im tiefen Projektpfad: „Dateiname zu lang“ → Venv nach `C:\agl-venv` (in README erklärt).
* Prozess-Pool stürzte ab (fehlender `__main__`-Guard unter Windows) → behoben.
* Erster Verifikationslauf: Piz Bernina FAIL wegen **falscher Gipfelkoordinate von mir** (nicht wegen der Daten) → Koordinate korrigiert; Nähte FAIL (83 abweichende Nähte) →
  Randpunkt-Angleichung eingebaut.
* Das 10-m-Testgebiet enthält nur Kacheln um die Flüge; die Gipfel-/See-Prüfungen für 10 m sind daher übersprungen (SKIP), nicht bestanden.

## Was ich nicht prüfen konnte

* **Safari/Bluefy auf dem iPhone**: nur Node 24 und Chromium getestet. `DecompressionStream('gzip')` auf iOS ≥ 16.4 stützt sich auf Dokumentation, nicht auf einen Test.
* **Offline-Speicherung** in der App (Service Worker/IndexedDB, Speicherlimits in Bluefy): nicht gebaut. 219 MB sind für das Gerät ggf. zu viel am Stück – Kacheln lassen sich
  regional laden; Byte-Shuffle würde ~29 % sparen.
* Der **Download-Hash** der ganzen 10-GB-Datei lässt sich bei Teil-Download nicht prüfen; Plausibilität über Gipfel/Seen/Nähte statt Prüfsumme.
* Höhenbezug des iPhones (Geoid-Modell, Barometer-Anteil) nur aus dem gemessenen Versatz abgeleitet; Seespiegel-Nennwerte aus dem Gedächtnis.
* Bäume, Gebäude, Hochspannungsleitungen, Seilbahnen sind im Modell nicht enthalten; nicht bewertbar.
* Die Landeplätze sind nicht unabhängig als „flach und frei“ bestätigt; der Versatz ist deshalb eine Schätzung mit ~8 m Streuung.
* Weitere IGC-Dateien in `Downloads` (Wingman-Flüge, `Riederalp Sedrun.igc` u. a.) gehörten nicht zur ZIP und wurden nicht verwendet.
