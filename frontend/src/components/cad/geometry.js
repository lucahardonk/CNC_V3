// Geometria 2D per il CAD. Coordinate in mm, Y verso l'alto, angoli in gradi (antiorario).
export const EPS = 1e-6
export const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : 'e' + Math.random().toString(36).slice(2) + Date.now().toString(36))
export const rad = (d) => (d * Math.PI) / 180
export const deg = (r) => (r * 180) / Math.PI
export const norm360 = (a) => ((a % 360) + 360) % 360
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k })
export const len = (a) => Math.hypot(a.x, a.y)
export const unit = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l } }
export const dot = (a, b) => a.x * b.x + a.y * b.y
export const cross = (a, b) => a.x * b.y - a.y * b.x
export const polar = (c, r, a) => ({ x: c.x + r * Math.cos(rad(a)), y: c.y + r * Math.sin(rad(a)) })
export const angleOf = (c, p) => norm360(deg(Math.atan2(p.y - c.y, p.x - c.x)))
export const arcSweep = (s, e) => { const w = norm360(e - s); return w < EPS ? 360 : w }
export const round3 = (v) => Math.round(v * 1000) / 1000
export const rp = (p) => ({ x: round3(p.x), y: round3(p.y) })

// 20 colori per i layer (indice del layer nel progetto)
export const LAYER_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
  '#f43f5e', '#fb923c', '#facc15', '#4ade80', '#2dd4bf',
  '#60a5fa', '#a78bfa', '#f472b6', '#22d3ee', '#a3e635',
]
export const layerColor = (i) => LAYER_COLORS[((i % 20) + 20) % 20]

// Entità di sola annotazione (non tagliate, non intersecabili)
export const DIM_TYPES = ['dimension', 'dim_radial', 'dim_angle']
export const isDim = (e) => DIM_TYPES.includes(e.type)

// --------------------------------------------------------------------------- curve di supporto
export function rectLines(d) {
  const { x, y, w, h } = d
  const p = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  return p.map((a, i) => ({ a, b: p[(i + 1) % 4] }))
}

export function ellipsePoint(d, t) {
  const r = rad(d.rotation || 0), lx = d.rx * Math.cos(t), ly = d.ry * Math.sin(t)
  return { x: d.cx + lx * Math.cos(r) - ly * Math.sin(r), y: d.cy + lx * Math.sin(r) + ly * Math.cos(r) }
}
export function ellipsePoints(d, n = 36) {
  return Array.from({ length: n + 1 }, (_, i) => ellipsePoint(d, (2 * Math.PI * i) / n))
}

// Asola: `length` = distanza tra i centri dei due semicerchi, `width` = larghezza (2 × raggio)
export function slotParts(d) {
  const c = { x: d.cx, y: d.cy }, u = polar({ x: 0, y: 0 }, 1, d.angle || 0), n = { x: -u.y, y: u.x }
  const r = d.width / 2, h = d.length / 2
  const c1 = sub(c, mul(u, h)), c2 = add(c, mul(u, h))
  const a = d.angle || 0
  return {
    c1, c2, r,
    segs: [{ a: add(c1, mul(n, -r)), b: add(c2, mul(n, -r)) }, { a: add(c2, mul(n, r)), b: add(c1, mul(n, r)) }],
    arcs: [{ c: c2, r, start: norm360(a - 90), end: norm360(a + 90) }, { c: c1, r, start: norm360(a + 90), end: norm360(a + 270) }],
  }
}
export function slotPoints(d, n = 24) {
  const s = slotParts(d), out = []
  const arcPts = (A) => Array.from({ length: n + 1 }, (_, i) => polar(A.c, A.r, A.start + (180 * i) / n))
  out.push(s.segs[0].a, ...arcPts(s.arcs[0]), ...arcPts(s.arcs[1]))
  out.push(s.segs[0].a)
  return out
}

// Catmull-Rom (tangente = (p[i+1]-p[i-1]) * 0.5) campionata
export function catmullRomPoints(points, samples = 20) {
  if (!points || points.length < 2) return points ? [...points] : []
  const P = (i) => points[Math.max(0, Math.min(points.length - 1, i))]
  const out = [points[0]]
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2)
    for (let k = 1; k <= samples; k++) {
      const t = k / samples, t2 = t * t, t3 = t2 * t
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  return out
}

// Stringa path SVG (curve cubiche) per una Catmull-Rom. `map` converte in coordinate schermo.
export function catmullRomPath(points, map = (p) => p) {
  if (!points || points.length < 2) return ''
  const q = points.map(map)
  const P = (i) => q[Math.max(0, Math.min(q.length - 1, i))]
  let d = `M ${q[0].x} ${q[0].y}`
  for (let i = 0; i < q.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2)
    const b1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const b2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    d += ` C ${b1.x} ${b1.y} ${b2.x} ${b2.y} ${p2.x} ${p2.y}`
  }
  return d
}

export function polyPath(points, map = (p) => p, close = false) {
  if (!points.length) return ''
  return points.map((p, i) => { const s = map(p); return `${i ? 'L' : 'M'} ${s.x} ${s.y}` }).join(' ') + (close ? ' Z' : '')
}

// Path SVG di un'asola
export function slotPath(d, map = (p) => p) { return polyPath(slotPoints(d), map, true) }

// Cerchio per 3 punti (null se collineari)
export function circumcircle(p1, p2, p3) {
  const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y))
  if (Math.abs(D) < 1e-9) return null
  const s1 = p1.x * p1.x + p1.y * p1.y, s2 = p2.x * p2.x + p2.y * p2.y, s3 = p3.x * p3.x + p3.y * p3.y
  const cx = (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / D
  const cy = (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / D
  return { cx, cy, r: Math.hypot(p1.x - cx, p1.y - cy) }
}

// Arco di centro c passante per pA e pB e contenente pMid (sceglie il verso antiorario corretto)
export function arcThrough(c, r, pA, pMid, pB) {
  const a = angleOf(c, pA), m = angleOf(c, pMid), b = angleOf(c, pB)
  const ccw = norm360(m - a) <= norm360(b - a)
  return { cx: round3(c.x), cy: round3(c.y), r: round3(r), start: round3(ccw ? a : b), end: round3(ccw ? b : a) }
}

export function arcFrom3(p1, p2, p3) {
  const cc = circumcircle(p1, p2, p3)
  if (!cc) return null
  return arcThrough({ x: cc.cx, y: cc.cy }, cc.r, p1, p2, p3)
}

// Arco da inizio, fine e raggio; si incurva verso `towards` (arco minore). r < corda/2 → semicerchio.
export function arcStartEndRadius(s, e, r, towards) {
  const L = dist(s, e)
  if (L < EPS) return null
  const R = Math.max(r, L / 2)
  const m = mul(add(s, e), 0.5), u = unit(sub(e, s)), n = { x: -u.y, y: u.x }
  const sg = towards && cross(u, sub(towards, m)) < 0 ? -1 : 1
  const h = Math.sqrt(Math.max(0, R * R - (L / 2) ** 2))
  const c = add(m, mul(n, -sg * h))
  const bulge = add(m, mul(n, sg * (R - h)))
  return arcThrough(c, R, s, bulge, e)
}

// Rettangolo per 3 punti: p1-p2 primo lato, p3 definisce la larghezza. Ritorna i 4 vertici.
export function rect3Corners(p1, p2, p3) {
  const u = unit(sub(p2, p1)), n = { x: -u.y, y: u.x }
  const w = dot(sub(p3, p2), n)
  return [p1, p2, add(p2, mul(n, w)), add(p1, mul(n, w))]
}

// Intersezione di rette infinite
export function lineIntersection(a1, a2, b1, b2) {
  const r = sub(a2, a1), s = sub(b2, b1)
  const den = cross(r, s)
  if (Math.abs(den) < EPS) return null
  const t = cross(sub(b1, a1), s) / den
  return add(a1, mul(r, t))
}

// Angolo tra due linee: lato scelto in base ai punti di click. Ritorna {P, a1, a2, sweep} o null (parallele)
export function angleBetweenLines(l1, c1, l2, c2) {
  const A1 = { x: l1.data.x1, y: l1.data.y1 }, A2 = { x: l1.data.x2, y: l1.data.y2 }
  const B1 = { x: l2.data.x1, y: l2.data.y1 }, B2 = { x: l2.data.x2, y: l2.data.y2 }
  const P = lineIntersection(A1, A2, B1, B2)
  if (!P) return null
  const dirTo = (a1, a2, click) => {
    const dir = unit(sub(a2, a1))
    const proj = add(a1, mul(dir, dot(sub(click, a1), dir)))
    const v = sub(proj, P)
    return len(v) < EPS ? (dist(a1, P) > dist(a2, P) ? unit(sub(a1, P)) : unit(sub(a2, P))) : unit(v)
  }
  const u1 = dirTo(A1, A2, c1), u2 = dirTo(B1, B2, c2)
  let a1 = angleOf({ x: 0, y: 0 }, u1), a2 = angleOf({ x: 0, y: 0 }, u2)
  if (arcSweep(a1, a2) > 180) [a1, a2] = [a2, a1]
  return { P, a1, a2, sweep: arcSweep(a1, a2) }
}

// Quota lineare: punti misurati a,b e linea di quota spostata di `off` mm sulla normale sinistra
export function dimLinePoints(d) {
  const a = { x: d.x1, y: d.y1 }, b = { x: d.x2, y: d.y2 }
  const u = unit(sub(b, a)), n = { x: -u.y, y: u.x }, off = d.off || 0
  return { a, b, n, off, A: add(a, mul(n, off)), B: add(b, mul(n, off)) }
}

// --------------------------------------------------------------------------- primitive
const segsOf = (pts) => pts.slice(0, -1).map((a, i) => ({ kind: 'seg', a, b: pts[i + 1] }))

export function primitives(e) {
  const d = e.data
  switch (e.type) {
    case 'line': case 'construction':
      return [{ kind: 'seg', a: { x: d.x1, y: d.y1 }, b: { x: d.x2, y: d.y2 } }]
    case 'dimension': { const q = dimLinePoints(d); return [{ kind: 'seg', a: q.A, b: q.B }] }
    case 'rect': case 'bridge':
      return rectLines(d).map((s) => ({ kind: 'seg', ...s }))
    case 'circle':
      return [{ kind: 'circ', c: { x: d.cx, y: d.cy }, r: d.r }]
    case 'arc':
      return [{ kind: 'circ', c: { x: d.cx, y: d.cy }, r: d.r, start: d.start, end: d.end }]
    case 'ellipse': // approssimata con 36 segmenti per intersezioni e hit-test
      return segsOf(ellipsePoints(d, 36))
    case 'slot': {
      const s = slotParts(d)
      return [...s.segs.map((x) => ({ kind: 'seg', ...x })), ...s.arcs.map((a) => ({ kind: 'circ', ...a }))]
    }
    case 'spline':
      return segsOf(catmullRomPoints(d.points || [], 20))
    case 'dim_radial': {
      const c = { x: d.cx, y: d.cy }, b = polar(c, d.r, d.angle)
      return [{ kind: 'seg', a: d.diam ? polar(c, d.r, d.angle + 180) : c, b }]
    }
    case 'dim_angle':
      return [{ kind: 'circ', c: { x: d.cx, y: d.cy }, r: d.r, start: d.a1, end: d.a2 }]
    default: return []
  }
}

const inArc = (p, ang) => p.start === undefined || norm360(ang - p.start) <= arcSweep(p.start, p.end) + 1e-7

export function closestOnPrim(p, pt) {
  if (p.kind === 'seg') {
    const ab = sub(p.b, p.a)
    const L2 = dot(ab, ab)
    const t = L2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(pt, p.a), ab) / L2))
    const q = add(p.a, mul(ab, t))
    return { point: q, d: dist(q, pt), t, tangent: unit(ab) }
  }
  const a = angleOf(p.c, pt)
  if (inArc(p, a)) {
    const q = polar(p.c, p.r, a)
    return { point: q, d: dist(q, pt), angle: a, tangent: { x: -Math.sin(rad(a)), y: Math.cos(rad(a)) } }
  }
  const s = polar(p.c, p.r, p.start), e = polar(p.c, p.r, p.end)
  const q = dist(s, pt) < dist(e, pt) ? s : e
  const qa = angleOf(p.c, q)
  return { point: q, d: dist(q, pt), angle: qa, tangent: { x: -Math.sin(rad(qa)), y: Math.cos(rad(qa)) } }
}

export function closestOnEntity(e, pt) {
  let best = null
  for (const p of primitives(e)) {
    const c = closestOnPrim(p, pt)
    if (!best || c.d < best.d) best = c
  }
  if (best && e.type === 'bridge') {
    const { x, y, w, h } = e.data
    if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) return { ...best, d: 0 }
  }
  return best
}

export function keyPoints(e) {
  const d = e.data
  switch (e.type) {
    case 'line': case 'construction': case 'dimension':
      return [{ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }, { x: (d.x1 + d.x2) / 2, y: (d.y1 + d.y2) / 2 }]
    case 'rect': case 'bridge':
      return [...rectLines(d).map((s) => s.a), ...rectLines(d).map((s) => mul(add(s.a, s.b), 0.5)), { x: d.x + d.w / 2, y: d.y + d.h / 2 }]
    case 'circle':
      return [{ x: d.cx, y: d.cy }, ...[0, 90, 180, 270].map((a) => polar({ x: d.cx, y: d.cy }, d.r, a))]
    case 'arc': {
      const c = { x: d.cx, y: d.cy }
      return [c, polar(c, d.r, d.start), polar(c, d.r, d.end), polar(c, d.r, d.start + arcSweep(d.start, d.end) / 2)]
    }
    case 'ellipse':
      return [{ x: d.cx, y: d.cy }, ...[0, 0.5, 1, 1.5].map((k) => ellipsePoint(d, k * Math.PI))]
    case 'slot': {
      const s = slotParts(d)
      return [{ x: d.cx, y: d.cy }, s.c1, s.c2, s.segs[0].a, s.segs[0].b, s.segs[1].a, s.segs[1].b]
    }
    case 'spline': return [...(d.points || [])]
    default: return []
  }
}

const bboxOfPts = (pts) => ({
  minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)),
  maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)),
})

export function bbox(e) {
  const d = e.data
  switch (e.type) {
    case 'rect': case 'bridge': return { minX: d.x, minY: d.y, maxX: d.x + d.w, maxY: d.y + d.h }
    case 'circle': case 'arc': case 'dim_radial': case 'dim_angle':
      return { minX: d.cx - d.r, minY: d.cy - d.r, maxX: d.cx + d.r, maxY: d.cy + d.r }
    case 'ellipse':
      if (!d.rotation) return { minX: d.cx - d.rx, maxX: d.cx + d.rx, minY: d.cy - d.ry, maxY: d.cy + d.ry }
      return bboxOfPts(ellipsePoints(d, 72))
    case 'slot': return bboxOfPts(slotPoints(d, 24))
    case 'spline': return bboxOfPts(d.points?.length ? catmullRomPoints(d.points, 8) : [{ x: 0, y: 0 }])
    default: return { minX: Math.min(d.x1, d.x2), minY: Math.min(d.y1, d.y2), maxX: Math.max(d.x1, d.x2), maxY: Math.max(d.y1, d.y2) }
  }
}

// --------------------------------------------------------------------------- intersezioni
function segSeg(p, q) {
  const r = sub(p.b, p.a), s = sub(q.b, q.a)
  const den = cross(r, s)
  if (Math.abs(den) < EPS) return []
  const t = cross(sub(q.a, p.a), s) / den
  const u = cross(sub(q.a, p.a), r) / den
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return []
  return [add(p.a, mul(r, t))]
}

function segCirc(s, c) {
  const d = sub(s.b, s.a), f = sub(s.a, c.c)
  const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - c.r * c.r
  let disc = B * B - 4 * A * C
  if (disc < -1e-9 || A < EPS) return []
  disc = Math.sqrt(Math.max(0, disc))
  const out = []
  for (const t of [(-B - disc) / (2 * A), (-B + disc) / (2 * A)]) {
    if (t >= -1e-9 && t <= 1 + 1e-9) {
      const p = add(s.a, mul(d, t))
      if (inArc(c, angleOf(c.c, p))) out.push(p)
    }
  }
  return out
}

function circCirc(a, b) {
  const d = dist(a.c, b.c)
  if (d < EPS || d > a.r + b.r + 1e-9 || d < Math.abs(a.r - b.r) - 1e-9) return []
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d)
  const h = Math.sqrt(Math.max(0, a.r * a.r - x * x))
  const u = unit(sub(b.c, a.c))
  const m = add(a.c, mul(u, x))
  const pts = [{ x: m.x - u.y * h, y: m.y + u.x * h }, { x: m.x + u.y * h, y: m.y - u.x * h }]
  return pts.filter((p) => inArc(a, angleOf(a.c, p)) && inArc(b, angleOf(b.c, p)))
}

export function intersectPrims(p, q) {
  if (p.kind === 'seg' && q.kind === 'seg') return segSeg(p, q)
  if (p.kind === 'seg') return segCirc(p, q)
  if (q.kind === 'seg') return segCirc(q, p)
  return circCirc(p, q)
}

// Intersezioni dell'entità `e` con TUTTE le altre entità (esclusa se stessa, quote e ponticelli)
export function intersectionsWith(e, others) {
  const out = []
  const pe = primitives(e)
  for (const o of others) {
    if (o === e || o.id === e.id || isDim(o) || o.type === 'bridge') continue
    const po = primitives(o)
    for (const a of pe) for (const b of po) out.push(...intersectPrims(a, b))
  }
  return out
}

// --------------------------------------------------------------------------- trasformazioni
export function translate(e, dx, dy) {
  const d = { ...e.data }
  for (const k of ['x1', 'x2', 'x', 'cx']) if (k in d) d[k] = round3(d[k] + dx)
  for (const k of ['y1', 'y2', 'y', 'cy']) if (k in d) d[k] = round3(d[k] + dy)
  if (Array.isArray(d.points)) d.points = d.points.map((p) => ({ x: round3(p.x + dx), y: round3(p.y + dy) }))
  return { ...e, data: d }
}

export function explodeRect(e) {
  return rectLines(e.data).map((s) => ({ id: uid(), type: 'line', is_construction: e.is_construction, data: { x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y } }))
}

// Asola → 2 linee + 2 archi (geometria esatta)
export function explodeSlot(e) {
  const s = slotParts(e.data)
  return [
    ...s.segs.map((g) => ({ id: uid(), type: 'line', is_construction: e.is_construction, data: { x1: round3(g.a.x), y1: round3(g.a.y), x2: round3(g.b.x), y2: round3(g.b.y) } })),
    ...s.arcs.map((a) => ({ id: uid(), type: 'arc', is_construction: e.is_construction, data: { cx: round3(a.c.x), cy: round3(a.c.y), r: round3(a.r), start: round3(a.start), end: round3(a.end) } })),
  ]
}

const linesFromCorners = (pts, e) => pts.map((a, i) => {
  const b = pts[(i + 1) % pts.length]
  return { id: uid(), type: 'line', is_construction: !!e?.is_construction, data: { x1: round3(a.x), y1: round3(a.y), x2: round3(b.x), y2: round3(b.y) } }
})
export const polygonLines = linesFromCorners

function reflectPt(p, a, b) {
  const u = unit(sub(b, a))
  const v = sub(p, a)
  const proj = add(a, mul(u, dot(v, u)))
  return { x: round3(2 * proj.x - p.x), y: round3(2 * proj.y - p.y) }
}

export function mirrorEntity(e, a, b) {
  const d = e.data
  const id = uid()
  const axisAng = angleOf(a, b)
  const refAng = (x) => round3(norm360(2 * axisAng - x))
  if (e.type === 'rect' || e.type === 'bridge') {
    const axisAligned = Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS
    if (!axisAligned) return explodeRect(e).map((l) => mirrorEntity(l, a, b)).flat()
    const p1 = reflectPt({ x: d.x, y: d.y }, a, b), p2 = reflectPt({ x: d.x + d.w, y: d.y + d.h }, a, b)
    return [{ ...e, id, data: normRect(p1, p2) }]
  }
  if (e.type === 'circle') { const c = reflectPt({ x: d.cx, y: d.cy }, a, b); return [{ ...e, id, data: { ...d, cx: c.x, cy: c.y } }] }
  if (e.type === 'arc') {
    const c0 = { x: d.cx, y: d.cy }
    const c = reflectPt(c0, a, b)
    const s = reflectPt(polar(c0, d.r, d.start), a, b), en = reflectPt(polar(c0, d.r, d.end), a, b)
    return [{ ...e, id, data: { ...d, cx: c.x, cy: c.y, start: round3(angleOf(c, en)), end: round3(angleOf(c, s)) } }]
  }
  if (e.type === 'ellipse' || e.type === 'slot') {
    const c = reflectPt({ x: d.cx, y: d.cy }, a, b)
    const k = e.type === 'ellipse' ? 'rotation' : 'angle'
    return [{ ...e, id, data: { ...d, cx: c.x, cy: c.y, [k]: refAng(d[k] || 0) } }]
  }
  if (e.type === 'spline') return [{ ...e, id, data: { ...d, points: d.points.map((p) => reflectPt(p, a, b)) } }]
  if (e.type === 'dim_radial') {
    const c = reflectPt({ x: d.cx, y: d.cy }, a, b)
    return [{ ...e, id, data: { ...d, cx: c.x, cy: c.y, angle: refAng(d.angle) } }]
  }
  if (e.type === 'dim_angle') {
    const c = reflectPt({ x: d.cx, y: d.cy }, a, b)
    return [{ ...e, id, data: { ...d, cx: c.x, cy: c.y, a1: refAng(d.a2), a2: refAng(d.a1) } }]
  }
  const p1 = reflectPt({ x: d.x1, y: d.y1 }, a, b), p2 = reflectPt({ x: d.x2, y: d.y2 }, a, b)
  const nd = { ...d, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
  if (e.type === 'dimension' && d.off) nd.off = -d.off // la riflessione inverte la normale
  return [{ ...e, id, data: nd }]
}

const rotPt = (p, c, ang) => {
  const r = rad(ang), dx = p.x - c.x, dy = p.y - c.y
  return { x: round3(c.x + dx * Math.cos(r) - dy * Math.sin(r)), y: round3(c.y + dx * Math.sin(r) + dy * Math.cos(r)) }
}

// Ruota un'entità di angleDeg attorno a center. Ritorna un array (i rettangoli ruotati
// di angoli non multipli di 90° vengono esplosi in linee). Gli id vengono rigenerati.
export function rotateEntity(e, center, angleDeg) {
  const d = e.data
  const id = uid()
  const ra = (x) => round3(norm360(x + angleDeg))
  switch (e.type) {
    case 'rect': case 'bridge': {
      const q = norm360(angleDeg)
      const right = [0, 90, 180, 270].some((k) => Math.abs(q - k) < 1e-6 || Math.abs(q - k - 360) < 1e-6)
      const corners = rectLines(d).map((s) => rotPt(s.a, center, angleDeg))
      if (right) return [{ ...e, id, data: normRect(corners[0], corners[2]) }]
      if (e.type === 'bridge') return [] // i ponticelli restano allineati agli assi
      return linesFromCorners(corners, e)
    }
    case 'circle': { const c = rotPt({ x: d.cx, y: d.cy }, center, angleDeg); return [{ ...e, id, data: { ...d, cx: c.x, cy: c.y } }] }
    case 'arc': {
      const c = rotPt({ x: d.cx, y: d.cy }, center, angleDeg)
      return [{ ...e, id, data: { ...d, cx: c.x, cy: c.y, start: ra(d.start), end: ra(d.end) } }]
    }
    case 'ellipse': case 'slot': {
      const c = rotPt({ x: d.cx, y: d.cy }, center, angleDeg)
      const k = e.type === 'ellipse' ? 'rotation' : 'angle'
      return [{ ...e, id, data: { ...d, cx: c.x, cy: c.y, [k]: ra(d[k] || 0) } }]
    }
    case 'spline': return [{ ...e, id, data: { ...d, points: d.points.map((p) => rotPt(p, center, angleDeg)) } }]
    case 'dim_radial': {
      const c = rotPt({ x: d.cx, y: d.cy }, center, angleDeg)
      return [{ ...e, id, data: { ...d, cx: c.x, cy: c.y, angle: ra(d.angle) } }]
    }
    case 'dim_angle': {
      const c = rotPt({ x: d.cx, y: d.cy }, center, angleDeg)
      return [{ ...e, id, data: { ...d, cx: c.x, cy: c.y, a1: ra(d.a1), a2: ra(d.a2) } }]
    }
    default: {
      const p1 = rotPt({ x: d.x1, y: d.y1 }, center, angleDeg), p2 = rotPt({ x: d.x2, y: d.y2 }, center, angleDeg)
      return [{ ...e, id, data: { ...d, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y } }]
    }
  }
}

export function normRect(p1, p2) {
  return { x: round3(Math.min(p1.x, p2.x)), y: round3(Math.min(p1.y, p2.y)), w: round3(Math.abs(p2.x - p1.x)), h: round3(Math.abs(p2.y - p1.y)) }
}

// --------------------------------------------------------------------------- trim
// Trim di una polilinea campionata (ellisse/spline). I pezzi rimanenti diventano spline.
function trimPolyline(e, pts, closed, pt, all) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]))
  const total = cum[cum.length - 1]
  if (total < EPS) return []
  const param = (q) => {
    let best = null
    for (let i = 0; i < pts.length - 1; i++) {
      const c = closestOnPrim({ kind: 'seg', a: pts[i], b: pts[i + 1] }, q)
      if (!best || c.d < best.d) best = { d: c.d, s: cum[i] + c.t * (cum[i + 1] - cum[i]) }
    }
    return best.s
  }
  const self = { ...e, type: 'spline', data: { points: pts } }
  const ss = [...new Set(intersectionsWith({ ...self, id: e.id }, all).map(param)
    .filter((s) => closed || (s > 1e-4 && s < total - 1e-4)).map((s) => +s.toFixed(6)))].sort((a, b) => a - b)
  const sc = param(pt)
  const piece = (a, b) => { // pezzo tra le ascisse a→b (b può superare total se chiuso)
    const out = []
    const at = (s) => {
      s = closed ? ((s % total) + total) % total : s
      let i = cum.findIndex((c) => c >= s); if (i <= 0) i = 1
      const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)
      return add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), t))
    }
    const step = Math.max(total / 200, (b - a) / 60)
    for (let s = a; s < b; s += step) out.push(rp(at(s)))
    out.push(rp(at(b)))
    return out.length >= 2 ? { id: uid(), type: 'spline', is_construction: e.is_construction, data: { points: out } } : null
  }
  if (closed) {
    if (ss.length < 2) return []
    const i = ss.findIndex((s) => s > sc)
    const hi = i === -1 ? ss[0] : ss[i]
    const lo = i <= 0 ? ss[ss.length - 1] : ss[i - 1]
    const end = lo < hi ? lo + total : lo
    return [piece(hi, end)].filter(Boolean)
  }
  let lo = 0, hi = total
  for (const s of ss) { if (s < sc) lo = s; else { hi = s; break } }
  return [lo > 0 ? piece(0, lo) : null, hi < total ? piece(hi, total) : null].filter(Boolean)
}

// Ritorna la lista di entità che sostituisce `e` dopo il trim al punto `pt`.
// Rimuove solo il tratto compreso tra le due intersezioni più vicine al click;
// se l'entità non interseca nessun'altra entità viene eliminata per intero.
export function trimEntity(e, pt, all) {
  const others = all.filter((o) => o.id !== e.id)
  const inter = intersectionsWith(e, others)
  const d = e.data
  if (e.type === 'line') {
    if (!inter.length) return []
    const a = { x: d.x1, y: d.y1 }, b = { x: d.x2, y: d.y2 }
    const ab = sub(b, a), L2 = dot(ab, ab)
    if (L2 < EPS) return []
    const tc = Math.max(0, Math.min(1, dot(sub(pt, a), ab) / L2))
    const ts = [...new Set(inter.map((p) => dot(sub(p, a), ab) / L2).filter((t) => t > 1e-6 && t < 1 - 1e-6).map((t) => +t.toFixed(9)))].sort((x, y) => x - y)
    let lo = 0, hi = 1
    for (const t of ts) { if (t < tc) lo = t; else { hi = t; break } }
    const out = []
    const P = (t) => add(a, mul(ab, t))
    if (lo > 0) { const q = P(lo); out.push({ ...e, id: uid(), data: { x1: d.x1, y1: d.y1, x2: round3(q.x), y2: round3(q.y) } }) }
    if (hi < 1) { const q = P(hi); out.push({ ...e, id: uid(), data: { x1: round3(q.x), y1: round3(q.y), x2: d.x2, y2: d.y2 } }) }
    return out
  }
  if (e.type === 'circle' || e.type === 'arc') {
    if (!inter.length) return []
    const c = { x: d.cx, y: d.cy }
    const start = e.type === 'arc' ? d.start : 0
    const sweep = e.type === 'arc' ? arcSweep(d.start, d.end) : 360
    const rel = (p) => norm360(angleOf(c, p) - start)
    const rc = rel(pt)
    if (e.type === 'circle') {
      // NB: nessun filtro sugli estremi (un'intersezione a 0° è valida); 360° ≡ 0°
      const rs = [...new Set(inter.map(rel).map((r) => (r > 360 - 1e-4 ? 0 : +r.toFixed(6))))].sort((x, y) => x - y)
      if (rs.length < 2) return []
      const i = rs.findIndex((r) => r > rc)
      const hi = i === -1 ? rs[0] : rs[i]
      const lo = i <= 0 ? rs[rs.length - 1] : rs[i - 1]
      return [{ ...e, id: uid(), type: 'arc', data: { cx: d.cx, cy: d.cy, r: d.r, start: round3(norm360(hi)), end: round3(norm360(lo)) } }]
    }
    const rs = [...new Set(inter.map(rel).filter((r) => r > 1e-4 && r < sweep - 1e-4).map((r) => +r.toFixed(6)))].sort((x, y) => x - y)
    let lo = 0, hi = sweep
    for (const r of rs) { if (r < rc) lo = r; else { hi = r; break } }
    const out = []
    if (lo > 0) out.push({ ...e, id: uid(), data: { ...d, end: round3(norm360(start + lo)) } })
    if (hi < sweep) out.push({ ...e, id: uid(), data: { ...d, start: round3(norm360(start + hi)) } })
    return out
  }
  if (e.type === 'ellipse') return inter.length ? trimPolyline(e, ellipsePoints(d, 144), true, pt, others) : []
  if (e.type === 'spline') return inter.length ? trimPolyline(e, catmullRomPoints(d.points, 20), false, pt, others) : []
  return [e]
}

// --------------------------------------------------------------------------- fillet
// l1, l2: entità linea; c1, c2: punti di click (lato da mantenere). Ritorna {l1, l2, arc} o null.
export function filletLines(l1, c1, l2, c2, r) {
  const A1 = { x: l1.data.x1, y: l1.data.y1 }, A2 = { x: l1.data.x2, y: l1.data.y2 }
  const B1 = { x: l2.data.x1, y: l2.data.y1 }, B2 = { x: l2.data.x2, y: l2.data.y2 }
  const P = lineIntersection(A1, A2, B1, B2)
  if (!P || !(r > 0)) return null
  const side = (a1, a2, click) => {
    const dir = unit(sub(a2, a1))
    const proj = add(a1, mul(dir, dot(sub(click, a1), dir)))
    const u = unit(sub(proj, P))
    const far = dot(sub(a1, P), u) > dot(sub(a2, P), u) ? 'start' : 'end'
    return { u, far }
  }
  const s1 = side(A1, A2, c1), s2 = side(B1, B2, c2)
  const cosT = Math.max(-1, Math.min(1, dot(s1.u, s2.u)))
  const theta = Math.acos(cosT)
  if (theta < 1e-3 || Math.PI - theta < 1e-3) return null
  const t = r / Math.tan(theta / 2)
  const T1 = add(P, mul(s1.u, t)), T2 = add(P, mul(s2.u, t))
  const bis = unit(add(s1.u, s2.u))
  const C = add(P, mul(bis, r / Math.sin(theta / 2)))
  const upd = (l, s, T) => {
    const d = { ...l.data }
    if (s.far === 'start') { d.x2 = round3(T.x); d.y2 = round3(T.y) } else { d.x1 = round3(T.x); d.y1 = round3(T.y) }
    return { ...l, data: d }
  }
  let a1 = angleOf(C, T1), a2 = angleOf(C, T2)
  if (arcSweep(a1, a2) > 180) [a1, a2] = [a2, a1]
  return {
    l1: upd(l1, s1, T1), l2: upd(l2, s2, T2),
    arc: { id: uid(), type: 'arc', is_construction: false, data: { cx: round3(C.x), cy: round3(C.y), r, start: round3(a1), end: round3(a2) } },
  }
}

// --------------------------------------------------------------------------- quote parametriche
// Quota con { targetId, param, side?, driving } → collegata a un'entità geometrica.
// param: length (linea) · width/height (lato rettangolo, side = indice in explodeRect) · diameter/radius (cerchio/arco)

// Coordinate aggiornate della quota calcolate dall'entità di riferimento (null se non collegata/non valida)
export function dimLiveData(dim, target) {
  if (!dim.targetId || !target) return null
  const d = dim.data, t = target.data
  if (dim.type === 'dimension') {
    if (target.type === 'line' || target.type === 'construction') return { ...d, x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 }
    if (target.type === 'rect') {
      const s = explodeRect(target)[dim.side ?? 0]
      return s ? { ...d, x1: s.data.x1, y1: s.data.y1, x2: s.data.x2, y2: s.data.y2 } : null
    }
  }
  if (dim.type === 'dim_radial' && (target.type === 'circle' || target.type === 'arc')) return { ...d, cx: t.cx, cy: t.cy, r: t.r }
  return null
}

// Valore misurato della quota (mm o gradi)
export function dimValue(dim) {
  const d = dim.data
  if (dim.type === 'dimension') return Math.hypot(d.x2 - d.x1, d.y2 - d.y1)
  if (dim.type === 'dim_radial') return d.diam ? 2 * d.r : d.r
  if (dim.type === 'dim_angle') return arcSweep(d.a1, d.a2)
  return 0
}

// Nuovi dati dell'entità di riferimento con il parametro impostato a `val` (null se non applicabile)
export function applyDimParam(target, param, val) {
  const t = target.data
  if (!(val > 0)) return null
  switch (param) {
    case 'length': {
      const L = Math.hypot(t.x2 - t.x1, t.y2 - t.y1)
      if (L < 1e-9) return null
      return { ...t, x2: round3(t.x1 + (t.x2 - t.x1) / L * val), y2: round3(t.y1 + (t.y2 - t.y1) / L * val) }
    }
    case 'width': return target.type === 'rect' ? { ...t, w: round3(val) } : null
    case 'height': return target.type === 'rect' ? { ...t, h: round3(val) } : null
    case 'diameter': return { ...t, r: round3(val / 2) }
    case 'radius': return { ...t, r: round3(val) }
    default: return null
  }
}

// Allinea tutte le quote collegate alle entità di riferimento correnti
export function syncDims(list) {
  const byId = new Map(list.map((e) => [e.id, e]))
  return list.map((e) => {
    if (!e.targetId) return e
    const live = dimLiveData(e, byId.get(e.targetId))
    return live ? { ...e, data: live } : e
  })
}
