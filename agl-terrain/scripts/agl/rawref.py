"""Referenz direkt auf den LV95-Rohdaten (10 m): pyproj -> LV95, dann bilinear / Maximum im Umkreis.

Damit lassen sich die Effekte "Umrechnung nach WGS84 + Max-Resampling + Dezimeter" von den Effekten
der Quelldaten trennen. Nur zur Prüfung gedacht (liest aus dem Rohdaten-Mosaik, nicht für die App)."""
from __future__ import annotations
import math
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import Window

from .config import RAW

SRC_NODATA = 3.4e38


class RohRaster:
    def __init__(self, vrt: Path | None = None):
        self.ds = rasterio.open(vrt or RAW / "swissaltiregio" / "mosaik.vrt")
        self.tr = self.ds.transform
        self.px = self.tr.a
        self.fwd = Transformer.from_crs("EPSG:4326", "EPSG:2056", always_xy=True)

    def lv95(self, lat, lon):
        return self.fwd.transform(lon, lat)

    def _fenster(self, e0, n0, e1, n1):
        """Pixel-Fenster (col0,row0,breite,hoehe) für ein LV95-Rechteck, auf Datensatz beschnitten."""
        c0 = int(math.floor((e0 - self.tr.c) / self.px))
        c1 = int(math.ceil((e1 - self.tr.c) / self.px))
        r0 = int(math.floor((self.tr.f - n1) / self.px))
        r1 = int(math.ceil((self.tr.f - n0) / self.px))
        c0, r0 = max(c0, 0), max(r0, 0)
        c1, r1 = min(c1, self.ds.width), min(r1, self.ds.height)
        if c1 <= c0 or r1 <= r0:
            return None
        return c0, r0, c1 - c0, r1 - r0

    def lies(self, e0, n0, e1, n1):
        w = self._fenster(e0, n0, e1, n1)
        if w is None:
            return None, None
        c0, r0, bw, bh = w
        a = self.ds.read(1, window=Window(c0, r0, bw, bh)).astype(np.float64)
        a[(a > 1e30) | ~np.isfinite(a)] = np.nan
        return a, (c0, r0)

    def bilinear(self, lat, lon):
        """Bilinear zwischen den vier nächsten 10-m-Zellmitten (Rohdaten). None bei Nodata/ausserhalb."""
        e, n = self.lv95(lat, lon)
        cf = (e - self.tr.c) / self.px - 0.5
        rf = (self.tr.f - n) / self.px - 0.5
        c0, r0 = int(math.floor(cf)), int(math.floor(rf))
        a, _ = self.lies(self.tr.c + c0 * self.px, self.tr.f - (r0 + 2) * self.px,
                         self.tr.c + (c0 + 2) * self.px, self.tr.f - r0 * self.px)
        if a is None or a.shape != (2, 2) or np.isnan(a).any():
            return None
        fc, fr = cf - c0, rf - r0
        return float((1 - fr) * ((1 - fc) * a[0, 0] + fc * a[0, 1]) + fr * ((1 - fc) * a[1, 0] + fc * a[1, 1]))

    def max_im_umkreis(self, lat, lon, radius_m):
        """Höchster Rohwert (Zellmitten) im Kreis um den Punkt -> (hoehe, (lat_unused))."""
        e, n = self.lv95(lat, lon)
        a, off = self.lies(e - radius_m, n - radius_m, e + radius_m, n + radius_m)
        if a is None:
            return None
        c0, r0 = off
        rr, cc = np.mgrid[0:a.shape[0], 0:a.shape[1]]
        ee = self.tr.c + (c0 + cc + 0.5) * self.px
        nn = self.tr.f - (r0 + rr + 0.5) * self.px
        maske = ((ee - e) ** 2 + (nn - n) ** 2 <= radius_m ** 2) & ~np.isnan(a)
        return float(a[maske].max()) if maske.any() else None


def bilinear_array(roh: "RohRaster", lats, lons) -> np.ndarray:
    """Vektorisierte Version von RohRaster.bilinear für viele Punkte (liest das Umgebungsfenster einmal)."""
    lats, lons = np.asarray(lats, float), np.asarray(lons, float)
    e, n = roh.fwd.transform(lons, lats)
    e, n = np.asarray(e), np.asarray(n)
    out = np.full(lats.shape, np.nan)
    a, off = roh.lies(e.min() - 30, n.min() - 30, e.max() + 30, n.max() + 30)
    if a is None:
        return out
    c0, r0 = off
    cf = (e - roh.tr.c) / roh.px - 0.5 - c0
    rf = (roh.tr.f - n) / roh.px - 0.5 - r0
    ci, ri = np.floor(cf).astype(int), np.floor(rf).astype(int)
    ok = (ci >= 0) & (ri >= 0) & (ci + 1 < a.shape[1]) & (ri + 1 < a.shape[0])
    ci, ri, fc, fr = ci[ok], ri[ok], (cf - np.floor(cf))[ok], (rf - np.floor(rf))[ok]
    v = ((1 - fr) * ((1 - fc) * a[ri, ci] + fc * a[ri, ci + 1]) + fr * ((1 - fc) * a[ri + 1, ci] + fc * a[ri + 1, ci + 1]))
    out[ok] = v          # NaN, falls ein Nachbar Nodata ist
    return out
