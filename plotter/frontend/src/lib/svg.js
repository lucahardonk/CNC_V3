// Import SVG → polilinee raggruppate per colore. Usa il motore SVG del browser
// (getTotalLength/getPointAtLength + getCTM) così trasformazioni, archi e curve sono gestiti nativamente.
// Solo contorni: il riempimento viene ignorato (di un elemento solo-fill si traccia il bordo).
import { simplify } from './geometry'

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi
const SKIP = 'defs, clipPath, mask, symbol, marker, pattern, metadata, title, style'

function toHex(c) {
  if (!c || c === 'none' || c.startsWith('url(')) return null
  const m = c.match(/rgba?\(([^)]+)\)/)
  if (!m) return c
  const [r, g, b, a] = m[1].split(',').map((v) => parseFloat(v))
  if (a === 0) return null
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

/** Divide un attributo d in sottopercorsi assoluti (gestisce 'm' relativo). */
function splitSubpaths(d, makePath) {
  const parts = d.match(/[Mm][^Mm]*/g) || []
  const out = []
  let cur = [0, 0]
  for (const part of parts) {
    const cmd = part[0]
    NUM.lastIndex = 0
    const n0 = NUM.exec(part), n1 = NUM.exec(part)
    if (!n0 || !n1) continue
    let ax = parseFloat(n0[0]), ay = parseFloat(n1[0])
    if (cmd === 'm') { ax += cur[0]; ay += cur[1] }
    let rest = part.slice(NUM.lastIndex).trim().replace(/^,/, '').trim()
    if (rest && /^[-.\d]/.test(rest)) rest = (cmd === 'm' ? 'l ' : 'L ') + rest
    const sd = `M ${ax} ${ay} ${rest}`
    const el = makePath(sd)
    out.push(el)
    cur = /[zZ]\s*$/.test(rest) ? [ax, ay] : (() => {
      const L = el.getTotalLength()
      const p = el.getPointAtLength(L)
      return [p.x, p.y]
    })()
  }
  return out
}

function sampleGeom(el, step) {
  const L = el.getTotalLength()
  if (!isFinite(L) || L <= 0) return []
  const n = Math.min(20000, Math.max(2, Math.ceil(L / step)))
  const pts = []
  for (let i = 0; i <= n; i++) {
    const p = el.getPointAtLength((i / n) * L)
    pts.push([p.x, p.y])
  }
  return pts
}

function applyCTM(el, pts) {
  const m = el.getCTM()
  if (!m) return pts
  return pts.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f])
}

/**
 * Analizza un SVG. Ritorna { groups: [{color, polylines}], bounds } con coordinate in px SVG (Y verso il basso).
 */
export function parseSvg(text) {
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-100000px;top:0;opacity:0;pointer-events:none;width:2000px;height:2000px'
  host.innerHTML = text
  document.body.appendChild(host)
  try {
    const svg = host.querySelector('svg')
    if (!svg) throw new Error('Nessun elemento <svg> trovato')
    // stima della scala per il campionamento
    const bb = svg.getBBox()
    const step = Math.max(0.01, Math.hypot(bb.width, bb.height) / 3000)
    const groups = new Map()
    const els = svg.querySelectorAll('path, line, polyline, polygon, rect, circle, ellipse')
    let skipped = 0
    for (const el of els) {
      if (el.closest(SKIP)) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const color = toHex(cs.stroke) || toHex(cs.fill)
      if (!color) { skipped++; continue }
      const tag = el.tagName.toLowerCase()
      let local = []
      if (tag === 'line') {
        local = [[[el.x1.baseVal.value, el.y1.baseVal.value], [el.x2.baseVal.value, el.y2.baseVal.value]]]
      } else if (tag === 'polyline' || tag === 'polygon') {
        const pts = Array.from(el.points, (p) => [p.x, p.y])
        if (tag === 'polygon' && pts.length) pts.push([...pts[0]])
        local = [pts]
      } else if (tag === 'rect' && !el.rx.baseVal.value && !el.ry.baseVal.value) {
        const x = el.x.baseVal.value, y = el.y.baseVal.value, w = el.width.baseVal.value, h = el.height.baseVal.value
        local = [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]
      } else if (tag === 'path') {
        const d = el.getAttribute('d') || ''
        const tmp = splitSubpaths(d, (sd) => {
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          p.setAttribute('d', sd)
          if (el.getAttribute('transform')) p.setAttribute('transform', el.getAttribute('transform'))
          el.parentNode.insertBefore(p, el)
          return p
        })
        // già trasformati qui: il path temporaneo ha lo stesso CTM dell'originale
        local = tmp.map((p) => applyCTM(p, sampleGeom(p, step)))
        tmp.forEach((p) => p.remove())
      } else {
        local = [sampleGeom(el, step)]
      }
      const polylines = local.filter((pl) => pl.length >= 2).map((pl) => (tag === 'path' ? pl : applyCTM(el, pl)))
      if (!polylines.length) continue
      if (!groups.has(color)) groups.set(color, [])
      groups.get(color).push(...polylines)
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const pls of groups.values()) for (const pl of pls) for (const [x, y] of pl) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
    if (!isFinite(minX)) throw new Error('Nessun tracciato vettoriale trovato (le immagini raster non sono supportate)')
    return {
      groups: [...groups.entries()].map(([color, polylines]) => ({ color, polylines })),
      bounds: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY },
      skipped,
    }
  } finally {
    host.remove()
  }
}

/** Scala/centra i gruppi in mm (Y verso l'alto), centro in (cx, cy). */
export function placeGroups(parsed, widthMm, heightMm, cx = 0, cy = 0, tol = 0.05) {
  const { bounds: b } = parsed
  const sx = b.w ? widthMm / b.w : 1, sy = b.h ? heightMm / b.h : 1
  return parsed.groups.map((g) => ({
    color: g.color,
    polylines: g.polylines.map((pl) => simplify(pl.map(([x, y]) => [
      cx + (x - b.minX - b.w / 2) * sx,
      cy - (y - b.minY - b.h / 2) * sy,
    ]), tol)),
  }))
}
