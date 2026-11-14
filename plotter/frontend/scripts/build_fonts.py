#!/usr/bin/env python3
"""Converte i font SVG single-stroke (npm `hersheytext`, svg_fonts/) in JSON compatti per PlotterCAM.

Uso: python3 scripts/build_fonts.py <cartella svg_fonts>
Output: src/lib/fonts/<id>.json  {name, cap, glyphs: {char: [adv, [[x,y,x,y,...], ...]]}}
Coordinate in unità font (y verso l'alto, baseline 0). Le curve C/Q vengono linearizzate.
"""
import json, re, sys, html
from pathlib import Path

FONTS = {
    "hershey_sans": ("HersheySans1.svg", "Hershey Sans"),
    "hershey_sans_med": ("HersheySansMed.svg", "Hershey Sans Medium"),
    "hershey_serif": ("HersheySerifMed.svg", "Hershey Serif"),
    "hershey_serif_italic": ("HersheySerifMedItalic.svg", "Hershey Serif Italic"),
    "hershey_serif_bold": ("HersheySerifBold.svg", "Hershey Serif Bold"),
    "hershey_script": ("HersheyScript1.svg", "Hershey Script (corsivo)"),
    "hershey_script_med": ("HersheyScriptMed.svg", "Hershey Script Medium"),
    "hershey_gothic": ("HersheyGothEnglish.svg", "Hershey Gothic English"),
    "ems_allure": ("EMSAllure.svg", "EMS Allure (calligrafico)"),
    "ems_readability": ("EMSReadability.svg", "EMS Readability"),
    "ems_readability_italic": ("EMSReadabilityItalic.svg", "EMS Readability Italic"),
    "ems_tech": ("EMSTech.svg", "EMS Tech"),
    "ems_felix": ("EMSFelix.svg", "EMS Felix"),
    "ems_nixish": ("EMSNixish.svg", "EMS Nixish"),
}
TOK = re.compile(r"[MLCQHVZmlcqhvz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?")


def parse_d(d):
    toks = TOK.findall(d)
    i, cmd, cur, start = 0, None, (0.0, 0.0), (0.0, 0.0)
    paths, pl = [], []

    def num():
        nonlocal i
        v = float(toks[i]); i += 1; return v

    while i < len(toks):
        if re.fullmatch(r"[A-Za-z]", toks[i]):
            cmd = toks[i]; i += 1
            if cmd in "Zz":
                if pl: pl.append(start)
                cur = start
                continue
        rel = cmd.islower()
        c = cmd.upper()
        ox, oy = cur if rel else (0, 0)
        if c == "M":
            if len(pl) > 1: paths.append(pl)
            cur = (ox + num(), oy + num()); start = cur; pl = [cur]
            cmd = "l" if rel else "L"
        elif c == "L":
            cur = (ox + num(), oy + num()); pl.append(cur)
        elif c == "H":
            cur = ((ox if rel else 0) + num(), cur[1]); pl.append(cur)
        elif c == "V":
            cur = (cur[0], (cur[1] if rel else 0) + num()); pl.append(cur)
        elif c in "CQ":
            n = 3 if c == "C" else 2
            pts = [cur] + [(ox + num(), oy + num()) for _ in range(n)]
            for k in range(1, 9):
                t = k / 8
                if n == 3:
                    a = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3]
                else:
                    a = [(1 - t) ** 2, 2 * (1 - t) * t, t ** 2]
                pl.append((sum(w * p[0] for w, p in zip(a, pts)), sum(w * p[1] for w, p in zip(a, pts))))
            cur = pts[-1]
        else:
            i += 1
    if len(pl) > 1: paths.append(pl)
    return [[round(v) for p in path for v in p] for path in paths]


def main(src):
    src = Path(src); out = Path(__file__).resolve().parent.parent / "src" / "lib" / "fonts"
    out.mkdir(parents=True, exist_ok=True)
    index = []
    for fid, (fname, name) in FONTS.items():
        txt = (src / fname).read_text(encoding="utf-8")
        default_adv = float(re.search(r'<font[^>]*horiz-adv-x="([\d.]+)"', txt).group(1))
        glyphs = {}
        for m in re.finditer(r"<glyph\b([^>]*)/?>", txt):
            attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
            if "unicode" not in attrs: continue
            ch = html.unescape(attrs["unicode"])
            if len(ch) != 1: continue
            glyphs[ch] = [round(float(attrs.get("horiz-adv-x", default_adv))), parse_d(attrs.get("d", ""))]
        cap = max((v for path in glyphs.get("H", [0, []])[1] for v in path[1::2]), default=700)
        (out / f"{fid}.json").write_text(json.dumps({"name": name, "cap": cap, "glyphs": glyphs}, separators=(",", ":")))
        index.append({"id": fid, "name": name})
        print(f"{fid}: {len(glyphs)} glifi, cap={cap}")
    (out / "index.json").write_text(json.dumps(index, indent=1))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "node_modules/hersheytext/svg_fonts")
