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
- **Einstellungen:** Berechnungsfenster, Anordnung der Kästen, Wake Lock, Offline-Cache.
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
| `tests/core.test.js` | Tests für Parser, Prüfsumme, Berechnungen und IGC-Export |

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
- Kommen mehr als 2 s keine Daten, werden die Werte abgedunkelt und mit „KEINE DATEN“ markiert.

## Tests

```
node --test tests/core.test.js
```

Die Tests laden die reinen Funktionen direkt aus `index.html`, aus dem Block zwischen `/*CORE-BEGIN*/` und `/*CORE-END*/`.

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
