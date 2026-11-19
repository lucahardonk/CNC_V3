import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Eye, Pencil, Play, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import Tooltip from '../common/Tooltip'
import { layerColor } from './geometry'
import { OPERATION_NAMES, useStore } from '../../store/store'
import { errMsg, Layers } from '../../services/api'

// Limiti della macchina reale (GRBL 1.1h): oltre questi valori il campo diventa rosso
export const MACHINE_LIMITS = { feed: 1500, rpm: 24000 }
const TOOL_TYPES = { flat: 'Piatta', ball: 'Sferica', vbit: 'V' }
// campo → [etichetta, step, validazione, suggerimento]
const CUT_FIELDS = {
  tool_diameter: ['Diametro fresa (mm)', 0.1, (v) => v >= 0 && v <= 50, 'Diametro della fresa: usato per il percorso e per l\'anteprima arancione nel CAD.'],
  feed_rate: ['Feed (mm/min)', 10, (v) => v > 0, `Avanzamento in taglio (G1 F). Massimo macchina ${MACHINE_LIMITS.feed} mm/min.`],
  spindle_rpm: ['RPM mandrino', 500, (v) => v >= 0 && Number.isInteger(v), `Velocità mandrino (M3 S). Massimo ${MACHINE_LIMITS.rpm} RPM.`],
  z_safe: ['Z sicurezza (mm)', 0.5, (v) => v >= 0, 'Quota Z per i movimenti rapidi (G0) sopra il pezzo.'],
  z_depth: ['Profondità finale (mm)', 0.1, (v) => v < 0, 'Quota Z finale del taglio, negativa (Z0 = superficie del pezzo).'],
  z_pass_depth: ['Passata per volta (mm)', 0.1, (v) => v > 0, 'Profondità asportata per ogni passata: più passate fino alla profondità finale.'],
}
const fieldWarn = (k, v) => (k === 'feed_rate' && v > MACHINE_LIMITS.feed ? `Oltre il massimo macchina (${MACHINE_LIMITS.feed} mm/min)`
  : k === 'spindle_rpm' && v > MACHINE_LIMITS.rpm ? `Oltre il massimo macchina (${MACHINE_LIMITS.rpm} RPM)` : null)

export default function LayerPanel({ layers, activeId, mode, onSelect, onEdit, onCut, onAdd, onDelete, onRename, onMove, projectId, onLayerUpdated }) {
  const tools = useStore((s) => s.tools)
  const notify = useStore((s) => s.notify)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [open, setOpen] = useState(() => new Set())
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-r border-line bg-bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Layer di lavorazione <span className="text-gray-500">{layers.length}</span></span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {layers.length === 0 && <p className="p-3 text-center text-xs text-gray-500">Nessun layer. Crea il primo layer per iniziare a disegnare.</p>}
        {layers.map((l, i) => {
          const tool = tools.find((t) => t.id === l.tool_id)
          const active = l.id === activeId
          return (
            <div key={l.id} onClick={() => onSelect(l.id)}
              className={`group cursor-pointer rounded-lg border p-2.5 transition ${active ? 'border-accent/70 bg-accent/5' : 'border-line bg-bg hover:border-gray-600'}`}>
              <div className="flex items-center gap-2">
                <span className="w-5 text-center font-mono text-xs text-gray-500">{i + 1}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: layerColor(i) }} title="Colore layer nel CAD" />
                {editing === l.id ? (
                  <input autoFocus className="input py-0.5 text-sm" value={name} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setName(e.target.value)} onBlur={() => { onRename(l.id, name); setEditing(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null) }} />
                ) : (
                  <span className="flex-1 truncate text-sm font-medium text-white" onDoubleClick={(e) => { e.stopPropagation(); setEditing(l.id); setName(l.name) }} title="Doppio click per rinominare">{l.name}</span>
                )}
                <Tooltip text={l.is_complete ? 'Lavorazione completata' : l.gcode ? 'Percorso utensile calcolato' : 'Percorso non ancora calcolato (si calcola aprendo la simulazione)'}>
                  {l.is_complete ? <CheckCircle2 size={15} className="text-accent" /> : <Circle size={15} className={l.gcode ? 'text-sky-400' : 'text-gray-600'} />}
                </Tooltip>
              </div>
              <div className="ml-7 mt-1 text-[11px] text-gray-500">
                {l.gcode ? `${OPERATION_NAMES[l.operation]} · ${tool ? `Ø${tool.diameter}` : '?'} · ${l.params?.depth_total ?? '?'} mm` : `${l.entity_count} entità · percorso da calcolare`}
              </div>
              <div className="ml-7 mt-2 flex items-center gap-1">
                <Btn tip="Modifica disegno (CAD)" onClick={() => onEdit(l.id)} active={mode === 'cad' && active}><Pencil size={13} /></Btn>
                <Btn tip={l.entity_count || l.gcode ? 'Simulazione 3D del percorso utensile' : 'Layer vuoto: disegna qualcosa prima'} disabled={!l.entity_count && !l.gcode} onClick={() => onCut(l.id)} active={mode === 'cutting' && active} green><Play size={13} /></Btn>
                <Btn tip="Mostra nel 3D" onClick={() => onSelect(l.id, true)}><Eye size={13} /></Btn>
                <Btn tip="Parametri di taglio del layer" onClick={() => toggle(l.id)} active={open.has(l.id)}>{open.has(l.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</Btn>
                <div className="ml-auto flex opacity-0 transition group-hover:opacity-100">
                  <Btn tip="Sposta su" disabled={i === 0} onClick={() => onMove(l.id, -1)}><ArrowUp size={13} /></Btn>
                  <Btn tip="Sposta giù" disabled={i === layers.length - 1} onClick={() => onMove(l.id, 1)}><ArrowDown size={13} /></Btn>
                  <Btn tip="Elimina layer" onClick={() => onDelete(l)} red><Trash2 size={13} /></Btn>
                </div>
              </div>
              {open.has(l.id) && <CutParams layer={l} onLayerUpdated={onLayerUpdated} notify={notify} />}
            </div>
          )
        })}
      </div>
      <div className="border-t border-line p-2">
        <button onClick={onAdd} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2.5 text-sm text-gray-400 transition hover:border-accent hover:text-accent">
          <Plus size={16} /> Nuovo Layer
        </button>
      </div>
    </div>
  )
}

const Btn = ({ children, tip, onClick, disabled, active, green, red }) => (
  <Tooltip text={tip}>
    <button disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick?.() }}
      className={`rounded p-1.5 transition disabled:opacity-30 ${active ? 'bg-accent text-black' : green ? 'text-accent hover:bg-accent/15' : red ? 'text-red-400 hover:bg-red-500/15' : 'text-gray-400 hover:bg-bg-hover hover:text-white'}`}>
      {children}
    </button>
  </Tooltip>
)

// Parametri di taglio di un layer: ogni modifica valida viene salvata subito (PATCH, debounce 300 ms)
function CutParams({ layer, onLayerUpdated, notify }) {
  const [draft, setDraft] = useState({})
  const pending = useRef({})
  const timer = useRef(null)
  const flush = async () => {
    clearTimeout(timer.current)
    const body = pending.current
    pending.current = {}
    if (!Object.keys(body).length) return
    try { onLayerUpdated?.(await Layers.patch(layer.id, body)) } catch (e) { notify(`Salvataggio parametri fallito: ${errMsg(e)}`, 'error') }
  }
  useEffect(() => () => { flush() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const save = (k, v) => {
    pending.current = { ...pending.current, [k]: v }
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 300)
  }
  const onNum = (k, raw) => {
    setDraft((d) => ({ ...d, [k]: raw }))
    const v = Number(raw)
    if (raw !== '' && Number.isFinite(v) && CUT_FIELDS[k][2](v)) save(k, v)
  }
  const num = (k) => {
    const [label, step, valid, tip] = CUT_FIELDS[k]
    const raw = draft[k] ?? String(layer[k] ?? '')
    const v = Number(raw)
    const invalid = raw === '' || !Number.isFinite(v) || !valid(v)
    const warn = !invalid && fieldWarn(k, v)
    return (
      <label key={k} className="block">
        <Tooltip text={tip}><span className="mb-0.5 block cursor-help text-[10px] text-gray-500">{label}</span></Tooltip>
        <input type="number" step={step} value={raw} onClick={(e) => e.stopPropagation()} onChange={(e) => onNum(k, e.target.value)} onBlur={flush}
          className={`input py-1 text-xs ${invalid || warn ? 'border-red-500 text-red-400' : ''}`} />
        {warn && <span className="mt-0.5 block text-[10px] leading-tight text-red-400">⚠ {warn}</span>}
        {invalid && <span className="mt-0.5 block text-[10px] leading-tight text-red-400">Valore non valido{k === 'z_depth' ? ' (deve essere negativo)' : ''}</span>}
      </label>
    )
  }
  const passes = Math.max(1, Math.ceil(Math.abs(Number(layer.z_depth) || 0) / (Number(layer.z_pass_depth) || 1) - 1e-9))
  return (
    <div className="ml-7 mt-2 space-y-2 border-t border-line pt-2" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-2">
        {num('tool_diameter')}
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-gray-500">Tipo fresa</span>
          <select className="input py-1 text-xs" value={layer.tool_type || 'flat'}
            onChange={(e) => { onLayerUpdated?.({ ...layer, tool_type: e.target.value }); save('tool_type', e.target.value); flush() }}>
            {Object.entries(TOOL_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        {num('feed_rate')}
        {num('spindle_rpm')}
        {num('z_safe')}
        {num('z_depth')}
        {num('z_pass_depth')}
      </div>
      <p className="text-[10px] text-gray-500">{OPERATION_NAMES[layer.operation] || layer.operation} · {passes} passat{passes === 1 ? 'a' : 'e'} fino a Z{layer.z_depth}</p>
    </div>
  )
}
