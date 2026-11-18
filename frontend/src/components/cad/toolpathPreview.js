// Anteprima visiva del percorso utensile: contorni spostati di tool_diameter/2.
// Solo grafica (il percorso reale lo calcola il backend con shapely).
//  - forme chiuse (rect, circle, ellipse, slot, spline chiusa): esterno per profile_outside,
//    interno per profile_inside/pocket, entrambi i lati per profile_on (larghezza del taglio)
//  - entità aperte (linee, archi, spline aperte): entrambi i lati, perché il lato di taglio
//    dipende dal contorno di cui fanno parte
import { catmullRomPoints, ellipsePoints, rectBox, rectLines, slotPoints } from './geometry'

const SKIP = new Set(['construction', 'dimension', 'dim_radial', 'dim_angle', 'constraint', 'point', 'bridge'])

const signedArea = (pts) => {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

// Punti campionati dell'entità: { pts, closed } oppure null
function samplePoints(e) {
  const d = e.data || {}
  switch (e.type) {
    case 'rect': return { pts: rectLines(rectBox(d)).map((s) => s.a), closed: true }
    case 'circle': {
      const r = Math.abs(d.r)
      if (!(r > 0)) return null
      return { pts: Array.from({ length: 72 }, (_, i) => ({ x: d.cx + r * Math.cos(i * Math.PI / 36), y: d.cy + r * Math.sin(i * Math.PI / 36) })), closed: true }
    }
    case 'ellipse': return { pts: ellipsePoints(d, 96).slice(0, -1), closed: true }
    case 'slot': return { pts: slotPoints(d).slice(0, -1), closed: true }
    case 'line': return { pts: [{ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }], closed: false }
    case 'arc': {
      const sw = ((((d.end - d.start) % 360) + 360) % 360) || 360
      const n = Math.max(2, Math.ceil(sw / 5))
      return { pts: Array.from({ length: n + 1 }, (_, i) => { const a = (d.start + sw * i / n) * Math.PI / 180; return { x: d.cx + d.r * Math.cos(a), y: d.cy + d.r * Math.sin(a) } }), closed: false }
    }
    case 'spline': {
      const P = d.points || []
      if (P.length < 2) return null
      const c = catmullRomPoints(P, 12)
      const closed = P.length >= 3 && Math.hypot(P[0].x - P[P.length - 1].x, P[0].y - P[P.length - 1].y) < 0.01
      return { pts: closed ? c.slice(0, -1) : c, closed }
    }
    default: return null
  }
}

const dedupe = (pts) => pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6)

// Offset di una polilinea chiusa in senso antiorario. off > 0 = verso l'esterno.
// Giunti arrotondati sul lato convesso (come la fresa), a spigolo sul lato concavo.
function offsetClosed(pts, off) {
  const n = pts.length, out = []
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p = pts[i], p1 = pts[(i + 1) % n]
    const e1 = { x: p.x - p0.x, y: p.y - p0.y }, e2 = { x: p1.x - p.x, y: p1.y - p.y }
    const l1 = Math.hypot(e1.x, e1.y) || 1, l2 = Math.hypot(e2.x, e2.y) || 1
    const n1 = { x: e1.y / l1, y: -e1.x / l1 }, n2 = { x: e2.y / l2, y: -e2.x / l2 } // normali esterne (CCW)
    const turn = e1.x * e2.y - e1.y * e2.x
    if (turn * off > 0) { // lato convesso rispetto all'offset → arco
      const a1 = Math.atan2(n1.y * Math.sign(off), n1.x * Math.sign(off))
      let a2 = Math.atan2(n2.y * Math.sign(off), n2.x * Math.sign(off))
      let da = a2 - a1
      while (da > Math.PI) da -= 2 * Math.PI
      while (da < -Math.PI) da += 2 * Math.PI
      const steps = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 18)))
      const r = Math.abs(off)
      for (let k = 0; k <= steps; k++) { const a = a1 + da * k / steps; out.push({ x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) }) }
    } else { // spigolo (miter, limitato)
      const b = { x: n1.x + n2.x, y: n1.y + n2.y }, bl = Math.hypot(b.x, b.y)
      if (bl < 1e-9) { out.push({ x: p.x + n1.x * off, y: p.y + n1.y * off }); continue }
      const bu = { x: b.x / bl, y: b.y / bl }, c = Math.max(0.25, bu.x * n1.x + bu.y * n1.y)
      out.push({ x: p.x + bu.x * off / c, y: p.y + bu.y * off / c })
    }
  }
  return out
}

// Offset di una polilinea aperta su un lato (side = +1/-1), con giunti a spigolo
function offsetOpen(pts, off) {
  const n = pts.length
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
    const e = { x: b.x - a.x, y: b.y - a.y }, l = Math.hypot(e.x, e.y) || 1
    return { x: p.x + (e.y / l) * off, y: p.y - (e.x / l) * off }
  })
}

/** Polilinee (in mm) del percorso utensile: [{ pts, closed }] */
export function toolpathOffsets(entities, diameter, operation = 'profile_outside') {
  const r = Number(diameter) / 2
  if (!(r > 0)) return []
  const out = []
  for (const e of entities) {
    if (!e || e.is_construction || SKIP.has(e.type)) continue
    const s = samplePoints(e)
    if (!s || s.pts.length < 2) continue
    let pts = dedupe(s.pts)
    if (!s.closed) {
      out.push({ pts: offsetOpen(pts, r), closed: false }, { pts: offsetOpen(pts, -r), closed: false })
      continue
    }
    if (pts.length < 3) continue
    const area = signedArea(pts)
    if (area < 0) pts = pts.slice().reverse()
    const sides = operation === 'profile_on' ? [r, -r] : operation === 'profile_outside' ? [r] : [-r]
    for (const off of sides) {
      const o = offsetClosed(pts, off)
      // offset interno più grande della forma: la fresa non ci entra → niente anteprima
      if (off < 0 && signedArea(o) <= 1e-6) continue
      out.push({ pts: o, closed: true })
    }
  }
  return out
}
