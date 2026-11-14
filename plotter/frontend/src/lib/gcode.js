// Generatore G-code per pen plotter (Klipper, Delta: origine al centro del piano).
import { shapeToPolylines, polylineLength } from './geometry'

const f3 = (v) => (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3)

/** Ordina le polilinee con nearest-neighbour (può invertire i tratti aperti). */
function orderPaths(paths, start) {
  const rest = paths.slice()
  const out = []
  let cur = start
  while (rest.length) {
    let best = 0, bestD = Infinity, rev = false
    for (let i = 0; i < rest.length; i++) {
      const p = rest[i].pts
      const a = p[0], b = p[p.length - 1]
      const da = Math.hypot(a[0] - cur[0], a[1] - cur[1])
      if (da < bestD) { bestD = da; best = i; rev = false }
      const closed = Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6
      if (!closed) {
        const db = Math.hypot(b[0] - cur[0], b[1] - cur[1])
        if (db < bestD) { bestD = db; best = i; rev = true }
      }
    }
    const [item] = rest.splice(best, 1)
    const pts = rev ? item.pts.slice().reverse() : item.pts
    out.push({ ...item, pts })
    cur = pts[pts.length - 1]
  }
  return out
}

/**
 * Restituisce { gcode, paths, travels, stats }.
 * paths: [{layerId,color,pts}] in coordinate foglio (mm), già ordinati come verranno tracciati.
 */
export function generateGcode({ layers, shapes, settings: s, name = 'plottercam', optimize = true }) {
  const zDown = Number(s.sheet_z) - Number(s.pen_down_extra || 0)
  const zUp = Number(s.sheet_z) + Number(s.pen_up)
  const ox = Number(s.offset_x || 0), oy = Number(s.offset_y || 0)
  const R = Number(s.print_radius || 0)
  const L = []
  const allPaths = [], travels = []
  let drawLen = 0, travelLen = 0, outOfReach = 0, penLifts = 0
  let cur = [-ox, -oy] // centro piano in coordinate foglio

  L.push(`; PlotterCAM - ${name}`, `; generato ${new Date().toISOString()}`,
    `; zero foglio Z=${f3(s.sheet_z)}  penna giu Z=${f3(zDown)}  penna su Z=${f3(zUp)}`,
    'G21', 'G90')
  if (s.home_before) L.push('G28')
  L.push(`G1 Z${f3(zUp)} F${s.feed_travel}`)

  for (const layer of layers) {
    if (!layer.visible) continue
    let paths = []
    for (const sh of shapes) {
      if (sh.layerId !== layer.id) continue
      for (const pts of shapeToPolylines(sh)) {
        const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.02)
        if (clean.length >= 2) paths.push({ layerId: layer.id, color: layer.color, pts: clean })
      }
    }
    if (!paths.length) continue
    if (optimize) paths = orderPaths(paths, cur)
    L.push('', `; ---- layer: ${layer.name} (${paths.length} tratti)`)
    if (layer.pause) L.push(`G1 Z${f3(zUp + 20)} F${s.feed_z_up}`, `M117 Cambio penna: ${layer.name}`, 'PAUSE')

    for (const p of paths) {
      const [sx, sy] = p.pts[0]
      travels.push([cur, p.pts[0]])
      travelLen += Math.hypot(sx - cur[0], sy - cur[1])
      L.push(`G1 X${f3(sx + ox)} Y${f3(sy + oy)} F${s.feed_travel}`)
      L.push(`G1 Z${f3(zDown)} F${s.feed_z_down}`)
      for (let i = 1; i < p.pts.length; i++) L.push(`G1 X${f3(p.pts[i][0] + ox)} Y${f3(p.pts[i][1] + oy)} F${s.feed_draw}`)
      L.push(`G1 Z${f3(zUp)} F${s.feed_z_up}`)
      penLifts++
      if (R > 0) for (const [x, y] of p.pts) if (Math.hypot(x + ox, y + oy) > R) { outOfReach++; break }
      drawLen += polylineLength(p.pts)
      cur = p.pts[p.pts.length - 1]
      allPaths.push(p)
    }
  }

  L.push('', '; ---- fine', `G1 Z${f3(zUp + 10)} F${s.feed_z_up}`, `G1 X0 Y0 F${s.feed_travel}`)
  if (s.home_after) L.push('G28')
  L.push('M400')

  const zMoves = penLifts * 2 * Math.abs(zUp - zDown)
  const estSec = (drawLen / s.feed_draw + travelLen / s.feed_travel +
    (penLifts * Math.abs(zUp - zDown)) * (1 / s.feed_z_down + 1 / s.feed_z_up)) * 60
  return {
    gcode: L.join('\n') + '\n', paths: allPaths, travels,
    stats: { paths: allPaths.length, drawLen, travelLen, zMoves, outOfReach, estSec, lines: L.length, zDown, zUp },
  }
}

export function fmtTime(sec) {
  if (!isFinite(sec)) return '-'
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`
}
