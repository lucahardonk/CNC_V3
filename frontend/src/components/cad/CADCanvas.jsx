import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  angleBetweenLines, angleOf, arcFrom3, arcStartEndRadius, arcSweep, bbox, catmullRomPath, catmullRomPoints, circumcircle,
  closestOnEntity, cross, dimLinePoints, dist, dot, explodeRect, explodeSlot, filletLines, isDim, keyPoints, mirrorEntity,
  normRect, applyDimParam, dimLiveData, dimValue, syncDims, polar, polygonLines, rad, rect3Corners, rotateEntity, round3, rp, slotPath, sub, translate, computeNodes, trimClick, uid, unit,
} from './geometry'
import {
  ORIGIN_ID, autoCoincide, coincident, constraintPos, fillDimValues, getPt, hasCoincident, isConstraint, isGeo, isLinkedDim, isStretch,
  isOnLine, measureDim, namedPoints, onLine, pointKind, setPt, solveCommit, syncRefDims,
} from './constraints'
import { SELECTION_TOOLS, toolForKey } from './Toolbar'

const COLORS = { normal: '#e5e7eb', selected: '#3b82f6', hover: '#93c5fd', construction: '#6b7280', bridge: '#f97316', dim: '#facc15', preview: '#22c55e', measure: '#22d3ee', point: '#d946ef', midCtr: '#22d3ee' }
// Colore dei key-point/snap per categoria: vertice, punto medio, centro, entità Punto
const KP_COLOR = { vtx: '#cbd5e1', mid: COLORS.midCtr, ctr: COLORS.midCtr, pt: COLORS.point }
const SNAP_COLOR = { vtx: '#facc15', mid: COLORS.midCtr, ctr: COLORS.midCtr, pt: COLORS.point }
const SNAP_LABEL = { mid: 'medio', ctr: 'centro', pt: 'punto' }
// Key-point di un'entità con la loro categoria (i punti con nome danno la categoria, gli altri sono vertici)
const kpWithKind = (e) => {
  const named = namedPoints(e)
  return keyPoints(e).map((k) => {
    const q = named.find((n) => Math.abs(n.x - k.x) < 1e-9 && Math.abs(n.y - k.y) < 1e-9)
    return { ...k, kind: q ? pointKind(e, q.ref) : 'vtx' }
  })
}
const fmt = (v, n = 2) => Number(v).toFixed(n)
// Appunti condivisi tra layer (vivono finché la pagina è aperta)
let CLIPBOARD = null // { ents, base }
const isTrimmable = (e) => ['line', 'construction', 'rect', 'circle', 'arc', 'ellipse', 'slot', 'spline'].includes(e.type)
const isLineLike = (e) => e.type === 'line' || e.type === 'construction' || e.type === 'rect'
const sameSeg = (a, b) => {
  const A = a.data, B = b.data, eq = (x, y) => Math.abs(x - y) < 1e-6
  return (eq(A.x1, B.x1) && eq(A.y1, B.y1) && eq(A.x2, B.x2) && eq(A.y2, B.y2)) || (eq(A.x1, B.x2) && eq(A.y1, B.y2) && eq(A.x2, B.x1) && eq(A.y2, B.y1))
}
const lineLen = (l) => Math.hypot(l.data.x2 - l.data.x1, l.data.y2 - l.data.y1)

export default function CADCanvas({
  entities, onChange, selected, setSelected, tool, setTool, stock, ui, options, onContextMenu, notify,
  onUndo, onRedo, onDelete, onDuplicate, maxToolDia = 8, otherLayerEntities = [], pickLine = null,
}) {
  const wrap = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState(null) // {s, tx, ty}
  const [cursor, setCursor] = useState(null) // {raw, p, snap}
  const [pts, setPts] = useState([])
  const [drag, setDrag] = useState(null)
  const [pick, setPick] = useState(null) // fillet: {id, click}
  const [dimPick, setDimPick] = useState(null) // quota: {e, click, link}
  const [editingDim, setEditingDim] = useState(null) // {id, value, screenPos}
  const [dimRef, setDimRef] = useState(null) // punto con nome del primo click della quota punto-punto
  const geo = useMemo(() => entities.filter((x) => !isConstraint(x)), [entities])
  const nodeList = useMemo(() => (tool === 'trim' ? computeNodes(geo) : []), [geo, tool])
  const entMap = useMemo(() => new Map(entities.map((x) => [x.id, x])), [entities])
  const liveDim = (e) => (e.targetId && dimLiveData(e, entMap.get(e.targetId))) || e.data
  const [measure, setMeasure] = useState(null) // {first, title, rows, marks}
  const [pasting, setPasting] = useState(null) // { ents, base } durante Ctrl+V
  const [arrayCfg, setArrayCfg] = useState(null)
  const [hover, setHover] = useState(null)
  const space = useRef(false)

  // ---------------------------------------------------------------- viewport
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    const s = Math.min(size.w / (stock.x * 1.25), size.h / (stock.y * 1.25))
    setView({ s, tx: size.w / 2, ty: size.h / 2 })
  }, [size.w, size.h, stock.x, stock.y])
  useEffect(() => { if (!view && size.w > 10) fit() }, [size, view, fit])

  const v = view || { s: 1, tx: 0, ty: 0 }
  const toS = (p) => ({ x: p.x * v.s + v.tx, y: -p.y * v.s + v.ty })
  const toW = (sx, sy) => ({ x: (sx - v.tx) / v.s, y: -(sy - v.ty) / v.s })
  const tol = 7 / v.s

  // ---------------------------------------------------------------- snap (anche sui punti degli altri layer)
  const snapPoints = useMemo(() => {
    const out = [{ x: 0, y: 0, id: ORIGIN_ID }]
    const hx = stock.x / 2, hy = stock.y / 2
    out.push({ x: -hx, y: -hy }, { x: hx, y: -hy }, { x: hx, y: hy }, { x: -hx, y: hy })
    for (const e of geo) if (!isDim(e)) out.push(...kpWithKind(e).map((k) => ({ ...k, id: e.id })))
    for (const l of otherLayerEntities) for (const e of l.entities) if (!isDim(e)) out.push(...keyPoints(e))
    return out
  }, [geo, stock, otherLayerEntities])

  // Snap su punti (esatti, così i vincoli di coincidenza combaciano) o griglia. excludeId: ignora i punti di quell'entità
  const snap = (raw, e, excludeId = null) => {
    if (e?.altKey) return { p: raw, snap: null }
    const sd = (ui?.snap_distance ?? 5) * 1.5 / v.s
    let best = null
    for (const k of snapPoints) {
      if (excludeId && k.id === excludeId) continue
      const d = dist(k, raw)
      if (d < sd && (!best || d < best.d)) best = { d, k }
    }
    if (best) return { p: { x: best.k.x, y: best.k.y }, snap: best.k }
    if (ui?.snap_enabled) {
      let g = ui.grid_size || 1
      while (g * v.s < 6) g *= 5
      return { p: { x: round3(Math.round(raw.x / g) * g), y: round3(Math.round(raw.y / g) * g) }, snap: null }
    }
    return { p: { x: round3(raw.x), y: round3(raw.y) }, snap: null }
  }

  // Punto con nome corrispondente a uno snap (origine o punto di un'entità di questo layer)
  const refOfSnap = (k) => {
    if (!k?.id) return null
    if (k.id === ORIGIN_ID) return { id: ORIGIN_ID, ref: 'o' }
    const ent = entMap.get(k.id)
    const q = ent && namedPoints(ent).filter((n) => dist(n, k) < 1e-6).sort((a, b) => isStretch(ent, a.ref) ? -1 : isStretch(ent, b.ref) ? 1 : 0)[0]
    return q ? { id: k.id, ref: q.ref } : null
  }
  // Punto con nome sotto il cursore (preferisce entità selezionate e punti stirabili)
  const pointAt = (w) => {
    let best = null
    for (const e of geo) {
      if (isDim(e) || e.type === 'bridge') continue
      for (const q of namedPoints(e)) {
        const d = dist(q, w)
        if (d > tol) continue
        const score = d - (selected.has(e.id) ? tol : 0) - (isStretch(e, q.ref) ? tol / 2 : 0)
        if (!best || score < best.score) best = { id: e.id, ref: q.ref, x: q.x, y: q.y, score }
      }
    }
    return best
  }
  const constraintAt = (w) => {
    let best = null
    for (const c of entities) {
      if (!isConstraint(c)) continue
      const q = constraintPos(c, entMap)
      const d = q ? dist(q, w) : Infinity
      if (d <= tol && (!best || d < best.d)) best = { c, d }
    }
    return best?.c || null
  }
  const keyOf = (r) => (isStretch(entMap.get(r.id), r.ref) ? `${r.id}:${r.ref}` : r.id)

  const ortho = (p, e) => {
    if (!e?.shiftKey || !pts.length || !['line', 'construction', 'line_midpoint', 'dimension', 'mirror'].includes(tool)) return p
    const a = pts[pts.length - 1]
    return Math.abs(p.x - a.x) > Math.abs(p.y - a.y) ? { x: p.x, y: a.y } : { x: a.x, y: p.y }
  }

  const hit = (w, filter = () => true) => {
    let best = null
    for (const e of geo) {
      if (!filter(e)) continue
      const c = closestOnEntity(e, w)
      if (c && c.d < tol && (!best || c.d < best.c.d)) best = { e, c }
    }
    return best
  }
  const geomFilter = (x) => !isDim(x) && x.type !== 'bridge'

  // Linea sotto il cursore (i lati dei rettangoli vengono esplosi al volo)
  const lineAt = (w) => {
    const h = hit(w, isLineLike)
    if (!h) return null
    if (h.e.type === 'rect') {
      const lines = explodeRect(h.e)
      const near = lines.reduce((b, l) => { const c = closestOnEntity(l, w); return !b || c.d < b.d ? { l, d: c.d } : b }, null).l
      return { e: near, src: h.e, lines, c: h.c }
    }
    return { e: h.e, src: h.e, lines: null, c: h.c }
  }

  const evPos = (e) => {
    const r = wrap.current.getBoundingClientRect()
    return { sx: e.clientX - r.left, sy: e.clientY - r.top }
  }

  // ---------------------------------------------------------------- azioni
  // Le nuove entità i cui estremi cadono su punti esistenti (o sull'origine) vengono vincolate automaticamente
  const add = (...ents) => onChange([...entities, ...ents, ...autoCoincide(geo, ents)])
  const replace = (ids, news) => { const rest = entities.filter((e) => !ids.includes(e.id)); onChange([...rest, ...news, ...autoCoincide(rest.filter(isGeo), news)]) }
  const cancel = () => { setPts([]); setDimRef(null); setPick(null); setDimPick(null); setArrayCfg(null); setEditingDim(null); setPasting(null) }
  const selEnts = entities.filter((x) => selected.has(x.id))

  useEffect(() => {
    cancel(); setMeasure(null)
    if (SELECTION_TOOLS.includes(tool) && !selected.size) {
      notify('Seleziona prima le entità')
      setTool('select')
      return
    }
    if (tool === 'array_rect') {
      const bs = selEnts.map(bbox)
      const w = Math.max(...bs.map((b) => b.maxX)) - Math.min(...bs.map((b) => b.minX))
      const h = Math.max(...bs.map((b) => b.maxY)) - Math.min(...bs.map((b) => b.minY))
      setArrayCfg({ type: 'rect', cols: 3, rows: 2, dx: round3(w + 5), dy: round3(h + 5) })
    }
  }, [tool]) // eslint-disable-line react-hooks/exhaustive-deps

  const finishSpline = (list) => {
    const clean = list.filter((p, i) => i === 0 || dist(p, list[i - 1]) > tol * 0.5)
    if (clean.length >= 2) add({ id: uid(), type: 'spline', is_construction: false, data: { points: clean.map(rp) } })
    else notify('La spline richiede almeno 2 punti')
    setPts([])
  }

  // Copie generate dalle serie (usate sia per l'anteprima sia per l'applicazione)
  const arrayCopies = (cfg) => {
    if (!cfg) return []
    const out = []
    if (cfg.type === 'circular') {
      if (!cfg.center) return []
      const n = Math.max(2, Math.min(360, Math.floor(Number(cfg.n) || 2)))
      const total = Number(cfg.angle) || 360
      const step = Math.abs(total) >= 360 ? total / n : total / (n - 1)
      for (let i = 1; i < n; i++) for (const e of selEnts) out.push(...rotateEntity(e, cfg.center, step * i))
    } else {
      const cols = Math.max(1, Math.min(100, Math.floor(Number(cfg.cols) || 1)))
      const rows = Math.max(1, Math.min(100, Math.floor(Number(cfg.rows) || 1)))
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        if (!c && !r) continue
        for (const e of selEnts) out.push({ ...translate(e, c * Number(cfg.dx || 0), r * Number(cfg.dy || 0)), id: uid() })
      }
    }
    return out
  }
  const applyArray = () => {
    const copies = arrayCopies(arrayCfg)
    if (!copies.length) return notify('Nessuna copia da generare')
    add(...copies)
    setSelected(new Set([...selected, ...copies.map((c) => c.id)]))
    notify(`${copies.length} entità create`, 'success')
    setArrayCfg(null)
    setTool('select')
  }

  // ---------------------------------------------------------------- misure / quote
  const entityInfo = (e) => {
    const d = e.data
    switch (e.type) {
      case 'line': case 'construction': {
        const L = lineLen(e)
        return { title: 'Linea', rows: [['Lunghezza', `${fmt(L, 3)} mm`], ['ΔX', `${fmt(d.x2 - d.x1, 3)} mm`], ['ΔY', `${fmt(d.y2 - d.y1, 3)} mm`], ['Angolo', `${fmt(angleOf({ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }))}°`]] }
      }
      case 'circle':
        return { title: 'Cerchio', rows: [['Raggio', `${fmt(d.r, 3)} mm`], ['Diametro', `${fmt(2 * d.r, 3)} mm`], ['Circonferenza', `${fmt(2 * Math.PI * d.r)} mm`], ['Area', `${fmt(Math.PI * d.r * d.r)} mm²`]] }
      case 'arc': {
        const sw = arcSweep(d.start, d.end)
        return { title: 'Arco', rows: [['Raggio', `${fmt(d.r, 3)} mm`], ['Ampiezza', `${fmt(sw)}°`], ['Lunghezza arco', `${fmt(d.r * rad(sw), 3)} mm`], ['Corda', `${fmt(2 * d.r * Math.sin(rad(sw) / 2), 3)} mm`]] }
      }
      case 'ellipse': {
        const { rx, ry } = d, h = ((rx - ry) ** 2) / ((rx + ry) ** 2)
        return { title: 'Ellisse', rows: [['Semiasse X', `${fmt(rx, 3)} mm`], ['Semiasse Y', `${fmt(ry, 3)} mm`], ['Perimetro ≈', `${fmt(Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))))} mm`], ['Area', `${fmt(Math.PI * rx * ry)} mm²`]] }
      }
      case 'slot':
        return { title: 'Asola', rows: [['Interasse', `${fmt(d.length, 3)} mm`], ['Larghezza', `${fmt(d.width, 3)} mm`], ['Lunghezza totale', `${fmt(d.length + d.width, 3)} mm`], ['Area', `${fmt(d.length * d.width + Math.PI * (d.width / 2) ** 2)} mm²`]] }
      case 'spline': {
        const s = catmullRomPoints(d.points, 20)
        let L = 0; for (let i = 1; i < s.length; i++) L += dist(s[i - 1], s[i])
        return { title: 'Spline', rows: [['Lunghezza', `${fmt(L, 3)} mm`], ['Punti', d.points.length]] }
      }
      case 'rect':
        return { title: 'Rettangolo', rows: [['Larghezza', `${fmt(d.w, 3)} mm`], ['Altezza', `${fmt(d.h, 3)} mm`], ['Area', `${fmt(d.w * d.h)} mm²`]] }
      default: return { title: e.type, rows: [] }
    }
  }

  const handleMeasure = (p, raw) => {
    const first = measure?.first
    const la = lineAt(raw)
    if (la) {
      if (first?.kind === 'line' && !sameSeg(first.e, la.e)) {
        const ang = angleBetweenLines(first.e, first.click, la.e, raw)
        if (!ang) return setMeasure({ first: null, title: 'Angolo', rows: [['Linee', 'parallele (0°)']], marks: { ents: [first.e, la.e] } })
        const a = Math.min(ang.sweep, 180 - ang.sweep)
        return setMeasure({
          first: null, title: 'Angolo tra linee',
          rows: [['Angolo', `${fmt(ang.sweep)}°`], ['Supplementare', `${fmt(180 - ang.sweep)}°`], ['Acuto', `${fmt(a)}°`]],
          marks: { ents: [first.e, la.e], arc: { cx: ang.P.x, cy: ang.P.y, r: 12 / v.s * 3, start: ang.a1, end: ang.a2 } },
        })
      }
      const info = entityInfo(la.e)
      return setMeasure({ first: { kind: 'line', e: la.e, click: raw }, ...info, note: 'Click su una seconda linea per l\'angolo', marks: { ents: [la.e] } })
    }
    const h = hit(raw, geomFilter)
    if (h) return setMeasure({ first: null, ...entityInfo(h.e), marks: { ents: [h.e] } })
    if (first?.kind === 'point') {
      const a = first.p
      return setMeasure({
        first: null, title: 'Distanza tra punti',
        rows: [['Distanza', `${fmt(dist(a, p), 3)} mm`], ['ΔX', `${fmt(p.x - a.x, 3)} mm`], ['ΔY', `${fmt(p.y - a.y, 3)} mm`], ['Angolo', `${fmt(angleOf(a, p))}°`]],
        marks: { seg: [a, p] },
      })
    }
    setMeasure({ first: { kind: 'point', p }, title: 'Primo punto', rows: [['X', fmt(p.x, 3)], ['Y', fmt(p.y, 3)]], note: 'Click sul secondo punto', marks: { pts: [p] } })
  }

  // Collegamento parametrico: la prima quota su (entità, parametro) è guida, le successive di riferimento
  const withDriving = (link) => link && ({ ...link, driving: !entities.some((x) => isDim(x) && x.targetId === link.targetId && x.param === link.param && x.driving !== false) })
  const linkOfLine = (la) => {
    if (!la?.src) return null
    if (la.src.type === 'rect') {
      const side = la.lines ? la.lines.indexOf(la.e) : -1
      if (side < 0) return null
      const d = la.e.data
      return { targetId: la.src.id, side, param: Math.abs(d.x2 - d.x1) > Math.abs(d.y2 - d.y1) ? 'width' : 'height' }
    }
    if (la.src.type === 'line' || la.src.type === 'construction') return { targetId: la.src.id, param: 'length' }
    return null
  }
  const linearDimOf = (l, off, link) => ({ id: uid(), type: 'dimension', is_construction: true, ...(withDriving(link) || {}), data: { x1: l.data.x1, y1: l.data.y1, x2: l.data.x2, y2: l.data.y2, off: round3(off) } })
  const angleDimOf = (l1, c1, l2, c2) => {
    const ang = angleBetweenLines(l1, c1, l2, c2)
    if (!ang) return null
    const r = Math.max(5, 28 / v.s, Math.min(dist(ang.P, c1), dist(ang.P, c2)) * 0.7)
    const dim = { id: uid(), type: 'dim_angle', is_construction: true, data: { cx: round3(ang.P.x), cy: round3(ang.P.y), r: round3(r), a1: round3(ang.a1), a2: round3(ang.a2) } }
    // Collegamento guida: solo tra due linee vere (non lati di rettangolo). v = estremo più vicino al vertice
    const real = (l) => entMap.get(l.id)?.type === 'line' || entMap.get(l.id)?.type === 'construction'
    if (!real(l1) || !real(l2) || l1.id === l2.id) return dim
    const vOf = (l) => (dist({ x: l.data.x1, y: l.data.y1 }, ang.P) <= dist({ x: l.data.x2, y: l.data.y2 }, ang.P) ? 'p1' : 'p2')
    for (const [A, B] of [[l1, l2], [l2, l1]]) {
      const link = { la: { id: A.id, v: vOf(A) }, lb: { id: B.id, v: vOf(B) } }
      const m = measureDim(link, entMap)
      if (m != null && Math.abs(m - ang.sweep) < 0.01) return { ...dim, ...link, driving: true }
    }
    return dim
  }
  const offsetFrom = (l, p) => {
    const q = dimLinePoints({ ...l.data, off: 0 })
    const off = dot(sub(p, q.a), q.n)
    return Math.abs(off) < 0.5 ? 5 : off
  }

  // ---------------------------------------------------------------- click strumenti
  const handleToolClick = (p, raw, e, sn = null) => {
    const P = ortho(p, e)
    const mk = (type, data, extra = {}) => ({ id: uid(), type, is_construction: false, data, ...extra })
    switch (tool) {
      case 'point': {
        const pt = mk('point', { x: P.x, y: P.y }, { is_construction: true })
        if (sn?.snap) return add(pt) // su un key-point: vincolo di coincidenza automatico
        const h = hit(raw, (x) => x.type === 'line' || x.type === 'construction')
        if (h) {
          const q = rp(h.c.point)
          pt.data = { x: q.x, y: q.y }
          onChange([...entities, pt, onLine({ id: pt.id, ref: 'p' }, h.e.id)])
          return notify('Punto vincolato sulla linea (Canc sul cerchietto verde per rimuovere il vincolo)', 'success')
        }
        return add(pt)
      }
      case 'line': case 'construction': {
        if (!pts.length) return setPts([P])
        const a = pts[0]
        if (dist(a, P) < 1e-6) return
        add(mk('line', { x1: a.x, y1: a.y, x2: P.x, y2: P.y }, { is_construction: tool === 'construction' }))
        return setPts([P])
      }
      case 'line_midpoint': {
        if (!pts.length) return setPts([P])
        const m = pts[0]
        if (dist(m, P) < 1e-6) return
        add(mk('line', { x1: round3(2 * m.x - P.x), y1: round3(2 * m.y - P.y), x2: P.x, y2: P.y }))
        return setPts([])
      }
      case 'rect': {
        if (!pts.length) return setPts([p])
        const d = normRect(pts[0], p)
        if (d.w > 0 && d.h > 0) add(mk('rect', d))
        return setPts([])
      }
      case 'rect_center': {
        if (!pts.length) return setPts([p])
        const c = pts[0], d = normRect({ x: 2 * c.x - p.x, y: 2 * c.y - p.y }, p)
        if (d.w > 0 && d.h > 0) add(mk('rect', d))
        return setPts([])
      }
      case 'rect_3pt': {
        if (pts.length < 2) { if (pts.length === 1 && dist(pts[0], p) < 1e-6) return; return setPts([...pts, p]) }
        const cs = rect3Corners(pts[0], pts[1], p)
        if (dist(cs[1], cs[2]) < 1e-6) return
        const u = sub(pts[1], pts[0])
        const aligned = Math.abs(u.x) < 1e-9 || Math.abs(u.y) < 1e-9
        if (aligned) add(mk('rect', normRect(cs[0], cs[2])))
        else add(...polygonLines(cs))
        return setPts([])
      }
      case 'circle': {
        if (!pts.length) return setPts([p])
        const r = round3(dist(pts[0], p))
        if (r > 0) add(mk('circle', { cx: pts[0].x, cy: pts[0].y, r }))
        return setPts([])
      }
      case 'circle_2pt': {
        if (!pts.length) return setPts([p])
        const r = round3(dist(pts[0], p) / 2)
        if (r > 0) add(mk('circle', { cx: round3((pts[0].x + p.x) / 2), cy: round3((pts[0].y + p.y) / 2), r }))
        return setPts([])
      }
      case 'circle_3pt': {
        if (pts.length < 2) return setPts([...pts, p])
        const cc = circumcircle(pts[0], pts[1], p)
        if (!cc) { notify('Punti allineati: impossibile creare il cerchio'); return }
        add(mk('circle', { cx: round3(cc.cx), cy: round3(cc.cy), r: round3(cc.r) }))
        return setPts([])
      }
      case 'arc': {
        if (pts.length < 2) return setPts([...pts, p])
        const [c, s] = pts
        const r = round3(dist(c, s))
        if (r > 0) add(mk('arc', { cx: c.x, cy: c.y, r, start: round3(angleOf(c, s)), end: round3(angleOf(c, p)) }))
        return setPts([])
      }
      case 'arc_3pt': {
        if (pts.length < 2) return setPts([...pts, p])
        const a = arcFrom3(pts[0], pts[1], p)
        if (!a) { notify('Punti allineati: impossibile creare l\'arco'); return }
        add(mk('arc', a))
        return setPts([])
      }
      case 'arc_start_end_radius': {
        if (pts.length < 2) { if (pts.length === 1 && dist(pts[0], p) < 1e-6) return; return setPts([...pts, p]) }
        const a = arcStartEndRadius(pts[0], pts[1], Number(options.arcRadius) || 10, p)
        if (!a) return
        if ((Number(options.arcRadius) || 0) < dist(pts[0], pts[1]) / 2) notify('Raggio minore di metà corda: creato un semicerchio')
        add(mk('arc', a))
        return setPts([])
      }
      case 'ellipse': {
        if (!pts.length) return setPts([p])
        if (pts.length === 1) { if (dist(pts[0], p) < 1e-6) return; return setPts([...pts, p]) }
        const [c, ax] = pts
        const u = unit(sub(ax, c)), ry = Math.abs(cross(u, sub(p, c)))
        if (ry < 1e-6) return
        add(mk('ellipse', { cx: c.x, cy: c.y, rx: round3(dist(c, ax)), ry: round3(ry), rotation: round3(angleOf(c, ax)) }))
        return setPts([])
      }
      case 'slot_center': {
        if (!pts.length) return setPts([p])
        const c = pts[0]
        if (dist(c, p) < 1e-6) return
        add(mk('slot', { cx: c.x, cy: c.y, length: round3(2 * dist(c, p)), width: round3(Number(options.slotWidth) || 5), angle: round3(angleOf(c, p)) }))
        return setPts([])
      }
      case 'spline': return setPts([...pts, p])
      case 'measure': return handleMeasure(p, raw)
      case 'dimension': {
        if (pts.length) {
          // quota tra due punti: se entrambi sono punti di figure (o l'origine) diventa guida e li posiziona
          const rb = refOfSnap(sn?.snap)
          const link = dimRef && rb && !(dimRef.id === rb.id && dimRef.ref === rb.ref) ? { pa: dimRef, pb: rb, driving: true } : {}
          if (dist(pts[0], p) > 0) add({ id: uid(), type: 'dimension', is_construction: true, ...link, data: { x1: pts[0].x, y1: pts[0].y, x2: p.x, y2: p.y, off: 0 } })
          setDimRef(null)
          return setPts([])
        }
        if (dimPick) {
          const la = lineAt(raw)
          if (la && sameSeg(la.e, dimPick.e)) add(linearDimOf(dimPick.e, 5, dimPick.link))
          else if (la) {
            const d = angleDimOf(dimPick.e, dimPick.click, la.e, raw)
            if (!d) notify('Linee parallele: nessun angolo da quotare')
            else add(d)
          } else add(linearDimOf(dimPick.e, offsetFrom(dimPick.e, p), dimPick.link))
          return setDimPick(null)
        }
        // click vicino a un punto chiave (estremo, vertice, centro, origine) = quota punto-punto
        const r0 = refOfSnap(sn?.snap)
        if (r0 && dist(sn.p, raw) < tol) { setDimRef(r0); return setPts([p]) }
        const la = lineAt(raw)
        if (la) return setDimPick({ e: la.e, click: raw, link: linkOfLine(la) })
        const h = hit(raw, geomFilter)
        if (h && (h.e.type === 'circle' || h.e.type === 'arc')) {
          const d = h.e.data
          const ang = round3(angleOf({ x: d.cx, y: d.cy }, raw))
          const link = withDriving({ targetId: h.e.id, param: h.e.type === 'circle' ? 'diameter' : 'radius' })
          return add({ id: uid(), type: 'dim_radial', is_construction: true, ...link, data: { cx: d.cx, cy: d.cy, r: d.r, angle: ang, diam: h.e.type === 'circle' ? 1 : 0 } })
        }
        setDimRef(refOfSnap(sn?.snap))
        return setPts([p])
      }
      case 'bridge': {
        if (!pts.length) {
          const h = hit(raw, (x) => x.type !== 'bridge' && !isDim(x) && !x.is_construction)
          if (h) {
            const bw = options.bridgeWidth || 4
            const across = maxToolDia + 6
            const horiz = Math.abs(h.c.tangent.x) >= Math.abs(h.c.tangent.y)
            const w = horiz ? bw : across, hh = horiz ? across : bw
            return add({ id: uid(), type: 'bridge', is_construction: false, data: { x: round3(h.c.point.x - w / 2), y: round3(h.c.point.y - hh / 2), w, h: hh } })
          }
          return setPts([p])
        }
        const d = normRect(pts[0], p)
        if (d.w > 0 && d.h > 0) add({ id: uid(), type: 'bridge', is_construction: false, data: d })
        return setPts([])
      }
      case 'trim': {
        const h = hit(raw, isTrimmable)
        if (!h) return
        const r = trimClick(h.e, h.c.point, geo)
        return r && replace(r.removeIds, r.add)
      }
      case 'mirror': {
        if (!selected.size) { notify('Seleziona prima le entità da specchiare'); return setTool('select') }
        if (!pts.length) return setPts([P])
        if (dist(pts[0], P) < 1e-6) return
        const copies = selEnts.flatMap((x) => mirrorEntity(x, pts[0], P))
        add(...copies)
        setSelected(new Set(copies.map((c) => c.id)))
        return setPts([])
      }
      case 'mirror_on_line': {
        if (!selected.size) { notify('Seleziona prima le entità da specchiare'); return setTool('select') }
        const la = lineAt(raw)
        if (!la) return notify('Click su una linea esistente da usare come asse')
        const a = { x: la.e.data.x1, y: la.e.data.y1 }, b = { x: la.e.data.x2, y: la.e.data.y2 }
        if (dist(a, b) < 1e-6) return
        const copies = selEnts.filter((x) => x.id !== la.src.id).flatMap((x) => mirrorEntity(x, a, b))
        add(...copies)
        setSelected(new Set(copies.map((c) => c.id)))
        return notify(`Specchiate ${copies.length} entità`, 'success')
      }
      case 'array_circular': {
        if (!selected.size) { notify('Seleziona prima le entità'); return setTool('select') }
        return setArrayCfg((c) => ({ type: 'circular', n: c?.n ?? 6, angle: c?.angle ?? 360, center: p }))
      }
      case 'fillet': {
        const la = lineAt(raw)
        if (!la) return
        const R = Number(options.filletRadius) || 3
        if (!pick) {
          if (la.lines) onChange([...entities.filter((x) => x.id !== la.src.id), ...la.lines])
          return setPick({ id: la.e.id, click: raw })
        }
        const l1 = entities.find((x) => x.id === pick.id)
        if (!l1 || l1.id === la.e.id || sameSeg(l1, la.e)) return setPick(null)
        const res = filletLines(l1, pick.click, la.e, raw, R)
        if (!res) { notify('Raccordo impossibile (linee parallele o raggio troppo grande)'); return setPick(null) }
        const base = la.lines ? [...entities.filter((x) => x.id !== la.src.id), ...la.lines] : entities
        const kept = base.filter((x) => x.id !== l1.id && x.id !== la.e.id)
        onChange([...kept, res.l1, res.l2, res.arc, ...autoCoincide([...kept.filter(isGeo), res.l1, res.l2], [res.arc])])
        return setPick(null)
      }
      default:
    }
  }

  // ---------------------------------------------------------------- mouse
  const onMouseDown = (e) => {
    const { sx, sy } = evPos(e)
    const raw = toW(sx, sy)
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault()
      return setDrag({ type: 'pan', sx, sy, tx: v.tx, ty: v.ty })
    }
    if (e.button !== 0) return
    const sn = snap(raw, e)
    const { p } = sn
    if (pasting) return placePaste(p)
    if (pickLine) {
      const la = lineAt(raw)
      if (la) pickLine(la.e)
      else notify('Click su una linea di riferimento (Esc per annullare)')
      return
    }
    if (tool === 'select') {
      // 1) punto chiave: trascina il punto (stira l'estremo o sposta la figura), click = seleziona
      const pt = !e.shiftKey && pointAt(raw)
      if (pt) return setDrag({ type: 'point', id: pt.id, ref: pt.ref, grab: { x: pt.x, y: pt.y }, cur: { x: pt.x, y: pt.y }, target: null, sx, sy, moved: false, con: constraintAt(raw)?.id || null })
      const con = constraintAt(raw)
      if (con) {
        const sel = e.shiftKey ? new Set(selected) : new Set()
        sel.has(con.id) ? sel.delete(con.id) : sel.add(con.id)
        return setSelected(sel)
      }
      // l'etichetta di una quota è cliccabile quanto la sua linea
      const lab = entities.filter(isDim).map((x) => ({ e: x, d: dimLabelDist(x, sx, sy) })).filter((q) => q.d < 16).sort((a, b) => a.d - b.d)[0]
      // etichetta di quota: trascinandola si cambia l'offset RELATIVO al punto medio della quota
      if (lab && !e.shiftKey) {
        setSelected(new Set([lab.e.id]))
        return setDrag({ type: 'label', id: lab.e.id, start: raw, cur: raw, sx, sy, moved: false, editDim: isLinkedDim(lab.e) && lab.e.driving !== false ? lab.e : null })
      }
      const h = lab ? { e: lab.e } : hit(raw)
      if (h) {
        let sel = selected
        if (e.shiftKey) {
          sel = new Set(selected)
          sel.has(h.e.id) ? sel.delete(h.e.id) : sel.add(h.e.id)
          setSelected(sel)
          return
        }
        if (!selected.has(h.e.id)) { sel = new Set([h.e.id]); setSelected(sel) }
        const editDim = isLinkedDim(h.e) && h.e.driving !== false ? h.e : null
        // presa vicino a un punto chiave della figura: rilasciandola su un altro punto si crea il vincolo
        const sr = !editDim && refOfSnap(sn.snap)
        const startRef = sr && sel.has(sr.id) ? sr : null
        return setDrag({ type: 'move', start: p, cur: p, ids: sel, editDim, sx, sy, startRef, target: null })
      }
      if (!e.shiftKey) setSelected(new Set())
      return setDrag({ type: 'box', a: raw, b: raw })
    }
    handleToolClick(p, raw, e, sn)
  }

  const onMouseMove = (e) => {
    const { sx, sy } = evPos(e)
    if (drag?.type === 'pan') return setView({ ...v, tx: drag.tx + sx - drag.sx, ty: drag.ty + sy - drag.sy })
    const raw = toW(sx, sy)
    if (drag?.type === 'point') {
      // snap sui punti delle altre figure / origine (non sui propri)
      const sn = snap(raw, e, drag.id)
      setCursor({ raw, p: sn.p, snap: sn.snap })
      const moved = drag.moved || Math.hypot(sx - drag.sx, sy - drag.sy) > 3
      return setDrag({ ...drag, cur: moved ? sn.p : drag.cur, target: moved ? refOfSnap(sn.snap) : null, moved })
    }
    if (drag?.type === 'label') {
      setCursor({ raw, p: raw, snap: null })
      return setDrag({ ...drag, cur: raw, moved: drag.moved || Math.hypot(sx - drag.sx, sy - drag.sy) > 3 })
    }
    const sn = snap(raw, e, drag?.type === 'move' && drag.ids.size === 1 ? [...drag.ids][0] : null)
    setCursor({ raw, p: ortho(sn.p, e), snap: sn.snap })
    if (drag?.type === 'move') {
      const t = drag.startRef && refOfSnap(sn.snap)
      setDrag({ ...drag, cur: sn.p, target: t && !drag.ids.has(t.id) ? t : null })
    }
    else if (drag?.type === 'box') setDrag({ ...drag, b: raw })
    else if (!drag) { const h = hit(raw); setHover(h?.e.id || null) }
  }

  const onMouseUp = () => {
    if (drag?.type === 'point') {
      if (!drag.moved) {
        // click semplice: sul punto con vincolo seleziona prima il vincolo, poi la figura
        setSelected(new Set([drag.con && !selected.has(drag.con) ? drag.con : drag.id]))
      } else {
        const res = pointDragResult(drag)
        if (res) {
          onChange(res.list, { fixed: res.fixed })
          if (res.linked) notify(res.linked === 'on_line' ? 'Punto vincolato sulla linea (Canc per rimuovere il vincolo)' : 'Vincolo di coincidenza creato (Canc per rimuoverlo)', 'success')
        }
      }
    } else if (drag?.type === 'label') {
      if (drag.moved) {
        const dx = drag.cur.x - drag.start.x, dy = drag.cur.y - drag.start.y
        onChange(entities.map((x) => (x.id === drag.id ? { ...x, lo: { dx: round3((x.lo?.dx || 0) + dx), dy: round3((x.lo?.dy || 0) + dy) } } : x)))
      } else if (drag.editDim) openDimEditor(drag.editDim)
    } else if (drag?.type === 'move') {
      const dx = drag.cur.x - drag.start.x, dy = drag.cur.y - drag.start.y
      if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
        let list = entities.map((x) => (drag.ids.has(x.id) ? translate(x, dx, dy) : x))
        const link = drag.startRef && drag.target && !hasCoincident(list, drag.startRef, drag.target)
        if (link) list = [...list, coincident(drag.startRef, drag.target)]
        onChange(list, { fixed: [...drag.ids] })
        if (link) notify('Vincolo di coincidenza creato (Canc per rimuoverlo)', 'success')
      } else if (drag.editDim) openDimEditor(drag.editDim)
    } else if (drag?.type === 'box') {
      const minX = Math.min(drag.a.x, drag.b.x), maxX = Math.max(drag.a.x, drag.b.x)
      const minY = Math.min(drag.a.y, drag.b.y), maxY = Math.max(drag.a.y, drag.b.y)
      if (maxX - minX > tol || maxY - minY > tol) {
        const ids = entities.filter((x) => {
          if (isConstraint(x)) { const c = constraintPos(x, entMap); return !!c && c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY }
          const b = bbox(x); return b.minX >= minX && b.maxX <= maxX && b.minY >= minY && b.maxY <= maxY }).map((x) => x.id)
        setSelected(new Set([...selected, ...ids]))
      }
    }
    setDrag(null)
  }

  // Trascinamento di un punto: lista con il punto spostato (+ eventuale nuovo vincolo) e chiavi da tenere ferme
  const pointDragResult = (d) => {
    const ent = entMap.get(d.id)
    if (!ent || dist(d.cur, d.grab) < 1e-9 && !d.target) return null
    const a = { id: d.id, ref: d.ref }
    let list = entities.map((x) => (x.id === d.id ? setPt(x, d.ref, d.cur) : x))
    let linked = false
    if (d.target && d.target.id !== d.id && !hasCoincident(list, a, d.target)) { list = [...list, coincident(a, d.target)]; linked = true }
    if (ent.type === 'point') {
      // Punto rilasciato su una linea (non su un key-point) → vincolo punto su linea
      let onl = list.some((c) => isOnLine(c) && c.data.a.id === d.id)
      if (!d.target && !onl) {
        const h = hit(d.cur, (x) => (x.type === 'line' || x.type === 'construction') && x.id !== d.id)
        if (h) { list = [...list, onLine(a, h.e.id)]; onl = true; linked = 'on_line' }
      }
      if (onl) return { list, fixed: [], linked } // il solver proietta il punto sulla linea: scorre lungo di essa
    }
    return { list, fixed: [keyOf(a)], linked }
  }
  // Anteprima durante i trascinamenti: il solver fa seguire le figure vincolate
  const dragPreview = useMemo(() => {
    if (drag?.type === 'point' && drag.moved) {
      const r = pointDragResult(drag)
      return r ? new Map(syncDims(solveCommit(fillDimValues(syncDims(r.list)), r.fixed).list).map((x) => [x.id, x])) : null
    }
    if (drag?.type === 'move') {
      const dx = drag.cur.x - drag.start.x, dy = drag.cur.y - drag.start.y
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null
      const list = entities.map((x) => (drag.ids.has(x.id) ? translate(x, dx, dy) : x))
      return new Map(syncDims(solveCommit(fillDimValues(syncDims(list)), [...drag.ids]).list).map((x) => [x.id, x]))
    }
    return null
  }, [drag, entities]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- copia / incolla
  // Copie con nuovi id; le quote collegate a entità copiate restano collegate alle copie
  const pasteCopies = (clip, p) => {
    const dx = round3(p.x - clip.base.x), dy = round3(p.y - clip.base.y)
    const ids = new Map(clip.ents.map((x) => [x.id, uid()]))
    return clip.ents.map((x) => {
      if (isConstraint(x)) return { ...x, id: ids.get(x.id), data: { a: { ...x.data.a, id: ids.get(x.data.a.id) }, b: { ...x.data.b, id: ids.get(x.data.b.id) } } }
      const c = { ...translate(x, dx, dy), id: ids.get(x.id) }
      if (c.targetId) {
        if (ids.has(c.targetId)) c.targetId = ids.get(c.targetId)
        else { delete c.targetId; delete c.param; delete c.side; delete c.driving; delete c.value }
      }
      for (const [k1, k2] of [['pa', 'pb'], ['la', 'lb']]) {
        if (!c[k1]) continue
        const ok = (r) => r.id === ORIGIN_ID || ids.has(r.id)
        const mapRef = (r) => (r.id === ORIGIN_ID ? r : { ...r, id: ids.get(r.id) })
        if (ok(c[k1]) && ok(c[k2])) { c[k1] = mapRef(c[k1]); c[k2] = mapRef(c[k2]) } else { delete c[k1]; delete c[k2]; delete c.driving; delete c.value }
      }
      return c
    })
  }
  const placePaste = (p) => {
    let copies = pasteCopies(pasting, p)
    // punti coincidenti tra le copie (es. vertici che erano vincolati entrambi all'origine)
    const cons = copies.filter(isConstraint)
    copies = [...copies, ...autoCoincide(cons, copies.filter((x) => !isConstraint(x)))]
    onChange(syncDims([...entities, ...copies]))
    setSelected(new Set(copies.map((c) => c.id)))
    setPasting(null)
  }

  // ---------------------------------------------------------------- quote editabili
  // Offset (px schermo) dell'etichetta: e.lo è relativo al punto medio della quota, in mm (+ trascinamento in corso)
  const labelOff = (e) => {
    let dx = e.lo?.dx || 0, dy = e.lo?.dy || 0
    if (drag?.type === 'label' && drag.moved && drag.id === e.id) { dx += drag.cur.x - drag.start.x; dy += drag.cur.y - drag.start.y }
    return { x: dx * v.s, y: -dy * v.s }
  }
  // Raggio dell'arco di una quota angolare: l'arco parte dall'intersezione e termina SULLE due linee
  const angleR = (e, d, byId = entMap) => {
    if (!e.la || !e.lb) return d.r
    const c = { x: d.cx, y: d.cy }
    const reach = [e.la, e.lb].map((r) => { const l = byId.get(r.id); return l ? Math.max(dist(c, { x: l.data.x1, y: l.data.y1 }), dist(c, { x: l.data.x2, y: l.data.y2 })) : Infinity })
    const m = Math.min(...reach)
    return m === Infinity || m <= 0 ? d.r : Math.max(Math.min(d.r, m * 0.9), Math.min(m, 4 / v.s))
  }
  const dimLabelBase = (e, d) => {
    if (e.type === 'dimension') { const q = dimLinePoints(d); const a = toS(q.A), b = toS(q.B); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
    const c = { x: d.cx, y: d.cy }
    if (e.type === 'dim_angle') return toS(polar(c, angleR(e, d) + 10 / v.s, d.a1 + arcSweep(d.a1, d.a2) / 2))
    return toS(d.diam ? polar(c, d.r * 0.45, d.angle) : polar(c, d.r / 2, d.angle))
  }
  const dimLabelPos = (e) => {
    const b = dimLabelBase(e, liveDim(e)), o = labelOff(e)
    return { x: b.x + o.x, y: b.y + o.y }
  }
  // Distanza (px) del click dall'etichetta: le quote lineari hanno un'etichetta lunga lungo la linea di quota
  const dimLabelDist = (e, sx, sy) => {
    const c = dimLabelPos(e)
    if (e.type !== 'dimension' || e.lo) return dist(c, { x: sx, y: sy }) * (e.lo && e.type === 'dimension' ? 0.5 : 1)
    const q = dimLinePoints(liveDim(e)), a = toS(q.A), b = toS(q.B), L = dist(a, b) || 1
    const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, dx = sx - c.x, dy = sy - c.y
    const along = Math.max(0, Math.abs(dx * u.x + dy * u.y) - 28), perp = Math.abs(dx * u.y - dy * u.x)
    return Math.hypot(along, Math.max(0, perp - 6))
  }
  const openDimEditor = (e) => {
    const val = measureDim(e, entMap)
    if (val == null) return notify('Entità quotata non trovata: quota non modificabile')
    setEditingDim({ id: e.id, value: String(round3(val)), screenPos: dimLabelPos(e) })
  }
  const applyDimEdit = () => {
    const ed = editingDim
    setEditingDim(null)
    if (!ed) return
    const dim = entMap.get(ed.id)
    const cur = dim && measureDim(dim, entMap)
    if (cur == null) return
    const val = parseFloat(String(ed.value).replace(',', '.'))
    if (!(val > 0)) return notify('La quota deve essere maggiore di 0')
    if (dim.la && !(val < 180)) return notify("L'angolo deve essere compreso tra 0° e 180°")
    if (Math.abs(val - cur) < 1e-9) return
    // la quota guida prende il nuovo valore e il solver riposiziona la geometria (primo riferimento fermo)
    const fixed = dim.targetId ? (entMap.get(dim.targetId)?.type === 'rect' ? [] : [`${dim.targetId}:p1`])
      : dim.pa ? [keyOf(dim.pa)] : [] // angolo: il solver ruota la linea meno vincolata
    onChange(entities.map((x) => (x.id === dim.id ? { ...x, value: val } : x)), { fixed, refresh: false })
  }

  const onDoubleClick = () => { if (tool === 'spline' && pts.length) finishSpline(pts) }

  const onWheel = (e) => {
    const { sx, sy } = evPos(e)
    const k = Math.exp(-e.deltaY * 0.0015)
    const s = Math.max(0.05, Math.min(400, v.s * k))
    const w = toW(sx, sy)
    setView({ s, tx: sx - w.x * s, ty: sy + w.y * s })
  }
  useEffect(() => {
    const el = wrap.current
    const h = (e) => e.preventDefault()
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [])

  const onCtx = (e) => {
    e.preventDefault()
    if (tool === 'spline' && pts.length >= 2) return finishSpline(pts)
    if (pts.length || pick || dimPick) return cancel()
    const { sx, sy } = evPos(e)
    const h = hit(toW(sx, sy))
    if (h) {
      if (!selected.has(h.e.id)) setSelected(new Set([h.e.id]))
      onContextMenu?.(h.e, { x: e.clientX, y: e.clientY })
    }
  }

  // ---------------------------------------------------------------- tastiera
  useEffect(() => {
    const down = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.code === 'Space') { space.current = true; e.preventDefault(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? onRedo() : onUndo() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); return onRedo() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const toCopy = selEnts.filter((x) => !isConstraint(x))
        if (!toCopy.length) return
        e.preventDefault()
        const bs = toCopy.map(bbox)
        const base = { x: (Math.min(...bs.map((b) => b.minX)) + Math.max(...bs.map((b) => b.maxX))) / 2, y: (Math.min(...bs.map((b) => b.minY)) + Math.max(...bs.map((b) => b.maxY))) / 2 }
        // i vincoli interni (tra figure copiate) viaggiano con la copia; quelli verso l'esterno/origine no
        const cids = new Set(toCopy.map((x) => x.id))
        const inner = entities.filter((x) => isConstraint(x) && cids.has(x.data.a.id) && cids.has(x.data.b.id))
        CLIPBOARD = { ents: JSON.parse(JSON.stringify([...toCopy, ...inner])), base }
        return notify(`${toCopy.length} entità copiate · Ctrl+V per incollare`)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (!CLIPBOARD?.ents.length) return notify('Niente da incollare: seleziona e premi Ctrl+C')
        e.preventDefault()
        cancel()
        return setPasting(CLIPBOARD)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); return onDuplicate() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); return setSelected(new Set(geo.map((x) => x.id))) }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Enter' && tool === 'spline' && pts.length) { e.preventDefault(); return finishSpline(pts) }
      if (e.key === 'Escape') {
        if (pasting) setPasting(null)
        else if (pickLine) pickLine(null)
        else if (pts.length || pick || dimPick || arrayCfg) cancel()
        else if (measure) setMeasure(null)
        else if (selected.size) setSelected(new Set())
        else setTool('select')
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return onDelete() }
      if (e.key === 'Home' || e.key === 'h' || e.key === 'H') return fit()
      const t = toolForKey(e.key, tool)
      if (t) setTool(t)
    }
    const up = (e) => { if (e.code === 'Space') space.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }) // si riaggancia a ogni render: legge sempre lo stato corrente

  // ---------------------------------------------------------------- render helpers
  const grid = useMemo(() => {
    if (!view) return null
    let g = ui?.grid_size || 1
    while (g * v.s < 8) g *= 5
    const major = g * 10
    const tl = toW(0, 0), br = toW(size.w, size.h)
    const lines = []
    for (let x = Math.floor(tl.x / g) * g; x <= br.x; x += g) {
      const sx = x * v.s + v.tx
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6
      lines.push(<line key={'x' + x} x1={sx} y1={0} x2={sx} y2={size.h} stroke={isMajor ? '#2f2f2f' : '#1f1f1f'} strokeWidth={1} />)
    }
    for (let y = Math.floor(br.y / g) * g; y <= tl.y; y += g) {
      const sy = -y * v.s + v.ty
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6
      lines.push(<line key={'y' + y} x1={0} y1={sy} x2={size.w} y2={sy} stroke={isMajor ? '#2f2f2f' : '#1f1f1f'} strokeWidth={1} />)
    }
    return { lines, g }
  }, [view, size, ui?.grid_size]) // eslint-disable-line react-hooks/exhaustive-deps

  const arcPath = (d) => {
    const c = { x: d.cx, y: d.cy }
    const sw = arcSweep(d.start, d.end)
    if (sw >= 359.999) { const s = toS(c); return `M ${s.x - d.r * v.s} ${s.y} a ${d.r * v.s} ${d.r * v.s} 0 1 0 ${2 * d.r * v.s} 0 a ${d.r * v.s} ${d.r * v.s} 0 1 0 ${-2 * d.r * v.s} 0` }
    const a = toS(polar(c, d.r, d.start)), b = toS(polar(c, d.r, d.end))
    return `M ${a.x} ${a.y} A ${d.r * v.s} ${d.r * v.s} 0 ${sw > 180 ? 1 : 0} 0 ${b.x} ${b.y}`
  }

  // dy è nel riferimento ruotato del testo: lo stacca dalla linea di quota anche quando è verticale
  const dimText = (x, y, ang, txt, color, key, reference, dy = -6) => {
    const flip = ang > 90 || ang < -90
    return <text key={key} x={x} y={y} dy={dy} fill={color} fontStyle={reference ? 'italic' : undefined} opacity={reference ? 0.75 : 1} fontSize={12} textAnchor="middle" fontFamily="monospace" paintOrder="stroke" stroke="#121212" strokeWidth={3}
      transform={`rotate(${flip ? ang + 180 : ang} ${x} ${y})`}>{txt}</text>
  }

  // Etichetta agganciata: posizione = punto medio della quota + offset relativo (con linea di richiamo se spostata)
  const anchoredText = (e, mx, my, ang, txt, stroke, ref, dy) => {
    const o = labelOff(e)
    const moved = Math.hypot(o.x, o.y) > 1
    return <>{moved && <line x1={mx} y1={my} x2={mx + o.x} y2={my + o.y} stroke={stroke} strokeWidth={0.6} strokeDasharray="2 2" />}
      {dimText(mx + o.x, my + o.y, ang, txt, stroke, undefined, ref, dy)}</>
  }
  const renderEntity = (e, key, opts = {}) => {
    const d = isDim(e) && !opts.ghost && !opts.live ? liveDim(e) : e.data
    const ref = e.driving === false
    const lbl = (t) => (ref ? `(${t})` : t)
    const isSel = !opts.ghost && selected.has(e.id)
    const stroke = opts.color || (isSel ? COLORS.selected : e.type === 'bridge' ? COLORS.bridge : isDim(e) ? COLORS.dim
      : e.is_construction ? COLORS.construction : hover === e.id ? COLORS.hover : COLORS.normal)
    const common = {
      stroke, strokeWidth: opts.width || (isSel ? 2 : 1.5), fill: 'none', strokeLinecap: 'round',
      strokeDasharray: opts.dash || (e.is_construction && !isDim(e) ? '6 4' : undefined),
    }
    switch (e.type) {
      case 'line': case 'construction': {
        const a = toS({ x: d.x1, y: d.y1 }), b = toS({ x: d.x2, y: d.y2 })
        return <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
      }
      case 'rect': case 'bridge': {
        const a = toS({ x: d.x, y: d.y + d.h })
        return <rect key={key} x={a.x} y={a.y} width={d.w * v.s} height={d.h * v.s} {...common}
          fill={e.type === 'bridge' && !opts.ghost ? 'rgba(249,115,22,0.25)' : 'none'} />
      }
      case 'circle': {
        const c = toS({ x: d.cx, y: d.cy })
        return <circle key={key} cx={c.x} cy={c.y} r={Math.max(0, d.r * v.s)} {...common} />
      }
      case 'arc': return <path key={key} d={arcPath(d)} {...common} />
      case 'ellipse': {
        const c = toS({ x: d.cx, y: d.cy })
        return <ellipse key={key} cx={c.x} cy={c.y} rx={Math.max(0, d.rx * v.s)} ry={Math.max(0, d.ry * v.s)} transform={`rotate(${-(d.rotation || 0)} ${c.x} ${c.y})`} {...common} />
      }
      case 'slot': return <path key={key} d={slotPath(d, toS)} {...common} strokeLinejoin="round" />
      case 'spline': return <path key={key} d={catmullRomPath(d.points, toS)} {...common} />
      case 'dimension': {
        const q = dimLinePoints(d)
        const a = toS(q.A), b = toS(q.B), pa = toS(q.a), pb = toS(q.b)
        const L = dist(q.a, q.b)
        const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        const ext = q.off ? 2 / v.s * Math.sign(q.off) : 0
        const ea = toS({ x: q.A.x + q.n.x * ext, y: q.A.y + q.n.y * ext }), eb = toS({ x: q.B.x + q.n.x * ext, y: q.B.y + q.n.y * ext })
        return (
          <g key={key}>
            {q.off ? <><line x1={pa.x} y1={pa.y} x2={ea.x} y2={ea.y} stroke={stroke} strokeWidth={0.8} /><line x1={pb.x} y1={pb.y} x2={eb.x} y2={eb.y} stroke={stroke} strokeWidth={0.8} /></> : null}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} markerStart="url(#arrow)" markerEnd="url(#arrow)" />
            {editingDim?.id !== e.id && (opts.ghost ? dimText(mx, my, ang, lbl(`${fmt(L)} mm`), stroke, undefined, ref) : anchoredText(e, mx, my, ang, lbl(`${fmt(L)} mm`), stroke, ref))}
          </g>
        )
      }
      case 'dim_radial': {
        const c = { x: d.cx, y: d.cy }
        const tip = toS(polar(c, d.r, d.angle)), tail = toS(d.diam ? polar(c, d.r, d.angle + 180) : c)
        const ang = Math.atan2(tip.y - tail.y, tip.x - tail.x) * 180 / Math.PI
        const mid = d.diam ? toS(polar(c, d.r * 0.45, d.angle)) : { x: (tip.x + tail.x) / 2, y: (tip.y + tail.y) / 2 }
        return (
          <g key={key}>
            <line x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} {...common} markerStart={d.diam ? 'url(#arrow)' : undefined} markerEnd="url(#arrow)" />
            {!d.diam && <circle cx={tail.x} cy={tail.y} r={2} fill={stroke} />}
            {editingDim?.id !== e.id && anchoredText(opts.ghost ? {} : e, mid.x, mid.y, ang, lbl(d.diam ? `Ø ${fmt(2 * d.r)} mm` : `R ${fmt(d.r)} mm`), stroke, ref)}
          </g>
        )
      }
      case 'dim_angle': {
        const c = { x: d.cx, y: d.cy }, sw = arcSweep(d.a1, d.a2)
        const r = opts.ghost ? d.r : angleR(e, d, opts.byId || entMap)
        const t = toS(polar(c, r + 10 / v.s, d.a1 + sw / 2))
        return (
          <g key={key}>
            <path d={arcPath({ cx: d.cx, cy: d.cy, r, start: d.a1, end: d.a2 })} {...common} markerStart="url(#arrow)" markerEnd="url(#arrow)" />
            {editingDim?.id !== e.id && anchoredText(opts.ghost ? {} : e, t.x, t.y, 0, lbl(`${fmt(sw)}°`), stroke, ref, 4)}
          </g>
        )
      }
      case 'point': {
        const c = toS({ x: d.x, y: d.y }), col = opts.color || (isSel ? COLORS.selected : hover === e.id ? COLORS.hover : COLORS.point)
        return (
          <g key={key} stroke={col} strokeWidth={1.5} fill="none">
            <circle cx={c.x} cy={c.y} r={3} />
            <line x1={c.x - 6} y1={c.y} x2={c.x + 6} y2={c.y} /><line x1={c.x} y1={c.y - 6} x2={c.x} y2={c.y + 6} />
          </g>
        )
      }
      default: return null
    }
  }

  // ---------------------------------------------------------------- anteprime
  const preview = () => {
    if (arrayCfg) {
      const cps = arrayCopies(arrayCfg)
      return <g>{cps.map((e, i) => renderEntity(e, '_arr' + i, { color: COLORS.preview, dash: '5 4' }))}
        {arrayCfg.center && (() => { const s = toS(arrayCfg.center); return <circle cx={s.x} cy={s.y} r={5} fill="none" stroke={COLORS.preview} /> })()}</g>
    }
    if (!cursor) return null
    const p = cursor.p
    const pv = (e, k = '_pv', o = {}) => renderEntity({ id: '_pv', ...e }, k, { color: COLORS.preview, ...o })
    const guide = (a, b, k = '_g') => pv({ type: 'line', is_construction: true, data: { x1: a.x, y1: a.y, x2: b.x, y2: b.y } }, k)
    const c0 = pts[0]
    if (pasting) return <g>{pasteCopies(pasting, p).map((x, i) => renderEntity(x, '_paste' + i, { color: COLORS.preview, dash: '5 4' }))}</g>
    if (pickLine) { const la = lineAt(cursor.raw); return la && renderEntity(la.e, '_pl', { color: '#f472b6', width: 2.5 }) }
    switch (tool) {
      case 'trim': {
        const h = hit(cursor.raw, isTrimmable)
        const r = h && trimClick(h.e, h.c.point, geo)
        return r?.removed && renderEntity({ ...r.removed, id: '_trim', is_construction: false }, '_trim', { color: '#ef4444', width: 3, dash: '6 4' })
      }
      case 'line': case 'construction':
        return c0 && pv({ type: 'line', is_construction: tool === 'construction', data: { x1: c0.x, y1: c0.y, x2: p.x, y2: p.y } })
      case 'line_midpoint':
        return c0 && pv({ type: 'line', data: { x1: 2 * c0.x - p.x, y1: 2 * c0.y - p.y, x2: p.x, y2: p.y } })
      case 'rect': case 'bridge': return c0 && pv({ type: 'rect', data: normRect(c0, p) })
      case 'rect_center': return c0 && pv({ type: 'rect', data: normRect({ x: 2 * c0.x - p.x, y: 2 * c0.y - p.y }, p) })
      case 'rect_3pt':
        if (pts.length === 1) return guide(c0, p)
        if (pts.length === 2) return <g>{polygonLines(rect3Corners(pts[0], pts[1], p)).map((l, i) => pv(l, '_r3' + i))}</g>
        return null
      case 'circle': return c0 && pv({ type: 'circle', data: { cx: c0.x, cy: c0.y, r: dist(c0, p) } })
      case 'circle_2pt': return c0 && <g>{guide(c0, p)}{pv({ type: 'circle', data: { cx: (c0.x + p.x) / 2, cy: (c0.y + p.y) / 2, r: dist(c0, p) / 2 } }, '_c2')}</g>
      case 'circle_3pt': {
        if (pts.length === 1) return guide(c0, p)
        if (pts.length === 2) { const cc = circumcircle(pts[0], pts[1], p); return cc ? pv({ type: 'circle', data: { cx: cc.cx, cy: cc.cy, r: cc.r } }) : guide(pts[1], p) }
        return null
      }
      case 'arc':
        if (pts.length === 1) return guide(c0, p)
        if (pts.length === 2) return pv({ type: 'arc', data: { cx: c0.x, cy: c0.y, r: dist(c0, pts[1]), start: angleOf(c0, pts[1]), end: angleOf(c0, p) } })
        return null
      case 'arc_3pt': {
        if (pts.length === 1) return guide(c0, p)
        if (pts.length === 2) { const a = arcFrom3(pts[0], pts[1], p); return a ? pv({ type: 'arc', data: a }) : guide(pts[0], p) }
        return null
      }
      case 'arc_start_end_radius': {
        if (pts.length === 1) return guide(c0, p)
        if (pts.length === 2) { const a = arcStartEndRadius(pts[0], pts[1], Number(options.arcRadius) || 10, p); return a && pv({ type: 'arc', data: a }) }
        return null
      }
      case 'ellipse': {
        if (pts.length === 1) return guide(c0, p)
        if (pts.length === 2) {
          const [c, ax] = pts, u = unit(sub(ax, c)), ry = Math.abs(cross(u, sub(p, c)))
          return <g>{guide(c, ax)}{pv({ type: 'ellipse', data: { cx: c.x, cy: c.y, rx: dist(c, ax), ry: Math.max(ry, 1e-3), rotation: angleOf(c, ax) } }, '_el')}</g>
        }
        return null
      }
      case 'slot_center':
        return c0 && dist(c0, p) > 1e-6 && <g>{guide(c0, p)}{pv({ type: 'slot', data: { cx: c0.x, cy: c0.y, length: 2 * dist(c0, p), width: Number(options.slotWidth) || 5, angle: angleOf(c0, p) } }, '_sl')}</g>
      case 'spline':
        return pts.length > 0 && pv({ type: 'spline', data: { points: [...pts, p] } })
      case 'mirror': return c0 && guide(c0, p)
      case 'mirror_on_line': {
        const la = lineAt(cursor.raw)
        if (!la) return null
        const a = { x: la.e.data.x1, y: la.e.data.y1 }, b = { x: la.e.data.x2, y: la.e.data.y2 }
        return <g>{renderEntity(la.e, '_axis', { color: '#f472b6', width: 2.5 })}{selEnts.filter((x) => x.id !== la.src.id).flatMap((x) => mirrorEntity(x, a, b)).map((x, i) => pv(x, '_m' + i, { dash: '5 4' }))}</g>
      }
      case 'dimension': {
        if (c0) return pv({ type: 'dimension', data: { x1: c0.x, y1: c0.y, x2: p.x, y2: p.y, off: 0 } })
        if (dimPick) {
          const la = lineAt(cursor.raw)
          if (la && !sameSeg(la.e, dimPick.e)) { const d = angleDimOf(dimPick.e, dimPick.click, la.e, cursor.raw); return d && renderEntity(d, '_pv', { color: COLORS.preview }) }
          return renderEntity(linearDimOf(dimPick.e, la ? 5 : offsetFrom(dimPick.e, p)), '_pv', { color: COLORS.preview })
        }
        return null
      }
      case 'fillet': {
        if (!pick) return null
        const l1 = entities.find((x) => x.id === pick.id)
        const la = lineAt(cursor.raw)
        if (!l1 || !la || sameSeg(l1, la.e)) return null
        const res = filletLines(l1, pick.click, la.e, cursor.raw, Number(options.filletRadius) || 3)
        if (!res) return null
        return <g>{[res.l1, res.l2, res.arc].map((x, i) => pv(x, '_f' + i, { dash: '5 4', width: 2 }))}</g>
      }
      default: return null
    }
  }

  const measureMarks = () => {
    const m = measure?.marks
    if (!m) return null
    return (
      <g>
        {(m.ents || []).map((e, i) => renderEntity(e, '_ms' + i, { color: COLORS.measure, width: 2.5 }))}
        {m.seg && (() => { const a = toS(m.seg[0]), b = toS(m.seg[1]); return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLORS.measure} strokeDasharray="5 4" strokeWidth={1.5} /> })()}
        {[...(m.pts || []), ...(m.seg || [])].map((p, i) => { const s = toS(p); return <circle key={'mp' + i} cx={s.x} cy={s.y} r={3.5} fill={COLORS.measure} /> })}
        {m.arc && <path d={arcPath(m.arc)} stroke={COLORS.measure} fill="none" strokeWidth={1.5} />}
      </g>
    )
  }

  const shown = dragPreview ? entities.map((x) => dragPreview.get(x.id) || x) : entities
  const shownMap = dragPreview || entMap
  const nodes = tool === 'trim' ? nodeList : []
  const origin = toS({ x: 0, y: 0 })
  const stockTL = toS({ x: -stock.x / 2, y: stock.y / 2 })
  const hintText = {
    point: 'Click = punto libero · su una linea = punto vincolato sulla linea · su un key-point (pallino ciano = medio/centro) = punto coincidente',
    select: drag?.type === 'label' ? 'Rilascia per fissare la posizione dell\'etichetta (relativa al punto medio della quota)' : drag?.type === 'point' ? (drag.target ? 'Rilascia per creare il vincolo di coincidenza' : 'Trascina su un altro punto o sull\'origine per vincolarlo (Alt = senza snap)')
      : 'Click/drag per selezionare · trascina un punto chiave per spostare/stirare e vincolare · quadratino verde = vincolo (Canc elimina) · H = adatta',
    line: pts.length ? 'Click punto finale (Shift = orto, Esc = fine)' : 'Click punto iniziale',
    line_midpoint: pts.length ? 'Click estremo: la linea si estende simmetrica' : 'Click punto medio della linea',
    construction: pts.length ? 'Click punto finale' : 'Click punto iniziale',
    rect: pts.length ? 'Click angolo opposto' : 'Click primo angolo',
    rect_center: pts.length ? 'Click vertice' : 'Click centro del rettangolo',
    rect_3pt: ['1/3 · Click inizio del primo lato', '2/3 · Click fine del primo lato', '3/3 · Click per definire la larghezza'][pts.length],
    circle: pts.length ? 'Click punto sul raggio' : 'Click centro',
    circle_2pt: pts.length ? 'Click secondo estremo del diametro' : 'Click primo estremo del diametro',
    circle_3pt: ['1/3 · Click primo punto', '2/3 · Click secondo punto', '3/3 · Click terzo punto'][pts.length],
    arc: ['Click centro', 'Click punto iniziale', 'Click punto finale (antiorario)'][pts.length],
    arc_3pt: ['1/3 · Click punto iniziale', '2/3 · Click punto intermedio', '3/3 · Click punto finale'][pts.length],
    arc_start_end_radius: ['1/3 · Click punto iniziale', '2/3 · Click punto finale', `3/3 · Click dal lato della curvatura (R=${options.arcRadius} mm)`][pts.length],
    ellipse: ['1/3 · Click centro', '2/3 · Click estremo asse X (raggio e rotazione)', '3/3 · Click per il semiasse Y'][pts.length],
    slot_center: pts.length ? `Click estremo (centro semicerchio) · larghezza ${options.slotWidth} mm` : 'Click centro dell\'asola',
    spline: pts.length ? `${pts.length} punti · click per aggiungere · Invio / doppio click / tasto destro per confermare · Esc annulla` : 'Click primo punto della spline',
    trim: 'Punti arancioni = vertici e contatti · click sul tratto da eliminare (in rosso): si taglia tra i 2 punti più vicini, senza punti interni si elimina tutta la linea',
    mirror: selected.size ? (pts.length ? "Click secondo punto dell'asse" : "Click primo punto dell'asse") : 'Seleziona prima le entità',
    mirror_on_line: selected.size ? `Click su una linea esistente come asse (${selected.size} entità)` : 'Seleziona prima le entità',
    array_circular: arrayCfg?.center ? 'Imposta quantità e angolo nel pannello, poi Applica (click per spostare il centro)' : 'Click centro di rotazione',
    array_rect: 'Imposta colonne, righe e passi nel pannello, poi Applica',
    fillet: pick ? 'Passa sulla seconda linea (anteprima) e click dal lato da mantenere' : `Click prima linea (R=${options.filletRadius} mm)`,
    dimension: pts.length ? 'Click secondo punto' : dimPick ? 'Click stessa linea = quota (offset 5 mm) · altra linea = angolo · vuoto = posiziona quota'
      : 'Click linea / cerchio (Ø) / arco (R), oppure due punti liberi',
    measure: measure?.note || 'Click su linea, cerchio/arco, due linee (angolo) o due punti (distanza) · Esc azzera',
    bridge: pts.length ? 'Click angolo opposto' : 'Click su un contorno (o due click per rettangolo libero)',
  }[tool]

  const stop = (e) => e.stopPropagation()
  const numIn = (k, label, step = 1, min) => (
    <label className="flex items-center justify-between gap-2 text-xs text-gray-400">{label}
      <input type="number" step={step} min={min} className="input w-24 py-1" value={arrayCfg[k] ?? ''} onChange={(e) => setArrayCfg({ ...arrayCfg, [k]: e.target.value })} />
    </label>
  )

  return (
    <div ref={wrap} className="relative h-full w-full select-none overflow-hidden bg-[#121212]"
      style={{ cursor: drag?.type === 'pan' ? 'grabbing' : tool === 'select' ? 'default' : 'crosshair' }}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={() => { setCursor(null); setDrag(null) }}
      onDoubleClick={onDoubleClick} onWheel={onWheel} onContextMenu={onCtx}>
      <svg width={size.w} height={size.h} className="absolute inset-0">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        {grid?.lines}
        <rect x={stockTL.x} y={stockTL.y} width={stock.x * v.s} height={stock.y * v.s} fill="rgba(34,197,94,0.03)" stroke="#22c55e" strokeDasharray="8 5" strokeWidth={1.2} />
        <line x1={origin.x - 14} y1={origin.y} x2={origin.x + 30} y2={origin.y} stroke="#ef4444" strokeWidth={1.5} />
        <line x1={origin.x} y1={origin.y + 14} x2={origin.x} y2={origin.y - 30} stroke="#22c55e" strokeWidth={1.5} />
        <circle cx={origin.x} cy={origin.y} r={3} fill="#ef4444" />
        {/* altri layer: colore del layer, opacità 0.4, non interattivi */}
        <g opacity={0.4} pointerEvents="none">
          {otherLayerEntities.map((l, li) => l.entities.map((e) => renderEntity(e, `ol${li}_${e.id}`, { color: l.color, width: 1, ghost: true })))}
        </g>
        {shown.map((e) => renderEntity(e, e.id, dragPreview ? { live: true, byId: shownMap } : {}))}
        {pick && (() => { const e = entities.find((x) => x.id === pick.id); return e && renderEntity(e, '_pick', { color: '#f472b6', width: 2.5 }) })()}
        {dimPick && renderEntity(dimPick.e, '_dpick', { color: '#f472b6', width: 2.5 })}
        {measureMarks()}
        {preview()}
        {/* key-point: vertici grigi, punti medi e centri ciano (vincolabili come i vertici) */}
        {tool !== 'trim' && shown.filter((e) => isGeo(e) && e.type !== 'point').flatMap((e) => kpWithKind(e).map((k, i) => { const q = toS(k); return <circle key={`kp${e.id}_${i}`} cx={q.x} cy={q.y} r={k.kind === 'vtx' ? 2.4 : 2.2} fill={selected.has(e.id) ? COLORS.selected : KP_COLOR[k.kind]} stroke="#121212" strokeWidth={1} pointerEvents="none" /> }))}
        {/* vincoli di coincidenza: quadratino verde (click per selezionare, Canc per eliminare) */}
        {shown.filter(isConstraint).map((c) => {
          const q = constraintPos(c, shownMap)
          if (!q) return null
          const s2 = toS(q), sel = selected.has(c.id)
          if (isOnLine(c)) return <circle key={'cn' + c.id} cx={s2.x} cy={s2.y} r={6} fill="none" stroke={sel ? COLORS.selected : '#22c55e'} strokeWidth={sel ? 2.2 : 1.5} pointerEvents="none" />
          return <rect key={'cn' + c.id} x={s2.x - 5} y={s2.y - 5} width={10} height={10} fill="none" stroke={sel ? COLORS.selected : '#22c55e'} strokeWidth={sel ? 2.2 : 1.5} pointerEvents="none" />
        })}
        {drag?.type === 'point' && drag.moved && drag.target && (() => { const s2 = toS(drag.cur); return <rect x={s2.x - 7} y={s2.y - 7} width={14} height={14} fill="rgba(34,197,94,0.25)" stroke="#22c55e" strokeWidth={1.5} pointerEvents="none" /> })()}
        {nodes.map((n, i) => { const s = toS(n); return <circle key={'nd' + i} cx={s.x} cy={s.y} r={2.6} fill="#f59e0b" stroke="#121212" strokeWidth={1} pointerEvents="none" /> })}
        {pts.map((p, i) => { const s = toS(p); return <circle key={'pt' + i} cx={s.x} cy={s.y} r={3} fill={COLORS.preview} /> })}
        {cursor?.snap && (() => {
          const s = toS(cursor.snap), k = cursor.snap.kind || 'vtx', col = SNAP_COLOR[k]
          return <g pointerEvents="none">
            <circle cx={s.x} cy={s.y} r={6} fill={k === 'vtx' ? 'none' : 'rgba(34,211,238,0.18)'} stroke={col} strokeWidth={1.5} />
            {k !== 'vtx' && <circle cx={s.x} cy={s.y} r={2.6} fill={col} />}
            {SNAP_LABEL[k] && <text x={s.x + 9} y={s.y - 8} fill={col} fontSize={10} fontFamily="monospace" paintOrder="stroke" stroke="#121212" strokeWidth={3}>{SNAP_LABEL[k]}</text>}
          </g>
        })()}
        {drag?.type === 'box' && (() => {
          const a = toS(drag.a), b = toS(drag.b)
          return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="rgba(59,130,246,0.1)" stroke="#3b82f6" strokeDasharray="4 3" />
        })()}
        {cursor && tool !== 'select' && (() => { const s = toS(cursor.p); return (
          <g stroke="#22c55e" strokeWidth={1} opacity={0.7}><line x1={s.x - 10} y1={s.y} x2={s.x + 10} y2={s.y} /><line x1={s.x} y1={s.y - 10} x2={s.x} y2={s.y + 10} /></g>) })()}
      </svg>

      <div className="pointer-events-none absolute left-3 top-3 max-w-[45%] rounded-md bg-black/60 px-2.5 py-1 text-xs text-gray-300">{pasting ? `Incolla ${pasting.ents.filter((x) => !isConstraint(x)).length} entità: click per posizionare (Esc = annulla)` : pickLine ? 'Click sulla linea di riferimento per rendere parallela la linea selezionata (Esc = annulla)' : hintText}</div>

      {measure && (
        <div className="absolute right-3 top-3 z-10 w-60 rounded-lg border border-cyan-500/40 bg-[#0f1a1d]/95 p-3 text-xs shadow-xl" onMouseDown={stop} onDoubleClick={stop}>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wider text-cyan-300">{measure.title}</span>
            <button onClick={() => setMeasure(null)} className="text-gray-500 hover:text-white" title="Chiudi (Esc)"><X size={14} /></button>
          </div>
          <div className="space-y-1 font-mono">
            {measure.rows.map(([k, val]) => (
              <div key={k} className="flex justify-between gap-2"><span className="text-gray-400">{k}</span><span className="text-white">{val}</span></div>
            ))}
          </div>
          {measure.note && <div className="mt-2 text-[11px] text-gray-500">{measure.note}</div>}
        </div>
      )}

      {arrayCfg && (arrayCfg.type === 'rect' || arrayCfg.center) && (
        <div className="absolute right-3 top-3 z-20 w-64 rounded-lg border border-line bg-bg-card p-3 shadow-2xl" onMouseDown={stop} onDoubleClick={stop} onWheel={stop} onContextMenu={stop}>
          <div className="mb-3 text-sm font-semibold text-white">{arrayCfg.type === 'circular' ? 'Serie circolare' : 'Serie rettangolare'}</div>
          <div className="space-y-2">
            {arrayCfg.type === 'circular' ? (<>
              {numIn('n', 'Quantità (incl. originale)', 1, 2)}
              {numIn('angle', 'Angolo totale (°)', 15)}
              <p className="text-[11px] text-gray-500">Centro: X {fmt(arrayCfg.center.x)} · Y {fmt(arrayCfg.center.y)}. Con 360° le copie sono equidistanti; con angoli minori la prima e l'ultima stanno agli estremi.</p>
            </>) : (<>
              {numIn('cols', 'Colonne (N)', 1, 1)}
              {numIn('rows', 'Righe (M)', 1, 1)}
              {numIn('dx', 'Passo X (mm)', 0.5)}
              {numIn('dy', 'Passo Y (mm)', 0.5)}
            </>)}
            <div className="text-[11px] text-gray-400">Verranno create <b className="text-accent">{arrayCopies(arrayCfg).length}</b> entità</div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded-md border border-line px-3 py-1 text-xs text-gray-300 hover:bg-bg-hover" onClick={() => { setArrayCfg(null); setTool('select') }}>Annulla</button>
            <button className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-black hover:brightness-110" onClick={applyArray}>Applica</button>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 rounded-md bg-black/60 px-2.5 py-1 font-mono text-xs text-gray-300">
        <span>X {cursor ? cursor.p.x.toFixed(2) : '—'}</span><span>Y {cursor ? cursor.p.y.toFixed(2) : '—'}</span>
        {pts.length > 0 && cursor && <span className="text-accent">L {dist(pts[pts.length - 1], cursor.p).toFixed(2)}</span>}
        <span className="text-gray-500">griglia {grid?.g ?? '-'} mm · zoom {(v.s).toFixed(2)} px/mm</span>
      </div>
      {editingDim && tool === 'select' && (
        <input type="number" step="0.1" autoFocus value={editingDim.value}
          onFocus={(ev) => ev.target.select()}
          onChange={(ev) => setEditingDim({ ...editingDim, value: ev.target.value })}
          onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') applyDimEdit(); if (ev.key === 'Escape') setEditingDim(null) }}
          onBlur={applyDimEdit} onMouseDown={stop} onDoubleClick={stop} onWheel={stop}
          className="absolute z-30 rounded border border-[#22c55e] bg-[#0b0f0c] px-1.5 py-0.5 text-center font-mono text-xs text-white shadow-lg outline-none"
          style={{ left: editingDim.screenPos.x, top: editingDim.screenPos.y - 8, minWidth: 80, width: 90, transform: 'translate(-50%, -50%)' }} />
      )}
      <button onClick={fit} onMouseDown={stop} className="absolute bottom-3 right-3 rounded-md border border-line bg-bg-panel px-2.5 py-1 text-xs text-gray-300 hover:text-white">Adatta (H)</button>
    </div>
  )
}
