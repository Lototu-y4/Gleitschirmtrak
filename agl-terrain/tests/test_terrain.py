"""Abfrage (Python) und Gleichheit Python <-> JavaScript an einem kleinen synthetischen Kachelsatz."""
import json
import random
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from agl import tiles
from agl.grid import Grid, NODATA
from agl.terrain import Terrain
from agl.tilefmt import kachel_pfad, schreibe_kachel

ROOT = Path(__file__).resolve().parents[1]
GRID = Grid(10, 8)              # kleine Kacheln: 10 x 8 Intervalle (11 x 9 Punkte) pro 0.1 Grad


def hoehe_modell(lat, lon):
    """Lineare Fläche (Meter): bilinear interpoliert muss sie exakt (bis auf dm-Rundung) herauskommen."""
    return 400.0 + 3000.0 * (lat - 47.0) + 2000.0 * (lon - 6.0)


@pytest.fixture(scope="module")
def kachelordner(tmp_path_factory):
    out = tmp_path_factory.mktemp("tiles")
    eintraege = {}
    for ty in range(0, 2):
        for tx in range(0, 2):
            if (ty, tx) == (1, 1):
                continue                                   # fehlende Kachel
            arr = np.zeros((GRID.tr + 1, GRID.tc + 1), dtype=np.uint16)
            for r in range(GRID.tr + 1):
                for c in range(GRID.tc + 1):
                    lat = GRID.lat_of(ty * GRID.tr + r)
                    lon = GRID.lon_of(tx * GRID.tc + c)
                    arr[r, c] = round(hoehe_modell(lat, lon) * 10)
            if (ty, tx) == (0, 0):
                arr[4, 3] = NODATA                           # ein Nodata-Punkt
            eintraege[f"{ty}_{tx}"] = schreibe_kachel(kachel_pfad(out, ty, tx), arr)
    tiles.schreibe_index(out, GRID, 0, "max", eintraege)
    return out


def zufallspunkte(n, seed=1):
    rnd = random.Random(seed)
    # Gebiet: Kacheln (0,0),(0,1),(1,0) und die fehlende (1,1), plus ein Stück ausserhalb
    return [(48.0 - rnd.uniform(-0.02, 0.22), 5.8 + rnd.uniform(-0.02, 0.22)) for _ in range(n)]


def test_bilinear_trifft_lineare_flaeche_ueber_kachelgrenzen(kachelordner):
    t = Terrain(kachelordner)
    gepruft = 0
    for lat, lon in zufallspunkte(500):
        h = t.hoehe_an(lat, lon)
        if h is None:
            continue
        assert h == pytest.approx(hoehe_modell(lat, lon), abs=0.06)    # nur dm-Rundung
        gepruft += 1
    assert gepruft > 200


def test_nodata_fehlende_kachel_ausserhalb_geben_none(kachelordner):
    t = Terrain(kachelordner)
    r, c = 4, 3                                    # Nodata-Punkt in Kachel (0,0)
    lat, lon = GRID.lat_of(r), GRID.lon_of(c)
    assert t.hoehe_an(lat, lon) is None            # genau auf dem Nodata-Punkt
    assert t.hoehe_an(lat + 0.3 * GRID.dlat, lon - 0.3 * GRID.dlon) is None   # in einer Zelle, die ihn berührt
    assert t.hoehe_an(lat - 3 * GRID.dlat, lon + 3 * GRID.dlon) is not None   # weiter weg: ok
    assert t.hoehe_an(47.92, 5.95) is not None
    # fehlende Kachel (1,1): lat 47.8–47.9, lon 5.9–6.0
    assert t.hoehe_an(47.85, 5.95) is None
    # komplett ausserhalb
    assert t.hoehe_an(50.0, 12.0) is None
    assert t.hoehe_an(float("nan"), 8.0) is None


def test_nearest(kachelordner):
    t = Terrain(kachelordner)
    lat, lon = GRID.lat_of(2), GRID.lon_of(2)
    assert t.hoehe_an(lat, lon, interpolieren=False) == pytest.approx(hoehe_modell(lat, lon), abs=0.06)


@pytest.mark.skipif(shutil.which("node") is None, reason="node nicht installiert")
@pytest.mark.parametrize("modus", ["bilinear", "nearest"])
def test_python_und_javascript_stimmen_ueberein(kachelordner, tmp_path, modus):
    pts = zufallspunkte(300, seed=7)
    pj, aj = tmp_path / "p.json", tmp_path / "a.json"
    pj.write_text(json.dumps(pts))
    cmd = ["node", str(ROOT / "js" / "abfrage_cli.mjs"), str(kachelordner), str(pj), str(aj)]
    if modus == "nearest":
        cmd.append("nearest")
    subprocess.run(cmd, check=True, capture_output=True, timeout=60)
    js = json.loads(aj.read_text())
    t = Terrain(kachelordner)
    n_werte = 0
    for (lat, lon), h_js in zip(pts, js):
        h_py = t.hoehe_an(lat, lon, interpolieren=(modus == "bilinear"))
        if h_py is None:
            assert h_js is None, (lat, lon)
        else:
            assert h_js == pytest.approx(h_py, abs=1e-9), (lat, lon)
            n_werte += 1
    assert n_werte > 100
