"""Schritt 2: LV95-Rohdaten -> WGS84-Kacheln (uint16, Dezimeter, Max-Resampling) + index.json + Grössenübersicht."""
from __future__ import annotations
import argparse, json, time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject, transform_bounds

from .config import NODATA_U16, OUT, QUELLE, QUELLE_LANG, RAW
from .grid import Grid
from .tilefmt import kachel_pfad, lese_kachel, schreibe_kachel

SRC_NODATA = 3.4e38
DST_NODATA_F = -9999.0
RESAMPLING = {"max": Resampling.max, "bilinear": Resampling.bilinear, "nearest": Resampling.nearest,
              "average": Resampling.average}


# ----------------------------------------------------------------------------- Quelle (VRT)
def baue_vrt(raw_dir: Path) -> Path:
    """Mosaik aller Streifen als VRT (von Hand erzeugt, kein gdalbuildvrt nötig). Pfade relativ."""
    files = sorted(raw_dir.glob("streifen_*.tif"))
    if not files:
        raise SystemExit(f"Keine Rohdaten in {raw_dir}. Zuerst scripts/01_download.py ausführen.")
    infos = []
    for f in files:
        with rasterio.open(f) as ds:
            infos.append((f.name, ds.transform, ds.width, ds.height))
    px = infos[0][1].a
    xmin = min(i[1].c for i in infos)
    ymax = max(i[1].f for i in infos)
    xmax = max(i[1].c + i[2] * px for i in infos)
    ymin = min(i[1].f - i[3] * px for i in infos)
    W, H = round((xmax - xmin) / px), round((ymax - ymin) / px)
    src = []
    for name, tr, w, h in infos:
        xo, yo = round((tr.c - xmin) / px), round((ymax - tr.f) / px)
        src.append(
            f'    <SimpleSource><SourceFilename relativeToVRT="1">{name}</SourceFilename><SourceBand>1</SourceBand>\n'
            f'      <SourceProperties RasterXSize="{w}" RasterYSize="{h}" DataType="Float32" BlockXSize="256" BlockYSize="256"/>\n'
            f'      <SrcRect xOff="0" yOff="0" xSize="{w}" ySize="{h}"/><DstRect xOff="{xo}" yOff="{yo}" xSize="{w}" ySize="{h}"/></SimpleSource>')
    srs = rasterio.crs.CRS.from_epsg(2056).to_wkt().replace("&", "&amp;").replace("<", "&lt;")
    nl = "\n"
    vrt = (f'<VRTDataset rasterXSize="{W}" rasterYSize="{H}">\n  <SRS>{srs}</SRS>\n'
           f'  <GeoTransform>{xmin}, {px}, 0, {ymax}, 0, {-px}</GeoTransform>\n'
           f'  <VRTRasterBand dataType="Float32" band="1"><NoDataValue>{SRC_NODATA}</NoDataValue>\n'
           f'{nl.join(src)}\n  </VRTRasterBand>\n</VRTDataset>')
    p = raw_dir / "mosaik.vrt"
    p.write_text(vrt, encoding="utf-8")
    return p


# ----------------------------------------------------------------------------- Kachel berechnen
def _to_dm(h: np.ndarray) -> np.ndarray:
    """Meter (float, Nodata) -> uint16 Dezimeter. AUFRUNDEN (ceil): Gelände eher zu hoch als zu tief,
    damit AGL eher zu klein ausfällt (konservativ). Das 1e-3 verhindert, dass Float-Rauschen (z. B. 434.0000001)
    einen ganzen Dezimeter hinzufügt."""
    out = np.full(h.shape, NODATA_U16, dtype=np.uint16)
    ok = np.isfinite(h) & (h > DST_NODATA_F + 1) & (h < 6000)
    dm = np.ceil(h[ok].astype(np.float64) * 10.0 - 1e-3)
    out[ok] = np.clip(dm, 0, NODATA_U16 - 1).astype(np.uint16)
    return out


def berechne_kachel(src_ds, grid: Grid, ty: int, tx: int, resampling=Resampling.max):
    """uint16-Array (TR+1, TC+1) oder None, wenn die Kachel keine Daten enthält."""
    rows, cols = grid.tr + 1, grid.tc + 1
    lon0 = grid.lon_of(tx * grid.tc)
    lat0 = grid.lat_of(ty * grid.tr)
    # Knoten-Registrierung: Zellmitte der Zielzelle = Gitterpunkt
    dst_tr = Affine(grid.dlon, 0, lon0 - grid.dlon / 2, 0, -grid.dlat, lat0 + grid.dlat / 2)
    dst = np.full((rows, cols), DST_NODATA_F, dtype=np.float32)
    reproject(source=rasterio.band(src_ds, 1), destination=dst, dst_transform=dst_tr, dst_crs="EPSG:4326",
              src_nodata=SRC_NODATA, dst_nodata=DST_NODATA_F, resampling=resampling, init_dest_nodata=True,
              num_threads=1)
    out = _to_dm(dst)
    if (out == NODATA_U16).all():
        return None
    return out


_WORKER = {}


def _init_worker(vrt, grid, resampling_name, outdir):
    _WORKER["ds"] = rasterio.open(vrt)
    _WORKER["grid"] = grid
    _WORKER["rs"] = RESAMPLING[resampling_name]
    _WORKER["out"] = Path(outdir)


def _job(tile):
    ty, tx = tile
    pfad = kachel_pfad(_WORKER["out"], ty, tx)
    if pfad.exists():
        return ty, tx, pfad.stat().st_size, "vorhanden"
    arr = berechne_kachel(_WORKER["ds"], _WORKER["grid"], ty, tx, _WORKER["rs"])
    if arr is None:
        return ty, tx, 0, "leer"
    return ty, tx, schreibe_kachel(pfad, arr), "neu"


def kachel_kandidaten(vrt: Path, grid: Grid, bbox_wgs84=None):
    """Alle Kachel-Indizes, die den Rohdaten-Ausschnitt (oder bbox_wgs84 = (W,S,E,N)) berühren könnten."""
    with rasterio.open(vrt) as ds:
        w, s, e, n = transform_bounds(ds.crs, "EPSG:4326", *ds.bounds, densify_pts=101)
    if bbox_wgs84:
        w, s, e, n = max(w, bbox_wgs84[0]), max(s, bbox_wgs84[1]), min(e, bbox_wgs84[2]), min(n, bbox_wgs84[3])
    ty0, tx0 = grid.tile_of(n, w)
    ty1, tx1 = grid.tile_of(s, e)
    return [(ty, tx) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]


def _max_ohne_nodata(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Elementweise Maximum; Nodata (65535) zählt als 'fehlt'."""
    xv, yv = x != NODATA_U16, y != NODATA_U16
    return np.where(xv & yv, np.maximum(x, y), np.where(xv, x, y)).astype(np.uint16)


def naehte_angleichen(outdir: Path, grid: Grid, keys) -> int:
    """GDAL rechnet die Zielzellen am Rand zweier Nachbarkacheln mit leicht unterschiedlichen Näherungen
    der Quell-Fussabdrücke (bis 0.125 Pixel) -> einzelne Randpunkte weichen ab (auf steilem Gelände bis
    mehrere Meter). Wir gleichen die doppelten Randpunkte an: Maximum beider Werte (konservativ).
    Reihenfolge Ost-Nähte, dann Süd-Nähte macht auch die gemeinsamen Eckpunkte aller vier Kacheln gleich.
    Gibt die Anzahl der geänderten Kacheln zurück."""
    menge = {tuple(map(int, k.split("_"))) for k in keys}
    geaendert = set()
    for richtung in ("ost", "sued"):
        for (ty, tx) in sorted(menge):
            nb = (ty, tx + 1) if richtung == "ost" else (ty + 1, tx)
            if nb not in menge:
                continue
            pa, pb = kachel_pfad(outdir, ty, tx), kachel_pfad(outdir, *nb)
            a, b = lese_kachel(pa, grid).copy(), lese_kachel(pb, grid).copy()
            if richtung == "ost":
                m = _max_ohne_nodata(a[:, -1], b[:, 0])
                da, db = not np.array_equal(a[:, -1], m), not np.array_equal(b[:, 0], m)
                a[:, -1], b[:, 0] = m, m
            else:
                m = _max_ohne_nodata(a[-1, :], b[0, :])
                da, db = not np.array_equal(a[-1, :], m), not np.array_equal(b[0, :], m)
                a[-1, :], b[0, :] = m, m
            if da:
                schreibe_kachel(pa, a); geaendert.add((ty, tx))
            if db:
                schreibe_kachel(pb, b); geaendert.add(nb)
    return len(geaendert)


def kandidaten_aus_igc(igc_ordner: Path, grid: Grid):
    """Kacheln, die von IGC-Fixes berührt werden (für ein 10-m-Testgebiet nur um die eigenen Flüge).
    Mehr als diese Kacheln braucht die Abfrage nicht: jede Abfrage nutzt genau eine Kachel."""
    from .igc import parse_igc
    out = set()
    for p in sorted(Path(igc_ordner).glob("*.[iI][gG][cC]")):
        for f in parse_igc(p).fixes:
            if f.valid:
                out.add(grid.tile_of(f.lat, f.lon))
    return sorted(out)


# ----------------------------------------------------------------------------- index.json + Grössen
def groessenuebersicht(index: dict) -> dict:
    sizes = list(index["kacheln"].values())
    if not sizes:
        return dict(anzahl=0, gesamt_bytes=0, groesste_bytes=0, groesste_kachel=None, mittel_bytes=0)
    gross = max(index["kacheln"].items(), key=lambda kv: kv[1])
    return dict(anzahl=len(sizes), gesamt_bytes=int(sum(sizes)), groesste_bytes=int(gross[1]),
                groesste_kachel=gross[0], mittel_bytes=int(sum(sizes) / len(sizes)))


def formatiere_groessen(g: dict) -> str:
    return (f"Anzahl Kacheln : {g['anzahl']}\n"
            f"Gesamtgrösse   : {g['gesamt_bytes'] / 1e6:.2f} MB\n"
            f"Mittel/Kachel  : {g['mittel_bytes'] / 1e3:.0f} kB\n"
            f"Grösste Kachel : {g['groesste_kachel']} = {g['groesste_bytes'] / 1e3:.0f} kB")


def schreibe_index(outdir: Path, grid: Grid, res_m: float, resampling: str, tiles: dict) -> dict:
    index = dict(
        name="swisstopo-terrain-wgs84",
        beschreibung="Geländehöhen (DTM, ohne Bäume/Gebäude) als WGS84-Raster, Kacheln, für Höhe-über-Grund-Berechnung",
        quelle=QUELLE, quelle_lang=QUELLE_LANG,
        erstellt=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        zielaufloesung_m=res_m,
        grid=grid.to_dict(),
        registrierung="Knoten (Gitterpunkte); Randpunkte jeder Kachel doppelt (Überlappung 1 Punkt)",
        kachel=dict(zeilen=grid.tr + 1, spalten=grid.tc + 1, datentyp="uint16", byte_order="little-endian",
                    anordnung="zeilenweise, Zeile 0 = Nordrand, Spalte 0 = Westrand",
                    kompression="gzip", dateimuster="tiles/{ty}_{tx}.u16.gz",
                    ty="floor((lat_top - lat) / tile_deg)", tx="floor((lon - lon_left) / tile_deg)"),
        einheit="Dezimeter (Wert/10 = Meter)", nodata=NODATA_U16,
        hoehenbezug="LN02, orthometrische Höhen (EPSG:5728) wie im swissALTIRegio-Original; NICHT ellipsoidisch",
        resampling=f"{resampling} (höchster Wert der Ursprungszellen pro Zielzelle); Dezimeter aufgerundet",
        kacheln=tiles,
    )
    index["summe"] = groessenuebersicht(index)
    (outdir / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return index


def main(argv=None):
    ap = argparse.ArgumentParser(description="WGS84-Kacheln aus swissALTIRegio erzeugen")
    ap.add_argument("--res", type=float, default=25.0, help="Zielauflösung in Metern (Standard 25)")
    ap.add_argument("--resampling", choices=list(RESAMPLING), default="max")
    ap.add_argument("--out", type=Path, default=None, help="Ausgabeordner (Standard output/tiles_<res>m)")
    ap.add_argument("--bbox", type=float, nargs=4, metavar=("W", "S", "E", "N"), default=None,
                    help="nur Kacheln in diesem WGS84-Ausschnitt (z. B. Testgebiet in 10 m)")
    ap.add_argument("--igc", type=Path, default=None,
                    help="Ordner mit IGC-Dateien: nur Kacheln erzeugen, die diese Flüge berühren (Testgebiet)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--raw", type=Path, default=RAW / "swissaltiregio")
    a = ap.parse_args(argv)

    grid = Grid.fuer_aufloesung(a.res)
    outdir = a.out or OUT / f"tiles_{a.res:g}m"
    outdir.mkdir(parents=True, exist_ok=True)
    vrt = baue_vrt(a.raw)
    cands = kachel_kandidaten(vrt, grid, a.bbox)
    if a.igc:
        erlaubt = set(cands)
        cands = [t for t in kandidaten_aus_igc(a.igc, grid) if t in erlaubt]
    print(f"Raster: {grid.tr}x{grid.tc} Zellen/Kachel, ~{grid.res_lat_m:.2f} m (Breite) x ~{grid.res_lon_m:.2f} m (Länge); "
          f"{len(cands)} Kandidaten-Kacheln; Resampling={a.resampling}", flush=True)
    t0 = time.time()
    tiles: dict = {}
    with ProcessPoolExecutor(a.workers, initializer=_init_worker,
                             initargs=(str(vrt), grid, a.resampling, str(outdir))) as ex:
        for i, (ty, tx, size, status) in enumerate(ex.map(_job, cands, chunksize=4), 1):
            if size:
                tiles[f"{ty}_{tx}"] = size
            if i % 50 == 0 or i == len(cands):
                print(f"  {i}/{len(cands)} ({time.time()-t0:.0f}s) Kacheln mit Daten: {len(tiles)}", flush=True)
    n_ang = naehte_angleichen(outdir, grid, tiles)
    print(f"Nähte angeglichen: {n_ang} Kacheln geändert")
    tiles = {k: kachel_pfad(outdir, *map(int, k.split("_"))).stat().st_size for k in tiles}   # Grössen nach dem Angleichen
    index = schreibe_index(outdir, grid, a.res, a.resampling, tiles)
    print(formatiere_groessen(index["summe"]))
    return index


if __name__ == "__main__":
    main()
