# Verifikation 10 m – output\tiles_10m_testgebiet

Toleranzen: JS=Python ≤ 1 mm; Gipfel: publiziert vs. Roh-Max ≤ 4 m, Gitter-Max ≥ Roh-Max − 0.1 m; Seespiegel ± 1.0 m; Nähte exakt gleich.

| Prüfung | Ergebnis | Detail |
|---|---|---|
| A JS=Python (bilinear) | PASS | 300 Zufallspunkte, 300 mit Wert, max. Abweichung 0.0000 cm (Toleranz 0.1 cm), null-Unterschiede: 0, null (py/js): 0/0 |
| A JS=Python (nearest) | PASS | 300 Zufallspunkte, 300 mit Wert, max. Abweichung 0.0000 cm (Toleranz 0.1 cm), null-Unterschiede: 0, null (py/js): 0/0 |
| B Gipfel Dufourspitze | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B Gipfel Matterhorn | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B Gipfel Weisshorn | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B Gipfel Finsteraarhorn | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B Gipfel Jungfrau | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B Gipfel Piz Bernina | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B Gipfel Säntis | PASS | publiziert 2502 | Roh-Max(150 m) 2501.8 | Gitter-Max(175 m) 2501.8 | am Punkt: bilinear 2501.8, nächster 2501.8 |
| B See Genfersee | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B See Bodensee (Obersee) | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B See Zürichsee | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B See Neuenburgersee | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B See Vierwaldstättersee | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| B See Lago Maggiore | PASS | Nennspiegel ~193.5 | häufigster Wert 193.4 (117 von 1600 Rasterpunkten) | Toleranz ±1.0 m |
| B See Thunersee | SKIP | ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen |
| C Randpunkte benachbarter Kacheln identisch | PASS | 43 Nähte geprüft, 0 mit Abweichung |
| D Gitter(bilinear) minus Rohdaten(bilinear) | PASS | n=1500: Mittel +3.50 m, Median +2.55 m, 1%-Quantil +0.0 m, 99%-Quantil +14.2 m (positiv = Raster höher als Roh – erwartet bei Max-Resampling) |
