// Conversione di percorsi vettoriali (comandi M/L/C/Q/Z stile opentype.js / SVG) in entità CAD.
// Le coordinate sorgente sono "y in giù" (font, SVG): il passaggio al CAD (y in su) avviene in placeMap.
// I tratti rettilinei diventano `line`, le curve (Bézier campionate) diventano `spline` a punti densi,
// come fa l'import DXF: il generatore G-code le concatena in contorni chiusi.
import { uid } from './geometry'

const r3 = (v) => Math.round(v * 1000) / 1000
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// ---------------------------------------------------------------- campionamento Bézier
function cubicPts(p0, p1, p2, p3, step) {
  const len = dist(p0, p1) + dist(p1, p2) + dist(p2, p3)
  const n = Math.max(2, Math.min(64, Math.ceil(len / step)))
  const out = []
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    })
  }
  return out
}
const quadPts = (p0, p1, p2, step) => cubicPts(p0, { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) },
  { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) }, p2, step)

// comandi → subpath: { pieces: [{kind:'line', a, b} | {kind:'curve', pts:[p0..pn]}], closed }
// step: lunghezza indicativa di campionamento delle curve (unità sorgente)
export function commandsToSubpaths(cmds, step = 0.5) {
  const subs = []
  let cur = null, pos = null, start = null
  const close = () => {
    if (!cur) return
    if (cur.closed && pos && start && dist(pos, start) > 1e-9) cur.pieces.push({ kind: 'line', a: pos, b: start })
    if (cur.pieces.length) subs.push(cur)
    cur = null
  }
  for (const c of cmds) {
    if (c.type === 'M') { close(); pos = start = { x: c.x, y: c.y }; cur = { pieces: [], closed: false }; continue }
    if (!cur) { cur = { pieces: [], closed: false }; pos = start = pos || { x: 0, y: 0 } }
    if (c.type === 'L') {
      const b = { x: c.x, y: c.y }
      if (dist(pos, b) > 1e-9) cur.pieces.push({ kind: 'line', a: pos, b })
      pos = b
    } else if (c.type === 'C' || c.type === 'Q') {
      const b = { x: c.x, y: c.y }
      const pts = c.type === 'C' ? cubicPts(pos, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, b, step) : quadPts(pos, { x: c.x1, y: c.y1 }, b, step)
      cur.pieces.push({ kind: 'curve', pts: [pos, ...pts] })
      pos = b
    } else if (c.type === 'Z') {
      cur.closed = true
      close()
      pos = start
    }
  }
  close()
  return subs
}

// Applica una trasformazione punto→punto a tutti i subpath
export function mapSubpaths(subs, fn) {
  return subs.map((s) => ({
    closed: s.closed,
    pieces: s.pieces.map((p) => (p.kind === 'line' ? { kind: 'line', a: fn(p.a), b: fn(p.b) } : { kind: 'curve', pts: p.pts.map(fn) })),
  }))
}

export function subpathsBBox(subs) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = (p) => { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y }
  for (const s of subs) for (const p of s.pieces) (p.kind === 'line' ? [p.a, p.b] : p.pts).forEach(add)
  return isFinite(minX) ? { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY } : null
}

// Mappa dalle coordinate sorgente (y in giù) al riquadro CAD {cx, cy, w, h} (mm, y in su)
export function placeMap(bbox, box) {
  const sx = bbox.w > 1e-9 ? box.w / bbox.w : 1
  const sy = bbox.h > 1e-9 ? box.h / bbox.h : 1
  const mx = (bbox.minX + bbox.maxX) / 2, my = (bbox.minY + bbox.maxY) / 2
  return (p) => ({ x: box.cx + (p.x - mx) * sx, y: box.cy - (p.y - my) * sy })
}

// Polilinee (per l'anteprima) da subpath già posizionati
export function subpathsToPolylines(subs) {
  return subs.map((s) => {
    const out = []
    for (const p of s.pieces) {
      const pts = p.kind === 'line' ? [p.a, p.b] : p.pts
      for (const q of pts) if (!out.length || dist(out[out.length - 1], q) > 1e-9) out.push(q)
    }
    return out
  }).filter((l) => l.length > 1)
}

// angolo tra due direzioni (gradi)
const turn = (a, b, c) => {
  const u = { x: b.x - a.x, y: b.y - a.y }, v = { x: c.x - b.x, y: c.y - b.y }
  const lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y)
  if (lu < 1e-12 || lv < 1e-12) return 0
  return (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv)))) * 180) / Math.PI
}

// Subpath posizionati (coordinate CAD) → entità CAD. Le curve consecutive senza spigolo vivo
// formano un'unica spline; agli spigoli (>35°) la spline viene spezzata per non arrotondarli.
export function subpathsToEntities(subs, { minSeg = 0.01 } = {}) {
  const ents = []
  const R = (p) => ({ x: r3(p.x), y: r3(p.y) })
  const pushLine = (a, b) => {
    const A = R(a), B = R(b)
    if (dist(A, B) < minSeg) return
    ents.push({ id: uid(), type: 'line', is_construction: false, data: { x1: A.x, y1: A.y, x2: B.x, y2: B.y } })
  }
  const pushSpline = (pts) => {
    const clean = []
    for (const p of pts.map(R)) if (!clean.length || dist(clean[clean.length - 1], p) >= minSeg) clean.push(p)
    if (clean.length < 2) return
    if (clean.length === 2) return pushLine(clean[0], clean[1])
    ents.push({ id: uid(), type: 'spline', is_construction: false, data: { points: clean } })
  }
  for (const s of subs) {
    let run = null
    const flush = () => { if (run) pushSpline(run); run = null }
    for (const p of s.pieces) {
      if (p.kind === 'line') { flush(); pushLine(p.a, p.b); continue }
      if (run && run.length > 1 && p.pts.length > 1 && turn(run[run.length - 2], run[run.length - 1], p.pts[1]) > 35) flush()
      run = run ? [...run, ...p.pts.slice(1)] : [...p.pts]
    }
    flush()
  }
  return ents
}

export function entitiesBBox(ents) {
  const xs = [], ys = []
  for (const e of ents) {
    const d = e.data
    if (e.type === 'line') { xs.push(d.x1, d.x2); ys.push(d.y1, d.y2) } else if (d.points) d.points.forEach((q) => { xs.push(q.x); ys.push(q.y) })
  }
  return xs.length ? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) } : null
}

// ---------------------------------------------------------------- SVG
const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

// Arco ellittico SVG → cubiche (algoritmo standard W3C, endpoint → center parametrization)
function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0) return [{ type: 'L', x: x2, y: y2 }]
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy
  rx = Math.abs(rx); ry = Math.abs(ry)
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  let co = Math.sqrt(Math.max(0, num / den))
  if (fa === fs) co = -co
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a }
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!fs && dt > 0) dt -= 2 * Math.PI
  if (fs && dt < 0) dt += 2 * Math.PI
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)))
  const d = dt / segs, k = (4 / 3) * Math.tan(d / 4)
  const pt = (t) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos })
  const der = (t) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos })
  const out = []
  for (let i = 0; i < segs; i++) {
    const a = t1 + i * d, b = a + d
    const pa = pt(a), pb = pt(b), da = der(a), db = der(b)
    out.push({ type: 'C', x1: pa.x + k * da.x, y1: pa.y + k * da.y, x2: pb.x - k * db.x, y2: pb.y - k * db.y, x: pb.x, y: pb.y })
  }
  out[out.length - 1].x = x2; out[out.length - 1].y = y2
  return out
}

// Attributo `d` → comandi assoluti M/L/C/Q/Z
export function parsePathD(d) {
  const out = []
  const toks = (d || '').match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []
  let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null
  const isCmd = (t) => /^[A-Za-z]$/.test(t)
  const n = () => parseFloat(toks[i++])
  // flag degli archi: possono essere scritti attaccati ("011") → li separiamo
  const flag = () => {
    const t = toks[i]
    if (t === '0' || t === '1') { i++; return +t }
    if (/^[01]/.test(t)) { toks[i] = t.slice(1); return +t[0] }
    i++; return +t ? 1 : 0
  }
  while (i < toks.length) {
    if (isCmd(toks[i])) cmd = toks[i++]
    else if (!cmd) { i++; continue }
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase()
    const ox = rel ? x : 0, oy = rel ? y : 0
    if (C === 'Z') { out.push({ type: 'Z' }); x = sx; y = sy; lc = lq = null; cmd = null; continue }
    if (i >= toks.length || isCmd(toks[i])) { if (C !== 'Z') cmd = null; continue }
    if (C === 'M') {
      x = ox + n(); y = oy + n(); sx = x; sy = y
      out.push({ type: 'M', x, y }); cmd = rel ? 'l' : 'L'; lc = lq = null
    } else if (C === 'L') { x = ox + n(); y = oy + n(); out.push({ type: 'L', x, y }); lc = lq = null }
    else if (C === 'H') { x = ox + n(); out.push({ type: 'L', x, y }); lc = lq = null }
    else if (C === 'V') { y = oy + n(); out.push({ type: 'L', x, y }); lc = lq = null }
    else if (C === 'C') {
      const x1 = ox + n(), y1 = oy + n(), x2 = ox + n(), y2 = oy + n(); x = ox + n(); y = oy + n()
      out.push({ type: 'C', x1, y1, x2, y2, x, y }); lc = { x: x2, y: y2 }; lq = null
    } else if (C === 'S') {
      const x1 = lc ? 2 * x - lc.x : x, y1 = lc ? 2 * y - lc.y : y
      const x2 = ox + n(), y2 = oy + n(); x = ox + n(); y = oy + n()
      out.push({ type: 'C', x1, y1, x2, y2, x, y }); lc = { x: x2, y: y2 }; lq = null
    } else if (C === 'Q') {
      const x1 = ox + n(), y1 = oy + n(); x = ox + n(); y = oy + n()
      out.push({ type: 'Q', x1, y1, x, y }); lq = { x: x1, y: y1 }; lc = null
    } else if (C === 'T') {
      const x1 = lq ? 2 * x - lq.x : x, y1 = lq ? 2 * y - lq.y : y
      x = ox + n(); y = oy + n()
      out.push({ type: 'Q', x1, y1, x, y }); lq = { x: x1, y: y1 }; lc = null
    } else if (C === 'A') {
      const rx = n(), ry = n(), rot = n(), fa = flag(), fs = flag(), ex = ox + n(), ey = oy + n()
      out.push(...arcToCubics(x, y, rx, ry, rot, fa, fs, ex, ey)); x = ex; y = ey; lc = lq = null
    } else i++
  }
  return out.filter((c) => c.type === 'Z' || [c.x, c.y, c.x1 ?? 0, c.y1 ?? 0, c.x2 ?? 0, c.y2 ?? 0].every(Number.isFinite))
}

// trasformazioni SVG → matrice [a b c d e f]
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
const ID = [1, 0, 0, 1, 0, 0]
function parseTransform(str) {
  let m = ID
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let t
  while ((t = re.exec(str || ''))) {
    const v = (t[2].match(NUM) || []).map(Number)
    let n = ID
    if (t[1] === 'matrix' && v.length === 6) n = v
    else if (t[1] === 'translate') n = [1, 0, 0, 1, v[0] || 0, v[1] || 0]
    else if (t[1] === 'scale') n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]
    else if (t[1] === 'rotate') {
      const a = ((v[0] || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
      n = [c, s, -s, c, 0, 0]
      if (v.length === 3) n = mul(mul([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]])
    } else if (t[1] === 'skewX') n = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0]
    else if (t[1] === 'skewY') n = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]
    m = mul(m, n)
  }
  return m
}
const apply = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })

const num = (el, k, def = 0) => { const v = parseFloat(el.getAttribute(k)); return Number.isFinite(v) ? v : def }
const ellipseD = (cx, cy, rx, ry) => `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`
function shapeD(el) {
  const tag = el.tagName.toLowerCase().replace(/^.*:/, '')
  switch (tag) {
    case 'path': return el.getAttribute('d')
    case 'rect': {
      const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height')
      if (w <= 0 || h <= 0) return null
      let rx = num(el, 'rx', NaN), ry = num(el, 'ry', NaN)
      if (!Number.isFinite(rx)) rx = Number.isFinite(ry) ? ry : 0
      if (!Number.isFinite(ry)) ry = rx
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2)
      if (rx <= 0 || ry <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
    }
    case 'circle': { const r = num(el, 'r'); return r > 0 ? ellipseD(num(el, 'cx'), num(el, 'cy'), r, r) : null }
    case 'ellipse': { const rx = num(el, 'rx'), ry = num(el, 'ry'); return rx > 0 && ry > 0 ? ellipseD(num(el, 'cx'), num(el, 'cy'), rx, ry) : null }
    case 'line': return `M${num(el, 'x1')} ${num(el, 'y1')}L${num(el, 'x2')} ${num(el, 'y2')}`
    case 'polyline': case 'polygon': {
      const v = (el.getAttribute('points') || '').match(NUM)?.map(Number) || []
      if (v.length < 4) return null
      let d = `M${v[0]} ${v[1]}`
      for (let i = 2; i + 1 < v.length; i += 2) d += `L${v[i]} ${v[i + 1]}`
      return tag === 'polygon' ? d + 'Z' : d
    }
    default: return null
  }
}

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const SKIP = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'title', 'desc', 'metadata', 'style', 'script', 'text'])

// Testo SVG → { subpaths, counts, unit } (coordinate utente SVG, y in giù; trasformazioni applicate)
export function parseSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror')) throw new Error('File SVG non valido')
  const root = doc.documentElement
  if (root.tagName.toLowerCase() !== 'svg') throw new Error('Il file non contiene un elemento <svg>')
  const counts = {}
  const subs = []
  const walk = (el, m) => {
    const tag = el.tagName.toLowerCase().replace(/^.*:/, '')
    if (SKIP.has(tag) || el.getAttribute('display') === 'none') return
    const mm = mul(m, parseTransform(el.getAttribute('transform')))
    if (SHAPES.has(tag)) {
      const d = shapeD(el)
      if (d) {
        const cmds = parsePathD(d)
        if (cmds.length) {
          counts[tag] = (counts[tag] || 0) + 1
          // trasformiamo i punti di controllo (le trasformazioni affini preservano le Bézier)
          const tc = cmds.map((c) => {
            if (c.type === 'Z') return c
            const o = { type: c.type, ...apply(mm, c) }
            if (c.x1 !== undefined) { const p = apply(mm, { x: c.x1, y: c.y1 }); o.x1 = p.x; o.y1 = p.y }
            if (c.x2 !== undefined) { const p = apply(mm, { x: c.x2, y: c.y2 }); o.x2 = p.x; o.y2 = p.y }
            return o
          })
          subs.push(tc)
        }
      }
    }
    for (const ch of el.children) walk(ch, mm)
  }
  walk(root, ID)
  // dimensioni dichiarate (per proporre una misura iniziale in mm)
  const vb = (root.getAttribute('viewBox') || '').match(NUM)?.map(Number)
  const dimMm = (k) => {
    const raw = root.getAttribute(k) || ''
    const v = parseFloat(raw)
    if (!Number.isFinite(v) || raw.endsWith('%')) return null
    if (raw.endsWith('mm')) return v
    if (raw.endsWith('cm')) return v * 10
    if (raw.endsWith('in')) return v * 25.4
    if (raw.endsWith('pt')) return (v * 25.4) / 72
    return (v * 25.4) / 96 // px (96 dpi)
  }
  return { commands: subs, counts, declared: { w: dimMm('width'), h: dimMm('height') }, viewBox: vb?.length === 4 ? vb : null }
}
