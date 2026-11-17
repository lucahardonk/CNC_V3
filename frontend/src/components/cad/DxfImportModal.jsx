import { useEffect, useMemo, useState } from 'react'
import { FileUp } from 'lucide-react'
import Modal from '../common/Modal'
import Button from '../common/Button'
import { catmullRomPoints } from './geometry'
import { DEFAULT_LAYER_COLOR } from './drawLayers'

const TYPE_LABEL = { LINE: 'Linee', ARC: 'Archi', CIRCLE: 'Cerchi', LWPOLYLINE: 'LWPolyline (segmenti)', POLYLINE: 'Polyline (segmenti)', SPLINE: 'Spline', ELLIPSE: 'Ellissi', INSERT: 'Blocchi (esplosi)' }
const PLACEMENTS = {
  center: 'Centra sull\'origine (centro stock)',
  stock_corner: 'Angolo in basso a sinistra sullo stock',
  keep: 'Mantieni le coordinate del DXF',
}
const r4 = (v) => Math.round(v * 1e4) / 1e4

function bboxOf(ents) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const P = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
  for (const e of ents) {
    const d = e.data
    if (e.type === 'line') { P(d.x1, d.y1); P(d.x2, d.y2) }
    else if (e.type === 'circle' || e.type === 'arc') { P(d.cx - d.r, d.cy - d.r); P(d.cx + d.r, d.cy + d.r) }
    else if (e.type === 'ellipse') { const m = Math.max(d.rx, d.ry); P(d.cx - m, d.cy - m); P(d.cx + m, d.cy + m) }
    else if (e.type === 'spline') d.points.forEach((p) => P(p.x, p.y))
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY }
}

// scala attorno all'origine e poi trasla
function transform(e, k, dx, dy) {
  const d = e.data, X = (x) => r4(x * k + dx), Y = (y) => r4(y * k + dy)
  switch (e.type) {
    case 'line': return { ...e, data: { x1: X(d.x1), y1: Y(d.y1), x2: X(d.x2), y2: Y(d.y2) } }
    case 'circle': return { ...e, data: { cx: X(d.cx), cy: Y(d.cy), r: r4(d.r * k) } }
    case 'arc': return { ...e, data: { ...d, cx: X(d.cx), cy: Y(d.cy), r: r4(d.r * k) } }
    case 'ellipse': return { ...e, data: { ...d, cx: X(d.cx), cy: Y(d.cy), rx: r4(d.rx * k), ry: r4(d.ry * k) } }
    case 'spline': return { ...e, data: { points: d.points.map((p) => ({ x: X(p.x), y: Y(p.y) })) } }
    default: return e
  }
}

const polar = (cx, cy, r, a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)]
function svgPath(e) {
  const d = e.data
  switch (e.type) {
    case 'line': return `M${d.x1} ${-d.y1}L${d.x2} ${-d.y2}`
    case 'circle': return `M${d.cx - d.r} ${-d.cy}a${d.r} ${d.r} 0 1 0 ${2 * d.r} 0a${d.r} ${d.r} 0 1 0 ${-2 * d.r} 0`
    case 'arc': {
      const sw = (((d.end - d.start) % 360) + 360) % 360 || 360
      const [x1, y1] = polar(d.cx, d.cy, d.r, d.start), [x2, y2] = polar(d.cx, d.cy, d.r, d.end)
      return `M${x1} ${-y1}A${d.r} ${d.r} 0 ${sw > 180 ? 1 : 0} 0 ${x2} ${-y2}`
    }
    case 'ellipse': {
      const pts = Array.from({ length: 73 }, (_, i) => {
        const t = (i / 72) * 2 * Math.PI, r = (d.rotation || 0) * Math.PI / 180
        const lx = d.rx * Math.cos(t), ly = d.ry * Math.sin(t)
        return [d.cx + lx * Math.cos(r) - ly * Math.sin(r), d.cy + lx * Math.sin(r) + ly * Math.cos(r)]
      })
      return 'M' + pts.map(([x, y]) => `${x} ${-y}`).join('L')
    }
    case 'spline': return 'M' + catmullRomPoints(d.points, 4).map((p) => `${p.x} ${-p.y}`).join('L')
    default: return ''
  }
}

export default function DxfImportModal({ data, stock, onClose, onConfirm }) {
  const [placement, setPlacement] = useState('center')
  const [scale, setScale] = useState(1)
  const [enabled, setEnabled] = useState({})
  const [asConstruction, setAsConstruction] = useState(false)

  useEffect(() => {
    if (!data) return
    setEnabled(Object.fromEntries(data.layers.map((l) => [l.name, true])))
    setPlacement('center'); setScale(1); setAsConstruction(false)
  }, [data])

  const colorOf = useMemo(() => Object.fromEntries((data?.layers || []).map((l) => [l.name, l.color || DEFAULT_LAYER_COLOR])), [data])
  const result = useMemo(() => {
    if (!data) return { ents: [], bb: null }
    const k = Number(scale) > 0 ? Number(scale) : 1
    const src = data.entities.filter((e) => enabled[e.layer] !== false)
    const scaled = src.map((e) => transform(e, k, 0, 0))
    const bb = bboxOf(scaled)
    if (!bb) return { ents: [], bb: null }
    let dx = 0, dy = 0
    if (placement === 'center') { dx = -(bb.minX + bb.maxX) / 2; dy = -(bb.minY + bb.maxY) / 2 }
    else if (placement === 'stock_corner') { dx = -stock.x / 2 - bb.minX; dy = -stock.y / 2 - bb.minY }
    const ents = dx || dy ? scaled.map((e) => transform(e, 1, dx, dy)) : scaled
    return { ents, bb: { minX: bb.minX + dx, maxX: bb.maxX + dx, minY: bb.minY + dy, maxY: bb.maxY + dy } }
  }, [data, scale, enabled, placement, stock])

  if (!data) return null
  const { ents, bb } = result
  const w = bb ? bb.maxX - bb.minX : 0, h = bb ? bb.maxY - bb.minY : 0
  // viewBox: disegno + stock, con margine
  const vb = (() => {
    const xs = [-stock.x / 2, stock.x / 2, ...(bb ? [bb.minX, bb.maxX] : [])], ys = [-stock.y / 2, stock.y / 2, ...(bb ? [bb.minY, bb.maxY] : [])]
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const m = Math.max(maxX - minX, maxY - minY) * 0.05 || 10
    return { x: minX - m, y: -maxY - m, w: maxX - minX + 2 * m, h: maxY - minY + 2 * m }
  })()
  const sw = Math.max(vb.w, vb.h) / 500
  const outside = bb && (bb.minX < -stock.x / 2 - 1e-6 || bb.maxX > stock.x / 2 + 1e-6 || bb.minY < -stock.y / 2 - 1e-6 || bb.maxY > stock.y / 2 + 1e-6)

  return (
    <Modal open onClose={onClose} title={`Importa DXF · ${data.filename || ''}`} width="max-w-4xl"
      footer={<>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="primary" icon={FileUp} disabled={!ents.length} onClick={() => onConfirm({ entities: ents, layers: data.layers.filter((l) => enabled[l.name] !== false), asConstruction })}>
          Importa {ents.length} entità
        </Button>
      </>}>
      <div className="grid grid-cols-[1fr_260px] gap-4">
        <div className="flex flex-col gap-2">
          <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="h-[420px] w-full rounded-md border border-line bg-[#121212]">
            <rect x={-stock.x / 2} y={-stock.y / 2} width={stock.x} height={stock.y} fill="rgba(34,197,94,0.04)" stroke="#22c55e" strokeDasharray={`${sw * 8} ${sw * 5}`} strokeWidth={sw * 1.2} />
            <line x1={-sw * 14} y1={0} x2={sw * 30} y2={0} stroke="#ef4444" strokeWidth={sw * 1.5} />
            <line x1={0} y1={sw * 14} x2={0} y2={-sw * 30} stroke="#22c55e" strokeWidth={sw * 1.5} />
            {ents.map((e, i) => <path key={i} d={svgPath(e)} fill="none" stroke={colorOf[e.layer] || DEFAULT_LAYER_COLOR} strokeWidth={sw * 1.4} strokeDasharray={asConstruction ? `${sw * 6} ${sw * 4}` : undefined} vectorEffect="non-scaling-stroke" />)}
          </svg>
          <div className="flex justify-between text-xs text-gray-400">
            <span>Ingombro: <b className="font-mono text-gray-200">{w.toFixed(2)} × {h.toFixed(2)} mm</b></span>
            <span>Stock: <span className="font-mono">{stock.x} × {stock.y} mm</span> (bordo verde)</span>
          </div>
          {outside && <p className="text-xs text-yellow-400">⚠ Il disegno esce dal pezzo grezzo: controlla posizione, scala o dimensioni dello stock.</p>}
        </div>

        <div className="space-y-4 text-sm">
          <div className="rounded-md border border-line bg-bg p-2.5 text-xs leading-relaxed text-gray-300">
            <div>Unità file: <b className="text-white">{data.unit_name}</b> <span className="text-gray-500">($INSUNITS={data.units})</span></div>
            <div>Conversione → mm: <b className="font-mono text-white">×{data.scale}</b></div>
            <div className="mt-1.5 border-t border-line pt-1.5">
              {Object.entries(data.counts).map(([t, n]) => <div key={t} className="flex justify-between"><span>{TYPE_LABEL[t] || t}</span><b className="font-mono">{n}</b></div>)}
            </div>
          </div>
          <div>
            <span className="label">Posizione</span>
            {Object.entries(PLACEMENTS).map(([k, l]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-gray-300">
                <input type="radio" name="dxf-place" checked={placement === k} onChange={() => setPlacement(k)} /> {l}
              </label>
            ))}
          </div>
          <div>
            <span className="label">Scala aggiuntiva</span>
            <input type="number" step="0.1" min="0.001" className="input py-1" value={scale} onChange={(e) => setScale(e.target.value)} />
          </div>
          <div>
            <span className="label">Layer DXF ({data.layers.length})</span>
            <div className="max-h-36 space-y-0.5 overflow-y-auto">
              {data.layers.map((l) => (
                <label key={l.name} className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
                  <input type="checkbox" checked={enabled[l.name] !== false} onChange={(e) => setEnabled({ ...enabled, [l.name]: e.target.checked })} />
                  <span className="h-3 w-3 rounded-sm" style={{ background: l.color }} />
                  <span className="flex-1 truncate">{l.name}</span>
                  <span className="font-mono text-gray-500">{l.count}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={asConstruction} onChange={(e) => setAsConstruction(e.target.checked)} /> Importa come geometria di costruzione
          </label>
          {data.warnings?.length > 0 && (
            <div className="space-y-0.5 text-[11px] text-yellow-300">{data.warnings.map((m) => <div key={m}>⚠ {m}</div>)}</div>
          )}
        </div>
      </div>
    </Modal>
  )
}
