# Flug-Anzeige XCTracer (Eigenbau)

Ergänzende Flug-Anzeige für das Vario XCTracer Mini V über Web Bluetooth, gedacht für Bluefy auf dem iPhone.
**Eigenbau ohne Zulassung – nur als Ergänzung zu einem Hauptinstrument.**

Online: <https://lototu-y4.github.io/Gleitschirmtrak/>

## Bedienung

- **Start:**
  - Mit dem Vario verbinden und den Verbindungsstatus auf einen Blick sehen.
  - „Flug starten“ öffnet die Fluganzeige und startet automatisch die Aufzeichnung.
  - Während des Flugs stehen hier „Zur Fluganzeige“ und „Flug beenden“.
  - Ein unterbrochener Flug (z. B. nach einem Neuladen) wird hier zum Fortsetzen angeboten.
- **Fluganzeige:**
  - Seiten „Flug“ und „Info“, durch seitliches Wischen oder über die Reiter unten zu wechseln.
  - „Menü“ führt zurück zur Startseite, der Flug läuft dabei weiter.
- **Einstellungen:** Berechnungsfenster, Anordnung der Kästen, Darstellung (automatisch, hell oder dunkel), Wake Lock, Geländedaten offline speichern, Offline-Cache.
- **Debug:**
  - Ausführlicher Verbindungsstatus, Datenquellen und Rohdaten
  - Gespeicherte Aufzeichnungen mit Export als .txt und .igc
  - Service-Liste und UUIDs

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | die ganze App (HTML, CSS, JavaScript), ohne Frameworks |
| `sw.js` | Service Worker: Offline-Cache, „Netz zuerst, Cache als Rückfall“ |
| `manifest.webmanifest` | Web-App-Manifest |
| `tests/core.test.js` | Tests für Parser, Prüfsumme, Berechnungen, IGC-Export und Geländeabfrage |
| `terrain/` | Geländekacheln für „Höhe über Grund“ (`index.json` + `tiles/*.u16.gz`, 1140 Kacheln, ~220 MB), Kopie von `agl-terrain/output/tiles_25m/` |
| `agl-terrain/` | Werkzeug, das die Kacheln aus swisstopo-Daten erzeugt und prüft (eigene README) |

## Daten

- `$GPGGA`: Position, GPS-Höhe (über Meer), Satelliten, HDOP, Fix-Qualität
- `$GPRMC`: Geschwindigkeit (Knoten → km/h), Kurs über Grund, Datum/Zeit, Status A/V
- `$LXWP0`: Vario in m/s (Feldbedeutung nach dem XCTracer-Parser von XCSoar). Die Barometerhöhe wird nicht angezeigt. Sie bleibt im Rohlog und geht als Druckhöhe (ISA) in die IGC-Datei.
- Zeilen mit falscher oder fehlender Prüfsumme werden verworfen und gezählt (Seite „Rohdaten“).

## Berechnungen

- **Integriertes Steigen:** zeitgewichteter Mittelwert des Varios über ein gleitendes Fenster (Standard 16 s, 5–120 s).
- **Gleitzahl über Grund:** mittlere Geschwindigkeit über Grund geteilt durch das mittlere Sinken im Fenster (Standard 10 s, 5–60 s).
  Beim Steigen ist das Ergebnis negativ.
  Ein Strich erscheint, wenn der Betrag über der Schwelle liegt (Standard 60), das Fenster noch nicht gefüllt ist oder Daten fehlen.
- **Regeln für alle Fenster:**
  - Jeder Messwert gilt bis zum nächsten, höchstens aber 2 s.
  - Längere Lücken zählen nicht mit.
  - Ein Fenster gilt erst als gefüllt, wenn es zu mindestens 90 % abgedeckt ist.
- Kommen mehr als 2 s keine Daten, werden die Werte abgedunkelt und mit „Keine Daten“ markiert.

## Höhe über Grund (AGL)

- **Berechnung:** GPS-Höhe über Meer (GGA Feld 9) minus Geländehöhe an der aktuellen Position.
  Der Geoid-Abstand wird dabei **nicht** addiert, weil das Gelände ebenfalls Höhen über Meer (LN02) enthält.
- **Gelände:** swisstopo swissALTIRegio, als 25-m-Raster in WGS84 (Schweiz mit ca. 10 km Rand).
  - Pro Rasterzelle steht der höchste Wert, das Gelände ist also eher zu hoch und die AGL eher zu klein.
  - Zwischen den vier Nachbarpunkten wird bilinear interpoliert. Das kann an Gipfeln und Graten wieder etwas tiefer liegen (siehe `agl-terrain/BERICHT.md`).
- **Kachel laden:** zuerst aus dem Speicher, dann aus der IndexedDB (`flugapp-terrain`), dann aus dem Netz.
  - Kacheln aus dem Netz werden in der IndexedDB gespeichert.
  - Die 8 Nachbarkacheln der aktuellen Position werden im Hintergrund mitgeladen.
- **Ohne Netz** geht es nur mit vorher gespeicherten Kacheln: *Einstellungen → Gelände → Gebiet offline speichern* (Radius um die aktuelle Position oder um eingegebene Koordinaten; 30 km ≈ 12 MB).
- Der Service Worker und „Neueste Version laden“ lassen die Geländedaten in Ruhe.
- Ausserhalb der Kacheln (z. B. Gardasee) zeigt der Kasten „ausserhalb der Geländedaten“.
- **Nur eine Näherung:** Das Modell enthält keine Bäume, Gebäude, Leitungen oder Seilbahnen, und die GPS-Höhe schwankt um mehrere Meter.
- Quelle: Bundesamt für Landestopografie swisstopo (swissALTIRegio, Open Government Data).
- **Kacheln aktualisieren:** in `agl-terrain/` neu erzeugen (siehe dortige README) und `output/tiles_25m/` nach `terrain/` kopieren.

## Tests

```
node --test tests/core.test.js
```

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
