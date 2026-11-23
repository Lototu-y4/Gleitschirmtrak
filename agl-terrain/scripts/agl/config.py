"""Zentrale Konstanten."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "raw"
OUT = ROOT / "output"

QUELLE = "Federal Office of Topography swisstopo"
QUELLE_LANG = ("Federal Office of Topography swisstopo – swissALTIRegio (10 m DTM), "
               "https://www.swisstopo.admin.ch/en/height-model-swissaltiregio, Open Government Data (OGD)")

STAC_ITEM_URL = ("https://data.geo.admin.ch/api/stac/v0.9/collections/"
                 "ch.swisstopo.swissaltiregio/items/swissaltiregio")

# Ausschnitt für den Download in LV95 (EPSG:2056): Schweiz + FL (E 2485071–2833837, N 1075269–1295934)
# plus ca. 10 km Puffer. Ausserhalb der Landesgrenze enthält swissALTIRegio Daten der Nachbarländer, die wir behalten.
CH_BBOX_LV95 = (2475000.0, 1065000.0, 2845000.0, 1306000.0)  # (E_min, N_min, E_max, N_max)

NODATA_U16 = 65535
