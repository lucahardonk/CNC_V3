"""Importazione DXF → entità CAD di CNC V3.

Entità supportate: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE (2D, con bulge), SPLINE, ELLIPSE,
INSERT (blocchi esplosi ricorsivamente). Le polilinee vengono esplose in linee/archi; spline ed
ellissi parziali diventano `spline` (Catmull-Rom per punti densi, come nel frontend).

Tutte le coordinate vengono convertite in millimetri in base a $INSUNITS.
"""
from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from typing import Any

import ezdxf
from ezdxf import colors as dxf_colors
from ezdxf import recover
from ezdxf.math import Vec3

# $INSUNITS → fattore verso mm (0 = non specificato: si assume mm)
UNIT_NAMES = {0: "non specificata (assunto mm)", 1: "pollici", 2: "piedi", 4: "millimetri", 5: "centimetri",
              6: "metri", 8: "micro-pollici", 9: "mils", 10: "iarde", 13: "micron", 14: "decimetri"}
UNIT_TO_MM = {0: 1.0, 1: 25.4, 2: 304.8, 4: 1.0, 5: 10.0, 6: 1000.0, 8: 25.4e-6, 9: 0.0254, 10: 914.4,
              13: 0.001, 14: 100.0}
SUPPORTED = {"LINE", "ARC", "CIRCLE", "LWPOLYLINE", "POLYLINE", "SPLINE", "ELLIPSE", "INSERT"}
DEFAULT_COLOR = "#e5e7eb"
FLATTEN_TOL = 0.05  # mm, tolleranza di discretizzazione per spline/ellissi
MAX_INSERT_DEPTH = 8


@dataclass
class ImportResult:
    units: int
    unit_name: str
    scale: float
    entities: list[dict[str, Any]] = field(default_factory=list)
    layers: list[dict[str, Any]] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)
    skipped: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def bbox(self) -> dict[str, float] | None:
        xs, ys = [], []
        for e in self.entities:
            d = e["data"]
            if e["type"] == "line":
                xs += [d["x1"], d["x2"]]; ys += [d["y1"], d["y2"]]
            elif e["type"] in ("circle", "arc"):
                xs += [d["cx"] - d["r"], d["cx"] + d["r"]]; ys += [d["cy"] - d["r"], d["cy"] + d["r"]]
            elif e["type"] == "ellipse":
                m = max(d["rx"], d["ry"])
                xs += [d["cx"] - m, d["cx"] + m]; ys += [d["cy"] - m, d["cy"] + m]
            elif e["type"] == "spline":
                xs += [p["x"] for p in d["points"]]; ys += [p["y"] for p in d["points"]]
        if not xs:
            return None
        return {"minX": min(xs), "minY": min(ys), "maxX": max(xs), "maxY": max(ys)}

    def to_dict(self) -> dict[str, Any]:
        return {"units": self.units, "unit_name": self.unit_name, "scale": self.scale, "entities": self.entities,
                "layers": self.layers, "counts": self.counts, "skipped": self.skipped,
                "warnings": self.warnings, "bbox": self.bbox()}


def _r(v: float) -> float:
    return round(float(v), 4)


def _hex(rgb) -> str:
    return "#%02x%02x%02x" % tuple(int(c) for c in rgb)


def _layer_color(layer) -> str:
    try:
        if layer.has_dxf_attrib("true_color"):
            return _hex(dxf_colors.int2rgb(layer.dxf.true_color))
        aci = abs(int(layer.dxf.color))
        if aci in (0, 7, 256) or aci > 255:  # bianco/nero o BYBLOCK/BYLAYER → colore neutro del CAD
            return DEFAULT_COLOR
        return _hex(dxf_colors.aci2rgb(aci))
    except Exception:  # noqa: BLE001
        return DEFAULT_COLOR


def _read_doc(content: bytes):
    """Legge il DXF (testo o binario); in caso di file danneggiato tenta il recupero."""
    try:
        if content.startswith(b"AutoCAD Binary DXF"):
            import tempfile, os  # noqa: E401
            with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as f:
                f.write(content)
                path = f.name
            try:
                return ezdxf.readfile(path), []
            finally:
                os.unlink(path)
        text = None
        for enc in ("utf-8", "cp1252", "latin-1"):
            try:
                text = content.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        return ezdxf.read(io.StringIO(text)), []
    except Exception:  # noqa: BLE001
        doc, auditor = recover.read(io.BytesIO(content))
        return doc, [f"File DXF riparato automaticamente ({len(auditor.fixes)} correzioni)"]


class _Converter:
    def __init__(self, scale: float, res: ImportResult):
        self.k = scale
        self.res = res

    def pt(self, v) -> dict[str, float]:
        return {"x": _r(v[0] * self.k), "y": _r(v[1] * self.k)}

    def add(self, etype: str, data: dict, layer: str, src: str):
        self.res.entities.append({"type": etype, "data": data, "layer": layer or "0", "source": src})
        self.res.counts[src] = self.res.counts.get(src, 0) + 1

    def skip(self, t: str):
        self.res.skipped[t] = self.res.skipped.get(t, 0) + 1

    def line(self, a, b, layer, src):
        if math.dist((a[0], a[1]), (b[0], b[1])) * self.k < 1e-6:
            return
        pa, pb = self.pt(a), self.pt(b)
        self.add("line", {"x1": pa["x"], "y1": pa["y"], "x2": pb["x"], "y2": pb["y"]}, layer, src)

    def arc_entity(self, e, layer, src):
        """ARC/CIRCLE con gestione OCS (estrusione negativa = specchiato su X)."""
        c = e.ocs().to_wcs(e.dxf.center)
        r = float(e.dxf.radius) * self.k
        if r <= 1e-9:
            return
        flipped = e.dxf.extrusion.z < 0
        cx, cy = _r(c.x * self.k), _r(c.y * self.k)
        if e.dxftype() == "CIRCLE":
            return self.add("circle", {"cx": cx, "cy": cy, "r": _r(r)}, layer, src)
        s, en = float(e.dxf.start_angle), float(e.dxf.end_angle)
        if flipped:
            s, en = 180.0 - en, 180.0 - s
        s, en = s % 360.0, en % 360.0
        if abs(en - s) < 1e-9:
            return self.add("circle", {"cx": cx, "cy": cy, "r": _r(r)}, layer, src)
        self.add("arc", {"cx": cx, "cy": cy, "r": _r(r), "start": _r(s), "end": _r(en)}, layer, src)

    def points_curve(self, pts: list, closed: bool, layer, src):
        clean = []
        for p in pts:
            q = self.pt(p)
            if not clean or math.dist((q["x"], q["y"]), (clean[-1]["x"], clean[-1]["y"])) > 1e-4:
                clean.append(q)
        if closed and clean and math.dist((clean[0]["x"], clean[0]["y"]), (clean[-1]["x"], clean[-1]["y"])) > 1e-4:
            clean.append(dict(clean[0]))
        if len(clean) == 2:
            a, b = clean
            return self.add("line", {"x1": a["x"], "y1": a["y"], "x2": b["x"], "y2": b["y"]}, layer, src)
        if len(clean) >= 3:
            self.add("spline", {"points": clean}, layer, src)

    def convert(self, e, depth: int = 0, layer_override: str | None = None):
        t = e.dxftype()
        layer = layer_override or e.dxf.get("layer", "0")
        try:
            if t == "LINE":
                self.line(e.dxf.start, e.dxf.end, layer, t)
            elif t in ("ARC", "CIRCLE"):
                self.arc_entity(e, layer, t)
            elif t in ("LWPOLYLINE", "POLYLINE"):
                if t == "POLYLINE" and (e.is_polygon_mesh or e.is_poly_face_mesh):
                    return self.skip(t + " (mesh)")
                # esplode in LINE/ARC già in coordinate WCS (bulge → archi)
                for sub in e.virtual_entities():
                    st = sub.dxftype()
                    if st == "LINE":
                        self.line(sub.dxf.start, sub.dxf.end, layer, t)
                    elif st == "ARC":
                        self.arc_entity(sub, layer, t)
            elif t == "SPLINE":
                pts = list(e.flattening(FLATTEN_TOL / max(self.k, 1e-9)))
                self.points_curve(pts, bool(e.closed), layer, t)
            elif t == "ELLIPSE":
                ratio = float(e.dxf.ratio)
                major = Vec3(e.dxf.major_axis)
                full = abs(((e.dxf.end_param - e.dxf.start_param) % (2 * math.pi))) < 1e-9 or \
                    abs(e.dxf.end_param - e.dxf.start_param - 2 * math.pi) < 1e-9
                if full and e.dxf.extrusion.z > 0:
                    c = e.dxf.center
                    rx = major.magnitude * self.k
                    self.add("ellipse", {"cx": _r(c.x * self.k), "cy": _r(c.y * self.k), "rx": _r(rx),
                                         "ry": _r(rx * ratio), "rotation": _r(math.degrees(math.atan2(major.y, major.x)))},
                             layer, t)
                else:
                    self.points_curve(list(e.flattening(FLATTEN_TOL / max(self.k, 1e-9))), full, layer, t)
            elif t == "INSERT":
                if depth >= MAX_INSERT_DEPTH:
                    return self.skip("INSERT (annidamento eccessivo)")
                for sub in e.virtual_entities():
                    sub_layer = sub.dxf.get("layer", "0")
                    # entità dei blocchi sul layer "0" ereditano il layer dell'INSERT (regola DXF)
                    self.convert(sub, depth + 1, layer if sub_layer == "0" else sub_layer)
            else:
                self.skip(t)
        except Exception as exc:  # noqa: BLE001
            self.skip(t)
            self.res.warnings.append(f"{t} ignorata: {exc}")


def parse_dxf(content: bytes) -> ImportResult:
    if not content:
        raise ValueError("File vuoto")
    head = content[:4096]
    if b"SECTION" not in head and not head.startswith(b"AutoCAD Binary DXF"):
        raise ValueError("Il file non sembra un DXF valido (sezione SECTION assente)")
    try:
        doc, warns = _read_doc(content)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"File DXF non valido: {exc}") from exc

    units = int(doc.header.get("$INSUNITS", 0) or 0)
    scale = UNIT_TO_MM.get(units)
    res = ImportResult(units=units, unit_name=UNIT_NAMES.get(units, f"codice {units}"), scale=scale or 1.0)
    res.warnings += warns
    if scale is None:
        res.warnings.append(f"Unità $INSUNITS={units} non supportata: coordinate importate come mm")
    elif units == 0:
        res.warnings.append("Il file non specifica le unità ($INSUNITS=0): assunti millimetri")

    conv = _Converter(res.scale, res)
    for e in doc.modelspace():
        conv.convert(e)

    used = {e["layer"] for e in res.entities}
    for layer in doc.layers:
        name = layer.dxf.name
        if name not in used:
            continue
        res.layers.append({"name": name, "color": _layer_color(layer), "count": sum(1 for e in res.entities if e["layer"] == name)})
    # layer referenziati ma non definiti nella tabella LAYER
    for name in sorted(used - {l["name"] for l in res.layers}):
        res.layers.append({"name": name, "color": DEFAULT_COLOR, "count": sum(1 for e in res.entities if e["layer"] == name)})
    if not res.entities:
        res.warnings.append("Nessuna geometria supportata trovata nel model space")
    for t, n in res.skipped.items():
        res.warnings.append(f"{n} entità {t} non supportate e ignorate")
    return res
