#!/usr/bin/env python3
"""Comprime data/index.html (gzip) e genera index_html.h da includere nel firmware.

Uso (dalla cartella esp32_wireless_bridge):  python3 tools/embed_html.py
"""
import gzip
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "data" / "index.html"
dst = root / "index_html.h"

data = gzip.compress(src.read_bytes(), compresslevel=9, mtime=0)
rows = [", ".join(f"0x{b:02x}" for b in data[i:i + 16]) for i in range(0, len(data), 16)]

dst.write_text(
    "// GENERATO da tools/embed_html.py partendo da data/index.html — NON modificare a mano.\n"
    "#pragma once\n#include <Arduino.h>\n\n"
    f"static const size_t INDEX_HTML_GZ_LEN = {len(data)};\n"
    "static const uint8_t INDEX_HTML_GZ[] PROGMEM = {\n  " + ",\n  ".join(rows) + "\n};\n",
    encoding="utf-8",
)
print(f"{src.name}: {src.stat().st_size} byte -> gzip {len(data)} byte -> {dst.name}")
