"""IGC-ZIP sicher in einen leeren Unterordner entpacken (nur Daten, nichts wird ausgeführt)."""
from __future__ import annotations
import zipfile
from pathlib import Path


def entpacke(zip_pfad: Path, ziel: Path) -> list[Path]:
    """Entpackt nur *.igc (egal ob Gross-/Kleinschreibung), mit flachen, bereinigten Dateinamen."""
    ziel.mkdir(parents=True, exist_ok=True)
    if any(ziel.iterdir()):
        # bereits entpackt -> nicht erneut schreiben
        return sorted(p for p in ziel.iterdir() if p.suffix.lower() == ".igc")
    out = []
    with zipfile.ZipFile(zip_pfad) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name  # Verzeichnisanteile verwerfen (Zip-Slip)
            if not name or Path(name).suffix.lower() != ".igc":
                continue
            if info.file_size > 50_000_000:
                continue
            p = ziel / name
            p.write_bytes(z.read(info))
            out.append(p)
    return sorted(out)
