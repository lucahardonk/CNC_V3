import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { A4, boundsOf, hitShape, shapeToPolylines, snapVal, circlePoints } from '../lib/geometry'
import { layoutTextbox } from '../lib/textbox'

/** Canvas 2D: foglio A4 (mm), griglia, forme per layer, strumenti di disegno e anteprima percorso. */
export default function PlotCanvas({ plan, machinePos }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const view = useRef({ scale: 2, ox: 0, oy: 0 })
  const drag = useRef(null)
  const [draft, setDraft] = useState(null)       // forma in costruzione
  const [cursor, setCursor] = useState(null)     // posizione mm
  const [, force] = useState(0)
  const redraw = () => force((n) => n + 1)

  const st = useStore()
  const { layers, shapes, selected, tool, settings, preview, activeLayerId, textStyle, fontsVersion } = st
  const grid = Number(settings.grid) || 1

  const toMm = (sx, sy) => {
    const v = view.current
    return [(sx - v.ox) / v.scale, -(sy - v.oy) / v.scale]
  }
  const snapPt = (p, e) => (settings.snap && !e?.altKey ? [snapVal(p[0], grid), snapVal(p[1], grid)] : p)
  const evPos = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const fit = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const w = el.clientWidth, h = el.clientHeight
    const R = Math.max(A4.h / 2, Number(settings.print_radius) || 0) + 10
    const scale = Math.min(w, h) / (2 * R)
    view.current = { scale, ox: w / 2, oy: h / 2 }
    redraw()
  }, [settings.print_radius])

  // resize
  useEffect(() => {
    const el = wrapRef.current
    const ro = new ResizeObserver(() => {
      const c = canvasRef.current
      const dpr = window.devicePixelRatio || 1
      c.width = el.clientWidth * dpr
      c.height = el.clientHeight * dpr
      c.style.width = `${el.clientWidth}px`
      c.style.height = `${el.clientHeight}px`
      if (!view.current.init) { fit(); view.current.init = true } else redraw()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  useEffect(() => {
    const h = () => fit()
    window.addEventListener('plotter:fit', h)
    return () => window.removeEventListener('plotter:fit', h)
  }, [fit])

  // ---------------------------------------------------------------- render
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const { scale, ox, oy } = view.current
    const W = c.width / dpr, H = c.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0f0f0f'
    ctx.fillRect(0, 0, W, H)
    const X = (x) => ox + x * scale
    const Y = (y) => oy - y * scale
    const poly = (pts, close) => {
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))))
      if (close) ctx.closePath()
    }

    // area raggiungibile della Delta (cerchio centrato sul centro del piano)
    const bedCx = -Number(settings.offset_x || 0), bedCy = -Number(settings.offset_y || 0)
    const R = Number(settings.print_radius) || 0
    if (R > 0) {
      poly(circlePoints(bedCx, bedCy, R, 180))
      ctx.fillStyle = '#141a14'
      ctx.fill()
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#2f4f2f'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([])
    }
    // foglio A4
    ctx.fillStyle = '#1c1c1c'
    ctx.fillRect(X(-A4.w / 2), Y(A4.h / 2), A4.w * scale, A4.h * scale)
    // griglia
    const [x0, y1] = toMm(0, 0), [x1, y0] = toMm(W, H)
    const drawGrid = (step, color) => {
      if (step * scale < 4) return
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath()
      for (let x = Math.ceil(Math.max(x0, -A4.w / 2) / step) * step; x <= Math.min(x1, A4.w / 2); x += step) { ctx.moveTo(X(x) + 0.5, Y(A4.h / 2)); ctx.lineTo(X(x) + 0.5, Y(-A4.h / 2)) }
      for (let y = Math.ceil(Math.max(y0, -A4.h / 2) / step) * step; y <= Math.min(y1, A4.h / 2); y += step) { ctx.moveTo(X(-A4.w / 2), Y(y) + 0.5); ctx.lineTo(X(A4.w / 2), Y(y) + 0.5) }
      ctx.stroke()
    }
    drawGrid(grid, '#232323')
    drawGrid(10, '#2c2c2c')
    ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 1.5
    ctx.strokeRect(X(-A4.w / 2), Y(A4.h / 2), A4.w * scale, A4.h * scale)
    // assi
    ctx.strokeStyle = '#3f3f46'; ctx.lineWidth = 1; ctx.beginPath()
    ctx.moveTo(X(-A4.w / 2), Y(0)); ctx.lineTo(X(A4.w / 2), Y(0)); ctx.moveTo(X(0), Y(A4.h / 2)); ctx.lineTo(X(0), Y(-A4.h / 2)); ctx.stroke()
    ctx.fillStyle = '#6b7280'; ctx.font = '11px Inter, sans-serif'
    ctx.fillText('A4 210×297 mm · origine al centro', X(-A4.w / 2), Y(A4.h / 2) - 6)

    const layerMap = Object.fromEntries(layers.map((l) => [l.id, l]))
    const sel = new Set(selected)
    if (!preview) {
      for (const l of layers) {
        if (!l.visible) continue
        for (const s of shapes) {
          if (s.layerId !== l.id) continue
          const isSel = sel.has(s.id)
          ctx.strokeStyle = isSel ? '#ffffff' : l.color
          ctx.lineWidth = isSel ? 2 : 1.4
          for (const pl of shapeToPolylines(s)) { poly(pl); ctx.stroke() }
        }
      }
      // cornice e punto di ancoraggio delle caselle di testo selezionate
      for (const s of shapes) {
        if (s.type !== 'textbox' || !sel.has(s.id)) continue
        const { corners } = layoutTextbox(s)
        ctx.setLineDash([2, 3]); ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1
        poly(corners); ctx.stroke(); ctx.setLineDash([])
        ctx.fillStyle = '#60a5fa'; ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), 3.5, 0, Math.PI * 2); ctx.fill()
      }
      // bounding box selezione
      if (sel.size) {
        const b = boundsOf(shapes.filter((s) => sel.has(s.id)).flatMap(shapeToPolylines))
        if (isFinite(b.minX)) {
          ctx.setLineDash([4, 3]); ctx.strokeStyle = '#a3a3a3'; ctx.lineWidth = 1
          ctx.strokeRect(X(b.minX) - 4, Y(b.maxY) - 4, b.w * scale + 8, b.h * scale + 8); ctx.setLineDash([])
        }
      }
    } else if (plan) {
      // anteprima G-code: spostamenti a penna alzata tratteggiati, tracciati col colore del layer
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(248,113,113,.45)'; ctx.lineWidth = 1
      for (const [a, b] of plan.travels) { ctx.beginPath(); ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); ctx.stroke() }
      ctx.setLineDash([])
      plan.paths.forEach((p, i) => {
        ctx.strokeStyle = layerMap[p.layerId]?.color || p.color
        ctx.lineWidth = 1.6
        poly(p.pts); ctx.stroke()
        ctx.fillStyle = ctx.strokeStyle
        ctx.beginPath(); ctx.arc(X(p.pts[0][0]), Y(p.pts[0][1]), 2.2, 0, Math.PI * 2); ctx.fill()
        if (plan.paths.length < 200 && scale > 1.5) { ctx.fillStyle = '#9ca3af'; ctx.fillText(String(i + 1), X(p.pts[0][0]) + 3, Y(p.pts[0][1]) - 3) }
      })
    }

    // forma in costruzione
    if (draft) {
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3])
      for (const pl of draftPolylines(draft, textStyle)) { poly(pl); ctx.stroke() }
      ctx.setLineDash([])
      if (draft.type === 'box') {
        ctx.strokeStyle = '#60a5fa'; ctx.setLineDash([4, 3])
        ctx.strokeRect(X(Math.min(draft.a[0], draft.b[0])), Y(Math.max(draft.a[1], draft.b[1])), Math.abs(draft.b[0] - draft.a[0]) * scale, Math.abs(draft.b[1] - draft.a[1]) * scale)
        ctx.setLineDash([])
      }
    }
    // posizione penna reale
    if (machinePos) {
      const mx = machinePos[0] - Number(settings.offset_x || 0), my = machinePos[1] - Number(settings.offset_y || 0)
      ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(X(mx), Y(my), 6, 0, Math.PI * 2); ctx.moveTo(X(mx) - 10, Y(my)); ctx.lineTo(X(mx) + 10, Y(my)); ctx.moveTo(X(mx), Y(my) - 10); ctx.lineTo(X(mx), Y(my) + 10); ctx.stroke()
    }
    // cursore
    if (cursor && tool !== 'select') {
      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(X(cursor[0]), Y(cursor[1]), 2.5, 0, Math.PI * 2); ctx.fill()
    }
  })

  // ---------------------------------------------------------------- interazione
  const finishPoly = () => {
    if (draft?.type === 'poly' && draft.points.length >= 2) {
      const closed = tool === 'polygon'
      if (!closed || draft.points.length >= 3) st.addShape({ type: closed ? 'polygon' : 'polyline', points: draft.points })
    }
    setDraft(null)
  }

  const onMouseDown = (e) => {
    const sp = evPos(e)
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey && tool !== 'select')) {
      drag.current = { mode: 'pan', sp, ox: view.current.ox, oy: view.current.oy }
      return
    }
    if (e.button !== 0 || preview) return
    const raw = toMm(...sp)
    const p = snapPt(raw, e)
    if (tool === 'select') {
      const tol = 5 / view.current.scale
      const hit = [...shapes].reverse().find((s) => layers.find((l) => l.id === s.layerId)?.visible && hitShape(s, raw[0], raw[1], tol))
      if (hit) {
        const already = selected.includes(hit.id)
        if (e.shiftKey) st.setSelected(already ? selected.filter((i) => i !== hit.id) : [...selected, hit.id])
        else if (!already) st.setSelected([hit.id])
        st.snapshot()
        drag.current = { mode: 'move', last: p }
      } else {
        if (!e.shiftKey) st.setSelected([])
        drag.current = { mode: 'box', a: raw }
        setDraft({ type: 'box', a: raw, b: raw })
      }
      return
    }
    if (tool === 'text') {
      const s = st.addShape({ type: 'textbox', ...textStyle, x: p[0], y: p[1] })
      st.setTool('select')
      st.setFocusText(s.id)
      return
    }
    if (tool === 'polyline' || tool === 'polygon') {
      if (draft?.type === 'poly') {
        const last = draft.points[draft.points.length - 1]
        const first = draft.points[0]
        if (tool === 'polygon' && draft.points.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) * view.current.scale < 8) return finishPoly()
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) setDraft({ ...draft, points: [...draft.points, p], hover: p })
      } else setDraft({ type: 'poly', points: [p], hover: p })
      return
    }
    // line / rect / circle: trascinamento
    drag.current = { mode: 'draw', a: p }
    setDraft({ type: tool, a: p, b: p })
  }

  const onMouseMove = (e) => {
    const sp = evPos(e)
    const raw = toMm(...sp)
    const p = snapPt(raw, e)
    setCursor(p)
    const d = drag.current
    if (d?.mode === 'pan') {
      view.current.ox = d.ox + sp[0] - d.sp[0]
      view.current.oy = d.oy + sp[1] - d.sp[1]
      redraw()
    } else if (d?.mode === 'move') {
      const dx = p[0] - d.last[0], dy = p[1] - d.last[1]
      if (dx || dy) { st.moveSelected(dx, dy, false); d.last = p }
    } else if (d?.mode === 'box') {
      setDraft({ type: 'box', a: d.a, b: raw })
    } else if (d?.mode === 'draw') {
      setDraft({ type: tool, a: d.a, b: p })
    } else if (draft?.type === 'poly') {
      setDraft({ ...draft, hover: p })
    }
  }

  const onMouseUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.mode === 'box' && draft?.type === 'box') {
      const minX = Math.min(draft.a[0], draft.b[0]), maxX = Math.max(draft.a[0], draft.b[0])
      const minY = Math.min(draft.a[1], draft.b[1]), maxY = Math.max(draft.a[1], draft.b[1])
      if (maxX - minX > 0.5 || maxY - minY > 0.5) {
        const inside = shapes.filter((s) => {
          if (!layers.find((l) => l.id === s.layerId)?.visible) return false
          const b = boundsOf(shapeToPolylines(s))
          return b.minX >= minX && b.maxX <= maxX && b.minY >= minY && b.maxY <= maxY
        }).map((s) => s.id)
        st.setSelected([...new Set([...selected, ...inside])])
      }
      setDraft(null)
    } else if (d.mode === 'draw' && draft) {
      const [ax, ay] = draft.a, [bx, by] = draft.b
      if (Math.hypot(bx - ax, by - ay) > 0.01) {
        if (draft.type === 'line') st.addShape({ type: 'line', x1: ax, y1: ay, x2: bx, y2: by })
        if (draft.type === 'rect') st.addShape({ type: 'rect', x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) })
        if (draft.type === 'circle') st.addShape({ type: 'circle', cx: ax, cy: ay, r: Math.hypot(bx - ax, by - ay) })
      }
      setDraft(null)
    }
  }

  const onWheel = (e) => {
    const [sx, sy] = evPos(e)
    const v = view.current
    const k = Math.exp(-e.deltaY * 0.0015)
    const ns = Math.max(0.3, Math.min(80, v.scale * k))
    v.ox = sx - (sx - v.ox) * (ns / v.scale)
    v.oy = sy - (sy - v.oy) * (ns / v.scale)
    v.scale = ns
    redraw()
  }

  useEffect(() => {
    const c = canvasRef.current
    const h = (e) => { e.preventDefault(); onWheel(e) }
    c.addEventListener('wheel', h, { passive: false })
    return () => c.removeEventListener('wheel', h)
  })

  // tastiera
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      const s = useStore.getState()
      const step = e.shiftKey ? 10 : grid
      if (e.key === 'Escape') { setDraft(null); s.setSelected([]) }
      else if (e.key === 'Enter') finishPoly()
      else if (e.key === 'Delete' || e.key === 'Backspace') s.deleteSelected()
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); s.duplicateSelected() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); s.setSelected(s.shapes.map((x) => x.id)) }
      else if (e.key.startsWith('Arrow') && s.selected.length) {
        e.preventDefault()
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
        s.moveSelected(d[0], d[1])
      } else if (!e.ctrlKey && !e.metaKey) {
        const map = { v: 'select', l: 'line', r: 'rect', c: 'circle', p: 'polyline', g: 'polygon', t: 'text' }
        if (map[e.key.toLowerCase()]) { setDraft(null); s.setTool(map[e.key.toLowerCase()]) }
        if (e.key.toLowerCase() === 'f') fit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => { setDraft(null) }, [tool])
  useEffect(() => { redraw() }, [fontsVersion])

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className={tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { setCursor(null); onMouseUp() }}
        onDoubleClick={finishPoly}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 font-mono text-[11px] text-gray-300">
        {cursor ? `X ${cursor[0].toFixed(2)}  Y ${cursor[1].toFixed(2)} mm` : '—'} · layer attivo: {layers.find((l) => l.id === activeLayerId)?.name}
      </div>
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[11px] text-gray-400">
        rotella = zoom · tasto destro/centrale = pan · F = adatta · Alt = no snap
      </div>
    </div>
  )
}

function draftPolylines(d, textStyle) {
  if (d.type === 'poly') return [[...d.points, d.hover].filter(Boolean)]
  if (!d.a || !d.b) return []
  const [ax, ay] = d.a, [bx, by] = d.b
  if (d.type === 'line') return [[d.a, d.b]]
  if (d.type === 'rect') return [[[ax, ay], [bx, ay], [bx, by], [ax, by], [ax, ay]]]
  if (d.type === 'circle') return [circlePoints(ax, ay, Math.hypot(bx - ax, by - ay), 90), [d.a, d.b]]
  if (d.type === 'text') return layoutTextbox({ ...textStyle, x: ax, y: ay }).polylines
  return []
}
