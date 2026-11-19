import { useEffect, useMemo, useRef, useState } from 'react'
import { FileImage, Link2, Link2Off, X } from 'lucide-react'
import { commandsToSubpaths, mapSubpaths, parseSvg, placeMap, subpathsBBox, subpathsToEntities, subpathsToPolylines } from './vectorize'

const TAG_NAMES = { path: 'path', rect: 'rettangoli', circle: 'cerchi', ellipse: 'ellissi', line: 'linee', polyline: 'polilinee', polygon: 'poligoni' }

const Num = ({ label, value, onChange, step = 1, suffix }) => (
  <label className="block">
    <span className="mb-0.5 block text-[10px] text-gray-500">{label}</span>
    <div className="flex items-center gap-1">
      <input type="number" step={step} className="input py-1 text-xs" value={Number.isFinite(value) ? +value.toFixed(3) : ''}
        onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) onChange(v) }} />
      {suffix && <span className="text-[10px] text-gray-500">{suffix}</span>}
    </div>
  </label>
)

// Pannello "Importa SVG": file picker → parsing (DOMParser) → anteprima trascinabile/ridimensionabile
// nel canvas → conferma: i percorsi diventano entità (linee + spline) del layer attivo.
export default function SvgImportTool({ center, stock, onClose, onConfirm, setPlacement, notify }) {
  const fileRef = useRef(null)
  const [src, setSrc] = useState(null) // { name, subs, bbox, counts }
  const [box, setBox] = useState(null)
  const [lock, setLock] = useState(true)

  const opened = useRef(false)
  useEffect(() => { if (!opened.current) { opened.current = true; fileRef.current?.click() } }, [])

  const onFile = async (f) => {
    if (!f) return
    try {
      const svg = parseSvg(await f.text())
      const all = svg.commands.flatMap((c) => c)
      const raw = commandsToSubpaths(all, 1e9) // solo per l'ingombro
      const bb0 = subpathsBBox(raw)
      if (!bb0) throw new Error('Nessuna geometria supportata (path, rect, circle, ellipse, line, polyline, polygon)')
      const step = Math.max(bb0.w, bb0.h) / 400 || 0.5
      const subs = svg.commands.flatMap((c) => commandsToSubpaths(c, step))
      const bbox = subpathsBBox(subs)
      // misura iniziale: dimensione dichiarata nel file (mm/px a 96 dpi), limitata a ~80% dello stock
      let w = bbox.w || 1, h = bbox.h || 1
      if (svg.declared.w && svg.viewBox) { const k = svg.declared.w / svg.viewBox[2]; w *= k; h *= k }
      else { w = (w * 25.4) / 96; h = (h * 25.4) / 96 }
      const maxW = (stock?.x || 200) * 0.8, maxH = (stock?.y || 200) * 0.8
      const k = Math.min(1, maxW / w, maxH / h)
      w = Math.max(1, w * k); h = Math.max(1, h * k)
      if (bbox.w < 1e-9) w = 1
      if (bbox.h < 1e-9) h = 1
      setSrc({ name: f.name, subs, bbox, counts: svg.counts })
      setBox({ cx: center?.x || 0, cy: center?.y || 0, w, h })
    } catch (e) {
      notify?.(`Import SVG fallito: ${e.message || e}`, 'error')
    } finally { if (fileRef.current) fileRef.current.value = '' }
  }

  const placed = useMemo(() => (src && box ? mapSubpaths(src.subs, placeMap(src.bbox, box)) : null), [src, box])
  useEffect(() => {
    if (!placed) { setPlacement(null); return }
    setPlacement({ box, polylines: subpathsToPolylines(placed), lockAspect: lock, onChange: setBox, label: `${src.name} · ${box.w.toFixed(1)}×${box.h.toFixed(1)} mm` })
  }, [placed, lock]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setPlacement(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  const ratio = src && src.bbox.w > 1e-9 && src.bbox.h > 1e-9 ? src.bbox.h / src.bbox.w : null
  const setW = (w) => { if (w > 0) setBox((b) => ({ ...b, w, h: lock && ratio ? w * ratio : b.h })) }
  const setH = (h) => { if (h > 0) setBox((b) => ({ ...b, h, w: lock && ratio ? h / ratio : b.w })) }

  const confirm = () => {
    if (!placed) return
    const ents = subpathsToEntities(placed)
    if (!ents.length) return notify?.('Nessun percorso valido nel file SVG', 'error')
    onConfirm(ents, src.name)
  }

  const stop = (e) => e.stopPropagation()
  return (
    <div className="absolute right-3 top-3 z-20 w-72 rounded-lg border border-line bg-bg-card/95 p-3 text-xs shadow-2xl"
      onMouseDown={stop} onDoubleClick={stop} onWheel={stop} onContextMenu={stop}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-white"><FileImage size={15} /> Importa SVG</span>
        <button onClick={onClose} className="text-gray-500 hover:text-white" title="Chiudi (annulla)"><X size={15} /></button>
      </div>
      <input ref={fileRef} type="file" accept=".svg,image/svg+xml" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="space-y-2.5">
        <button onClick={() => fileRef.current?.click()} className="w-full rounded-md border border-dashed border-line py-2 text-gray-300 transition hover:border-accent hover:text-accent">
          {src ? `📄 ${src.name} — cambia file…` : 'Scegli un file .svg…'}
        </button>
        {src && box && (<>
          <div className="text-[10px] leading-snug text-gray-500">
            Trovati: {Object.entries(src.counts).map(([k, n]) => `${n} ${TAG_NAMES[k] || k}`).join(' · ')} → {src.subs.length} percorsi
          </div>
          <div className="flex items-end gap-1.5">
            <div className="grid flex-1 grid-cols-2 gap-2">
              <Num label="Larghezza" value={box.w} onChange={setW} step={1} suffix="mm" />
              <Num label="Altezza" value={box.h} onChange={setH} step={1} suffix="mm" />
            </div>
            <button onClick={() => setLock(!lock)} title={lock ? 'Proporzioni bloccate (click per sbloccare)' : 'Proporzioni libere (click per bloccare)'}
              className={`mb-0.5 flex h-7 w-7 items-center justify-center rounded border ${lock ? 'border-accent text-accent' : 'border-line text-gray-400'}`}>
              {lock ? <Link2 size={14} /> : <Link2Off size={14} />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Centro X" value={box.cx} onChange={(v) => setBox((b) => ({ ...b, cx: v }))} />
            <Num label="Centro Y" value={box.cy} onChange={(v) => setBox((b) => ({ ...b, cy: v }))} />
          </div>
          <p className="text-[10px] text-gray-400">Trascina il riquadro rosa nel canvas per spostarlo, gli angoli per ridimensionarlo. Il testo SVG (&lt;text&gt;) va convertito in tracciati prima dell'import.</p>
        </>)}
        <div className="flex justify-end gap-2 pt-1">
          <button className="rounded-md border border-line px-3 py-1 text-gray-300 hover:bg-bg-hover" onClick={onClose}>Annulla</button>
          <button className="rounded-md bg-accent px-3 py-1 font-semibold text-black hover:brightness-110 disabled:opacity-40" disabled={!placed} onClick={confirm}>Inserisci nel layer</button>
        </div>
      </div>
    </div>
  )
}
