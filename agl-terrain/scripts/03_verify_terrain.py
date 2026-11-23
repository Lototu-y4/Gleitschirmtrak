import sys
from pathlib import Path
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))  # nötig, weil python -I das Skriptverzeichnis nicht aufnimmt
from agl.verify import main

if __name__ == "__main__":
    main()
