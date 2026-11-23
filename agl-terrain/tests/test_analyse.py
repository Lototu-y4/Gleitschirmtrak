import zipfile

import numpy as np
import pytest

from agl import analyse
from agl.igc_extract import entpacke


def test_bodengeschwindigkeit_und_phasen():
    n = 60
    t = np.arange(n, dtype=float)
    lat = 47.0 + np.concatenate([np.zeros(10), np.arange(40) * 1e-4, np.full(10, 39e-4)])   # 10 s steht, 40 s ~11 m/s, 10 s steht
    lon = np.full(n, 8.0)
    v = analyse.bodengeschwindigkeit(t, lat, lon)
    assert v[:8].max() < 0.5 and v[-8:].max() < 0.5
    assert v[20:40] == pytest.approx(11.1195, abs=0.05)
    i0, i1 = analyse.phasen(v)
    assert 8 <= i0 <= 12 and 48 <= i1 <= 52


def test_entpacken_ignoriert_pfade_und_fremde_dateien(tmp_path):
    z = tmp_path / "x.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("../../evil.igc", "AXXX\n")       # Zip-Slip-Versuch -> landet flach im Zielordner
        zf.writestr("ordner/ok.IGC", "AXXX\n")
        zf.writestr("readme.exe", "nein")
    ziel = tmp_path / "ziel"
    dateien = entpacke(z, ziel)
    assert sorted(p.name for p in dateien) == ["evil.igc", "ok.IGC"]
    assert not (tmp_path / "evil.igc").exists()
    assert not (ziel / "readme.exe").exists()
