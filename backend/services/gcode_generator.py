"""Generatore G-code da entities CAD 2D.

Convenzioni:
  * Origine pezzo: X0 Y0 al centro dello stock, Z0 sulla superficie superiore.
  * Il taglio scende in Z negativo fino a -depth_total.
  * Formati entity (campo `data`):
      line    {x1, y1, x2, y2}
      rect    {x, y, w, h}          (x, y = angolo minimo)
      circle  {cx, cy, r}
      arc     {cx, cy, r, start, end}  angoli in gradi, verso antiorario da start a end
      bridge  {x, y, w, h}          rettangolo ponticello (tab)
      ellipse {cx, cy, rx, ry, rotation}  rotation in gradi (antiorario)
      slot    {cx, cy, length, width, angle}  length = interasse dei semicerchi, width = 2 x raggio
      spline  {points: [{x, y}, ...]}  Catmull-Rom (come nel frontend); chiusa se primo == ultimo punto
    Le entity con is_construction=True o type in (construction, dimension) vengono ignorate.

Operazioni: profile_on, profile_inside, profile_outside, pocket.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import linemerge, polygonize, unary_union

EPS = 1e-6
ARC_SEG_DEG = 5.0
IGNORED_TYPES = {"construction", "dimension", "dim_radial", "dim_angle", "constraint", "point"}
SNAP_TOL = 0.01  # mm: estremi più vicini di così vengono uniti (arrotondamenti del CAD)
ELLIPSE_SEGMENTS = 144


# --------------------------------------------------------------------------- geometria
def arc_points(cx: float, cy: float, r: float, start: float, end: float) -> list[tuple[float, float]]:
    """Punti di un arco antiorario da start a end (gradi)."""
    sweep = (end - start) % 360.0
    if sweep < EPS:
        sweep = 360.0
    n = max(2, int(math.ceil(sweep / ARC_SEG_DEG)))
    return [(cx + r * math.cos(math.radians(start + sweep * i / n)),
             cy + r * math.sin(math.radians(start + sweep * i / n))) for i in range(n + 1)]


def ellipse_points(cx: float, cy: float, rx: float, ry: float, rotation: float = 0.0,
                   n: int = ELLIPSE_SEGMENTS) -> list[tuple[float, float]]:
    """Stessa parametrizzazione del frontend (ellipsePoint)."""
    r = math.radians(rotation or 0.0)
    out = []
    for i in range(n + 1):
        t = 2 * math.pi * i / n
        lx, ly = rx * math.cos(t), ry * math.sin(t)
        out.append((cx + lx * math.cos(r) - ly * math.sin(r), cy + lx * math.sin(r) + ly * math.cos(r)))
    return out


def slot_points(cx: float, cy: float, length: float, width: float, angle: float = 0.0) -> list[tuple[float, float]]:
    """Contorno chiuso dell'asola (come slotParts del frontend): 2 segmenti + 2 semicerchi."""
    a = angle or 0.0
    ux, uy = math.cos(math.radians(a)), math.sin(math.radians(a))
    r, h = width / 2.0, length / 2.0
    c1 = (cx - ux * h, cy - uy * h)
    c2 = (cx + ux * h, cy + uy * h)
    pts = arc_points(c2[0], c2[1], r, a - 90, a + 90) + arc_points(c1[0], c1[1], r, a + 90, a + 270)
    pts.append(pts[0])
    return pts


def catmull_rom_points(points: list[tuple[float, float]], samples: int = 20) -> list[tuple[float, float]]:
    """Catmull-Rom uniforme con estremi ripetuti, identica a catmullRomPoints del frontend."""
    if len(points) < 2:
        return list(points)
    n = len(points)
    P = lambda i: points[max(0, min(n - 1, i))]  # noqa: E731
    out = [points[0]]
    for i in range(n - 1):
        p0, p1, p2, p3 = P(i - 1), P(i), P(i + 1), P(i + 2)
        for k in range(1, samples + 1):
            t = k / samples
            t2, t3 = t * t, t * t * t
            f = lambda a, b, c, d: 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2  # noqa: E731
                                          + (-a + 3 * b - 3 * c + d) * t3)
            out.append((f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])))
    return out


def entity_to_geom(e: dict[str, Any]):
    """Converte un'entity in geometria shapely. Ritorna (kind, geom) con kind 'area'|'line'|'bridge'."""
    t = e.get("type")
    d = e.get("data") or {}
    try:
        if t == "line":
            return "line", LineString([(float(d["x1"]), float(d["y1"])), (float(d["x2"]), float(d["y2"]))])
        if t in ("rect", "bridge"):
            x, y, w, h = float(d["x"]), float(d["y"]), float(d["w"]), float(d["h"])
            g = box(min(x, x + w), min(y, y + h), max(x, x + w), max(y, y + h))
            return ("bridge" if t == "bridge" else "area"), g
        if t == "circle":
            r = float(d["r"])
            if r <= 0:
                return None, None
            return "area", Polygon(arc_points(float(d["cx"]), float(d["cy"]), r, 0, 360))
        if t == "arc":
            return "line", LineString(arc_points(float(d["cx"]), float(d["cy"]), float(d["r"]),
                                                 float(d.get("start", 0)), float(d.get("end", 90))))
        if t == "ellipse":
            rx, ry = abs(float(d["rx"])), abs(float(d["ry"]))
            if rx <= 0 or ry <= 0:
                return None, None
            return "area", Polygon(ellipse_points(float(d["cx"]), float(d["cy"]), rx, ry, float(d.get("rotation") or 0)))
        if t == "slot":
            width = abs(float(d["width"]))
            if width <= 0:
                return None, None
            return "area", Polygon(slot_points(float(d["cx"]), float(d["cy"]), abs(float(d.get("length") or 0)),
                                               width, float(d.get("angle") or 0)))
        if t == "spline":
            pts = [(float(p["x"]), float(p["y"])) for p in (d.get("points") or [])]
            if len(pts) < 2:
                return None, None
            # Pezzi molto densi (es. ellissi tagliate) non richiedono 20 campioni per tratto
            samples = max(2, min(20, int(math.ceil(600 / len(pts)))))
            curve = catmull_rom_points(pts, samples)
            if len(pts) >= 3 and math.dist(pts[0], pts[-1]) < SNAP_TOL:
                poly = Polygon(curve).buffer(0)
                if not poly.is_empty and poly.area > EPS:
                    return "area", poly
            return "line", LineString(curve)
    except (KeyError, TypeError, ValueError):
        return None, None
    return None, None


def snap_endpoints(lines: list[LineString], tol: float = SNAP_TOL) -> list[LineString]:
    """Unisce gli estremi quasi coincidenti (tagli/raccordi arrotondati a 3 decimali) per poter
    concatenare linee, archi e spline in contorni chiusi. Gli estremi vicini all'interno di
    un'altra linea (contatto a T) vengono proiettati su di essa."""
    reps: list[tuple[float, float]] = []

    def rep(p):
        for q in reps:
            if math.dist(p, q) <= tol:
                return q
        reps.append(p)
        return p

    out = []
    for ln in lines:
        c = list(ln.coords)
        c[0], c[-1] = rep(c[0]), rep(c[-1])
        out.append(c)
    # contatti a T: estremo libero vicino al corpo di un'altra linea
    geoms = [LineString(c) for c in out if len(c) >= 2]
    for i, c in enumerate(out):
        for end in (0, -1):
            p = Point(c[end])
            for j, g in enumerate(geoms):
                if j == i or g.is_empty:
                    continue
                dd = g.distance(p)
                if EPS < dd <= tol:
                    q = g.interpolate(g.project(p))
                    c[end] = (q.x, q.y)
                    break
    res = []
    for c in out:
        g = LineString(c)
        if g.length > EPS:
            res.append(g)
    return res


def build_geometry(entities: Iterable[dict[str, Any]]):
    """Ritorna (regione chiusa, linee aperte, unione bridge)."""
    areas, lines, bridges = [], [], []
    for e in entities:
        if e.get("is_construction") or e.get("type") in IGNORED_TYPES:
            continue
        kind, g = entity_to_geom(e)
        if g is None or g.is_empty:
            continue
        {"area": areas, "line": lines, "bridge": bridges}[kind].append(g)

    open_lines = []
    if lines:
        lines = snap_endpoints(lines)
        noded = unary_union(lines)
        closed = list(polygonize(noded))
        areas.extend(closed)
        used = unary_union([p.boundary for p in closed]) if closed else None
        merged = linemerge(noded) if not isinstance(noded, LineString) else noded
        for ln in getattr(merged, "geoms", [merged]):
            if used is not None and ln.difference(used.buffer(1e-4)).length < 1e-3:
                continue
            open_lines.append(ln)

    # Regola even-odd: forme annidate diventano fori
    region = None
    for a in sorted(areas, key=lambda p: -p.area):
        a = a.buffer(0)
        region = a if region is None else region.symmetric_difference(a)
    bridge_union = unary_union(bridges) if bridges else None
    return region, open_lines, bridge_union


def _polys(geom) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


def _rings(polys: list[Polygon], sign: float) -> list[list[tuple[float, float]]]:
    out = []
    for p in polys:
        p = orient(p, sign=sign)
        out.append(list(p.exterior.coords))
        out.extend(list(r.coords) for r in p.interiors)
    return out


# --------------------------------------------------------------------------- toolpath
@dataclass
class Path:
    points: list[tuple[float, float]]
    closed: bool = True


def profile_paths(region, open_lines, operation: str, radius: float) -> tuple[list[Path], list[str]]:
    warnings: list[str] = []
    paths: list[Path] = []
    if operation == "profile_on":
        paths += [Path(r) for r in _rings(_polys(region), 1.0)]
    elif operation == "profile_outside":
        paths += [Path(r) for r in _rings(_polys(region.buffer(radius, quad_segs=16, join_style=1)) if region else [], 1.0)]
    elif operation == "profile_inside":
        inner = region.buffer(-radius, quad_segs=16, join_style=1) if region else None
        if region is not None and (inner is None or inner.is_empty):
            warnings.append("Forma troppo piccola per l'utensile: profilo interno vuoto.")
        paths += [Path(r) for r in _rings(_polys(inner), -1.0)]
    # Le linee aperte vengono sempre seguite sulla linea (centro fresa), mai interno/esterno
    paths += open_line_paths(open_lines)
    return paths, warnings


def open_line_paths(open_lines) -> list[Path]:
    return [Path(list(l.coords), closed=False) for l in open_lines if l.length > EPS]


def pocket_paths(region, radius: float, step: float, direction: str) -> tuple[list[Path], list[str]]:
    warnings: list[str] = []
    if region is None:
        return [], ["Nessuna forma chiusa da svuotare."]
    area = region.buffer(-radius, quad_segs=16, join_style=1)
    if area.is_empty:
        return [], ["Forma troppo piccola per l'utensile: pocket vuota."]
    paths: list[Path] = []
    if direction == "contour":
        cur = area
        rings_all = []
        while not cur.is_empty:
            rings_all.append(_rings(_polys(cur), -1.0))
            cur = cur.buffer(-step, quad_segs=16, join_style=1)
        for rings in reversed(rings_all):  # dal centro verso l'esterno
            paths += [Path(r) for r in rings]
        return paths, warnings

    minx, miny, maxx, maxy = area.bounds
    inside_test = area.buffer(1e-3)
    for poly in _polys(area):
        segs = []
        if direction == "vertical":
            n = int(math.floor((maxx - minx) / step)) + 1
            coords = [minx + i * step for i in range(n)] + [maxx - EPS]
            scan = lambda c: LineString([(c, miny - 1), (c, maxy + 1)])
        else:
            n = int(math.floor((maxy - miny) / step)) + 1
            coords = [miny + i * step for i in range(n)] + [maxy - EPS]
            scan = lambda c: LineString([(minx - 1, c), (maxx + 1, c)])
        flip = False
        for c in coords:
            inter = poly.intersection(scan(c))
            row = [g for g in getattr(inter, "geoms", [inter]) if isinstance(g, LineString) and g.length > EPS]
            row.sort(key=lambda g: min(g.coords[0][1 if direction == "vertical" else 0], g.coords[-1][1 if direction == "vertical" else 0]))
            for g in row:
                pts = sorted(g.coords, key=(lambda p: p[1]) if direction == "vertical" else (lambda p: p[0]))
                segs.append(pts[::-1] if flip else pts)
            flip = not flip
        # concatena segmenti se il collegamento resta dentro l'area (zig-zag senza risalita)
        current: list[tuple[float, float]] = []
        for s in segs:
            if current and inside_test.contains(LineString([current[-1], s[0]])):
                current.extend(s)
            else:
                if current:
                    paths.append(Path(current, closed=False))
                current = list(s)
        if current:
            paths.append(Path(current, closed=False))
        # passata di finitura sul contorno
        paths += [Path(r) for r in _rings([poly], -1.0)]
    return paths, warnings


# --------------------------------------------------------------------------- emissione
@dataclass
class Params:
    operation: str = "profile_outside"
    tool_diameter: float = 6.0
    tool_name: str = "Utensile"
    material: str = "softwood"
    feed_rate: float = 1200
    plunge_rate: float = 300
    spindle_rpm: float = 18000
    depth_total: float = 3.0
    depth_per_pass: float = 1.0
    step_over: float = 0.4
    safe_height: float = 5.0
    bridge_height: float = 1.5
    stock_z: float = 20.0
    pocket_direction: str = "horizontal"


@dataclass
class Result:
    gcode: str
    line_count: int
    path_length_mm: float
    cut_length_mm: float
    estimated_time_min: float
    warnings: list[str] = field(default_factory=list)


def _f(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _split_by_bridges(a, b, bridges, z_cut, z_tab):
    """Divide il segmento a->b nei tratti dentro/fuori i bridge; ritorna [(punto_fine, z)]."""
    if bridges is None or z_cut >= z_tab:
        return [(b, z_cut)]
    seg = LineString([a, b])
    if not seg.intersects(bridges):
        return [(b, z_cut)]
    ts = {0.0, 1.0}
    inter = seg.intersection(bridges.boundary)
    for g in getattr(inter, "geoms", [inter]):
        for c in getattr(g, "coords", []):
            ts.add(seg.project(Point(c), normalized=True))
    ts = sorted(ts)
    out = []
    for t0, t1 in zip(ts, ts[1:]):
        if t1 - t0 < 1e-9:
            continue
        mid = seg.interpolate((t0 + t1) / 2, normalized=True)
        end = seg.interpolate(t1, normalized=True)
        out.append(((end.x, end.y), z_tab if bridges.contains(mid) else z_cut))
    return out


def generate_gcode(entities: list[dict[str, Any]], p: Params) -> Result:
    if p.tool_diameter <= 0:
        raise ValueError("Diametro utensile non valido")
    if p.depth_per_pass <= 0:
        raise ValueError("Profondità di passata non valida")
    radius = p.tool_diameter / 2.0
    region, open_lines, bridges = build_geometry(entities)
    warnings: list[str] = []
    if region is None and not open_lines:
        raise ValueError("Nessuna geometria valida nel layer (disegna forme chiuse non di costruzione).")

    if p.operation == "pocket":
        paths, w = pocket_paths(region, radius, max(0.05, p.step_over * p.tool_diameter), p.pocket_direction)
        if open_lines:
            w = [x for x in w if region is not None]  # senza forme chiuse basta seguire le linee aperte
            paths += open_line_paths(open_lines)
    else:
        paths, w = profile_paths(region, open_lines, p.operation, radius)
    warnings += w
    if not paths:
        raise ValueError("; ".join(warnings) or "Nessun percorso generato.")
    if p.depth_total > p.stock_z:
        warnings.append(f"Profondità {p.depth_total}mm maggiore dello spessore stock {p.stock_z}mm!")

    # livelli di profondità
    levels, z = [], 0.0
    while z > -p.depth_total + EPS:
        z = max(z - p.depth_per_pass, -p.depth_total)
        levels.append(round(z, 4))
    z_tab = round(-p.depth_total + p.bridge_height, 4)
    if bridges is not None and p.operation == "pocket":
        warnings.append("I ponticelli sono ignorati nelle pocket.")
        bridges = None

    op_names = {"profile_on": "Profilo sul centro", "profile_inside": "Profilo interno",
                "profile_outside": "Profilo esterno", "pocket": f"Pocket ({p.pocket_direction})"}
    out = [
        "; CNC V3 - Generated G-code",
        f"; Operation: {op_names.get(p.operation, p.operation)}",
        f"; Tool: {p.tool_name} D={_f(p.tool_diameter)}mm",
        f"; Material: {p.material}",
        f"; Feed: {_f(p.feed_rate)}mm/min, Plunge: {_f(p.plunge_rate)}mm/min, RPM: {_f(p.spindle_rpm)}",
        f"; Depth total: {_f(p.depth_total)}mm, Pass depth: {_f(p.depth_per_pass)}mm, Passes: {len(levels)}",
        f"; Safe height: {_f(p.safe_height)}mm" + (f", Bridge height: {_f(p.bridge_height)}mm" if bridges is not None else ""),
        "; Origin: X0 Y0 = stock center, Z0 = stock top surface",
        f"; Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "G21 G90 G17 G94",
        f"M3 S{int(p.spindle_rpm)}",
        "G4 P2",
        f"G0 Z{_f(p.safe_height)}",
    ]
    rapid_len = cut_len = 0.0
    cut_time = 0.0
    pos = (0.0, 0.0)
    curz = p.safe_height
    for li, zl in enumerate(levels, 1):
        out.append(f"; --- Pass {li}/{len(levels)} Z={_f(zl)} ---")
        for path in paths:
            pts = path.points
            if len(pts) < 2:
                continue
            start = pts[0]
            out.append(f"G0 Z{_f(p.safe_height)}")
            rapid_len += abs(p.safe_height - curz)
            out.append(f"G0 X{_f(start[0])} Y{_f(start[1])}")
            rapid_len += math.dist(pos, start)
            start_z = z_tab if (bridges is not None and zl < z_tab and bridges.contains(Point(start))) else zl
            out.append(f"G0 Z{_f(min(1.0, p.safe_height))}")
            out.append(f"G1 Z{_f(start_z)} F{_f(p.plunge_rate)}")
            cut_time += (min(1.0, p.safe_height) - start_z) / p.plunge_rate
            curz = start_z
            first_feed = True
            prev = start
            for nxt in pts[1:]:
                for end, zz in _split_by_bridges(prev, nxt, bridges, zl, z_tab):
                    if abs(zz - curz) > EPS:
                        out.append(f"G1 Z{_f(zz)} F{_f(p.plunge_rate)}")
                        cut_time += abs(zz - curz) / p.plunge_rate
                        curz = zz
                        first_feed = True
                    seg = math.dist(prev, end)
                    if seg < EPS:
                        continue
                    out.append(f"G1 X{_f(end[0])} Y{_f(end[1])}" + (f" F{_f(p.feed_rate)}" if first_feed else ""))
                    first_feed = False
                    cut_len += seg
                    cut_time += seg / p.feed_rate
                    prev = end
            pos = prev
        out.append(f"G0 Z{_f(p.safe_height)}")
        curz = p.safe_height
    out += [f"G0 Z{_f(p.safe_height)}", "G0 X0 Y0", "M5", "M30"]
    rapid_time = rapid_len / 3000.0
    return Result(
        gcode="\n".join(out) + "\n",
        line_count=len(out),
        path_length_mm=round(cut_len + rapid_len, 1),
        cut_length_mm=round(cut_len, 1),
        estimated_time_min=round(cut_time + rapid_time, 2),
        warnings=warnings,
    )
