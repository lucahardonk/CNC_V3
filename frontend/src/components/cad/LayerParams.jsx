import { useEffect, useRef, useState } from 'react'
import Tooltip from '../common/Tooltip'
import { OPERATION_NAMES, useStore } from '../../store/store'
import { errMsg, Layers, Tools } from '../../services/api'

// Parametri di taglio di un layer di lavorazione o di un suo layer di disegno: UNICA fonte di verità
// (pannello a destra del CAD + riepilogo nel LayerPanel). La libreria frese è quella di Impostazioni > Utensili.

// Limiti della macchina reale (GRBL 1.1h): oltre questi valori il campo diventa rosso
export const MACHINE_LIMITS = { feed: 1500, rpm: 24000 }
const TOOL_TYPES = { flat: 'Piatta', ball: 'Sferica', vbit: 'V' }
// campo → [etichetta, step, validazione, suggerimento]
const CUT_FIELDS = {
  tool_diameter: ['Diametro fresa (mm)', 0.1, (v) => v > 0 && v <= 50, 'Diametro della fresa: usato per il percorso e per l\'anteprima arancione nel CAD.'],
  feed_rate: ['Feed (mm/min)', 10, (v) => v > 0, `Avanzamento in taglio (G1 F). Massimo macchina ${MACHINE_LIMITS.feed} mm/min.`],
  spindle_rpm: ['RPM mandrino', 500, (v) => v >= 0 && Number.isInteger(v), `Velocità mandrino (M3 S). Massimo ${MACHINE_LIMITS.rpm} RPM.`],
  z_safe: ['Z sicurezza (mm)', 0.5, (v) => v >= 0, 'Quota Z per i movimenti rapidi (G0) sopra il pezzo.'],
  z_depth: ['Profondità finale (mm)', 0.1, (v) => v < 0, 'Quota Z finale del taglio, negativa (Z0 = superficie del pezzo).'],
  z_pass_depth: ['Passata per volta (mm)', 0.1, (v) => v > 0, 'Profondità asportata per ogni passata: più passate fino alla profondità finale.'],
  plunge_rate: ['Plunge (mm/min)', 10, (v) => v > 0, 'Velocità di affondo in Z (G1 Z ... F). Deve essere più bassa del feed.'],
  step_over: ['Step-over (0-1)', 0.05, (v) => v > 0 && v <= 1, 'Passo laterale della tasca come frazione del diametro (0.4 = 40%).'],
  bridge_height: ['Altezza ponticelli (mm)', 0.1, (v) => v >= 0, 'Materiale lasciato sotto i ponticelli disegnati (dal fondo del taglio). Usato solo se il disegno contiene ponticelli.'],
}
const fieldWarn = (k, v, tool) => (k === 'feed_rate' && v > MACHINE_LIMITS.feed ? `Oltre il massimo macchina (${MACHINE_LIMITS.feed} mm/min)`
  : k === 'spindle_rpm' && v > MACHINE_LIMITS.rpm ? `Oltre il massimo macchina (${MACHINE_LIMITS.rpm} RPM)`
    : k === 'z_depth' && tool?.max_depth && -v > Number(tool.max_depth) ? `Oltre la prof. max della fresa (${tool.max_depth} mm)`
      : k === 'z_pass_depth' && tool?.max_depth && v > Number(tool.max_depth) ? `Oltre la prof. max della fresa (${tool.max_depth} mm)` : null)

// Colonne del layer di lavorazione; gli altri parametri stanno in layer.params
const COLUMN_KEYS = new Set(['tool_diameter', 'tool_type', 'feed_rate', 'spindle_rpm', 'z_safe', 'z_depth', 'z_pass_depth', 'tool_id', 'operation'])
const OP_TIPS = {
  profile_outside: 'Fuori dalla linea: la fresa gira all\'esterno del contorno, il pezzo mantiene le dimensioni disegnate.',
  profile_inside: 'Dentro la linea: la fresa gira all\'interno del contorno, il foro mantiene le dimensioni disegnate.',
  profile_on: 'Sulla linea: il centro fresa segue esattamente la linea (incisioni, linee aperte).',
  pocket: 'Svuota tutta l\'area chiusa fino alla profondità finale.',
}
const OP_SHORT = { profile_outside: 'Fuori linea', profile_inside: 'Dentro linea', profile_on: 'Sulla linea', pocket: 'Tasca (pocket)' }
export const POCKET_DIRS = { horizontal: 'Righe orizzontali (zig-zag X)', vertical: 'Righe verticali (zig-zag Y)', contour: 'Contorno (offset concentrici)' }

// Tipo fresa delle Impostazioni (upcut_spiral, downcut_spiral, compression, straight, ball_nose, v_bit) → backend (flat|ball|vbit)
export const toolTypeOf = (t) => {
  const s = String(t?.type || '').toLowerCase()
  return /ball|sfer/.test(s) ? 'ball' : /v[-_ ]?bit|^v$|vbit/.test(s) ? 'vbit' : 'flat'
}
const eq = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-6

/** Parametri effettivi: layer di lavorazione (colonne + params) sovrascritti da drawLayer.cut (non Layer 0). */
export function effectiveCut(layer, drawLayer, settings) {
  const prm = layer?.params || {}
  const v = {
    tool_id: layer?.tool_id ?? null, operation: layer?.operation || 'profile_outside',
    tool_diameter: layer?.tool_diameter, tool_type: layer?.tool_type || 'flat', feed_rate: layer?.feed_rate,
    spindle_rpm: layer?.spindle_rpm, z_safe: layer?.z_safe, z_depth: layer?.z_depth, z_pass_depth: layer?.z_pass_depth,
    plunge_rate: prm.plunge_rate, step_over: prm.step_over, pocket_direction: prm.pocket_direction, bridge_height: prm.bridge_height,
  }
  if (drawLayer && drawLayer.id !== '0') for (const [k, x] of Object.entries(drawLayer.cut || {})) if (k in v && (x != null || k === 'tool_id')) v[k] = x
  v.plunge_rate ??= Math.round(Math.max(50, (Number(v.feed_rate) || 600) * 0.3))
  v.step_over ??= 0.4
  v.bridge_height ??= settings?.cutting?.bridge_height ?? 1.5
  v.pocket_direction ||= 'horizontal'
  return v
}

/** Fresa della libreria corrispondente: per id oppure per diametro + tipo (a parità, quella con feed/RPM uguali). */
export function matchTool(v, tools) {
  const byId = v.tool_id && tools.find((t) => t.id === v.tool_id)
  if (byId) return byId
  const c = tools.filter((t) => eq(t.diameter, v.tool_diameter) && toolTypeOf(t) === (v.tool_type || 'flat'))
  return c.find((t) => eq(t.feed_rate, v.feed_rate) && eq(t.spindle_rpm, v.spindle_rpm)) || (c.length === 1 ? c[0] : null)
}

/** Riepilogo di una riga: "Profilo esterno · Fresa 3mm · Ø3 · 2 mm". */
export function cutSummary(v, tools) {
  const t = matchTool(v, tools)
  return `${OPERATION_NAMES[v.operation] || v.operation} · ${t ? `${t.name} · ` : ''}Ø${v.tool_diameter} · ${Math.abs(Number(v.z_depth) || 0)} mm`
}

/**
 * Editor parametri. Ogni modifica valida viene salvata (debounce 400 ms) e il percorso rigenerato subito
 * dopo (Layers.generate) → 3D e simulazione esterni si aggiornano da soli. Richieste in serie, risposte
 * superate ignorate.
 * - drawLayer assente o Layer 0: salva sul layer di lavorazione (colonne + params).
 * - altro layer di disegno: `persist(changes)` (fornito dal CAD) salva in draw_layers[i].cut e ritorna il layer;
 *   `onLocal(changes)` aggiorna subito la UI.
 */
export default function LayerParams({ layer, drawLayer, material, onLayerUpdated, persist, onLocal }) {
  const tools = useStore((s) => s.tools)
  const setTools = useStore((s) => s.setTools)
  const materials = useStore((s) => s.materials)
  const settings = useStore((s) => s.settings)
  const notify = useStore((s) => s.notify)
  const [draft, setDraft] = useState({})
  const [regen, setRegen] = useState(null) // null | 'busy' | messaggio di errore
  const pending = useRef({})
  const timer = useRef(null)
  const latest = useRef(layer)
  latest.current = layer
  const queue = useRef(Promise.resolve()) // richieste in serie: mai PATCH/generate concorrenti
  const seq = useRef(0)
  const lastParams = useRef(null) // params dell'ultimo salvataggio (anche se la sua risposta UI è stata scartata)
  const isDraw = !!(drawLayer && drawLayer.id !== '0')
  const targetKey = `${layer.id}:${isDraw ? drawLayer.id : '0'}`

  // libreria sempre allineata alle Impostazioni (lo store viene aggiornato anche al salvataggio delle Impostazioni)
  useEffect(() => { Tools.list().then(setTools).catch(() => {}) }, [setTools])

  const flush = () => {
    clearTimeout(timer.current)
    const changes = pending.current
    pending.current = {}
    if (!Object.keys(changes).length) return queue.current
    const my = ++seq.current
    const id = latest.current.id
    const save = persist
    queue.current = queue.current.then(async () => {
      let saved
      try {
        if (save) saved = await save(changes)
        else {
          const body = {}, par = {}
          for (const [k, v] of Object.entries(changes)) (COLUMN_KEYS.has(k) ? body : par)[k] = v
          if (Object.keys(par).length) body.params = { ...(lastParams.current || latest.current.params || {}), ...par }
          saved = await Layers.patch(id, body)
          lastParams.current = saved.params
        }
      } catch (e) { notify(`Salvataggio parametri fallito: ${errMsg(e)}`, 'error'); return }
      if (my !== seq.current) return // è già in coda una modifica più recente: rigenera quella
      onLayerUpdated?.(saved)
      if (!saved.entity_count) return
      setRegen('busy')
      try {
        const r = await Layers.generate(id, {})
        lastParams.current = r.layer.params
        if (my !== seq.current) return // risposta superata da una modifica successiva: ignorata
        onLayerUpdated?.(r.layer); setRegen(null)
      } catch (e) { if (my === seq.current) setRegen(errMsg(e)) }
    })
    return queue.current
  }
  // cambio di layer/target o smontaggio: salva subito le modifiche in sospeso
  useEffect(() => { setDraft({}); return () => { flush() } }, [targetKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = (changes, now = false) => {
    pending.current = { ...pending.current, ...changes }
    clearTimeout(timer.current)
    if (now) flush(); else timer.current = setTimeout(flush, 400)
  }
  const local = (ch) => {
    if (onLocal) { onLocal(ch); return }
    const col = Object.fromEntries(Object.entries(ch).filter(([k]) => COLUMN_KEYS.has(k)))
    const par = Object.fromEntries(Object.entries(ch).filter(([k]) => !COLUMN_KEYS.has(k)))
    onLayerUpdated?.({ ...layer, ...col, params: { ...(layer.params || {}), ...par } })
  }

  const values = effectiveCut(layer, drawLayer, settings)
  const tool = matchTool(values, tools)
  const onNum = (k, raw) => {
    setDraft((d) => ({ ...d, [k]: raw }))
    const v = Number(raw)
    if (raw === '' || !Number.isFinite(v) || !CUT_FIELDS[k][2](v)) return
    // diametro cambiato a mano → non corrisponde più alla fresa della libreria
    save(k === 'tool_diameter' && values.tool_id && !eq(v, tool?.diameter) ? { [k]: v, tool_id: null } : { [k]: v })
  }
  const choose = (k, v) => { local({ [k]: v }); save(k === 'tool_type' && tool && v !== toolTypeOf(tool) ? { [k]: v, tool_id: null } : { [k]: v }, true) }
  const applyTool = (id) => {
    const t = tools.find((x) => x.id === id)
    if (!t) { choose('tool_id', null); return }
    const mat = materials?.[material] || {}
    // tra materiale e utensile vale il valore più prudente
    const pick = (k) => { const c = [mat[k], t[k]].filter((v) => v != null).map(Number).filter(Number.isFinite); return c.length ? Math.min(...c) : undefined }
    const ch = { tool_id: t.id, tool_diameter: Number(t.diameter), tool_type: toolTypeOf(t) }
    for (const [k, v] of [['feed_rate', pick('feed_rate')], ['plunge_rate', pick('plunge_rate')], ['step_over', t.step_over ?? mat.step_over],
      ['spindle_rpm', t.spindle_rpm ?? mat.spindle_rpm]]) if (v != null && Number.isFinite(Number(v))) ch[k] = k === 'spindle_rpm' ? Math.round(v) : Number(v)
    // la passata non può superare la lunghezza utile della fresa
    if (t.max_depth && Number(values.z_pass_depth) > Number(t.max_depth)) ch.z_pass_depth = Number(t.max_depth)
    setDraft({})
    local(ch)
    save(ch, true)
    notify(`Fresa «${t.name}» applicata: diametro, tipo, feed, plunge, RPM e step-over aggiornati`, 'success')
  }

  const num = (k) => {
    const [label, step, valid, tip] = CUT_FIELDS[k]
    const raw = draft[k] ?? String(values[k] ?? '')
    const v = Number(raw)
    const invalid = raw === '' || !Number.isFinite(v) || !valid(v)
    const warn = !invalid && fieldWarn(k, v, tool)
    return (
      <label key={k} className="block">
        <Tooltip text={tip}><span className="mb-0.5 block cursor-help text-[10px] text-gray-500">{label}</span></Tooltip>
        <input type="number" step={step} value={raw} data-testid={`lp-${k}`} onClick={(e) => e.stopPropagation()} onChange={(e) => onNum(k, e.target.value)} onBlur={flush}
          className={`input py-1 text-xs ${invalid || warn ? 'border-red-500 text-red-400' : ''}`} />
        {warn && <span className="mt-0.5 block text-[10px] leading-tight text-red-400">⚠ {warn}</span>}
        {invalid && <span className="mt-0.5 block text-[10px] leading-tight text-red-400">Valore non valido{k === 'z_depth' ? ' (deve essere negativo)' : ''}</span>}
      </label>
    )
  }
  const lbl = (text, tip) => <Tooltip text={tip}><span className="mb-0.5 block cursor-help text-[10px] text-gray-500">{text}</span></Tooltip>
  const pocket = values.operation === 'pocket'
  const passes = Math.max(1, Math.ceil(Math.abs(Number(values.z_depth) || 0) / (Number(values.z_pass_depth) || 1) - 1e-9))
  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()} data-testid="layer-params">
      <label className="block">
        {lbl('Fresa (Impostazioni > Utensili)', 'Frese della libreria in Impostazioni > Utensili: applica diametro, tipo, feed, plunge, RPM e step-over. I valori restano modificabili a mano per questo layer, senza modificare la libreria.')}
        <select className="input py-1 text-xs" data-testid="lp-tool" value={tool?.id || ''} onChange={(e) => applyTool(e.target.value)}>
          <option value="">— Personalizzata —</option>
          {tools.map((t) => <option key={t.id} value={t.id}>{t.name} (Ø{t.diameter})</option>)}
        </select>
        {!tools.length && <span className="mt-0.5 block text-[10px] text-gray-500">Libreria vuota: aggiungi le frese in Impostazioni &gt; Utensili.</span>}
      </label>
      <div>
        {lbl('Strategia', OP_TIPS[values.operation])}
        <div className="grid grid-cols-2 gap-1">
          {Object.keys(OPERATION_NAMES).map((k) => (
            <Tooltip key={k} text={OP_TIPS[k]}>
              <button onClick={() => choose('operation', k)}
                className={`w-full rounded border px-1.5 py-1 text-[11px] transition ${values.operation === k ? 'border-accent bg-accent/10 text-white' : 'border-line text-gray-400 hover:border-gray-500'}`}>
                {OP_SHORT[k] || OPERATION_NAMES[k]}
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
          <select className="input py-1 text-xs" value={values.tool_type || 'flat'} onChange={(e) => choose('tool_type', e.target.value)}>
            {Object.entries(TOOL_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        {num('feed_rate')}
        {num('plunge_rate')}
        {num('spindle_rpm')}
        {num('z_safe')}
        {num('z_depth')}
        {num('z_pass_depth')}
        {num('bridge_height')}
      </div>
      <p className="text-[10px] text-gray-500">{OPERATION_NAMES[values.operation] || values.operation}{pocket ? ` (${POCKET_DIRS[values.pocket_direction]})` : ''} · {passes} passat{passes === 1 ? 'a' : 'e'} fino a Z{values.z_depth}</p>
      {regen && <p className={`text-[10px] ${regen === 'busy' ? 'text-sky-400' : 'text-red-400'}`}>{regen === 'busy' ? 'Aggiornamento percorso...' : `⚠ Percorso non aggiornato: ${regen}`}</p>}
    </div>
  )
}
