# Gelände-Kacheln der Schweiz für „Höhe über Grund“ (AGL)

Werkzeug für den **Eigengebrauch (Gleitschirmfliegen, nur Schweiz)**: lädt das Höhenmodell swissALTIRegio von swisstopo,
rechnet es in ein WGS84-Raster aus kleinen Kacheln um, die eine Web-App (z. B. Bluefy/iOS) offline laden kann, und prüft das
Ergebnis gegen eigene IGC-Flüge.

> **Quelle:** Federal Office of Topography swisstopo – swissALTIRegio (10 m, Open Government Data).
> **Wichtig:** Das Modell (DTM) enthält **keine Bäume und keine Gebäude**, die GPS-Höhe schwankt. Die berechnete Höhe über Grund
> ist eine **Näherung** und darf **nicht das einzige Sicherheitsinstrument** sein.

## Voraussetzungen

* Windows, Python 3.11, Internet (einmalig ~1,9 GB Download). Node.js ist optional (nur für den JS-Vergleichstest).
* Die virtuelle Umgebung liegt bewusst **an einem kurzen Pfad** (`C:\agl-venv`): im tiefen Projektpfad lud `rasterio`
  die GDAL-DLLs nicht („Dateiname zu lang“).

```powershell
python -m venv C:\agl-venv
C:\agl-venv\Scripts\python -m pip install -r requirements.txt
```

Alle Befehle im Projektordner. `-I` (isolierter Modus) wird verwendet, weil die Skripte fremde Daten (IGC) lesen.

## Befehle

| Schritt | Befehl | Ergebnis |
|---|---|---|
| 1. Download | `C:\agl-venv\Scripts\python -I scripts\01_download.py` | `raw/swissaltiregio/streifen_*.tif` (24 Streifen, ~1,9 GB), fortsetzbar |
| 2. Kacheln 25 m | `C:\agl-venv\Scripts\python -I scripts\02_build_tiles.py --res 25` | `output/tiles_25m/` (1140 Kacheln, ~219 MB), ~15 s |
| 2b. Kacheln 10 m (Testgebiet) | `C:\agl-venv\Scripts\python -I scripts\02_build_tiles.py --res 10 --igc igc\extrahiert --out output\tiles_10m_testgebiet` | nur Kacheln, die die Flüge berühren |
| 2c. Einzelnes Gebiet in 10 m | `... 02_build_tiles.py --res 10 --bbox 7.6 45.9 7.9 46.1 --out output\tiles_10m_wallis` | beliebiger WGS84-Ausschnitt (W S E N) |
| 3. Prüfung | `C:\agl-venv\Scripts\python -I scripts\03_verify_terrain.py output\tiles_25m` | `output/verifikation/verifikation_25m.md` |
| 4. Flüge | `C:\agl-venv\Scripts\python -I scripts\04_analyze_flights.py` | `output/analyse/` (Grafiken, CSV, `zusammenfassung.md`) |
| Grössen | `C:\agl-venv\Scripts\python -I scripts\05_groessen.py output\tiles_25m` | Anzahl, Gesamtgrösse, grösste Kachel |
| Tests | `C:\agl-venv\Scripts\python -m pytest -q tests` | 21 Tests |
| Demo | `python -m http.server 8765` im Projektordner, dann `http://127.0.0.1:8765/js/demo.html` | Höhe an Koordinate abfragen |

Die ZIP mit den Flügen liegt in `igc/zip/`, entpackt wird sie in `igc/extrahiert/` (nur `*.igc`, Pfade werden verworfen).
Bereits vorhandene Dateien/Kacheln werden übersprungen; zum Neuerzeugen den Ausgabeordner löschen.

## Entscheidungen

| Thema | Entscheidung | Grund |
|---|---|---|
| Datenquelle | STAC-Item `swissaltiregio` der Collection `ch.swisstopo.swissaltiregio`, Asset `swissaltiregio_2056_5728.tif` (COG, 10 m, LV95 + LN02) | Die „tiled“-Items liefern nur `.xyz.zip`; die Gesamt-COG (10 GB, mit halb Süddeutschland usw.) erlaubt HTTP-Range-Reads |
| Download | nur Ausschnitt Schweiz + FL + ~10 km Puffer (LV95 E 2 475 000–2 845 000, N 1 065 000–1 306 000), in 24 Streifen à 1024 Zeilen | ~1,9 statt 10 GB; Streifen = Wiederaufnahme nach Abbruch (`.part` → Umbenennen) |
| Nachbarländer | Daten innerhalb dieses Rechtecks bleiben erhalten | Nützlich an der Grenze; ausserhalb des Rechtecks (z. B. Gardasee) gibt es keine Kacheln → `null` |
| Raster | WGS84, **Knoten-Registrierung**, Kachel = 0,1° × 0,1°, 445 × 304 Intervalle (446 × 305 Punkte) → 0,000224719° (24,99 m) in Breite, 0,000328947° (25,04 m) in Länge; Randpunkte doppelt | Jede Abfrage braucht genau **eine** Kachel; JS/Python-Parität einfach. Auflösung per `--res` (10 m: 1112 × 761) |
| Resampling | GDAL `max`, Dezimeter **aufgerundet** (`ceil`) | Gelände eher zu hoch → AGL eher zu klein (konservativ) |
| Nähte | Randpunkte benachbarter Kacheln werden auf das Maximum beider Werte angeglichen | GDAL-Näherung der Fussabdrücke liess ~4 % der Nähte um einzelne Punkte abweichen (bis ~8 m im Steilgelände) |
| Zahlenformat | `uint16` little-endian, **Dezimeter**, 65535 = keine Daten, zeilenweise, Zeile 0 = Nord | ohne Bibliothek lesbar |
| Kompression | gzip (Stufe 9, Header ohne Zeitstempel) | `DecompressionStream('gzip')` ist in Safari/WebKit ab iOS 16.4 verfügbar (aus der Dokumentation, **auf iOS/Bluefy nicht getestet**; getestet: Node 24 und Chromium); Brotli gibt es dort nicht. Sendet ein Server schon `Content-Encoding: gzip`, erkennt `terrain.js` das an den fehlenden Magic-Bytes `1f 8b` |
| Höhenbezug | LN02 (orthometrisch) wie im Original | wird in `index.json` und im Bericht genannt |
| Format bewusst simpel | kein Byte-Shuffle/Delta | gemessen: Byte-Shuffle −29 %, Shuffle+Delta −36 % (≈ 156 bzw. 140 statt 219 MB, an 20 Probekacheln gemessen). Wenn Platz knapp wird, ist das die erste Stellschraube |

### Kachelnamen und Index

`tiles/{ty}_{tx}.u16.gz` mit `ty = floor((lat_top − lat) / tile_deg)`, `tx = floor((lon − lon_left) / tile_deg)`
(`lat_top = 48,0`, `lon_left = 5,8`; `tx` kann für Randgebiete **negativ** sein, z. B. `0_-1`).
Punkt `(r, c)` einer Kachel: `lat = lat_top − (ty·TR + r)·(0,1/TR)`, `lon = lon_left + (tx·TC + c)·(0,1/TC)`.
`index.json` enthält Gradschritte, Kachelgrösse, Ursprung, Format, Einheit, Nodata, Kachelliste mit Dateigrösse, Quelle, Datum.

### JavaScript (`js/terrain.js`, ES-Modul, keine Abhängigkeiten)

```js
import { ladeIndex, Gelaende } from "./terrain.js";
const g = new Gelaende(await ladeIndex("tiles_25m/"), "tiles_25m/");
await g.ladeUmgebung(lat, lon);     // Kachel laden (async, danach im Speicher)
const h = g.hoeheAn(lat, lon);      // Meter (LN02) oder null (Kachel fehlt/nicht geladen/Nodata)
// AGL = gpsHoehe - h   (nur wenn h !== null)
```

`hoeheAn` ist synchron und liest nur aus dem Speicher; vor dem ersten Aufruf `ladeUmgebung` (oder `hoeheAnAsync`) aufrufen.
Der Byte-Lader ist austauschbar (3. Konstruktor-Argument), z. B. für Cache/IndexedDB. Python-Gegenstück: `scripts/agl/terrain.py`.

## Quellenangabe

Federal Office of Topography swisstopo (swissALTIRegio). Der Hinweis steht in `index.json` (`quelle`, `quelle_lang`), in den Grafiken und hier.

Ergebnisse, Toleranzen und offene Punkte: siehe [BERICHT.md](BERICHT.md).
