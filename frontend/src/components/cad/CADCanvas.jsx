import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  angleOf, arcSweep, bbox, closestOnEntity, dist, explodeRect, filletLines, keyPoints, mirrorEntity, normRect, polar,
  round3, translate, trimEntity, uid,
} from './geometry'

const COLORS = { normal: '#e5e7eb', selected: '#3b82f6', hover: '#93c5fd', construction: '#6b7280', bridge: '#f97316', dim: '#facc15', preview: '#22c55e' }

export default function CADCanvas({
  entities, onChange, selected, setSelected, tool, setTool, stock, ui, options, onContextMenu, notify,
  onUndo, onRedo, onDelete, onDuplicate, maxToolDia = 8,
}) {
  const wrap = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState(null) // {s, tx, ty}
  const [cursor, setCursor] = useState(null) // {raw, p, snap}
  const [pts, setPts] = useState([])
  const [drag, setDrag] = useState(null)
  const [pick, setPick] = useState(null)
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

  // ---------------------------------------------------------------- snap
  const snapPoints = useMemo(() => {
    const out = [{ x: 0, y: 0 }]
    const hx = stock.x / 2, hy = stock.y / 2
    out.push({ x: -hx, y: -hy }, { x: hx, y: -hy }, { x: hx, y: hy }, { x: -hx, y: hy })
    for (const e of entities) if (e.type !== 'dimension') out.push(...keyPoints(e))
    return out
  }, [entities, stock])

  const snap = (raw, e) => {
    if (e?.altKey) return { p: raw, snap: null }
    const sd = (ui?.snap_distance ?? 5) * 1.5 / v.s
    let best = null
    for (const k of snapPoints) {
      const d = dist(k, raw)
      if (d < sd && (!best || d < best.d)) best = { d, k }
    }
    if (best) return { p: { x: round3(best.k.x), y: round3(best.k.y) }, snap: best.k }
    if (ui?.snap_enabled) {
      let g = ui.grid_size || 1
      while (g * v.s < 6) g *= 5
      return { p: { x: round3(Math.round(raw.x / g) * g), y: round3(Math.round(raw.y / g) * g) }, snap: null }
    }
    return { p: { x: round3(raw.x), y: round3(raw.y) }, snap: null }
  }

  const ortho = (p, e) => {
    if (!e?.shiftKey || !pts.length) return p
    const a = pts[pts.length - 1]
    return Math.abs(p.x - a.x) > Math.abs(p.y - a.y) ? { x: p.x, y: a.y } : { x: a.x, y: p.y }
  }

  const hit = (w, filter = () => true) => {
    let best = null
    for (const e of entities) {
      if (!filter(e)) continue
      const c = closestOnEntity(e, w)
      if (c && c.d < tol && (!best || c.d < best.c.d)) best = { e, c }
    }
    return best
  }

  const evPos = (e) => {
    const r = wrap.current.getBoundingClientRect()
    return { sx: e.clientX - r.left, sy: e.clientY - r.top }
  }

  // ---------------------------------------------------------------- azioni
  const add = (...ents) => onChange([...entities, ...ents])
  const replace = (ids, news) => onChange([...entities.filter((e) => !ids.includes(e.id)), ...news])
  const cancel = () => { setPts([]); setPick(null) }

  useEffect(() => { cancel() }, [tool])

  const handleToolClick = (p, raw, e) => {
    const P = ortho(p, e)
    switch (tool) {
      case 'line': case 'construction': {
        if (!pts.length) return setPts([P])
        const a = pts[0]
        if (dist(a, P) < 1e-6) return
        add({ id: uid(), type: 'line', is_construction: tool === 'construction', data: { x1: a.x, y1: a.y, x2: P.x, y2: P.y } })
        return setPts([P])
      }
      case 'rect': {
        if (!pts.length) return setPts([p])
        const d = normRect(pts[0], p)
        if (d.w > 0 && d.h > 0) add({ id: uid(), type: 'rect', is_construction: false, data: d })
        return setPts([])
      }
      case 'circle': {
        if (!pts.length) return setPts([p])
        const r = round3(dist(pts[0], p))
        if (r > 0) add({ id: uid(), type: 'circle', is_construction: false, data: { cx: pts[0].x, cy: pts[0].y, r } })
        return setPts([])
      }
      case 'arc': {
        if (pts.length < 2) return setPts([...pts, p])
        const [c, s] = pts
        const r = round3(dist(c, s))
        if (r > 0) add({ id: uid(), type: 'arc', is_construction: false, data: { cx: c.x, cy: c.y, r, start: round3(angleOf(c, s)), end: round3(angleOf(c, p)) } })
        return setPts([])
      }
      case 'dimension': {
        if (!pts.length) return setPts([p])
        if (dist(pts[0], p) > 0) add({ id: uid(), type: 'dimension', is_construction: true, data: { x1: pts[0].x, y1: pts[0].y, x2: p.x, y2: p.y } })
        return setPts([])
      }
      case 'bridge': {
        if (!pts.length) {
          const h = hit(raw, (x) => x.type !== 'bridge' && x.type !== 'dimension' && !x.is_construction)
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
        const h = hit(raw, (x) => ['line', 'rect', 'circle', 'arc'].includes(x.type))
        if (!h) return
        let target = h.e, others = entities, removeIds = [h.e.id], extra = []
        if (h.e.type === 'rect') {
          const lines = explodeRect(h.e)
          const near = lines.reduce((b, l) => { const c = closestOnEntity(l, raw); return !b || c.d < b.d ? { l, d: c.d } : b }, null).l
          target = near
          extra = lines.filter((l) => l !== near)
          others = [...entities.filter((x) => x.id !== h.e.id), ...extra]
        }
        return replace(removeIds, [...extra, ...trimEntity(target, h.c.point, others)])
      }
      case 'mirror': {
        if (!selected.size) { notify('Seleziona prima le entità da specchiare'); return setTool('select') }
        if (!pts.length) return setPts([p])
        if (dist(pts[0], p) < 1e-6) return
        const copies = entities.filter((x) => selected.has(x.id)).flatMap((x) => mirrorEntity(x, pts[0], p))
        add(...copies)
        setSelected(new Set(copies.map((c) => c.id)))
        return setPts([])
      }
      case 'fillet': {
        const h = hit(raw, (x) => x.type === 'line' || x.type === 'rect')
        if (!h) return
        let ent = h.e, extra = []
        if (h.e.type === 'rect') {
          const lines = explodeRect(h.e)
          ent = lines.reduce((b, l) => { const c = closestOnEntity(l, raw); return !b || c.d < b.d ? { l, d: c.d } : b }, null).l
          onChange([...entities.filter((x) => x.id !== h.e.id), ...lines])
          extra = lines
        }
        if (!pick) return setPick({ id: ent.id, click: raw })
        const l1 = [...entities, ...extra].find((x) => x.id === pick.id)
        if (!l1 || l1.id === ent.id) return setPick(null)
        const res = filletLines(l1, pick.click, ent, raw, options.filletRadius || 3)
        if (!res) { notify('Raccordo impossibile (linee parallele o raggio troppo grande)'); return setPick(null) }
        const base = extra.length ? [...entities.filter((x) => x.id !== h.e.id), ...extra] : entities
        onChange([...base.filter((x) => x.id !== l1.id && x.id !== ent.id), res.l1, res.l2, res.arc])
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
    const { p } = snap(raw, e)
    if (tool === 'select') {
      const h = hit(raw)
      if (h) {
        let sel = selected
        if (e.shiftKey) {
          sel = new Set(selected)
          sel.has(h.e.id) ? sel.delete(h.e.id) : sel.add(h.e.id)
          setSelected(sel)
          return
        }
        if (!selected.has(h.e.id)) { sel = new Set([h.e.id]); setSelected(sel) }
        return setDrag({ type: 'move', start: p, cur: p, ids: sel })
      }
      if (!e.shiftKey) setSelected(new Set())
      return setDrag({ type: 'box', a: raw, b: raw })
    }
    handleToolClick(p, raw, e)
  }

  const onMouseMove = (e) => {
    const { sx, sy } = evPos(e)
    if (drag?.type === 'pan') return setView({ ...v, tx: drag.tx + sx - drag.sx, ty: drag.ty + sy - drag.sy })
    const raw = toW(sx, sy)
    const sn = snap(raw, e)
    setCursor({ raw, p: ortho(sn.p, e), snap: sn.snap })
    if (drag?.type === 'move') setDrag({ ...drag, cur: sn.p })
    else if (drag?.type === 'box') setDrag({ ...drag, b: raw })
    else if (!drag) { const h = hit(raw); setHover(h?.e.id || null) }
  }

  const onMouseUp = () => {
    if (drag?.type === 'move') {
      const dx = drag.cur.x - drag.start.x, dy = drag.cur.y - drag.start.y
      if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) onChange(entities.map((x) => (drag.ids.has(x.id) ? translate(x, dx, dy) : x)))
    } else if (drag?.type === 'box') {
      const minX = Math.min(drag.a.x, drag.b.x), maxX = Math.max(drag.a.x, drag.b.x)
      const minY = Math.min(drag.a.y, drag.b.y), maxY = Math.max(drag.a.y, drag.b.y)
      if (maxX - minX > tol || maxY - minY > tol) {
        const ids = entities.filter((x) => { const b = bbox(x); return b.minX >= minX && b.maxX <= maxX && b.minY >= minY && b.maxY <= maxY }).map((x) => x.id)
        setSelected(new Set([...selected, ...ids]))
      }
    }
    setDrag(null)
  }

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
    if (pts.length || pick) return cancel()
    const { sx, sy } = evPos(e)
    const h = hit(toW(sx, sy))
    if (h) {
      if (!selected.has(h.e.id)) setSelected(new Set([h.e.id]))
      onContextMenu?.(h.e, { x: e.clientX, y: e.clientY })
    }
  }

  // ---------------------------------------------------------------- tastiera
  useEffect(() => {
    const keys = { s: 'select', l: 'line', r: 'rect', c: 'circle', a: 'arc', x: 'construction', t: 'trim', m: 'mirror', f: 'fillet', d: 'dimension', b: 'bridge' }
    const down = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.code === 'Space') { space.current = true; e.preventDefault(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? onRedo() : onUndo() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); return onRedo() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); return onDuplicate() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); return setSelected(new Set(entities.map((x) => x.id))) }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') { if (pts.length || pick) cancel(); else if (selected.size) setSelected(new Set()); else setTool('select'); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return onDelete() }
      if (e.key === 'Home' || e.key === 'h') return fit()
      const t = keys[e.key.toLowerCase()]
      if (t) setTool(t)
    }
    const up = (e) => { if (e.code === 'Space') space.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [pts, pick, selected, entities, onUndo, onRedo, onDelete, onDuplicate, fit])

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
  }, [view, size, ui?.grid_size])

  const arcPath = (d) => {
    const c = { x: d.cx, y: d.cy }
    const sw = arcSweep(d.start, d.end)
    if (sw >= 359.999) { const s = toS(c); return `M ${s.x - d.r * v.s} ${s.y} a ${d.r * v.s} ${d.r * v.s} 0 1 0 ${2 * d.r * v.s} 0 a ${d.r * v.s} ${d.r * v.s} 0 1 0 ${-2 * d.r * v.s} 0` }
    const a = toS(polar(c, d.r, d.start)), b = toS(polar(c, d.r, d.end))
    return `M ${a.x} ${a.y} A ${d.r * v.s} ${d.r * v.s} 0 ${sw > 180 ? 1 : 0} 0 ${b.x} ${b.y}`
  }

  const renderEntity = (e, key, opts = {}) => {
    const d = e.data
    const isSel = selected.has(e.id)
    const stroke = opts.color || (isSel ? COLORS.selected : e.type === 'bridge' ? COLORS.bridge : e.type === 'dimension' ? COLORS.dim
      : e.is_construction ? COLORS.construction : hover === e.id ? COLORS.hover : COLORS.normal)
    const common = { stroke, strokeWidth: isSel ? 2 : 1.5, fill: 'none', strokeDasharray: e.is_construction && e.type !== 'dimension' ? '6 4' : undefined, strokeLinecap: 'round' }
    switch (e.type) {
      case 'line': case 'construction': {
        const a = toS({ x: d.x1, y: d.y1 }), b = toS({ x: d.x2, y: d.y2 })
        return <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
      }
      case 'rect': case 'bridge': {
        const a = toS({ x: d.x, y: d.y + d.h })
        return <rect key={key} x={a.x} y={a.y} width={d.w * v.s} height={d.h * v.s} {...common}
          fill={e.type === 'bridge' ? 'rgba(249,115,22,0.25)' : 'none'} />
      }
      case 'circle': {
        const c = toS({ x: d.cx, y: d.cy })
        return <circle key={key} cx={c.x} cy={c.y} r={d.r * v.s} {...common} />
      }
      case 'arc': return <path key={key} d={arcPath(d)} {...common} />
      case 'dimension': {
        const a = toS({ x: d.x1, y: d.y1 }), b = toS({ x: d.x2, y: d.y2 })
        const L = Math.hypot(d.x2 - d.x1, d.y2 - d.y1)
        const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
        const flip = ang > 90 || ang < -90
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        return (
          <g key={key}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} markerStart="url(#arrow)" markerEnd="url(#arrow)" />
            <text x={mx} y={my - 6} fill={stroke} fontSize={12} textAnchor="middle" fontFamily="monospace"
              transform={`rotate(${flip ? ang + 180 : ang} ${mx} ${my})`}>{L.toFixed(2)} mm</text>
          </g>
        )
      }
      default: return null
    }
  }

  // preview del tool corrente
  const preview = () => {
    if (!cursor) return null
    const p = cursor.p
    const pv = (e) => renderEntity({ id: '_pv', ...e }, '_pv', { color: COLORS.preview })
    const c0 = pts[0]
    switch (tool) {
      case 'line': case 'construction': case 'dimension':
        return c0 && pv({ type: tool === 'dimension' ? 'dimension' : 'line', is_construction: tool === 'construction', data: { x1: c0.x, y1: c0.y, x2: p.x, y2: p.y } })
      case 'rect': case 'bridge': return c0 && pv({ type: 'rect', data: normRect(c0, p) })
      case 'circle': return c0 && pv({ type: 'circle', data: { cx: c0.x, cy: c0.y, r: dist(c0, p) } })
      case 'arc':
        if (pts.length === 1) return pv({ type: 'line', is_construction: true, data: { x1: c0.x, y1: c0.y, x2: p.x, y2: p.y } })
        if (pts.length === 2) return pv({ type: 'arc', data: { cx: c0.x, cy: c0.y, r: dist(c0, pts[1]), start: angleOf(c0, pts[1]), end: angleOf(c0, p) } })
        return null
      case 'mirror': return c0 && pv({ type: 'line', is_construction: true, data: { x1: c0.x, y1: c0.y, x2: p.x, y2: p.y } })
      default: return null
    }
  }

  const moveOffset = drag?.type === 'move' ? { dx: drag.cur.x - drag.start.x, dy: drag.cur.y - drag.start.y } : null
  const origin = toS({ x: 0, y: 0 })
  const stockTL = toS({ x: -stock.x / 2, y: stock.y / 2 })
  const hintText = {
    line: pts.length ? 'Click punto finale (Shift = orto, Esc = fine)' : 'Click punto iniziale',
    construction: pts.length ? 'Click punto finale' : 'Click punto iniziale',
    rect: pts.length ? 'Click angolo opposto' : 'Click primo angolo',
    circle: pts.length ? 'Click punto sul raggio' : 'Click centro',
    arc: ['Click centro', 'Click punto iniziale', 'Click punto finale (antiorario)'][pts.length],
    trim: 'Click sul tratto da eliminare',
    mirror: selected.size ? (pts.length ? "Click secondo punto dell'asse" : "Click primo punto dell'asse") : 'Seleziona prima le entità',
    fillet: pick ? 'Click seconda linea' : `Click prima linea (R=${options.filletRadius} mm)`,
    dimension: pts.length ? 'Click secondo punto' : 'Click primo punto',
    bridge: pts.length ? 'Click angolo opposto' : 'Click su un contorno (o due click per rettangolo libero)',
    select: 'Click/drag per selezionare · Space+drag o tasto centrale = pan · rotella = zoom · H = adatta',
  }[tool]

  return (
    <div ref={wrap} className="relative h-full w-full select-none overflow-hidden bg-[#121212]"
      style={{ cursor: drag?.type === 'pan' ? 'grabbing' : tool === 'select' ? 'default' : 'crosshair' }}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={() => { setCursor(null); setDrag(null) }}
      onWheel={onWheel} onContextMenu={onCtx}>
      <svg width={size.w} height={size.h} className="absolute inset-0">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={COLORS.dim} />
          </marker>
        </defs>
        {grid?.lines}
        <rect x={stockTL.x} y={stockTL.y} width={stock.x * v.s} height={stock.y * v.s} fill="rgba(34,197,94,0.03)" stroke="#22c55e" strokeDasharray="8 5" strokeWidth={1.2} />
        <line x1={origin.x - 14} y1={origin.y} x2={origin.x + 30} y2={origin.y} stroke="#ef4444" strokeWidth={1.5} />
        <line x1={origin.x} y1={origin.y + 14} x2={origin.x} y2={origin.y - 30} stroke="#22c55e" strokeWidth={1.5} />
        <circle cx={origin.x} cy={origin.y} r={3} fill="#ef4444" />
        {entities.map((e) => renderEntity(moveOffset && selected.has(e.id) ? translate(e, moveOffset.dx, moveOffset.dy) : e, e.id))}
        {pick && (() => { const e = entities.find((x) => x.id === pick.id); return e && renderEntity(e, '_pick', { color: '#f472b6' }) })()}
        {preview()}
        {pts.map((p, i) => { const s = toS(p); return <circle key={'pt' + i} cx={s.x} cy={s.y} r={3} fill={COLORS.preview} /> })}
        {cursor?.snap && (() => { const s = toS(cursor.snap); return <circle cx={s.x} cy={s.y} r={6} fill="none" stroke="#facc15" strokeWidth={1.5} /> })()}
        {drag?.type === 'box' && (() => {
          const a = toS(drag.a), b = toS(drag.b)
          return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="rgba(59,130,246,0.1)" stroke="#3b82f6" strokeDasharray="4 3" />
        })()}
        {cursor && tool !== 'select' && (() => { const s = toS(cursor.p); return (
          <g stroke="#22c55e" strokeWidth={1} opacity={0.7}><line x1={s.x - 10} y1={s.y} x2={s.x + 10} y2={s.y} /><line x1={s.x} y1={s.y - 10} x2={s.x} y2={s.y + 10} /></g>) })()}
      </svg>
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2.5 py-1 text-xs text-gray-300">{hintText}</div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 rounded-md bg-black/60 px-2.5 py-1 font-mono text-xs text-gray-300">
        <span>X {cursor ? cursor.p.x.toFixed(2) : '—'}</span><span>Y {cursor ? cursor.p.y.toFixed(2) : '—'}</span>
        {pts.length > 0 && cursor && <span className="text-accent">L {dist(pts[pts.length - 1], cursor.p).toFixed(2)}</span>}
        <span className="text-gray-500">griglia {grid?.g ?? '-'} mm · zoom {(v.s).toFixed(2)} px/mm</span>
      </div>
      <button onClick={fit} onMouseDown={(e) => e.stopPropagation()} className="absolute bottom-3 right-3 rounded-md border border-line bg-bg-panel px-2.5 py-1 text-xs text-gray-300 hover:text-white">Adatta (H)</button>
    </div>
  )
}
