"""Python-Abfrage der Kacheln – arbeitet exakt wie js/terrain.js (gleiche Formeln, gleiche Reihenfolge).

    t = Terrain(Path("output/tiles_25m"))
    t.hoehe_an(46.5, 8.0)            # Meter (LN02) oder None
    t.hoehe_an(46.5, 8.0, interpolieren=False)   # nächster Gitterpunkt
"""
from __future__ import annotations
import json
import math
from pathlib import Path

from .grid import Grid, NODATA
from .tilefmt import kachel_pfad, lese_kachel


class Terrain:
    def __init__(self, ordner: Path | str, cache_max: int = 64):
        self.ordner = Path(ordner)
        self.index = json.loads((self.ordner / "index.json").read_text(encoding="utf-8"))
        g = self.index["grid"]
        self.grid = Grid(g["cells_per_tile_lat"], g["cells_per_tile_lon"], g["lat_top"], g["lon_left"], g["tile_deg"])
        self.kacheln = self.index["kacheln"]
        self._cache: dict = {}
        self._cache_max = cache_max

    def kachel(self, ty: int, tx: int):
        """Kachel-Array (TR+1, TC+1) uint16 oder None, wenn nicht vorhanden."""
        key = f"{ty}_{tx}"
        if key not in self.kacheln:
            return None
        a = self._cache.get(key)
        if a is None:
            if len(self._cache) >= self._cache_max:
                self._cache.pop(next(iter(self._cache)))
            a = lese_kachel(kachel_pfad(self.ordner, ty, tx), self.grid)
            self._cache[key] = a
        return a

    def hoehe_an(self, lat: float, lon: float, interpolieren: bool = True):
        g = self.grid
        rf = (g.lat_top - lat) / g.dlat
        cf = (lon - g.lon_left) / g.dlon
        if not (math.isfinite(rf) and math.isfinite(cf)):
            return None
        if not interpolieren:
            R, C = math.floor(rf + 0.5), math.floor(cf + 0.5)      # nächster Punkt
            ty, tx = R // g.tr, C // g.tc
            a = self.kachel(ty, tx)
            if a is None:
                return None
            v = int(a[R - ty * g.tr, C - tx * g.tc])
            return None if v == NODATA else v / 10.0
        R0, C0 = math.floor(rf), math.floor(cf)
        fr, fc = rf - R0, cf - C0
        ty, tx = R0 // g.tr, C0 // g.tc          # Python: Floor-Division, auch für negative Werte korrekt
        a = self.kachel(ty, tx)
        if a is None:
            return None
        r, c = R0 - ty * g.tr, C0 - tx * g.tc    # r in 0..TR-1, c in 0..TC-1  -> r+1, c+1 liegen in derselben Kachel
        v00, v01 = int(a[r, c]), int(a[r, c + 1])
        v10, v11 = int(a[r + 1, c]), int(a[r + 1, c + 1])
        if NODATA in (v00, v01, v10, v11):
            return None
        v = (1 - fr) * ((1 - fc) * v00 + fc * v01) + fr * ((1 - fc) * v10 + fc * v11)
        return v / 10.0
