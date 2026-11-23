"""Schritt 3: Prüfung der Kacheln.
  A) JavaScript <-> Python an >= 200 Zufallspunkten (Toleranz: 1 mm; erwartet: identisch)
  B) bekannte Höhen: Gipfel (gegen veröffentlichte Höhe UND gegen das Maximum der Rohdaten) und Seespiegel
  C) Randpunkte benachbarter Kacheln identisch (Überlappung)
  D) Vergleich mit der Rohdaten-Referenz (bilinear auf LV95-10-m-Daten) an Zufallspunkten
Schreibt output/verifikation/verifikation.md und .json und gibt PASS/FAIL je Prüfung aus."""
from __future__ import annotations
import argparse, json, random, shutil, subprocess, sys
from pathlib import Path

import numpy as np

from .config import OUT, ROOT
from .grid import NODATA
from .rawref import RohRaster
from .terrain import Terrain

TOL_JS_PY_M = 0.001          # JS und Python rechnen gleich -> nur Rundungsrauschen erlaubt
TOL_GIPFEL_ROH_M = 4.0       # veröffentlichte Gipfelhöhe vs. Maximum der Rohdaten im 150-m-Umkreis
TOL_SEE_M = 1.0              # Seespiegel (Modus der Seeflächenwerte) vs. Nennwert
TOL_RASTER_MAX_M = 0.101     # Max-Resampling darf Rohmaximum nicht unterschreiten (0.1 m: Dezimeter-Rundung)

GIPFEL = [  # Name, lat, lon, veröffentlichte Höhe (m)
    ("Dufourspitze", 45.93694, 7.86694, 4634),
    ("Matterhorn", 45.97639, 7.65861, 4478),
    ("Weisshorn", 46.10139, 7.71583, 4506),
    ("Finsteraarhorn", 46.53722, 8.12611, 4274),
    ("Jungfrau", 46.53694, 7.96250, 4158),
    ("Piz Bernina", 46.38250, 9.90833, 4049),
    ("Säntis", 47.24944, 9.34333, 2502),
]
SEEN = [  # Name, (lat_min, lat_max, lon_min, lon_max), Nennspiegel m ü. M. (Näherung, ± wenige dm saisonal)
    ("Genfersee", (46.40, 46.48, 6.45, 6.62), 372.0),
    ("Bodensee (Obersee)", (47.55, 47.62, 9.25, 9.45), 395.6),
    ("Zürichsee", (47.22, 47.33, 8.55, 8.75), 406.0),
    ("Neuenburgersee", (46.85, 46.95, 6.75, 6.90), 429.4),
    ("Vierwaldstättersee", (46.97, 47.05, 8.35, 8.55), 433.6),
    ("Lago Maggiore", (45.95, 46.15, 8.65, 8.80), 193.5),
    ("Thunersee", (46.67, 46.74, 7.65, 7.85), 557.8),
]


def zufallspunkte(t: Terrain, n: int, seed: int) -> list[tuple[float, float]]:
    rnd = random.Random(seed)
    keys = list(t.kacheln)
    pts = []
    for _ in range(n):
        ty, tx = map(int, rnd.choice(keys).split("_"))
        w, s, e, nn = t.grid.tile_bounds(ty, tx)
        pts.append((rnd.uniform(s, nn), rnd.uniform(w, e)))
    return pts


def js_hoehen(ordner: Path, pts, modus="bilinear"):
    tmp = OUT / "verifikation" / "_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    pj, aj = tmp / "punkte.json", tmp / "js.json"
    pj.write_text(json.dumps(pts))
    cmd = ["node", str(ROOT / "js" / "abfrage_cli.mjs"), str(ordner), str(pj), str(aj)] + (["nearest"] if modus == "nearest" else [])
    subprocess.run(cmd, check=True, capture_output=True, timeout=600)
    return json.loads(aj.read_text())


def pruefe(ordner: Path, n_zufall: int = 300):
    t = Terrain(ordner)
    roh = RohRaster()
    res = {"ordner": str(ordner), "aufloesung_m": t.index["zielaufloesung_m"], "pruefungen": []}

    def add(name, ok, detail, skip=False):
        res["pruefungen"].append(dict(name=name, ok=bool(ok), detail=detail, uebersprungen=skip))
        print(("SKIP" if skip else "PASS" if ok else "FAIL"), name, "-", detail, flush=True)

    # A) JS <-> Python -------------------------------------------------------------------------
    pts = zufallspunkte(t, n_zufall, seed=42)
    for modus in ("bilinear", "nearest"):
        if shutil.which("node") is None:
            add(f"A JS=Python ({modus})", False, "node nicht gefunden – nicht geprüft")
            continue
        js = js_hoehen(ordner, pts, modus)
        diffs, nnull_py, nnull_js, mism = [], 0, 0, 0
        for (lat, lon), hj in zip(pts, js):
            hp = t.hoehe_an(lat, lon, interpolieren=(modus == "bilinear"))
            nnull_py += hp is None
            nnull_js += hj is None
            if (hp is None) != (hj is None):
                mism += 1
            elif hp is not None:
                diffs.append(abs(hp - hj))
        mx = max(diffs) if diffs else float("nan")
        add(f"A JS=Python ({modus})", mism == 0 and len(diffs) >= 200 and mx <= TOL_JS_PY_M,
            f"{len(pts)} Zufallspunkte, {len(diffs)} mit Wert, max. Abweichung {mx*100:.4f} cm "
            f"(Toleranz {TOL_JS_PY_M*100:.1f} cm), null-Unterschiede: {mism}, null (py/js): {nnull_py}/{nnull_js}")

    # B1) Gipfel -------------------------------------------------------------------------------
    gip = []
    for name, lat, lon, pub in GIPFEL:
        raw150 = roh.max_im_umkreis(lat, lon, 150)
        raw200 = roh.max_im_umkreis(lat, lon, 200)
        # Gitter: höchster Punkt im 175-m-Umkreis (Max-Resampling -> muss das Rohmaximum enthalten)
        g = t.grid
        best = None
        for dr in range(-int(200 / g.res_lat_m) - 2, int(200 / g.res_lat_m) + 3):
            for dc in range(-int(200 / g.res_lon_m) - 2, int(200 / g.res_lon_m) + 3):
                la = lat + dr * g.dlat
                lo = lon + dc * g.dlon
                dy, dx = (la - lat) * 111195, (lo - lon) * 111195 * 0.6845
                if dx * dx + dy * dy <= 175 ** 2:
                    h = t.hoehe_an(la, lo, interpolieren=False)
                    if h is not None and (best is None or h > best):
                        best = h
        interp = t.hoehe_an(lat, lon)
        nearest = t.hoehe_an(lat, lon, interpolieren=False)
        if best is None and interp is None and nearest is None:
            add(f"B Gipfel {name}", True, "ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen", skip=True)
            continue
        gip.append(dict(name=name, publiziert=pub, roh_max_150m=raw150, gitter_max_175m=best,
                        am_punkt_bilinear=interp, am_punkt_naechster=nearest))
        ok = (raw150 is not None and best is not None
              and abs(raw150 - pub) <= TOL_GIPFEL_ROH_M
              and best >= raw150 - TOL_RASTER_MAX_M and best <= (raw200 or raw150) + TOL_RASTER_MAX_M)
        add(f"B Gipfel {name}", ok,
            f"publiziert {pub} | Roh-Max(150 m) {raw150:.1f} | Gitter-Max(175 m) {best} | "
            f"am Punkt: bilinear {interp}, nächster {nearest}")
    res["gipfel"] = gip

    # B2) Seen ---------------------------------------------------------------------------------
    seen = []
    for name, (la0, la1, lo0, lo1), nominal in SEEN:
        werte, irgendwas = [], False
        for la in np.linspace(la0, la1, 40):
            for lo in np.linspace(lo0, lo1, 40):
                h = t.hoehe_an(float(la), float(lo), interpolieren=False)
                irgendwas |= h is not None
                if h is not None and abs(h - nominal) <= 3.0:
                    werte.append(h)
        if not irgendwas:
            add(f"B See {name}", True, "ausserhalb dieses Kachelsatzes (Testgebiet) – übersprungen", skip=True)
            continue
        if werte:
            vals, cnt = np.unique(np.round(werte, 1), return_counts=True)
            modus_h, n_modus = float(vals[cnt.argmax()]), int(cnt.max())
        else:
            modus_h, n_modus = None, 0
        ok = modus_h is not None and n_modus >= 20 and abs(modus_h - nominal) <= TOL_SEE_M
        seen.append(dict(name=name, nennwert=nominal, modus=modus_h, punkte_im_see=n_modus))
        add(f"B See {name}", ok, f"Nennspiegel ~{nominal} | häufigster Wert {modus_h} ({n_modus} von 1600 Rasterpunkten) | Toleranz ±{TOL_SEE_M} m")
    res["seen"] = seen

    # C) Nähte ---------------------------------------------------------------------------------
    nah_fehler = nah_gepr = 0
    for key in t.kacheln:
        ty, tx = map(int, key.split("_"))
        a = t.kachel(ty, tx)
        e = t.kachel(ty, tx + 1)
        s = t.kachel(ty + 1, tx)
        if e is not None:
            nah_gepr += 1
            nah_fehler += int(not np.array_equal(a[:, -1], e[:, 0]))
        if s is not None:
            nah_gepr += 1
            nah_fehler += int(not np.array_equal(a[-1, :], s[0, :]))
    add("C Randpunkte benachbarter Kacheln identisch", nah_fehler == 0, f"{nah_gepr} Nähte geprüft, {nah_fehler} mit Abweichung")
    res["naehte"] = dict(geprueft=nah_gepr, fehler=nah_fehler)

    # D) Referenz Rohdaten ---------------------------------------------------------------------
    d_bil, d_nn = [], []
    for lat, lon in zufallspunkte(t, 1500, seed=5):
        r = roh.bilinear(lat, lon)
        h = t.hoehe_an(lat, lon)
        hn = t.hoehe_an(lat, lon, interpolieren=False)
        if r is not None and h is not None:
            d_bil.append(h - r)
            d_nn.append(hn - r)
    d_bil, d_nn = np.array(d_bil), np.array(d_nn)
    stat = lambda d: dict(n=int(d.size), mittel=float(d.mean()), median=float(np.median(d)),
                          p01=float(np.percentile(d, 1)), p05=float(np.percentile(d, 5)),
                          p95=float(np.percentile(d, 95)), p99=float(np.percentile(d, 99)),
                          min=float(d.min()), max=float(d.max()))
    res["vs_rohdaten"] = dict(bilinear=stat(d_bil), naechster=stat(d_nn))
    b = res["vs_rohdaten"]["bilinear"]
    add("D Gitter(bilinear) minus Rohdaten(bilinear)", b["median"] >= -0.5 and b["mittel"] >= -0.5,
        f"n={b['n']}: Mittel {b['mittel']:+.2f} m, Median {b['median']:+.2f} m, 1%-Quantil {b['p01']:+.1f} m, "
        f"99%-Quantil {b['p99']:+.1f} m (positiv = Raster höher als Roh – erwartet bei Max-Resampling)")
    return res


def schreibe_bericht(res: dict, ziel: Path):
    ziel.mkdir(parents=True, exist_ok=True)
    name = f"verifikation_{res['aufloesung_m']:g}m"
    (ziel / f"{name}.json").write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
    L = [f"# Verifikation {res['aufloesung_m']:g} m – {res['ordner']}", "",
         "Toleranzen: JS=Python ≤ 1 mm; Gipfel: publiziert vs. Roh-Max ≤ 4 m, Gitter-Max ≥ Roh-Max − 0.1 m; "
         f"Seespiegel ± {TOL_SEE_M} m; Nähte exakt gleich.", "",
         "| Prüfung | Ergebnis | Detail |", "|---|---|---|"]
    for p in res["pruefungen"]:
        erg = "SKIP" if p.get("uebersprungen") else "PASS" if p["ok"] else "**FAIL**"
        L.append(f"| {p['name']} | {erg} | {p['detail']} |")
    (ziel / f"{name}.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("ordner", type=Path, nargs="?", default=OUT / "tiles_25m")
    a = ap.parse_args(argv)
    res = pruefe(a.ordner)
    schreibe_bericht(res, OUT / "verifikation")
    sys.exit(0 if all(p["ok"] for p in res["pruefungen"]) else 1)


if __name__ == "__main__":
    main()
