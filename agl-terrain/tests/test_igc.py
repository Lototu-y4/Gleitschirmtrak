from datetime import datetime, timezone

import pytest

from agl.igc import parse_igc


def schreibe(tmp_path, zeilen, name="t.igc"):
    p = tmp_path / name
    p.write_bytes(("\r\n".join(zeilen) + "\r\n").encode("latin-1"))
    return p


def test_koordinaten_und_hoehen(tmp_path):
    # Breite 47°05.916' N, Länge 008°46.375' E, Druckhöhe 01329, GPS 01330
    p = schreibe(tmp_path, ["AXXX", "HFDTE300526", "B1205184705916N00846375EA0132901330"])
    f = parse_igc(p)
    fx = f.fixes[0]
    assert fx.lat == pytest.approx(47 + 5.916 / 60, abs=1e-9)
    assert fx.lon == pytest.approx(8 + 46.375 / 60, abs=1e-9)
    assert fx.p_alt == 1329 and fx.g_alt == 1330
    assert fx.valid
    assert fx.t == datetime(2026, 5, 30, 12, 5, 18, tzinfo=timezone.utc)


def test_sued_west_und_negative_hoehe_und_v_fix(tmp_path):
    p = schreibe(tmp_path, ["HFDTE010120", "B0000013330000S07012345WV-001200050"])
    fx = parse_igc(p).fixes[0]
    assert fx.lat == pytest.approx(-(33 + 30.000 / 60))
    assert fx.lon == pytest.approx(-(70 + 12.345 / 60))
    assert fx.p_alt == -12 and fx.g_alt == 50
    assert not fx.valid


def test_lad_lod_erweiterung(tmp_path):
    # I-Zeile: 2 Erweiterungen, LAD auf Byte 36-37, LOD auf 38-39 -> je 2 zusätzliche Dezimalstellen der Minute
    zeile = "B1205184705916N00846375EA0132901330" + "12" + "34"
    p = schreibe(tmp_path, ["HFDTE300526", "I023637LAD3839LOD", zeile])
    fx = parse_igc(p).fixes[0]
    assert fx.lat == pytest.approx(47 + 5.91612 / 60, abs=1e-10)
    assert fx.lon == pytest.approx(8 + 46.37534 / 60, abs=1e-10)


def test_mitternacht(tmp_path):
    p = schreibe(tmp_path, ["HFDTE311225", "B2359584705916N00846375EA0132901330", "B0000024705916N00846375EA0132901330"])
    f = parse_igc(p)
    assert f.fixes[1].t == datetime(2026, 1, 1, 0, 0, 2, tzinfo=timezone.utc)
    assert (f.fixes[1].t - f.fixes[0].t).total_seconds() == 4


def test_kaputte_zeile_wird_gemeldet(tmp_path):
    p = schreibe(tmp_path, ["HFDTE300526", "B12051847", "B1205184705916N00846375EA0132901330"])
    f = parse_igc(p)
    assert len(f.fixes) == 1 and len(f.warnungen) == 1
