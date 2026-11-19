import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Download, Eye, Pencil, Play, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import Tooltip from '../common/Tooltip'
import { layerColor } from './geometry'
import { OPERATION_NAMES, useStore } from '../../store/store'
import { errMsg, Export, Layers } from '../../services/api'

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
  plunge_rate: ['Plunge (mm/min)', 10, (v) => v > 0, 'Velocità di affondo in Z (G1 Z ... F). Deve essere più bassa del feed.'],
  step_over: ['Step-over (0-1)', 0.05, (v) => v > 0 && v <= 1, 'Passo laterale della tasca come frazione del diametro (0.4 = 40%).'],
  bridge_height: ['Altezza ponticelli (mm)', 0.1, (v) => v >= 0, 'Materiale lasciato sotto i ponticelli disegnati (dal fondo del taglio). Usato solo se il disegno contiene ponticelli.'],
}
const fieldWarn = (k, v) => (k === 'feed_rate' && v > MACHINE_LIMITS.feed ? `Oltre il massimo macchina (${MACHINE_LIMITS.feed} mm/min)`
  : k === 'spindle_rpm' && v > MACHINE_LIMITS.rpm ? `Oltre il massimo macchina (${MACHINE_LIMITS.rpm} RPM)` : null)

export default function LayerPanel({ layers, activeId, mode, onSelect, onEdit, onCut, onAdd, onDelete, onRename, onMove, projectId, material, onLayerUpdated }) {
  const tools = useStore((s) => s.tools)
  const notify = useStore((s) => s.notify)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [open, setOpen] = useState(() => new Set())
  const [busy, setBusy] = useState(null) // id del layer in download
  const downloadNc = async (l) => {
    setBusy(l.id)
    try { notify(`Scaricato ${await Export.layerNc(l.id)}`, 'success') } catch (e) { notify(`Download fallito: ${errMsg(e)}`, 'error') } finally { setBusy(null) }
  }
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
                {OPERATION_NAMES[l.operation] || l.operation} · {tool ? `${tool.name} · ` : ''}Ø{l.tool_diameter} · {Math.abs(Number(l.z_depth) || 0)} mm{!l.gcode && ` · ${l.entity_count} entità`}
              </div>
              <div className="ml-7 mt-2 flex items-center gap-1">
                <Btn tip="Modifica disegno (CAD)" onClick={() => onEdit(l.id)} active={mode === 'cad' && active}><Pencil size={13} /></Btn>
                <Btn tip={l.entity_count || l.gcode ? 'Simulazione 3D del percorso utensile' : 'Layer vuoto: disegna qualcosa prima'} disabled={!l.entity_count && !l.gcode} onClick={() => onCut(l.id)} active={mode === 'cutting' && active} green><Play size={13} /></Btn>
                <Btn tip="Mostra nel 3D" onClick={() => onSelect(l.id, true)}><Eye size={13} /></Btn>
                <Btn tip={l.entity_count ? 'Scarica .nc: G-code di questo layer con i suoi parametri di taglio, da caricare sul bridge wireless' : 'Layer vuoto: disegna qualcosa prima'}
                  disabled={!l.entity_count || busy === l.id} onClick={() => downloadNc(l)}><Download size={13} className={busy === l.id ? 'animate-pulse' : ''} /></Btn>
                <Btn tip="Parametri di taglio del layer" onClick={() => toggle(l.id)} active={open.has(l.id)}>{open.has(l.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</Btn>
                <div className="ml-auto flex opacity-0 transition group-hover:opacity-100">
                  <Btn tip="Sposta su" disabled={i === 0} onClick={() => onMove(l.id, -1)}><ArrowUp size={13} /></Btn>
                  <Btn tip="Sposta giù" disabled={i === layers.length - 1} onClick={() => onMove(l.id, 1)}><ArrowDown size={13} /></Btn>
                  <Btn tip="Elimina layer" onClick={() => onDelete(l)} red><Trash2 size={13} /></Btn>
                </div>
              </div>
              {open.has(l.id) && <CutParams layer={l} material={material} onLayerUpdated={onLayerUpdated} notify={notify} />}
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

// Parametri salvati in layer.params (non sono colonne del layer)
const PARAM_KEYS = new Set(['plunge_rate', 'step_over', 'pocket_direction', 'bridge_height'])
const OP_TIPS = {
  profile_outside: 'Fuori dalla linea: la fresa gira all\'esterno del contorno, il pezzo mantiene le dimensioni disegnate.',
  profile_inside: 'Dentro la linea: la fresa gira all\'interno del contorno, il foro mantiene le dimensioni disegnate.',
  profile_on: 'Sulla linea: il centro fresa segue esattamente la linea (incisioni, linee aperte).',
  pocket: 'Svuota tutta l\'area chiusa fino alla profondità finale.',
}
const POCKET_DIRS = { horizontal: 'Righe orizzontali (zig-zag X)', vertical: 'Righe verticali (zig-zag Y)', contour: 'Contorno (offset concentrici)' }
const toolTypeOf = (t) => (/ball|sfer/i.test(t?.type || '') ? 'ball' : /v[-_ ]?bit|^v$/i.test(t?.type || '') ? 'vbit' : 'flat')

// Parametri di taglio di un layer: ogni modifica valida viene salvata (PATCH, debounce 400 ms) e il
// percorso viene rigenerato subito dopo (Layers.generate) → 3D e simulazione si aggiornano da soli.
function CutParams({ layer, material, onLayerUpdated, notify }) {
  const tools = useStore((s) => s.tools)
  const materials = useStore((s) => s.materials)
  const settings = useStore((s) => s.settings)
  const [draft, setDraft] = useState({})
  const [regen, setRegen] = useState(null) // null | 'busy' | messaggio di errore
  const pending = useRef({})
  const timer = useRef(null)
  const latest = useRef(layer)
  latest.current = layer
  const queue = useRef(Promise.resolve()) // richieste in serie: mai PATCH/generate concorrenti
  const seq = useRef(0)
  const lastParams = useRef(null) // params dell'ultimo salvataggio (anche se la sua risposta UI è stata scartata)

  const flush = () => {
    clearTimeout(timer.current)
    const changes = pending.current
    pending.current = {}
    if (!Object.keys(changes).length) return queue.current
    const my = ++seq.current
    queue.current = queue.current.then(async () => {
      const body = {}, par = {}
      for (const [k, v] of Object.entries(changes)) (PARAM_KEYS.has(k) ? par : body)[k] = v
      if (Object.keys(par).length) body.params = { ...(lastParams.current || latest.current.params || {}), ...par }
      let saved
      try { saved = await Layers.patch(layer.id, body) } catch (e) { notify(`Salvataggio parametri fallito: ${errMsg(e)}`, 'error'); return }
      lastParams.current = saved.params
      if (my !== seq.current) return // è già in coda una modifica più recente: rigenera quella
      onLayerUpdated?.(saved)
      if (!saved.entity_count) return
      setRegen('busy')
      try {
        const r = await Layers.generate(layer.id, {})
        lastParams.current = r.layer.params
        if (my !== seq.current) return // risposta superata da una modifica successiva: ignorata
        onLayerUpdated?.(r.layer); setRegen(null)
      } catch (e) { if (my === seq.current) setRegen(errMsg(e)) }
    })
    return queue.current
  }
  useEffect(() => () => { flush() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const save = (changes, now = false) => {
    pending.current = { ...pending.current, ...changes }
    clearTimeout(timer.current)
    if (now) flush(); else timer.current = setTimeout(flush, 400)
  }

  const prm = layer.params || {}
  const tool = tools.find((t) => t.id === layer.tool_id)
  const values = {
    ...layer,
    plunge_rate: prm.plunge_rate ?? Math.round(Math.max(50, (Number(layer.feed_rate) || 600) * 0.3)),
    step_over: prm.step_over ?? tool?.step_over ?? 0.4,
    bridge_height: prm.bridge_height ?? settings?.cutting?.bridge_height ?? 1.5,
    pocket_direction: prm.pocket_direction || 'horizontal',
  }
  const onNum = (k, raw) => {
    setDraft((d) => ({ ...d, [k]: raw }))
    const v = Number(raw)
    if (raw === '' || !Number.isFinite(v) || !CUT_FIELDS[k][2](v)) return
    // diametro cambiato a mano → non corrisponde più alla fresa della libreria
    save(k === 'tool_diameter' && tool && v !== Number(tool.diameter) ? { [k]: v, tool_id: null } : { [k]: v })
  }
  const choose = (k, v) => { onLayerUpdated?.({ ...layer, [k]: v, ...(PARAM_KEYS.has(k) ? { params: { ...prm, [k]: v } } : {}) }); save({ [k]: v }, true) }
  const applyTool = (id) => {
    const t = tools.find((x) => x.id === id)
    if (!t) { choose('tool_id', null); return }
    const mat = materials?.[material] || {}
    // come la vecchia modale "Genera G-code": tra materiale e utensile vale il valore più prudente
    const pick = (k) => { const c = [mat[k], t[k]].filter((v) => v != null).map(Number); return c.length ? Math.min(...c) : undefined }
    const ch = { tool_id: t.id, tool_diameter: Number(t.diameter), tool_type: toolTypeOf(t) }
    for (const [k, v] of [['feed_rate', pick('feed_rate')], ['plunge_rate', pick('plunge_rate')], ['step_over', pick('step_over')],
      ['spindle_rpm', t.spindle_rpm ?? mat.spindle_rpm]]) if (v != null && Number.isFinite(Number(v))) ch[k] = k === 'spindle_rpm' ? Math.round(v) : Number(v)
    setDraft({})
    const par = Object.fromEntries(Object.entries(ch).filter(([k]) => PARAM_KEYS.has(k)))
    onLayerUpdated?.({ ...layer, ...Object.fromEntries(Object.entries(ch).filter(([k]) => !PARAM_KEYS.has(k))), params: { ...prm, ...par } })
    save(ch, true)
    notify(`Fresa «${t.name}» applicata: diametro, feed, plunge e RPM aggiornati`, 'success')
  }

  const num = (k) => {
    const [label, step, valid, tip] = CUT_FIELDS[k]
    const raw = draft[k] ?? String(values[k] ?? '')
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
  const lbl = (text, tip) => <Tooltip text={tip}><span className="mb-0.5 block cursor-help text-[10px] text-gray-500">{text}</span></Tooltip>
  const pocket = layer.operation === 'pocket'
  const passes = Math.max(1, Math.ceil(Math.abs(Number(layer.z_depth) || 0) / (Number(layer.z_pass_depth) || 1) - 1e-9))
  return (
    <div className="ml-7 mt-2 space-y-2 border-t border-line pt-2" onClick={(e) => e.stopPropagation()}>
      <label className="block">
        {lbl('Fresa (libreria utensili)', 'Scegli una fresa predefinita: applica diametro, tipo, feed, plunge, RPM e step-over. I valori restano modificabili a mano.')}
        <select className="input py-1 text-xs" value={layer.tool_id && tool ? layer.tool_id : ''} onChange={(e) => applyTool(e.target.value)}>
          <option value="">— Personalizzata —</option>
          {tools.map((t) => <option key={t.id} value={t.id}>{t.name} (Ø{t.diameter})</option>)}
        </select>
      </label>
      <div>
        {lbl('Strategia', OP_TIPS[layer.operation])}
        <div className="grid grid-cols-2 gap-1">
          {Object.entries(OPERATION_NAMES).map(([k, n]) => (
            <Tooltip key={k} text={OP_TIPS[k]}>
              <button onClick={() => choose('operation', k)}
                className={`w-full rounded border px-1.5 py-1 text-[11px] transition ${layer.operation === k ? 'border-accent bg-accent/10 text-white' : 'border-line text-gray-400 hover:border-gray-500'}`}>
                {{ profile_outside: 'Fuori linea', profile_inside: 'Dentro linea', profile_on: 'Sulla linea', pocket: 'Tasca (pocket)' }[k] || n}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      {pocket && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            {lbl('Riempimento tasca', 'Come viene svuotata l\'area: righe a zig-zag oppure offset concentrici dal contorno.')}
            <select className="input py-1 text-xs" value={values.pocket_direction} onChange={(e) => choose('pocket_direction', e.target.value)}>
              {Object.entries(POCKET_DIRS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
          {num('step_over')}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {num('tool_diameter')}
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-gray-500">Tipo fresa</span>
          <select className="input py-1 text-xs" value={layer.tool_type || 'flat'} onChange={(e) => choose('tool_type', e.target.value)}>
            {Object.entries(TOOL_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        {num('feed_rate')}
        {num('plunge_rate')}
        {num('spindle_rpm')}
        {num('z_safe')}
        {num('z_depth')}
        {num('z_pass_depth')}
        {!pocket && num('bridge_height')}
      </div>
      <p className="text-[10px] text-gray-500">{OPERATION_NAMES[layer.operation] || layer.operation}{pocket ? ` (${POCKET_DIRS[values.pocket_direction]})` : ''} · {passes} passat{passes === 1 ? 'a' : 'e'} fino a Z{layer.z_depth}</p>
      {regen && <p className={`text-[10px] ${regen === 'busy' ? 'text-sky-400' : 'text-red-400'}`}>{regen === 'busy' ? 'Aggiornamento percorso...' : `⚠ Percorso non aggiornato: ${regen}`}</p>}
    </div>
  )
}
