# BLE-Test XCTracer

Wegwerf-Test, um zu prüfen, ob Web Bluetooth auf dem iPhone mit dem XCTracer Mini V zuverlässig funktioniert.
Die App besteht aus einer einzigen Datei, `index.html`, ohne Build-Schritt und ohne Abhängigkeiten.

Web Bluetooth funktioniert nur über **HTTPS**. GitHub Pages liefert das automatisch.

## Mit GitHub Pages veröffentlichen (nur im Browser, ohne Git)

1. Auf <https://github.com> anmelden, oben rechts **+** → **New repository**.
2. Einen Namen eintragen, z. B. `ble-test`, und **Public** wählen. Dann **Create repository**.
3. Auf der Repository-Seite **uploading an existing file** (oder **Add file → Upload files**) wählen.
   Dann `index.html` (und optional diese `README.md`) hineinziehen und **Commit changes** klicken.
4. Im Repository **Settings** → links **Pages** öffnen.
5. Unter **Build and deployment** bei **Source** die Option **Deploy from a branch** wählen,
   Branch **main** und Ordner **/ (root)** einstellen, dann **Save**.
6. Nach ca. 1–2 Minuten erscheint oben die Adresse, z. B.
   `https://DEIN-BENUTZERNAME.github.io/ble-test/`.

Für ein späteres Update `index.html` erneut hochladen (gleicher Name überschreibt die Datei).
Nach etwa einer Minute ist die neue Version online. Falls das iPhone noch die alte Version anzeigt, die Seite neu laden.

## Auf dem iPhone benutzen

- **Bluefy:** App aus dem App Store installieren, die GitHub-Pages-Adresse öffnen und **Verbinden** tippen.
- **Safari + WebBLE:** Die Erweiterung installieren und unter *Einstellungen → Apps → Safari → Erweiterungen* aktivieren.
  Danach die Seite in Safari öffnen und der Erweiterung den Zugriff auf die Website erlauben.

Oben zeigt die Seite an, welche Schnittstelle sie gefunden hat (`navigator.bluetooth` oder `navigator.webble`).

## Hinweise zum Test

- Damit Services sichtbar werden, muss ihre UUID im Feld **Service-UUIDs** stehen.
  Die Liste wird im Browser gespeichert. Nach einer Änderung neu verbinden.
- Das Display während des Tests anlassen. iOS pausiert Seiten im Hintergrund, und das sieht dann aus wie ein Verbindungsabbruch.
- **Geparste Werte:** Für `$LXWP0` folgen die Feldbedeutungen dem Quellcode von XCSoar (allgemeiner LX-Parser und XCTracer-Parser).
  Für `$LK8EX1` sind Druck (Pa), Vario (cm/s), Temperatur und Höhen-Platzhalter 99999 belegt.
  Die übrigen „nicht verfügbar“-Werte und die Bedeutung des Batteriefelds sind in der Anzeige als *unsicher* markiert.
