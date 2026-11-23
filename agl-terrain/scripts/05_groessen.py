"""Grössenübersicht eines Kachelordners: python -I scripts/05_groessen.py output/tiles_25m"""
import json
import sys
from pathlib import Path
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agl.tiles import formatiere_groessen, groessenuebersicht

if __name__ == "__main__":
    ordner = Path(sys.argv[1] if len(sys.argv) > 1 else "output/tiles_25m")
    index = json.loads((ordner / "index.json").read_text(encoding="utf-8"))
    real = sum(p.stat().st_size for p in (ordner / "tiles").glob("*.gz"))
    print(formatiere_groessen(groessenuebersicht(index)))
    print(f"Auf Platte (tiles/*.gz): {real / 1e6:.2f} MB; index.json: {(ordner / 'index.json').stat().st_size / 1e3:.0f} kB")
