import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, Lock, Unlock } from 'lucide-react'
import { useStore } from '../store'
import { parseSvg, placeGroups } from '../lib/svg'
import { A4 } from '../lib/geometry'
import { Btn, Modal, NumInput } from './ui'

const PX2MM = 25.4 / 96

export default function SvgImportModal({ onClose }) {
  const { addLayer, addShapes, notify, snapshot } = useStore()
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState(null)
  const [w, setW] = useState(100)
  const [h, setH] = useState(100)
  const [lock, setLock] = useState(true)
  const [cx, setCx] = useState(0)
  const [cy, setCy] = useState(0)
  const [enabled, setEnabled] = useState({})
  const [tol, setTol] = useState(0.05)
  const canvasRef = useRef(null)

  const load = async (f) => {
    setError(null)
    try {
      const p = parseSvg(await f.text())
      setFile(f)
      setParsed(p)
      setEnabled(Object.fromEntries(p.groups.map((g) => [g.color, true])))
      let nw = p.bounds.w * PX2MM, nh = p.bounds.h * PX2MM
      const k = Math.min(1, (A4.w - 20) / nw, (A4.h - 20) / nh)
      setW(+(nw * k).toFixed(2)); setH(+(nh * k).toFixed(2))
    } catch (e) { setError(e.message); setParsed(null) }
  }

  const ratio = parsed && parsed.bounds.w ? parsed.bounds.h / parsed.bounds.w : 1
  const setWidth = (v) => { setW(v); if (lock && v !== '') setH(+(v * ratio).toFixed(2)) }
  const setHeight = (v) => { setH(v); if (lock && v !== '' && ratio) setW(+(v / ratio).toFixed(2)) }
  const fitA4 = (margin = 10) => {
    const k = Math.min((A4.w - 2 * margin) / parsed.bounds.w, (A4.h - 2 * margin) / parsed.bounds.h)
    setW(+(parsed.bounds.w * k).toFixed(2)); setH(+(parsed.bounds.h * k).toFixed(2)); setCx(0); setCy(0)
  }

  const placed = useMemo(() => (parsed && w > 0 && h > 0 ? placeGroups(parsed, w, h, cx, cy, tol) : null), [parsed, w, h, cx, cy, tol])

  // anteprima sul foglio A4
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    const W = c.width, H = c.height, s = Math.min(W / (A4.w + 20), H / (A4.h + 20))
    ctx.fillStyle = '#0f0f0f'; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#1c1c1c'; ctx.fillRect(W / 2 - A4.w / 2 * s, H / 2 - A4.h / 2 * s, A4.w * s, A4.h * s)
    ctx.strokeStyle = '#6b7280'; ctx.strokeRect(W / 2 - A4.w / 2 * s, H / 2 - A4.h / 2 * s, A4.w * s, A4.h * s)
    if (!placed) return
    for (const g of placed) {
      if (!enabled[g.color]) continue
      ctx.strokeStyle = g.color === '#000000' ? '#e5e7eb' : g.color; ctx.lineWidth = 1
      for (const pl of g.polylines) {
        ctx.beginPath()
        pl.forEach(([x, y], i) => (i ? ctx.lineTo(W / 2 + x * s, H / 2 - y * s) : ctx.moveTo(W / 2 + x * s, H / 2 - y * s)))
        ctx.stroke()
      }
    }
  }, [placed, enabled])

  const stats = placed?.filter((g) => enabled[g.color]).reduce((a, g) => ({ paths: a.paths + g.polylines.length, pts: a.pts + g.polylines.reduce((n, p) => n + p.length, 0) }), { paths: 0, pts: 0 })

  const doImport = () => {
    const base = (file?.name || 'svg').replace(/\.svg$/i, '')
    const groups = placed.filter((g) => enabled[g.color] && g.polylines.length)
    if (!groups.length) return notify('Nessun colore selezionato', 'warn')
    snapshot()
    for (const g of groups) {
      const layer = addLayer({ name: `${base} ${g.color}`, color: g.color === '#000000' ? '#e5e7eb' : g.color })
      addShapes([{ type: 'multi', layerId: layer.id, paths: g.polylines, source: base }])
    }
    notify(`Importati ${groups.length} layer da ${file.name}`, 'ok')
    onClose()
  }

  return (
    <Modal title="Importa SVG → layer di disegno" onClose={onClose} wide>
      <div className="grid gap-4 md:grid-cols-[1fr_300px]">
        <div>
          <canvas ref={canvasRef} width={520} height={640} className="w-full rounded border border-line" />
        </div>
        <div className="space-y-3 text-sm">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line py-4 text-gray-300 hover:border-accent">
            <Upload size={16} /> {file ? file.name : 'Scegli file .svg'}
            <input type="file" accept=".svg,image/svg+xml" className="hidden" onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-[11px] text-gray-500">Si tracciano solo i contorni (stroke e bordi dei riempimenti). Ogni colore diventa un layer. Immagini raster e &lt;use&gt;/testo non convertito non sono supportati: in Inkscape usa “Oggetto → Percorso”.</p>
          {parsed && (
            <>
              <div className="flex items-end gap-2">
                <label className="flex-1 text-[11px] text-gray-500">Larghezza mm<NumInput value={w} onChange={setWidth} step={1} /></label>
                <button className="mb-1.5 text-gray-400 hover:text-white" onClick={() => setLock(!lock)} title="Mantieni proporzioni">{lock ? <Lock size={15} /> : <Unlock size={15} />}</button>
                <label className="flex-1 text-[11px] text-gray-500">Altezza mm<NumInput value={h} onChange={setHeight} step={1} /></label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gray-500">Centro X<NumInput value={cx} onChange={setCx} step={1} /></label>
                <label className="text-[11px] text-gray-500">Centro Y<NumInput value={cy} onChange={setCy} step={1} /></label>
              </div>
              <div className="flex gap-1.5">
                <Btn className="flex-1 text-xs" onClick={() => fitA4(10)}>Adatta ad A4</Btn>
                <Btn className="flex-1 text-xs" onClick={() => { setWidth(+(parsed.bounds.w * PX2MM).toFixed(2)) }}>Dim. originale</Btn>
              </div>
              <label className="block text-[11px] text-gray-500">Semplificazione (tolleranza mm)
                <NumInput value={tol} onChange={setTol} step={0.01} min={0} />
              </label>
              <div>
                <span className="label">Colori → layer</span>
                {parsed.groups.map((g) => (
                  <label key={g.color} className="flex items-center gap-2 py-0.5 text-xs">
                    <input type="checkbox" checked={!!enabled[g.color]} onChange={(e) => setEnabled({ ...enabled, [g.color]: e.target.checked })} />
                    <span className="h-3 w-3 rounded-sm border border-line" style={{ background: g.color }} />
                    <span className="font-mono">{g.color}</span>
                    <span className="text-gray-500">{g.polylines.length} tracciati</span>
                  </label>
                ))}
              </div>
              {stats && <p className="font-mono text-[11px] text-gray-500">{stats.paths} tracciati · {stats.pts} punti</p>}
              <Btn variant="primary" className="w-full" onClick={doImport}>Importa nel progetto</Btn>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
