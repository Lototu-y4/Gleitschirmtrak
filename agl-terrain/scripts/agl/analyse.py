"""Schritt 4: AGL (Höhe über Grund) für die IGC-Flüge berechnen und bewerten.

AGL = GPS-Höhe (IGC, Spalte GGGGG) - Geländehöhe (swisstopo-Kacheln).
Es wird KEIN Höhenversatz angewendet; der geschätzte Versatz wird nur ausgewiesen (Spalten *_offset* bzw. *_info*).

Varianten:  25m_bil  = 25-m-Kacheln, bilinear        25m_nn = 25-m-Kacheln, nächster Punkt
            10m_bil  = 10-m-Kacheln, bilinear        10m_nn = 10-m-Kacheln, nächster Punkt
            roh_bil  = Referenz: LV95-Rohdaten (10 m), bilinear, ohne Max-Resampling
"""
from __future__ import annotations
import argparse, csv, math, statistics as st
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .config import OUT, QUELLE, ROOT
from .igc import Flug, parse_igc
from .igc_extract import entpacke
from .rawref import RohRaster, bilinear_array
from .terrain import Terrain

STILL_MS = 2.0          # Bodengeschwindigkeit unter diesem Wert = "steht/geht" (Start- bzw. Landeplatz)
ZONE_START_S = 90       # nach dem Abheben bis hierhin gilt als "Startbereich"
ZONE_LANDUNG_S = 90     # vor dem Aufsetzen ab hier gilt als "Landebereich"
KLEIN_M = 10.0          # "sehr kleine AGL" = unter 10 m (ausserhalb Start/Landung)
M_LAT = 111195.0

VARIANTEN = ["25m_bil", "25m_nn", "10m_bil", "10m_nn", "roh_bil"]
HAUPT = "25m_bil"


@dataclass
class Analyse:
    flug: Flug
    t: np.ndarray            # Sekunden seit erstem Fix
    lat: np.ndarray
    lon: np.ndarray
    galt: np.ndarray
    speed: np.ndarray        # m/s, geglättet
    gelaende: dict           # Variante -> np.ndarray (NaN = keine Daten)
    start_still: slice       # stehende Fixes am Anfang
    land_still: slice        # stehende Fixes am Ende
    i_abheben: int
    i_aufsetzen: int
    zone: np.ndarray         # bool: Start-/Landebereich

    def agl(self, v=HAUPT):
        return self.galt - self.gelaende[v]


def bodengeschwindigkeit(t, lat, lon):
    dy = np.diff(lat) * M_LAT
    dx = np.diff(lon) * M_LAT * np.cos(np.radians((lat[1:] + lat[:-1]) / 2))
    dt = np.maximum(np.diff(t), 0.5)
    v = np.hypot(dx, dy) / dt
    v = np.concatenate([[v[0]], v]) if len(v) else np.zeros(1)
    k = 5                                            # gleitender Median (5 Fixes)
    pad = np.pad(v, (k // 2, k // 2), mode="edge")
    return np.median(np.lib.stride_tricks.sliding_window_view(pad, k), axis=1)


def phasen(speed):
    n = len(speed)
    i0 = 0
    while i0 < n and speed[i0] < STILL_MS:
        i0 += 1
    i1 = n
    while i1 > i0 and speed[i1 - 1] < STILL_MS:
        i1 -= 1
    return i0, i1            # [0,i0) steht am Anfang, [i1,n) steht am Ende


def lade_fluege(igc_ordner: Path):
    out = []
    for p in sorted(igc_ordner.glob("*.[iI][gG][cC]")):
        f = parse_igc(p)
        f.fixes = [x for x in f.fixes if x.valid and x.g_alt != 0]       # V-Fixes und GPS-Höhe 0 ausschliessen
        if len(f.fixes) > 10:
            out.append(f)
    return out


def analysiere(flug: Flug, terrains: dict, roh: RohRaster | None) -> Analyse:
    fx = flug.fixes
    t = np.array([(x.t - fx[0].t).total_seconds() for x in fx])
    lat = np.array([x.lat for x in fx])
    lon = np.array([x.lon for x in fx])
    galt = np.array([x.g_alt for x in fx], float)
    speed = bodengeschwindigkeit(t, lat, lon)
    gel = {}
    for name, (terr, interp) in terrains.items():
        gel[name] = np.array([np.nan if (h := terr.hoehe_an(a, b, interpolieren=interp)) is None else h
                              for a, b in zip(lat, lon)])
    if roh is not None:
        gel["roh_bil"] = bilinear_array(roh, lat, lon)
    i0, i1 = phasen(speed)
    zone = np.zeros(len(t), bool)
    zone[t <= (t[i0] if i0 < len(t) else 0) + ZONE_START_S] = True
    zone[t >= (t[min(i1, len(t) - 1)] if i1 > 0 else t[-1]) - ZONE_LANDUNG_S] = True
    return Analyse(flug, t, lat, lon, galt, speed, gel, slice(0, i0), slice(i1, len(t)), i0, i1, zone)


def _stat(x):
    x = x[np.isfinite(x)]
    if x.size == 0:
        return dict(n=0, min=np.nan, max=np.nan, median=np.nan, n_neg=0)
    return dict(n=int(x.size), min=float(x.min()), max=float(x.max()), median=float(np.median(x)), n_neg=int((x < 0).sum()))


def zeile(a: Analyse, offset_info: float | None) -> dict:
    agl = a.agl()
    ok = np.isfinite(agl)
    s = _stat(agl)
    n = len(a.t)
    kl = ok & (agl < KLEIN_M) & ~a.zone
    land = agl[a.land_still] if a.land_still.stop > a.land_still.start else agl[-1:]
    start = agl[a.start_still] if a.start_still.stop > a.start_still.start else agl[:1]
    fx0, fx1 = a.flug.fixes[0], a.flug.fixes[-1]
    d = dict(
        flug=a.flug.name, datum=str(a.flug.datum), fixes=n, dauer_min=round(a.t[-1] / 60, 1),
        start_lat=round(a.lat[0], 5), start_lon=round(a.lon[0], 5), land_lat=round(a.lat[-1], 5), land_lon=round(a.lon[-1], 5),
        gps_start_m=int(a.galt[0]), gps_landung_m=int(a.galt[-1]),
        gelaende_start_m=_r(a.gelaende[HAUPT][0]), gelaende_landung_m=_r(a.gelaende[HAUPT][-1]),
        agl_start_m=_r(np.nanmedian(start) if np.isfinite(start).any() else np.nan),
        agl_landung_m=_r(np.nanmedian(land) if np.isfinite(land).any() else np.nan),
        start_am_boden_erkannt=(a.start_still.stop - a.start_still.start) >= 5,
        landung_am_boden_erkannt=(a.land_still.stop - a.land_still.start) >= 5,
        agl_min_m=_r(s["min"]), agl_max_m=_r(s["max"]), agl_median_m=_r(s["median"]),
        n_negativ=s["n_neg"], anteil_negativ_prozent=round(100 * s["n_neg"] / max(s["n"], 1), 2),
        n_klein_ausserhalb_start_landung=int(kl.sum()), n_ohne_gelaende=int(n - ok.sum()),
    )
    if offset_info is not None and ok.any():
        k = agl[ok] + offset_info
        d["agl_min_m_mit_offset_nur_info"] = _r(k.min())
        d["n_negativ_mit_offset_nur_info"] = int((k < 0).sum())
    return d


def _r(x, nd=1):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def versatz_schaetzen(analysen):
    """Landeplatz-Versatz = GPS-Höhe minus Gelände an den stehenden Fixes am Ende der Aufzeichnung.
    Landewiesen sind meist flach -> robuster als der Start am Hang. Ergebnis wird NICHT angewendet."""
    per_flug = {}
    for a in analysen:
        if a.land_still.stop - a.land_still.start < 5:
            continue
        for v in ("25m_bil", "roh_bil"):
            if v in a.gelaende:
                d = (a.galt - a.gelaende[v])[a.land_still]
                d = d[np.isfinite(d)]
                if d.size >= 5:
                    per_flug.setdefault(a.flug.name, {})[v] = float(np.median(d))
    return per_flug


def plot_flug(a: Analyse, pfad: Path, offset_info):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    tm = a.t / 60
    agl = a.agl()
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 6.5), sharex=True, gridspec_kw=dict(height_ratios=[3, 2]))
    ax1.plot(tm, a.galt, color="#1f77b4", lw=1.1, label="GPS-Höhe (IGC)")
    ax1.fill_between(tm, a.gelaende[HAUPT], a.gelaende[HAUPT].min() - 50 if np.isfinite(a.gelaende[HAUPT]).any() else 0,
                     color="#8c6d46", alpha=0.35, label="Gelände (25 m, bilinear)")
    ax1.plot(tm, a.gelaende[HAUPT], color="#5a4326", lw=0.9)
    if "10m_bil" in a.gelaende and np.isfinite(a.gelaende["10m_bil"]).any():
        ax1.plot(tm, a.gelaende["10m_bil"], color="#2ca02c", lw=0.6, ls="--", label="Gelände (10 m, bilinear)")
    ax1.set_ylabel("Höhe [m]")
    ax1.legend(loc="upper right", fontsize=8)
    ax1.set_title(f"{a.flug.name}  ({a.flug.datum})   –   Quelle Gelände: {QUELLE}", fontsize=10)
    ax2.axhline(0, color="k", lw=0.8)
    ax2.plot(tm, agl, color="#d62728", lw=1.0, label="AGL = GPS − Gelände (25 m, bilinear)")
    if "10m_bil" in a.gelaende and np.isfinite(a.gelaende["10m_bil"]).any():
        ax2.plot(tm, a.galt - a.gelaende["10m_bil"], color="#2ca02c", lw=0.6, ls="--", label="AGL (10 m, bilinear)")
    neg = np.isfinite(agl) & (agl < 0)
    kl = np.isfinite(agl) & (agl >= 0) & (agl < KLEIN_M) & ~a.zone
    ax2.scatter(tm[neg], agl[neg], s=8, color="k", zorder=5, label=f"AGL < 0 ({neg.sum()} Fixes)")
    ax2.scatter(tm[np.isfinite(agl) & (agl < KLEIN_M) & ~a.zone], agl[np.isfinite(agl) & (agl < KLEIN_M) & ~a.zone],
                s=14, facecolors="none", edgecolors="orange", zorder=4, label=f"AGL < {KLEIN_M:.0f} m ausserhalb Start/Landung")
    ax2.axvspan(0, tm[min(a.i_abheben, len(tm) - 1)] + ZONE_START_S / 60, color="#aaaaaa", alpha=0.25)
    ax2.axvspan(tm[min(a.i_aufsetzen, len(tm) - 1)] - ZONE_LANDUNG_S / 60, tm[-1], color="#aaaaaa", alpha=0.25, label="Start-/Landebereich")
    if offset_info is not None:
        ax2.axhline(-offset_info, color="purple", lw=0.6, ls=":", label=f"(Info) Ø-Landeplatz-Versatz {offset_info:+.0f} m, nicht angewendet")
    ax2.set_ylabel("Höhe über Grund [m]")
    ax2.set_xlabel("Zeit seit Aufzeichnungsbeginn [min]")
    ax2.legend(loc="upper right", fontsize=7, ncol=2)
    fig.text(0.01, 0.005, "Modell ohne Bäume/Gebäude, GPS-Höhe schwankt: AGL ist eine Näherung, kein Sicherheitsinstrument.", fontsize=7, color="gray")
    fig.tight_layout(rect=(0, 0.015, 1, 1))
    fig.savefig(pfad, dpi=110)
    plt.close(fig)


def vergleich(analysen) -> list[dict]:
    """Pro Flug und Variante: AGL-Statistik, AGL am Landeplatz, Abweichung zur Roh-Referenz."""
    rows = []
    for a in analysen:
        ref = a.galt - a.gelaende["roh_bil"] if "roh_bil" in a.gelaende else None
        for v in VARIANTEN:
            if v not in a.gelaende or not np.isfinite(a.gelaende[v]).any():
                continue
            agl = a.galt - a.gelaende[v]
            s = _stat(agl)
            land = agl[a.land_still] if a.land_still.stop - a.land_still.start >= 5 else agl[-1:]
            land = land[np.isfinite(land)]
            r = dict(flug=a.flug.name, variante=v, n=s["n"], agl_min=_r(s["min"]), agl_median=_r(s["median"]), agl_max=_r(s["max"]),
                     n_negativ=s["n_neg"], agl_landung=_r(np.median(land)) if land.size else None)
            if ref is not None and v != "roh_bil":
                d = (agl - ref)[np.isfinite(agl) & np.isfinite(ref)]
                if d.size:
                    r.update(diff_roh_mittel=_r(d.mean(), 2), diff_roh_p05=_r(np.percentile(d, 5), 2),
                             diff_roh_p95=_r(np.percentile(d, 95), 2), diff_roh_absmax=_r(np.abs(d).max(), 1))
            rows.append(r)
    return rows


def auffaelligkeiten(analysen) -> list[dict]:
    """Zusammenhängende Abschnitte mit AGL < 0 oder AGL < KLEIN_M ausserhalb des Start-/Landebereichs (Hauptvariante)."""
    rows = []
    for a in analysen:
        agl = a.agl()
        mask = np.isfinite(agl) & (agl < KLEIN_M) & ~a.zone
        i = 0
        while i < len(mask):
            if not mask[i]:
                i += 1
                continue
            j = i
            while j + 1 < len(mask) and mask[j + 1]:
                j += 1
            seg = agl[i:j + 1]
            k = i + int(np.argmin(seg))
            rows.append(dict(flug=a.flug.name, ab_min=round(a.t[i] / 60, 2), dauer_s=int(a.t[j] - a.t[i] + 1),
                             agl_min_m=_r(seg.min()), art="AGL<0" if seg.min() < 0 else f"AGL<{KLEIN_M:.0f}",
                             lat=round(a.lat[k], 5), lon=round(a.lon[k], 5), gps_m=int(a.galt[k]),
                             gelaende_m=_r(a.gelaende[HAUPT][k]), roh_agl_m=_r(a.galt[k] - a.gelaende["roh_bil"][k]) if "roh_bil" in a.gelaende else None,
                             agl_10m_bil_m=_r(a.galt[k] - a.gelaende["10m_bil"][k]) if "10m_bil" in a.gelaende else None))
            i = j + 1
    return rows


def vergleich_gesamt(analysen) -> list[dict]:
    """Alle Flüge mit Geländedaten und erkannter Landung zusammengefasst, je Variante."""
    sel = [a for a in analysen if np.isfinite(a.gelaende[HAUPT]).any()]
    rows = []
    for v in VARIANTEN:
        diffs, agls, landungen = [], [], []
        for a in sel:
            if v not in a.gelaende:
                continue
            agl = a.galt - a.gelaende[v]
            agls.append(agl[np.isfinite(agl)])
            if a.land_still.stop - a.land_still.start >= 5:
                l = agl[a.land_still]
                l = l[np.isfinite(l)]
                if l.size:
                    landungen.append(float(np.median(l)))
            if v != "roh_bil" and "roh_bil" in a.gelaende:
                d = (agl - (a.galt - a.gelaende["roh_bil"]))
                diffs.append(d[np.isfinite(d)])
        if not agls:
            continue
        allagl = np.concatenate(agls)
        r = dict(variante=v, fluege=len(agls), fixes=int(allagl.size), agl_min=_r(allagl.min()),
                 n_negativ=int((allagl < 0).sum()), anteil_negativ_prozent=round(100 * (allagl < 0).mean(), 2),
                 landungen_n=len(landungen),
                 agl_landung_median=_r(np.median(landungen)) if landungen else None,
                 agl_landung_streuung_stabw=_r(np.std(landungen)) if landungen else None,
                 agl_landung_abs_median=_r(np.median(np.abs(landungen))) if landungen else None)
        if diffs:
            d = np.concatenate(diffs)
            r.update(diff_zu_roh_mittel=_r(d.mean(), 2), diff_zu_roh_p05=_r(np.percentile(d, 5), 2),
                     diff_zu_roh_p95=_r(np.percentile(d, 95), 2),
                     anteil_agl_kleiner_als_roh_prozent=round(100 * (d < -0.05).mean(), 1),
                     anteil_agl_groesser_als_roh_prozent=round(100 * (d > 0.05).mean(), 1))
        rows.append(r)
    return rows


def schreibe_csv(pfad: Path, rows: list[dict]):
    keys = []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    with open(pfad, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys, delimiter=";")
        w.writeheader()
        w.writerows(rows)


def md_tabelle(rows, cols, titel=None):
    L = []
    L.append("| " + " | ".join(titel or cols) + " |")
    L.append("|" + "---|" * len(cols))
    for r in rows:
        L.append("| " + " | ".join("" if r.get(c) is None else str(r.get(c)) for c in cols) + " |")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="IGC-Flüge gegen die Geländekacheln prüfen (AGL)")
    ap.add_argument("--zip", type=Path, default=ROOT / "igc" / "zip" / "igc.lototu_y4.world.zip")
    ap.add_argument("--igc", type=Path, default=ROOT / "igc" / "extrahiert")
    ap.add_argument("--t25", type=Path, default=OUT / "tiles_25m")
    ap.add_argument("--t10", type=Path, default=OUT / "tiles_10m_testgebiet")
    ap.add_argument("--out", type=Path, default=OUT / "analyse")
    a = ap.parse_args(argv)

    if not a.igc.exists() or not any(a.igc.iterdir()):
        entpacke(a.zip, a.igc)
    a.out.mkdir(parents=True, exist_ok=True)
    flights = lade_fluege(a.igc)
    print(f"{len(flights)} Flüge")
    terr = {}
    t25 = Terrain(a.t25)
    terr["25m_bil"], terr["25m_nn"] = (t25, True), (t25, False)
    if (a.t10 / "index.json").exists():
        t10 = Terrain(a.t10, cache_max=200)
        terr["10m_bil"], terr["10m_nn"] = (t10, True), (t10, False)
    roh = RohRaster()
    analysen = []
    for f in flights:
        an = analysiere(f, terr, roh)
        analysen.append(an)
        print(f"  {f.name}: {len(an.t)} Fixes, Gelände vorhanden bei {np.isfinite(an.gelaende[HAUPT]).mean()*100:.0f}%", flush=True)

    per_flug = versatz_schaetzen(analysen)
    off25 = [v["25m_bil"] for v in per_flug.values() if "25m_bil" in v]
    offroh = [v["roh_bil"] for v in per_flug.values() if "roh_bil" in v]
    offset_info = float(np.median(off25)) if off25 else None
    versatz = dict(n_fluege=len(off25), median_25m=offset_info,
                   mittel_25m=float(np.mean(off25)) if off25 else None,
                   stabw_25m=float(np.std(off25)) if off25 else None,
                   min_25m=min(off25) if off25 else None, max_25m=max(off25) if off25 else None,
                   median_roh=float(np.median(offroh)) if offroh else None,
                   per_flug={k: {kk: round(vv, 1) for kk, vv in v.items()} for k, v in per_flug.items()})
    print("Landeplatz-Versatz (GPS - Gelände), Median über Flüge:", offset_info)

    # Pro-Flug-Zeilen + Grafiken
    rows = []
    for an in analysen:
        rows.append(zeile(an, -offset_info if offset_info is not None else None))
        plot_flug(an, a.out / f"flug_{an.flug.name}.png", offset_info)
    # Hinweis: "mit_offset_nur_info" rechnet AGL + (-Versatz)... siehe Zeile: agl - versatz
    schreibe_csv(a.out / "uebersicht.csv", rows)
    comp = vergleich(analysen)
    schreibe_csv(a.out / "vergleich_varianten.csv", comp)
    gesamt = vergleich_gesamt(analysen)
    schreibe_csv(a.out / "vergleich_gesamt.csv", gesamt)
    auff = auffaelligkeiten(analysen)
    schreibe_csv(a.out / "auffaelligkeiten.csv", auff)
    import json
    (a.out / "versatz.json").write_text(json.dumps(versatz, indent=2, ensure_ascii=False), encoding="utf-8")
    schreibe_markdown(a.out / "zusammenfassung.md", rows, gesamt, auff, versatz, analysen)
    print("Fertig:", a.out)


def schreibe_markdown(pfad, rows, gesamt, auff, versatz, analysen):
    n_gel = sum(1 for a in analysen if np.isfinite(a.gelaende[HAUPT]).any())
    L = ["# Auswertung AGL gegen eigene Flüge", "",
         f"Gelände: {QUELLE} (swissALTIRegio, Höhen in LN02). AGL = GPS-Höhe (IGC) − Gelände, **ohne** Höhenkorrektur. "
         f"Hauptvariante: 25-m-Kacheln, bilinear. {len(analysen)} Flüge gelesen, {n_gel} davon liegen in den Kacheln "
         f"({len(analysen) - n_gel} ausserhalb der Schweiz-Kacheln → AGL nicht berechenbar, `null`).", "",
         "**Wichtig:** Das Modell enthält keine Bäume und keine Gebäude, die GPS-Höhe schwankt. AGL ist eine Näherung "
         "und kein Sicherheitsinstrument.", "",
         "## Pro Flug (Hauptvariante 25 m, bilinear)", ""]
    cols = ["flug", "dauer_min", "agl_start_m", "agl_landung_m", "landung_am_boden_erkannt", "agl_min_m", "agl_median_m",
            "agl_max_m", "n_negativ", "n_klein_ausserhalb_start_landung", "n_ohne_gelaende"]
    L.append(md_tabelle(rows, cols))
    L += ["", "`agl_start_m`/`agl_landung_m` = Median über die stehenden Fixes (Bodengeschwindigkeit < 2 m/s) am Anfang/Ende "
          "der Aufzeichnung; wo das nicht erkannt wurde (Spalte `landung_am_boden_erkannt` = False), ist es der erste/letzte Fix "
          "– dann endet/beginnt die Aufzeichnung in der Luft und der Wert ist KEIN Boden-Test.", ""]
    L += ["## Höhenbezug und geschätzter Versatz (nicht angewendet)", ""]
    if versatz["n_fluege"]:
        m = versatz["median_25m"]
        L += [f"Versatz am Landeplatz (GPS − Gelände, stehende Fixes am Ende), {versatz['n_fluege']} Flüge: "
              f"**Median {m:+.1f} m**, Mittel {versatz['mittel_25m']:+.1f} m, Streuung (Stabw.) {versatz['stabw_25m']:.1f} m, "
              f"Bereich {versatz['min_25m']:+.1f} … {versatz['max_25m']:+.1f} m. Der Versatz wurde nirgends angewendet.", ""]
        if abs(m) < 15:
            L += ["Einordnung: Ein ellipsoidischer WGS84-GPS-Wert läge in der Schweiz etwa 47–53 m über den swisstopo-Höhen (LN02). "
                  "Das ist hier eindeutig nicht der Fall; die Werte passen zu Höhen über Meer (Geoid/MSL), wie sie iOS "
                  "(Wingman auf iPhone) liefert. Der verbleibende Versatz von wenigen Metern und die Streuung von Flug zu Flug "
                  "kommen von: (1) Genauigkeit der iPhone-Höhe (typisch ±5–15 m, mit Luftdruck-Anteil, driftet mit dem Wetter), "
                  "(2) Geoid-Modell des Geräts ≠ LN02, (3) Landewiesen mit Hang/Bäumen/Gebäuden in der Nähe und Max-Resampling "
                  "(Gelände wird eher zu hoch angesetzt), (4) Landestelle nicht exakt flach.", ""]
        else:
            L += [f"Einordnung: Der Versatz von {m:+.0f} m ist gross; mögliche Ursache ist ein ellipsoidischer Höhenbezug.", ""]
        L += ["Pro Flug (m):", "", md_tabelle([dict(flug=k, **v) for k, v in versatz["per_flug"].items()],
                                              ["flug", "25m_bil", "roh_bil"], ["Flug", "25 m bilinear", "Rohdaten bilinear"]), ""]
    else:
        L += ["Kein Landeplatz-Versatz bestimmbar.", ""]
    L += ["Hinweis: In allen IGC-Dateien ist die Druckhöhe (PPPPP) identisch mit der GPS-Höhe (GGGGG) – Wingman schreibt in beide Felder "
          "denselben Wert. Die Druckhöhe taugt hier also nicht als unabhängige Kontrolle.", ""]
    L += ["## Vergleich 10 m ↔ 25 m, mit/ohne Interpolation", "",
          "Alle Flüge in den Kacheln gemeinsam (10-m-Kacheln nur im Testgebiet um die Flüge). `roh_bil` = Referenz direkt aus den "
          "LV95-Rohdaten (10 m, bilinear, kein Max-Resampling). Differenz = AGL(Variante) − AGL(roh); "
          "negativ = AGL kleiner als bei der Referenz = konservativer.", "",
          md_tabelle(gesamt, ["variante", "fluege", "fixes", "agl_min", "n_negativ", "anteil_negativ_prozent", "landungen_n",
                              "agl_landung_median", "agl_landung_streuung_stabw", "agl_landung_abs_median", "diff_zu_roh_mittel",
                              "diff_zu_roh_p05", "diff_zu_roh_p95", "anteil_agl_kleiner_als_roh_prozent"]), ""]
    L += ["## Auffällige Stellen (Hauptvariante)", "",
          f"Abschnitte mit AGL < {KLEIN_M:.0f} m ausserhalb der ersten/letzten {ZONE_START_S} s (Start/Landung). "
          "AGL < 0 ist physikalisch unmöglich und zeigt Fehler in GPS-Höhe, Gelände oder Versatz. Vollständige Liste: `auffaelligkeiten.csv`.", "",
          f"{len(auff)} Abschnitte, davon {sum(1 for r in auff if r['art'] == 'AGL<0')} mit AGL < 0.", ""]
    top = sorted(auff, key=lambda r: r["agl_min_m"])[:15]
    if top:
        L.append(md_tabelle(top, ["flug", "ab_min", "dauer_s", "agl_min_m", "lat", "lon", "gps_m", "gelaende_m", "roh_agl_m", "agl_10m_bil_m"]))
    pfad.write_text("\n".join(L) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
