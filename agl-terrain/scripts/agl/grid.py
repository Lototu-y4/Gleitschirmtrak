"""Kachelraster in WGS84 (EPSG:4326).

Entscheidung (siehe README): *Knoten-Registrierung* ("Posts").  Ein Rasterwert gehört zu einem Punkt
(lat, lon), nicht zu einer Fläche.  Jede Kachel ist genau tile_deg x tile_deg gross und enthält
(TR+1) x (TC+1) Punkte; der letzte Punkt jeder Kachel ist identisch mit dem ersten Punkt der Nachbarkachel
(1 Zeile / 1 Spalte Überlappung).  Dadurch braucht jede Höhenabfrage genau EINE Kachel.

  lat(R) = LAT_TOP  - R * (tile_deg / TR)      R = globale Zeilen-Nr. (ganzzahlig), 0 = Nordrand
  lon(C) = LON_LEFT + C * (tile_deg / TC)      C = globale Spalten-Nr.
  Kachel (ty, tx):  R = ty*TR + r (r = 0..TR),   C = tx*TC + c (c = 0..TC)
Alle Koordinaten werden aus ganzen Zahlen berechnet, nie durch Aufaddieren -> Randpunkte bit-identisch.
"""
from __future__ import annotations
import math
from dataclasses import dataclass

LAT_TOP = 48.0      # Nordrand des Rasters (Grad); Schweiz liegt bei 45.8–47.85 N
LON_LEFT = 5.8      # Westrand (Grad); Schweiz liegt bei 5.95–10.5 E
TILE_DEG = 0.1
M_PER_DEG_LAT = 111195.0
REF_LAT = 46.8      # Referenzbreite für die Länge-Schrittweite
NODATA = 65535


@dataclass(frozen=True)
class Grid:
    tr: int   # Zellen (Intervalle) pro Kachel in Breitenrichtung
    tc: int   # Zellen pro Kachel in Längenrichtung
    lat_top: float = LAT_TOP
    lon_left: float = LON_LEFT
    tile_deg: float = TILE_DEG

    @classmethod
    def fuer_aufloesung(cls, res_m: float) -> "Grid":
        tr = max(1, round(M_PER_DEG_LAT * TILE_DEG / res_m))
        tc = max(1, round(M_PER_DEG_LAT * math.cos(math.radians(REF_LAT)) * TILE_DEG / res_m))
        return cls(tr, tc)

    @property
    def dlat(self) -> float:
        return self.tile_deg / self.tr

    @property
    def dlon(self) -> float:
        return self.tile_deg / self.tc

    @property
    def res_lat_m(self) -> float:
        return self.dlat * M_PER_DEG_LAT

    @property
    def res_lon_m(self) -> float:
        return self.dlon * M_PER_DEG_LAT * math.cos(math.radians(REF_LAT))

    def lat_of(self, R: int) -> float:
        return self.lat_top - R * self.dlat

    def lon_of(self, C: int) -> float:
        return self.lon_left + C * self.dlon

    def tile_of(self, lat: float, lon: float) -> tuple[int, int]:
        """Kachel-Index (ty, tx), die den Punkt enthält (Südost-Randpunkte gehören zur Nachbarkachel)."""
        ty = math.floor((self.lat_top - lat) / self.tile_deg)
        tx = math.floor((lon - self.lon_left) / self.tile_deg)
        return ty, tx

    def tile_bounds(self, ty: int, tx: int):
        """(west, süd, ost, nord) der Eckpunkte der Kachel."""
        return (self.lon_of(tx * self.tc), self.lat_of((ty + 1) * self.tr),
                self.lon_of((tx + 1) * self.tc), self.lat_of(ty * self.tr))

    def to_dict(self) -> dict:
        return dict(lat_top=self.lat_top, lon_left=self.lon_left, tile_deg=self.tile_deg,
                    cells_per_tile_lat=self.tr, cells_per_tile_lon=self.tc,
                    step_lat_deg=self.dlat, step_lon_deg=self.dlon,
                    approx_res_lat_m=round(self.res_lat_m, 2), approx_res_lon_m=round(self.res_lon_m, 2),
                    approx_res_note=f"Länge bei {REF_LAT} N gerechnet")
