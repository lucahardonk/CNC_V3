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

// --------------------------------------------------------------------------- primitive
export function rectLines(d) {
  const { x, y, w, h } = d
  const p = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  return p.map((a, i) => ({ a, b: p[(i + 1) % 4] }))
}

export function primitives(e) {
  const d = e.data
  switch (e.type) {
    case 'line': case 'construction': case 'dimension':
      return [{ kind: 'seg', a: { x: d.x1, y: d.y1 }, b: { x: d.x2, y: d.y2 } }]
    case 'rect': case 'bridge':
      return rectLines(d).map((s) => ({ kind: 'seg', ...s }))
    case 'circle':
      return [{ kind: 'circ', c: { x: d.cx, y: d.cy }, r: d.r }]
    case 'arc':
      return [{ kind: 'circ', c: { x: d.cx, y: d.cy }, r: d.r, start: d.start, end: d.end }]
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
  if (e.type === 'bridge' || e.type === 'rect') {
    const { x, y, w, h } = e.data
    if (e.type === 'bridge' && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) return { ...best, d: 0 }
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
    default: return []
  }
}

export function bbox(e) {
  const d = e.data
  switch (e.type) {
    case 'rect': case 'bridge': return { minX: d.x, minY: d.y, maxX: d.x + d.w, maxY: d.y + d.h }
    case 'circle': case 'arc': return { minX: d.cx - d.r, minY: d.cy - d.r, maxX: d.cx + d.r, maxY: d.cy + d.r }
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
  if (disc < 0 || A < EPS) return []
  disc = Math.sqrt(disc)
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

export function intersectionsWith(e, others) {
  const out = []
  const pe = primitives(e)
  for (const o of others) {
    if (o.id === e.id || o.type === 'dimension' || o.type === 'bridge') continue
    for (const a of pe) for (const b of primitives(o)) out.push(...intersectPrims(a, b))
  }
  return out
}

// --------------------------------------------------------------------------- trasformazioni
export function translate(e, dx, dy) {
  const d = { ...e.data }
  for (const k of ['x1', 'x2', 'x', 'cx']) if (k in d) d[k] = round3(d[k] + dx)
  for (const k of ['y1', 'y2', 'y', 'cy']) if (k in d) d[k] = round3(d[k] + dy)
  return { ...e, data: d }
}

export function explodeRect(e) {
  return rectLines(e.data).map((s) => ({ id: uid(), type: 'line', is_construction: e.is_construction, data: { x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y } }))
}

function reflectPt(p, a, b) {
  const u = unit(sub(b, a))
  const v = sub(p, a)
  const proj = add(a, mul(u, dot(v, u)))
  return { x: round3(2 * proj.x - p.x), y: round3(2 * proj.y - p.y) }
}

export function mirrorEntity(e, a, b) {
  const d = e.data
  const id = uid()
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
  const p1 = reflectPt({ x: d.x1, y: d.y1 }, a, b), p2 = reflectPt({ x: d.x2, y: d.y2 }, a, b)
  return [{ ...e, id, data: { ...d, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y } }]
}

export function normRect(p1, p2) {
  return { x: round3(Math.min(p1.x, p2.x)), y: round3(Math.min(p1.y, p2.y)), w: round3(Math.abs(p2.x - p1.x)), h: round3(Math.abs(p2.y - p1.y)) }
}

// --------------------------------------------------------------------------- trim
// Ritorna la lista di entità che sostituisce `e` dopo il trim al punto `pt`.
export function trimEntity(e, pt, all) {
  const inter = intersectionsWith(e, all)
  const d = e.data
  if (e.type === 'line') {
    const a = { x: d.x1, y: d.y1 }, b = { x: d.x2, y: d.y2 }
    const ab = sub(b, a), L2 = dot(ab, ab)
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
    const c = { x: d.cx, y: d.cy }
    const start = e.type === 'arc' ? d.start : 0
    const sweep = e.type === 'arc' ? arcSweep(d.start, d.end) : 360
    const rel = (p) => norm360(angleOf(c, p) - start)
    const rc = rel(pt)
    const rs = [...new Set(inter.map(rel).filter((r) => r > 1e-4 && r < sweep - 1e-4).map((r) => +r.toFixed(6)))].sort((x, y) => x - y)
    if (e.type === 'circle') {
      if (rs.length < 2) return []
      let i = rs.findIndex((r) => r > rc)
      const hi = i === -1 ? rs[0] : rs[i]
      const lo = i <= 0 ? rs[rs.length - 1] : rs[i - 1]
      return [{ ...e, id: uid(), type: 'arc', data: { cx: d.cx, cy: d.cy, r: d.r, start: round3(norm360(hi)), end: round3(norm360(lo)) } }]
    }
    let lo = 0, hi = sweep
    for (const r of rs) { if (r < rc) lo = r; else { hi = r; break } }
    const out = []
    if (lo > 0) out.push({ ...e, id: uid(), data: { ...d, end: round3(norm360(start + lo)) } })
    if (hi < sweep) out.push({ ...e, id: uid(), data: { ...d, start: round3(norm360(start + hi)) } })
    return out
  }
  return [e]
}

// --------------------------------------------------------------------------- fillet
function lineIntersection(a1, a2, b1, b2) {
  const r = sub(a2, a1), s = sub(b2, b1)
  const den = cross(r, s)
  if (Math.abs(den) < EPS) return null
  const t = cross(sub(b1, a1), s) / den
  return add(a1, mul(r, t))
}

// l1, l2: entità linea; c1, c2: punti di click (lato da mantenere). Ritorna {l1, l2, arc} o null.
export function filletLines(l1, c1, l2, c2, r) {
  const A1 = { x: l1.data.x1, y: l1.data.y1 }, A2 = { x: l1.data.x2, y: l1.data.y2 }
  const B1 = { x: l2.data.x1, y: l2.data.y1 }, B2 = { x: l2.data.x2, y: l2.data.y2 }
  const P = lineIntersection(A1, A2, B1, B2)
  if (!P) return null
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
