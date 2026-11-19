import { useRef } from 'react'

// Anteprima posizionabile sopra il canvas CAD (testo / SVG prima della conferma).
// view: { toS, scale } dal CADCanvas · box: { cx, cy, w, h } in mm (coordinate CAD, y in su)
// polylines: percorsi già posizionati in mm · onChange(box) durante trascinamento/ridimensionamento
// lockAspect: le maniglie d'angolo scalano in modo uniforme
export default function PlacementOverlay({ view, box, polylines, onChange, lockAspect = true, color = '#f472b6', label }) {
  const drag = useRef(null)
  if (!view || !box) return null
  const { toS, scale } = view
  const tl = toS({ x: box.cx - box.w / 2, y: box.cy + box.h / 2 })
  const wPx = box.w * scale, hPx = box.h * scale

  const start = (mode, e) => {
    e.stopPropagation(); e.preventDefault()
    drag.current = { mode, x: e.clientX, y: e.clientY, box: { ...box } }
    const move = (ev) => {
      const d = drag.current
      if (!d) return
      const dx = (ev.clientX - d.x) / scale, dy = -(ev.clientY - d.y) / scale
      if (d.mode === 'move') return onChange({ ...d.box, cx: d.box.cx + dx, cy: d.box.cy + dy })
      // ridimensionamento: l'angolo opposto resta fermo
      const sx = d.mode.includes('e') ? 1 : -1, sy = d.mode.includes('n') ? 1 : -1
      let w = Math.max(1, d.box.w + sx * dx), h = Math.max(1, d.box.h + sy * dy)
      if (lockAspect) {
        const k = Math.max(w / d.box.w, h / d.box.h)
        w = Math.max(1, d.box.w * k); h = Math.max(1, d.box.h * k)
      }
      const ax = d.box.cx - (sx * d.box.w) / 2, ay = d.box.cy - (sy * d.box.h) / 2
      onChange({ cx: ax + (sx * w) / 2, cy: ay + (sy * h) / 2, w, h })
    }
    const up = () => { drag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const d = polylines.map((pl) => pl.map((p, i) => { const q = toS(p); return `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}` }).join('')).join('')
  const handle = (mode, style, cursor) => (
    <div key={mode} onMouseDown={(e) => start(mode, e)} title="Trascina per ridimensionare"
      className="pointer-events-auto absolute h-3 w-3 rounded-sm border-2 bg-[#121212]" style={{ ...style, borderColor: color, cursor }} />
  )
  const stop = (e) => e.stopPropagation()
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <path d={d} fill="none" stroke={color} strokeWidth={1.3} />
      </svg>
      <div className="pointer-events-auto absolute cursor-move border border-dashed" onMouseDown={(e) => start('move', e)} onDoubleClick={stop} onContextMenu={stop}
        style={{ left: tl.x, top: tl.y, width: wPx, height: hPx, borderColor: color, background: 'rgba(244,114,182,0.06)' }} title="Trascina per spostare">
        {label && <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-black/70 px-1.5 text-[10px] text-pink-200">{label}</span>}
        {handle('nw', { left: -7, top: -7 }, 'nwse-resize')}
        {handle('ne', { right: -7, top: -7 }, 'nesw-resize')}
        {handle('sw', { left: -7, bottom: -7 }, 'nesw-resize')}
        {handle('se', { right: -7, bottom: -7 }, 'nwse-resize')}
      </div>
    </div>
  )
}
