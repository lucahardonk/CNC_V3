// Geometria 2D in mm. Origine = centro del foglio, Y verso l'alto.
import { textToPolylines } from './font'
import { layoutTextbox } from './textbox'

export const A4 = { w: 210, h: 297 }
export const uid = () => Math.random().toString(36).slice(2, 10)

export function circlePoints(cx, cy, r, segs) {
  const n = segs || Math.max(24, Math.min(360, Math.ceil(2 * Math.PI * r / 0.8)))
  const pts = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

/** Converte una forma in una lista di polilinee [[x,y],...] in mm. */
export function shapeToPolylines(s) {
  switch (s.type) {
    case 'line': return [[[s.x1, s.y1], [s.x2, s.y2]]]
    case 'rect': return [[[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h], [s.x, s.y]]]
    case 'circle': return [circlePoints(s.cx, s.cy, s.r)]
    case 'polygon':
    case 'polyline': {
      if (!s.points?.length) return []
      const pts = s.points.map((p) => [p[0], p[1]])
      if (s.type === 'polygon' || s.closed) pts.push([...pts[0]])
      return [pts]
    }
    case 'multi': return s.paths.map((p) => p.map((q) => [q[0], q[1]]))
    case 'text': return textToPolylines(s.text, s.x, s.y, s.size)
    case 'textbox': return layoutTextbox(s).polylines
    default: return []
  }
}

export function translateShape(s, dx, dy) {
  const mv = (pts) => pts.map(([x, y]) => [x + dx, y + dy])
  switch (s.type) {
    case 'line': return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
    case 'rect': case 'text': case 'textbox': return { ...s, x: s.x + dx, y: s.y + dy }
    case 'circle': return { ...s, cx: s.cx + dx, cy: s.cy + dy }
    case 'polygon': case 'polyline': return { ...s, points: mv(s.points) }
    case 'multi': return { ...s, paths: s.paths.map(mv) }
    default: return s
  }
}

export function boundsOf(polylines) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pl of polylines) for (const [x, y] of pl) {
    if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function pointInPoly(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function hitShape(s, x, y, tol) {
  if (s.type === 'textbox' && pointInPoly(x, y, layoutTextbox(s).corners)) return true
  for (const pl of shapeToPolylines(s)) {
    for (let i = 1; i < pl.length; i++) if (distToSeg(x, y, pl[i - 1][0], pl[i - 1][1], pl[i][0], pl[i][1]) <= tol) return true
    if (pl.length === 1 && Math.hypot(x - pl[0][0], y - pl[0][1]) <= tol) return true
  }
  return false
}

/** Ramer–Douglas–Peucker. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let maxD = 0, idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]) }
  }
  return pts.filter((_, i) => keep[i])
}

export const snapVal = (v, g) => (g > 0 ? Math.round(v / g) * g : v)

export function polylineLength(pl) {
  let l = 0
  for (let i = 1; i < pl.length; i++) l += Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1])
  return l
}
