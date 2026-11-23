"""IGC-Parser (nur B-Zeilen und die wenigen Kopfzeilen, die wir brauchen).

IGC-Spezifikation (FAI Technical Specification, Anhang A), B-Satz:
  B HHMMSS DDMMmmm N/S DDDMMmmm E/W V/A PPPPP GGGGG [Erweiterungen]
  Pos  1   1-6    7-13   14   15-22    23   24  25-29 30-35
Breite/Länge sind Grad + Minuten mit 3 Dezimalstellen der Minute (= 1/1000 Minute).
Optionale I-Zeilen-Erweiterungen LAD/LOD liefern weitere Dezimalstellen (1/10000, 1/100000 Min.).
PPPPP = Druckhöhe (ISA 1013.25 hPa, kann negativ sein "-0012"), GGGGG = GPS-Höhe in m.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


@dataclass
class Fix:
    t: datetime          # UTC
    lat: float           # Grad, WGS84
    lon: float
    valid: bool          # 'A' = 3D-Fix, 'V' = 2D/ungültig
    p_alt: int           # Druckhöhe [m] (ISA)
    g_alt: int           # GPS-Höhe [m]


@dataclass
class Flug:
    pfad: str
    datum: date | None
    fixes: list[Fix] = field(default_factory=list)
    header: dict[str, str] = field(default_factory=dict)
    warnungen: list[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        return Path(self.pfad).stem


_B_RE = re.compile(rb"^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])([AV])(-\d{4}|\d{5})(-\d{4}|\d{5})")


def _parse_i(zeile: str) -> dict[str, tuple[int, int]]:
    """I-Zeile: 'I' NN (SSFFCCC)*  -> {Code: (start, ende)} mit 1-basierten, inklusiven Byte-Positionen."""
    out = {}
    try:
        n = int(zeile[1:3])
        for k in range(n):
            s = zeile[3 + 7 * k: 3 + 7 * (k + 1)]
            out[s[4:7]] = (int(s[0:2]), int(s[2:4]))
    except ValueError:
        pass
    return out


def parse_igc(pfad: str | Path) -> Flug:
    pfad = Path(pfad)
    roh = pfad.read_bytes()
    zeilen = roh.replace(b"\r\n", b"\n").replace(b"\r", b"\n").split(b"\n")
    flug = Flug(pfad=str(pfad), datum=None)
    ext: dict[str, tuple[int, int]] = {}
    tag_offset = 0
    letzte_sek = None
    for z in zeilen:
        if not z:
            continue
        kopf = z[:1]
        if kopf == b"H":
            s = z.decode("latin-1")
            if s.startswith("HFDTE"):
                m = re.search(r"(\d{2})(\d{2})(\d{2})", s[5:])  # HFDTEDDMMYY oder HFDTE:DDMMYY,NN
                if m:
                    d, mo, y = map(int, m.groups())
                    flug.datum = date(2000 + y if y < 80 else 1900 + y, mo, d)
            elif ":" in s or len(s) > 5:
                k, _, v = s[2:].partition(":")
                flug.header[k.strip()] = v.strip()
        elif kopf == b"I":
            ext = _parse_i(z.decode("latin-1"))
        elif kopf == b"B":
            m = _B_RE.match(z)
            if not m:
                flug.warnungen.append(f"B-Zeile nicht lesbar: {z[:40]!r}")
                continue
            hh, mm, ss, la_d, la_m, ns, lo_d, lo_m, ew, av, pa, ga = m.groups()
            la_min = int(la_m) / 1000.0     # MMmmm -> Minuten
            lo_min = int(lo_m) / 1000.0
            lad = ext.get("LAD")
            lod = ext.get("LOD")
            if lad and len(z) >= lad[1]:
                la_min += int(z[lad[0] - 1:lad[1]]) / (10 ** (3 + (lad[1] - lad[0] + 1)))
            if lod and len(z) >= lod[1]:
                lo_min += int(z[lod[0] - 1:lod[1]]) / (10 ** (3 + (lod[1] - lod[0] + 1)))
            lat = int(la_d) + la_min / 60.0
            lon = int(lo_d) + lo_min / 60.0
            if ns == b"S":
                lat = -lat
            if ew == b"W":
                lon = -lon
            sek = int(hh) * 3600 + int(mm) * 60 + int(ss)
            if letzte_sek is not None and sek < letzte_sek - 3600:
                tag_offset += 1  # Mitternachts-Überlauf
            letzte_sek = sek
            if flug.datum is None:
                flug.warnungen.append("HFDTE fehlt, Datum unbekannt")
                flug.datum = date(1970, 1, 1)
            t = datetime(flug.datum.year, flug.datum.month, flug.datum.day, tzinfo=timezone.utc) \
                + timedelta(days=tag_offset, seconds=sek)
            flug.fixes.append(Fix(t, lat, lon, av == b"A", int(pa), int(ga)))
    return flug
