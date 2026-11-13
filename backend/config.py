"""Percorsi e helper per i file JSON di configurazione in DATA_DIR."""
import json
import os
import shutil
import threading
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", str(Path(__file__).resolve().parent.parent / "data")))
DEFAULTS_DIR = Path(__file__).resolve().parent / "data"
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", str(Path(__file__).resolve().parent.parent / "frontend" / "dist")))
JSON_FILES = ("materials.json", "tools.json", "settings.json")
_lock = threading.Lock()


def ensure_data_files() -> list[str]:
    """Copia i JSON di default in DATA_DIR se mancanti. Ritorna i file creati."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    created = []
    for name in JSON_FILES:
        target = DATA_DIR / name
        if not target.exists():
            shutil.copy(DEFAULTS_DIR / name, target)
            created.append(name)
    return created


def read_json(name: str):
    path = DATA_DIR / name
    if not path.exists():
        ensure_data_files()
    with _lock, open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(name: str, data) -> None:
    path = DATA_DIR / name
    tmp = path.with_suffix(".tmp")
    with _lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)


def deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out
