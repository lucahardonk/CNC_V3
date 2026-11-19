import { useEffect, useMemo, useState } from 'react'
import { parse as parseFont } from 'opentype.js'
import { Bold, Italic, Type, X } from 'lucide-react'
import { commandsToSubpaths, mapSubpaths, placeMap, subpathsBBox, subpathsToEntities, subpathsToPolylines } from './vectorize'

// Font inclusi in /public/fonts (licenze libere, metriche compatibili con i font di sistema indicati)
export const FONTS = {
  Arial: { note: 'Liberation Sans', r: 'LiberationSans-Regular.ttf', b: 'LiberationSans-Bold.ttf', i: 'LiberationSans-Italic.ttf', bi: 'LiberationSans-BoldItalic.ttf' },
  'Times New Roman': { note: 'Liberation Serif', r: 'LiberationSerif-Regular.ttf', b: 'LiberationSerif-Bold.ttf', i: 'LiberationSerif-Italic.ttf', bi: 'LiberationSerif-BoldItalic.ttf' },
  'Courier New': { note: 'Liberation Mono', r: 'LiberationMono-Regular.ttf', b: 'LiberationMono-Bold.ttf', i: 'LiberationMono-Italic.ttf', bi: 'LiberationMono-BoldItalic.ttf' },
  Helvetica: { note: 'FreeSans', r: 'FreeSans.ttf', b: 'FreeSansBold.ttf', i: 'FreeSansOblique.ttf', bi: 'FreeSansBoldOblique.ttf' },
}
const fontCache = new Map()
function loadFont(file) {
  if (!fontCache.has(file)) {
    const url = `${import.meta.env.BASE_URL || '/'}fonts/${file}`
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error(`Font non trovato (${url})`); return r.arrayBuffer() }).then((b) => parseFont(b))
    p.catch(() => fontCache.delete(file))
    fontCache.set(file, p)
  }
  return fontCache.get(file)
}

// Trasforma i punti (anche di controllo) di un comando opentype
const mapCmd = (c, fn) => {
  if (c.type === 'Z') return c
  const o = { type: c.type, ...fn({ x: c.x, y: c.y }) }
  if (c.x1 !== undefined) { const p = fn({ x: c.x1, y: c.y1 }); o.x1 = p.x; o.y1 = p.y }
  if (c.x2 !== undefined) { const p = fn({ x: c.x2, y: c.y2 }); o.x2 = p.x; o.y2 = p.y }
  return o
}

// Comandi del testo (coordinate font: y in giù, unità = mm)
function textCommands(font, cfg) {
  const { text, size, mode, radius, startAngle, inside } = cfg
  if (mode === 'linear') {
    const out = []
    text.split('\n').forEach((line, k) => {
      const w = font.getAdvanceWidth(line, size, { kerning: true })
      out.push(...font.getPath(line, -w / 2, k * size * 1.2, size, { kerning: true }).commands)
    })
    return out
  }
  // circolare: ogni glifo ruotato sulla circonferenza (baseline sul cerchio di raggio R)
  const glyphs = font.stringToGlyphs(text.replace(/\n/g, ' '))
  const k = size / font.unitsPerEm
  const R = Math.max(1, radius)
  const out = []
  let s = 0
  for (const g of glyphs) {
    const adv = (g.advanceWidth || 0) * k
    const phi = ((startAngle * Math.PI) / 180) + (inside ? 1 : -1) * (s + adv / 2) / R
    const rot = phi + (inside ? 1 : -1) * Math.PI / 2
    const c = Math.cos(rot), sn = Math.sin(rot), ox = R * Math.cos(phi), oy = R * Math.sin(phi)
    // glifo centrato in x, y in giù → y in su, rotazione, traslazione, di nuovo y in giù
    const fn = (p) => { const x = p.x, y = -p.y; return { x: ox + x * c - y * sn, y: -(oy + x * sn + y * c) } }
    out.push(...g.getPath(-adv / 2, 0, size).commands.map((cm) => mapCmd(cm, fn)))
    s += adv
  }
  return out
}

const Num = ({ label, value, onChange, step = 1, min, suffix }) => (
  <label className="block">
    <span className="mb-0.5 block text-[10px] text-gray-500">{label}</span>
    <div className="flex items-center gap-1">
      <input type="number" step={step} min={min} className="input py-1 text-xs" value={Number.isFinite(value) ? +value.toFixed(3) : ''}
        onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) onChange(v) }} />
      {suffix && <span className="text-[10px] text-gray-500">{suffix}</span>}
    </div>
  </label>
)

// Pannello "Testo da incidere": genera l'anteprima trascinabile nel canvas (setPlacement) e,
// alla conferma, passa le entità (linee + spline) a onConfirm.
export default function TextTool({ center, onClose, onConfirm, setPlacement, notify }) {
  const [text, setText] = useState('CNC')
  const [family, setFamily] = useState('Arial')
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [size, setSize] = useState(20)
  const [mode, setMode] = useState('linear')
  const [radius, setRadius] = useState(50)
  const [startAngle, setStartAngle] = useState(135)
  const [inside, setInside] = useState(false)
  const [pos, setPos] = useState({ x: center?.x || 0, y: center?.y || 0 })
  const [font, setFont] = useState(null)
  const [error, setError] = useState(null)

  const file = FONTS[family][bold && italic ? 'bi' : bold ? 'b' : italic ? 'i' : 'r']
  useEffect(() => {
    let alive = true
    setError(null)
    loadFont(file).then((f) => alive && setFont(f)).catch((e) => alive && setError(String(e.message || e)))
    return () => { alive = false }
  }, [file])

  const geo = useMemo(() => {
    if (!font || !text.trim() || !(size > 0)) return null
    try {
      const subs = commandsToSubpaths(textCommands(font, { text, size, mode, radius, startAngle, inside }), Math.max(0.05, size / 60))
      const bbox = subpathsBBox(subs)
      return bbox ? { subs, bbox } : null
    } catch (e) { return null }
  }, [font, text, size, mode, radius, startAngle, inside])

  const box = geo ? { cx: pos.x, cy: pos.y, w: geo.bbox.w, h: geo.bbox.h } : null
  const placed = useMemo(() => (geo ? mapSubpaths(geo.subs, placeMap(geo.bbox, { cx: pos.x, cy: pos.y, w: geo.bbox.w, h: geo.bbox.h })) : null), [geo, pos.x, pos.y])
  const arcTooLong = mode === 'circular' && geo && font && (font.getAdvanceWidth(text.replace(/\n/g, ' '), size) > 2 * Math.PI * radius)

  useEffect(() => {
    if (!placed || !box) { setPlacement(null); return }
    setPlacement({
      box, polylines: subpathsToPolylines(placed), lockAspect: true, label: `Testo · ${box.w.toFixed(1)}×${box.h.toFixed(1)} mm`,
      // le maniglie scalano altezza carattere (e raggio) in modo uniforme
      onChange: (b) => {
        const k = box.w > 1e-6 ? b.w / box.w : 1
        setPos({ x: b.cx, y: b.cy })
        if (Math.abs(k - 1) > 1e-6) { setSize(Math.max(0.5, size * k)); if (mode === 'circular') setRadius(Math.max(1, radius * k)) }
      },
    })
  }, [placed]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setPlacement(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = () => {
    if (!placed) return
    const ents = subpathsToEntities(placed)
    if (!ents.length) return notify?.('Nessun percorso generato dal testo', 'error')
    onConfirm(ents, `testo «${text.replace(/\n/g, ' ').slice(0, 24)}»`)
  }

  const tog = (on) => `flex h-7 w-7 items-center justify-center rounded border transition ${on ? 'border-accent bg-accent/20 text-accent' : 'border-line text-gray-400 hover:text-white'}`
  const stop = (e) => e.stopPropagation()
  return (
    <div className="absolute right-3 top-3 z-20 w-72 rounded-lg border border-line bg-bg-card/95 p-3 text-xs shadow-2xl"
      onMouseDown={stop} onDoubleClick={stop} onWheel={stop} onContextMenu={stop}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-white"><Type size={15} /> Testo da incidere</span>
        <button onClick={onClose} className="text-gray-500 hover:text-white" title="Chiudi (annulla)"><X size={15} /></button>
      </div>
      <div className="space-y-2.5">
        <textarea rows={2} className="input resize-y py-1 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Scrivi il testo…" autoFocus />
        <div className="flex items-center gap-1.5">
          <select className="input flex-1 py-1 text-xs" value={family} onChange={(e) => setFamily(e.target.value)} style={{ fontFamily: family }}>
            {Object.keys(FONTS).map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select>
          <button className={tog(bold)} onClick={() => setBold(!bold)} title="Grassetto"><Bold size={14} /></button>
          <button className={tog(italic)} onClick={() => setItalic(!italic)} title="Corsivo"><Italic size={14} /></button>
        </div>
        <div className="text-[10px] text-gray-500">Font vettoriale: {FONTS[family].note}{bold || italic ? ` (${[bold && 'grassetto', italic && 'corsivo'].filter(Boolean).join(' ')})` : ''}</div>
        <div className="grid grid-cols-3 gap-2">
          <Num label="Altezza font" value={size} onChange={(v) => v > 0 && setSize(v)} step={0.5} min={0.5} suffix="mm" />
          <Num label="Centro X" value={pos.x} onChange={(v) => setPos((p) => ({ ...p, x: v }))} step={1} />
          <Num label="Centro Y" value={pos.y} onChange={(v) => setPos((p) => ({ ...p, y: v }))} step={1} />
        </div>
        <div>
          <span className="mb-0.5 block text-[10px] text-gray-500">Percorso del testo</span>
          <div className="grid grid-cols-2 gap-1">
            {[['linear', 'Lineare'], ['circular', 'Circolare']].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} className={`rounded border py-1 transition ${mode === k ? 'border-accent bg-accent/10 text-white' : 'border-line text-gray-400 hover:border-gray-500'}`}>{l}</button>
            ))}
          </div>
        </div>
        {mode === 'circular' && (
          <div className="space-y-2 rounded-md border border-line bg-bg p-2">
            <div className="grid grid-cols-2 gap-2">
              <Num label="Raggio" value={radius} onChange={(v) => v > 0 && setRadius(v)} step={1} min={1} suffix="mm" />
              <Num label="Angolo iniziale" value={startAngle} onChange={setStartAngle} step={5} suffix="°" />
            </div>
            <label className="flex items-center gap-2 text-gray-400"><input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} /> Antiorario (testo leggibile nella parte bassa)</label>
            <p className="text-[10px] leading-snug text-gray-500">0° = destra, 90° = alto. Il testo parte dall'angolo iniziale e gira in senso {inside ? 'antiorario' : 'orario'}.</p>
            {arcTooLong && <p className="text-[10px] text-yellow-300">⚠ Il testo è più lungo della circonferenza: aumenta il raggio.</p>}
          </div>
        )}
        {error && <p className="text-[11px] text-red-400">Errore caricamento font: {error}</p>}
        {!font && !error && <p className="text-[11px] text-gray-500">Caricamento font…</p>}
        {box && <p className="text-[10px] text-gray-400">Ingombro: <b className="text-gray-200">{box.w.toFixed(1)} × {box.h.toFixed(1)} mm</b> · trascina il riquadro rosa nel canvas per spostarlo, gli angoli per ridimensionarlo.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="rounded-md border border-line px-3 py-1 text-gray-300 hover:bg-bg-hover" onClick={onClose}>Annulla</button>
          <button className="rounded-md bg-accent px-3 py-1 font-semibold text-black hover:brightness-110 disabled:opacity-40" disabled={!placed} onClick={confirm}>Inserisci nel layer</button>
        </div>
      </div>
    </div>
  )
}
