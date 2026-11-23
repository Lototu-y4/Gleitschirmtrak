"""Schritt 1: swissALTIRegio (10 m COG, Gesamtabdeckung) streifenweise laden.

Warum Streifen?  Die COG auf data.geo.admin.ch ist ~10 GB gross und umfasst auch halb Süddeutschland, Ost-
frankreich usw. Wir lesen per HTTP-Range-Requests nur den Ausschnitt "Schweiz + Puffer" (CH_BBOX_LV95) und
speichern ihn in horizontalen Streifen (je 1024 Zeilen = 4 COG-Blöcke) als lokale GeoTIFFs in raw/swissaltiregio/.
  * vorhandene Streifen werden übersprungen, Abbruch -> einfach nochmal starten
  * Streifen werden als *.part geschrieben und erst nach erfolgreichem Schliessen umbenannt
  * ganz leere Streifen bekommen nur eine Markierungsdatei *.leer
Die URL wird jedes Mal live aus der STAC-API gelesen (nichts hartkodiert ausser der Item-URL).
"""
from __future__ import annotations
import argparse, json, math, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.windows import Window

from .config import CH_BBOX_LV95, RAW, STAC_ITEM_URL, QUELLE

STREIFEN_ZEILEN = 1024
RAW_DIR = RAW / "swissaltiregio"


def stac_cog_info() -> dict:
    r = requests.get(STAC_ITEM_URL, timeout=60)
    r.raise_for_status()
    item = r.json()
    for name, a in item["assets"].items():
        if name.endswith(".tif"):
            return {"name": name, "href": a["href"], "updated": a.get("updated"),
                    "checksum": a.get("checksum:multihash"), "item_updated": item["properties"].get("updated")}
    raise RuntimeError("Kein .tif-Asset im STAC-Item gefunden")


def streifen_plan(src_transform, src_w, src_h, bbox=CH_BBOX_LV95, zeilen=STREIFEN_ZEILEN):
    """Liefert (col_off, width, [(row_off, height), ...]) ausgerichtet auf das 256er-Blockraster der COG."""
    e0, n0, e1, n1 = bbox
    ox, oy, px = src_transform.c, src_transform.f, src_transform.a
    c0 = max(0, int(math.floor((e0 - ox) / px / 256)) * 256)
    c1 = min(src_w, int(math.ceil((e1 - ox) / px / 256)) * 256)
    r0 = max(0, int(math.floor((oy - n1) / px / 256)) * 256)
    r1 = min(src_h, int(math.ceil((oy - n0) / px / 256)) * 256)
    rows = [(r, min(zeilen, r1 - r)) for r in range(r0, r1, zeilen)]
    return c0, c1 - c0, rows


def _lade_streifen(url, ziel: Path, col_off, width, row_off, height, profile_basis, retries=5):
    leer = ziel.with_suffix(".leer")
    if ziel.exists() or leer.exists():
        return ziel.name, "vorhanden", 0
    part = ziel.with_suffix(".tif.part")
    env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
               GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES", GDAL_HTTP_MULTIPLEX="YES", GDAL_HTTP_VERSION="2",
               VSI_CACHE="TRUE", VSI_CACHE_SIZE=str(256 * 1024 * 1024), CPL_VSIL_CURL_CACHE_SIZE=str(256 * 1024 * 1024),
               GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2")
    for versuch in range(retries):
        try:
            with rasterio.Env(**env):
                with rasterio.open("/vsicurl/" + url) as src:
                    win = Window(col_off, row_off, width, height)
                    data = src.read(1, window=win)
                    tr = src.window_transform(win)
                    nd = src.nodata
            gueltig = (data != nd) & np.isfinite(data) & (data < 1e30)
            if not gueltig.any():
                leer.write_text("alles nodata\n")
                return ziel.name, "leer", 0
            prof = dict(driver="GTiff", dtype="float32", count=1, width=width, height=height, crs="EPSG:2056",
                        transform=tr, nodata=nd, tiled=True, blockxsize=256, blockysize=256,
                        compress="DEFLATE", predictor=3, zlevel=6)
            with rasterio.open(part, "w", **prof) as dst:
                dst.write(data, 1)
                dst.update_tags(SOURCE=QUELLE, SOURCE_URL=url)
            os.replace(part, ziel)
            return ziel.name, "geladen", ziel.stat().st_size
        except Exception as e:  # Netzwerkfehler etc.
            if part.exists():
                part.unlink()
            if versuch == retries - 1:
                raise
            time.sleep(3 * (versuch + 1))


def main(argv=None):
    ap = argparse.ArgumentParser(description="swissALTIRegio-Ausschnitt streifenweise laden")
    ap.add_argument("--limit", type=int, default=0, help="nur die ersten N fehlenden Streifen laden (Test)")
    ap.add_argument("--threads", type=int, default=3)
    ap.add_argument("--bbox", type=float, nargs=4, metavar=("E0", "N0", "E1", "N1"), default=list(CH_BBOX_LV95),
                    help="Ausschnitt in LV95 (EPSG:2056)")
    a = ap.parse_args(argv)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    info = stac_cog_info()
    print("STAC:", info["name"], "| aktualisiert", info["item_updated"])
    (RAW_DIR / "stac_info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        with rasterio.open("/vsicurl/" + info["href"]) as src:
            tr, w, h = src.transform, src.width, src.height
    c0, width, rows = streifen_plan(tr, w, h, tuple(a.bbox))
    print(f"Ausschnitt: {width} Spalten x {sum(r[1] for r in rows)} Zeilen in {len(rows)} Streifen")
    jobs = []
    for row_off, hgt in rows:
        ziel = RAW_DIR / f"streifen_r{row_off:05d}_c{c0:05d}.tif"
        jobs.append((ziel, row_off, hgt))
    todo = [j for j in jobs if not j[0].exists() and not j[0].with_suffix(".leer").exists()]
    print(f"{len(jobs) - len(todo)} vorhanden, {len(todo)} fehlen")
    if a.limit:
        todo = todo[:a.limit]
    t0 = time.time()
    total = 0
    with ThreadPoolExecutor(a.threads) as ex:
        futs = {ex.submit(_lade_streifen, info["href"], z, c0, width, r, hg, None): z for z, r, hg in todo}
        for i, f in enumerate(as_completed(futs), 1):
            name, status, size = f.result()
            total += size
            print(f"[{i}/{len(todo)}] {name}: {status} {size/1e6:.1f} MB  ({time.time()-t0:.0f}s)", flush=True)
    print(f"Fertig. Neu geschrieben: {total/1e6:.1f} MB in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
