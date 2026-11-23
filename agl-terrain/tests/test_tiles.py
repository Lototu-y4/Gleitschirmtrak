"""Umrechnung LV95 -> WGS84-Kacheln: synthetisches Raster mit bekanntem Inhalt."""
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling

from agl import tiles
from agl.grid import Grid, NODATA
from agl.tilefmt import kachel_pfad, lese_kachel, schreibe_kachel

TY, TX = 10, 16        # Kachel um Bern (lat 46.9–47.0, lon 7.4–7.5)
E0, N1 = 2590000.0, 1215000.0


@pytest.fixture(scope="module")
def synth(tmp_path_factory):
    d = tmp_path_factory.mktemp("raw")
    h, w = 3500, 3000
    arr = np.full((h, w), 500.0, dtype=np.float32)
    # Spitze: ein einzelnes Pixel (10 m) mit 900 m
    spike_row, spike_col = int((N1 - 1200005) / 10), int((2603005 - E0) / 10)
    arr[spike_row, spike_col] = 900.0
    arr[:1200, :] = 3.4e38                      # Nodata im Norden (N > 1203000, Nord = obere Zeilen)
    prof = dict(driver="GTiff", dtype="float32", count=1, width=w, height=h, crs="EPSG:2056",
                transform=from_origin(E0, N1, 10, 10), nodata=3.4e38)
    with rasterio.open(d / "streifen_a.tif", "w", **prof) as dst:
        dst.write(arr, 1)
    vrt = tiles.baue_vrt(d)
    return vrt, (spike_row, spike_col)


def test_max_resampling_behaelt_spitze(synth):
    vrt, _ = synth
    grid = Grid.fuer_aufloesung(25)
    with rasterio.open(vrt) as ds:
        mx = tiles.berechne_kachel(ds, grid, TY, TX, Resampling.max)
        av = tiles.berechne_kachel(ds, grid, TY, TX, Resampling.average)
    assert mx.shape == (grid.tr + 1, grid.tc + 1) and mx.dtype == np.uint16
    # Die 900-m-Spitze (= 9000 dm) muss im 25-m-Raster mindestens einmal komplett erhalten bleiben ...
    gueltig = mx != NODATA
    assert mx[gueltig].max() == 9000
    # ... und der Rest ist 500 m (5000 dm) bzw. Nodata.
    assert set(np.unique(mx)) <= {5000, 9000, NODATA}
    # Gegenprobe: Mittelwert-Resampling würde die Spitze verschlucken -> der Test unterscheidet also wirklich.
    assert av[av != NODATA].max() < 6000


def test_dezimeter_aufrunden_und_nodata():
    h = np.array([434.0, 434.04, 434.0000001, 4634.0, -9999.0, np.nan], dtype=np.float32)
    dm = tiles._to_dm(h)
    assert list(dm[:4]) == [4340, 4341, 4340, 46340]       # aufrunden (konservativ), kein Float-Rauschen-Sprung
    assert dm[4] == NODATA and dm[5] == NODATA


def test_nodata_bereich_wird_65535(synth):
    vrt, _ = synth
    grid = Grid.fuer_aufloesung(25)
    # Kachel (10,16) reicht bis lat 47.0 (N ~ 1205300) -> der Nordrand liegt im Nodata-Bereich
    with rasterio.open(vrt) as ds:
        arr = tiles.berechne_kachel(ds, grid, TY, TX)
    assert (arr == NODATA).any() and (arr != NODATA).any()
    assert (arr[0, :] == NODATA).all()                     # Nordrand liegt im Nodata-Streifen


def test_kachel_ohne_daten_ist_none(synth):
    vrt, _ = synth
    grid = Grid.fuer_aufloesung(25)
    with rasterio.open(vrt) as ds:
        assert tiles.berechne_kachel(ds, grid, 40, 40) is None


def test_randpunkte_benachbarter_kacheln_identisch(synth):
    """Ost-Rand von Kachel (ty,tx) == West-Rand von (ty,tx+1) usw. (Überlappung)."""
    vrt, _ = synth
    grid = Grid.fuer_aufloesung(25)
    with rasterio.open(vrt) as ds:
        a = tiles.berechne_kachel(ds, grid, 10, 16)
        b = tiles.berechne_kachel(ds, grid, 10, 17)
        c = tiles.berechne_kachel(ds, grid, 11, 16)
    assert a is not None and b is not None and c is not None
    assert np.array_equal(a[:, -1], b[:, 0])
    assert np.array_equal(a[-1, :], c[0, :])


def test_kachelformat_roundtrip(tmp_path):
    grid = Grid(5, 4)
    arr = (np.arange(30, dtype=np.uint16).reshape(6, 5) * 1000).astype(np.uint16)
    arr[0, 0] = NODATA
    p = kachel_pfad(tmp_path, 3, 7)
    size = schreibe_kachel(p, arr)
    assert size == p.stat().st_size > 0
    assert np.array_equal(lese_kachel(p, grid), arr)
    assert p.read_bytes()[:2] == b"\x1f\x8b"              # gzip-Magic


def test_groessenuebersicht():
    idx = {"kacheln": {"1_1": 100_000, "1_2": 250_000, "2_2": 50_000}}
    g = tiles.groessenuebersicht(idx)
    assert g["anzahl"] == 3 and g["gesamt_bytes"] == 400_000
    assert g["groesste_kachel"] == "1_2" and g["groesste_bytes"] == 250_000
    assert "0.40 MB" in tiles.formatiere_groessen(g)
    assert tiles.groessenuebersicht({"kacheln": {}})["anzahl"] == 0


def test_grid_aufloesung_und_ganzzahlige_kanten():
    g = Grid.fuer_aufloesung(25)
    assert 24 < g.res_lat_m < 26 and 24 < g.res_lon_m < 26
    g10 = Grid.fuer_aufloesung(10)
    assert 9.9 < g10.res_lat_m < 10.1
    # Randpunkt von Kachel tx == Anfangspunkt von tx+1 (bit-identisch)
    assert g.lon_of(16 * g.tc + g.tc) == g.lon_of(17 * g.tc)
    assert g.lat_of(10 * g.tr + g.tr) == g.lat_of(11 * g.tr)
    assert g.tile_of(46.95, 7.44) == (10, 16)


def test_naehte_angleichen_nimmt_maximum_und_behandelt_nodata(tmp_path):
    g = Grid(4, 3)
    a = np.full((5, 4), 1000, dtype=np.uint16)
    b = np.full((5, 4), 1000, dtype=np.uint16)
    s = np.full((5, 4), 1000, dtype=np.uint16)
    a[:, -1] = [10, 20, NODATA, 40, 50]
    b[:, 0] = [12, 18, 30, NODATA, 50]          # Ost-Nachbar (0,1)
    a[-1, :] = [1, 2, 3, 4]
    a[-1, -1] = 50                                # Ecke, bleibt konsistent
    s[0, :] = [0, 5, 3, 9]                        # Süd-Nachbar (1,0)
    for key, arr in (((0, 0), a), ((0, 1), b), ((1, 0), s)):
        schreibe_kachel(kachel_pfad(tmp_path, *key), arr)
    n = tiles.naehte_angleichen(tmp_path, g, ["0_0", "0_1", "1_0"])
    A, B, S = (lese_kachel(kachel_pfad(tmp_path, *k), g) for k in ((0, 0), (0, 1), (1, 0)))
    assert list(A[:, -1]) == list(B[:, 0]) == [12, 20, 30, 40, 50]
    assert list(A[-1, :]) == list(S[0, :]) == [1, 5, 3, 50]
    assert n == 3
