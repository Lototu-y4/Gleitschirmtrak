"""Kachelformat lesen/schreiben.

Datei: gzip( uint16 little-endian, Zeile für Zeile, Zeile 0 = Nordrand, Spalte 0 = Westrand ), (TR+1) x (TC+1) Werte,
Einheit Dezimeter, 65535 = keine Daten.  Kein Header (alles Nötige steht in index.json).
"""
from __future__ import annotations
import gzip
import numpy as np
from .grid import Grid, NODATA


def kachel_pfad(basis, ty, tx):
    return basis / "tiles" / f"{ty}_{tx}.u16.gz"


def schreibe_kachel(pfad, arr: np.ndarray) -> int:
    assert arr.dtype == np.uint16
    data = arr.astype("<u2", copy=False).tobytes()
    pfad.parent.mkdir(parents=True, exist_ok=True)
    tmp = pfad.with_suffix(".part")
    with open(tmp, "wb") as f:
        with gzip.GzipFile(fileobj=f, mode="wb", compresslevel=9, mtime=0) as gz:   # mtime=0: reproduzierbar
            gz.write(data)
    tmp.replace(pfad)
    return pfad.stat().st_size


def lese_kachel(pfad, grid: Grid) -> np.ndarray:
    with gzip.open(pfad, "rb") as f:
        data = f.read()
    a = np.frombuffer(data, dtype="<u2")
    if a.size != (grid.tr + 1) * (grid.tc + 1):
        raise ValueError(f"{pfad}: unerwartete Grösse {a.size}")
    return a.reshape(grid.tr + 1, grid.tc + 1)
