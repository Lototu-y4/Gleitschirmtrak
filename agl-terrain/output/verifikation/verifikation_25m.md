# Verifikation 25 m – output\tiles_25m

Toleranzen: JS=Python ≤ 1 mm; Gipfel: publiziert vs. Roh-Max ≤ 4 m, Gitter-Max ≥ Roh-Max − 0.1 m; Seespiegel ± 1.0 m; Nähte exakt gleich.

| Prüfung | Ergebnis | Detail |
|---|---|---|
| A JS=Python (bilinear) | PASS | 300 Zufallspunkte, 273 mit Wert, max. Abweichung 0.0000 cm (Toleranz 0.1 cm), null-Unterschiede: 0, null (py/js): 27/27 |
| A JS=Python (nearest) | PASS | 300 Zufallspunkte, 273 mit Wert, max. Abweichung 0.0000 cm (Toleranz 0.1 cm), null-Unterschiede: 0, null (py/js): 27/27 |
| B Gipfel Dufourspitze | PASS | publiziert 4634 | Roh-Max(150 m) 4634.2 | Gitter-Max(175 m) 4634.2 | am Punkt: bilinear 4627.824389120004, nächster 4634.2 |
| B Gipfel Matterhorn | PASS | publiziert 4478 | Roh-Max(150 m) 4477.0 | Gitter-Max(175 m) 4477.1 | am Punkt: bilinear 4475.985806800162, nächster 4477.1 |
| B Gipfel Weisshorn | PASS | publiziert 4506 | Roh-Max(150 m) 4504.0 | Gitter-Max(175 m) 4504.0 | am Punkt: bilinear 4492.694032799961, nächster 4492.3 |
| B Gipfel Finsteraarhorn | PASS | publiziert 4274 | Roh-Max(150 m) 4274.2 | Gitter-Max(175 m) 4274.3 | am Punkt: bilinear 4269.618934079922, nächster 4274.3 |
| B Gipfel Jungfrau | PASS | publiziert 4158 | Roh-Max(150 m) 4157.1 | Gitter-Max(175 m) 4157.2 | am Punkt: bilinear 4152.14439999992, nächster 4157.2 |
| B Gipfel Piz Bernina | PASS | publiziert 4049 | Roh-Max(150 m) 4047.1 | Gitter-Max(175 m) 4047.2 | am Punkt: bilinear 4037.1195000000102, nächster 4047.2 |
| B Gipfel Säntis | PASS | publiziert 2502 | Roh-Max(150 m) 2501.8 | Gitter-Max(175 m) 2501.8 | am Punkt: bilinear 2501.628800000004, nächster 2501.8 |
| B See Genfersee | PASS | Nennspiegel ~372.0 | häufigster Wert 372.2 (1559 von 1600 Rasterpunkten) | Toleranz ±1.0 m |
| B See Bodensee (Obersee) | PASS | Nennspiegel ~395.6 | häufigster Wert 395.6 (809 von 1600 Rasterpunkten) | Toleranz ±1.0 m |
| B See Zürichsee | PASS | Nennspiegel ~406.0 | häufigster Wert 406.0 (341 von 1600 Rasterpunkten) | Toleranz ±1.0 m |
| B See Neuenburgersee | PASS | Nennspiegel ~429.4 | häufigster Wert 429.3 (969 von 1600 Rasterpunkten) | Toleranz ±1.0 m |
| B See Vierwaldstättersee | PASS | Nennspiegel ~433.6 | häufigster Wert 433.6 (687 von 1600 Rasterpunkten) | Toleranz ±1.0 m |
| B See Lago Maggiore | PASS | Nennspiegel ~193.5 | häufigster Wert 193.5 (387 von 1600 Rasterpunkten) | Toleranz ±1.0 m |
| B See Thunersee | PASS | Nennspiegel ~557.8 | häufigster Wert 557.7 (451 von 1600 Rasterpunkten) | Toleranz ±1.0 m |
| C Randpunkte benachbarter Kacheln identisch | PASS | 2205 Nähte geprüft, 0 mit Abweichung |
| D Gitter(bilinear) minus Rohdaten(bilinear) | PASS | n=1384: Mittel +6.52 m, Median +4.37 m, 1%-Quantil -55.7 m, 99%-Quantil +74.8 m (positiv = Raster höher als Roh – erwartet bei Max-Resampling) |
