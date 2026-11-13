import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Cog, Copy, Play, Redo2, Trash2, Undo2, Repeat } from 'lucide-react'
import CADCanvas from './CADCanvas'
import Toolbar from './Toolbar'
import Modal from '../common/Modal'
import Button from '../common/Button'
import Tooltip from '../common/Tooltip'
import { TOOL_TIPS } from '../settings/ToolBox'
import { errMsg, Layers } from '../../services/api'
import { OPERATION_NAMES, useStore } from '../../store/store'
import { translate, uid } from './geometry'

const FIELD_LABELS = { x1: 'X1', y1: 'Y1', x2: 'X2', y2: 'Y2', x: 'X', y: 'Y', w: 'Larghezza', h: 'Altezza', cx: 'Centro X', cy: 'Centro Y', r: 'Raggio', start: 'Angolo inizio°', end: 'Angolo fine°' }
const TYPE_NAMES = { line: 'Linea', rect: 'Rettangolo', circle: 'Cerchio', arc: 'Arco', bridge: 'Ponticello', dimension: 'Quota', construction: 'Costruzione' }

export default function CADView({ project, layer, onClose, onLayerUpdated, onStartCutting }) {
  const { settings, tools, materials, notify } = useStore()
  const [entities, setEntities] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [tool, setTool] = useState('line')
  const [options, setOptions] = useState({ filletRadius: 3, bridgeWidth: settings?.cutting?.bridge_width || 4 })
  const [saveState, setSaveState] = useState('saved')
  const [ctx, setCtx] = useState(null)
  const [genOpen, setGenOpen] = useState(false)
  const hist = useRef({ past: [], future: [] })
  const saveTimer = useRef(null)
  const latest = useRef([])

  useEffect(() => {
    Layers.entities(layer.id).then((list) => {
      const ents = list.map(({ id, type, data, is_construction }) => ({ id, type, data, is_construction }))
      setEntities(ents); latest.current = ents; setLoaded(true)
    }).catch((e) => notify(errMsg(e), 'error'))
  }, [layer.id])

  const save = useCallback(async () => {
    clearTimeout(saveTimer.current)
    setSaveState('saving')
    try {
      await Layers.saveEntities(layer.id, latest.current)
      setSaveState('saved')
    } catch (e) { setSaveState('error'); notify(`Salvataggio fallito: ${errMsg(e)}`, 'error') }
  }, [layer.id])

  useEffect(() => () => { if (saveTimer.current) { clearTimeout(saveTimer.current); Layers.saveEntities(layer.id, latest.current).catch(() => {}) } }, [layer.id])

  const commit = useCallback((next) => {
    hist.current.past.push(latest.current)
    if (hist.current.past.length > 200) hist.current.past.shift()
    hist.current.future = []
    latest.current = next
    setEntities(next)
    setSaveState('dirty')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 700)
  }, [save])

  const undo = useCallback(() => {
    const prev = hist.current.past.pop()
    if (!prev) return
    hist.current.future.push(latest.current)
    latest.current = prev; setEntities(prev); setSelected(new Set())
    clearTimeout(saveTimer.current); saveTimer.current = setTimeout(save, 700)
  }, [save])
  const redo = useCallback(() => {
    const nxt = hist.current.future.pop()
    if (!nxt) return
    hist.current.past.push(latest.current)
    latest.current = nxt; setEntities(nxt)
    clearTimeout(saveTimer.current); saveTimer.current = setTimeout(save, 700)
  }, [save])

  const del = useCallback(() => {
    if (!selected.size) return
    commit(latest.current.filter((e) => !selected.has(e.id))); setSelected(new Set())
  }, [selected, commit])

  const duplicate = useCallback(() => {
    if (!selected.size) return
    const off = Math.max(5, (settings?.ui?.grid_size || 1) * 10)
    const copies = latest.current.filter((e) => selected.has(e.id)).map((e) => ({ ...translate(e, off, -off), id: uid() }))
    commit([...latest.current, ...copies]); setSelected(new Set(copies.map((c) => c.id)))
  }, [selected, commit, settings])

  const toggleConstruction = () => {
    commit(latest.current.map((e) => (selected.has(e.id) && e.type !== 'bridge' && e.type !== 'dimension' ? { ...e, is_construction: !e.is_construction } : e)))
  }

  const selEntity = selected.size === 1 ? entities.find((e) => selected.has(e.id)) : null
  const updateSel = (k, val) => commit(latest.current.map((e) => (e.id === selEntity.id ? { ...e, data: { ...e.data, [k]: val } } : e)))
  const cutEntities = entities.filter((e) => !e.is_construction && !['dimension', 'bridge'].includes(e.type))
  const maxToolDia = useMemo(() => Math.max(3, ...tools.map((t) => Number(t.diameter) || 0)), [tools])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-bg-panel px-3">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={async () => { await save(); onClose() }}>Vista 3D</Button>
        <div className="mx-2 h-5 w-px bg-line" />
        <span className="text-sm text-gray-400">Layer:</span>
        <span className="text-sm font-semibold text-white">{layer.name}</span>
        <span className={`ml-2 text-xs ${saveState === 'saved' ? 'text-gray-500' : saveState === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
          {saveState === 'saved' ? '✓ salvato' : saveState === 'saving' ? 'salvataggio…' : saveState === 'error' ? 'errore salvataggio' : 'modifiche…'}
        </span>
        <div className="mx-2 h-5 w-px bg-line" />
        <Button size="xs" variant="ghost" icon={Undo2} onClick={undo} title="Annulla (Ctrl+Z)" />
        <Button size="xs" variant="ghost" icon={Redo2} onClick={redo} title="Ripeti (Ctrl+Y)" />
        <div className="mx-2 h-5 w-px bg-line" />
        <label className="flex items-center gap-1.5 text-xs text-gray-400">Raggio raccordo
          <input type="number" min="0.1" step="0.5" className="input w-16 py-1" value={options.filletRadius} onChange={(e) => setOptions({ ...options, filletRadius: Number(e.target.value) || 0.1 })} /> mm
        </label>
        <label className="ml-3 flex items-center gap-1.5 text-xs text-gray-400">Largh. ponticello
          <input type="number" min="0.5" step="0.5" className="input w-16 py-1" value={options.bridgeWidth} onChange={(e) => setOptions({ ...options, bridgeWidth: Number(e.target.value) || 1 })} /> mm
        </label>
        <div className="ml-auto flex items-center gap-2">
          {layer.gcode && <Button size="sm" variant="outline" icon={Play} onClick={async () => { await save(); onStartCutting() }}>Taglia</Button>}
          <Button size="sm" variant="primary" icon={Cog} disabled={!cutEntities.length} onClick={async () => { await save(); setGenOpen(true) }}>Genera Percorso</Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <Toolbar tool={tool} setTool={setTool} onCopy={duplicate} canCopy={selected.size > 0} />
        <div className="relative min-w-0 flex-1">
          {loaded && (
            <CADCanvas entities={entities} onChange={commit} selected={selected} setSelected={setSelected} tool={tool} setTool={setTool}
              stock={{ x: project.stock_x, y: project.stock_y }} ui={settings?.ui} options={options} notify={notify}
              onContextMenu={(e, pos) => setCtx({ entity: e, ...pos })} onUndo={undo} onRedo={redo} onDelete={del} onDuplicate={duplicate} maxToolDia={maxToolDia} />
          )}
        </div>
        <aside className="w-60 shrink-0 overflow-y-auto border-l border-line bg-bg-panel p-3 text-sm">
          {selEntity ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{TYPE_NAMES[selEntity.type] || selEntity.type}</span>
                {selEntity.is_construction && selEntity.type !== 'dimension' && <span className="rounded bg-gray-700 px-1.5 text-[10px] text-gray-300">costruzione</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.keys(selEntity.data).map((k) => (
                  <div key={k}>
                    <span className="label">{FIELD_LABELS[k] || k}</span>
                    <input type="number" step="0.1" className="input py-1" value={selEntity.data[k]}
                      onChange={(e) => e.target.value !== '' && updateSel(k, Number(e.target.value))} />
                  </div>
                ))}
              </div>
              {selEntity.type === 'line' && (
                <div className="text-xs text-gray-400">Lunghezza: <b className="text-gray-200">{Math.hypot(selEntity.data.x2 - selEntity.data.x1, selEntity.data.y2 - selEntity.data.y1).toFixed(3)} mm</b></div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {!['bridge', 'dimension'].includes(selEntity.type) && <Button size="xs" icon={Repeat} onClick={toggleConstruction}>{selEntity.is_construction ? 'Normale' : 'Costruzione'}</Button>}
                <Button size="xs" icon={Copy} onClick={duplicate}>Duplica</Button>
                <Button size="xs" icon={Trash2} className="text-red-400" onClick={del}>Elimina</Button>
              </div>
            </div>
          ) : selected.size > 1 ? (
            <div className="space-y-3">
              <div className="font-semibold text-white">{selected.size} entità selezionate</div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" icon={Repeat} onClick={toggleConstruction}>Costruzione ⇄</Button>
                <Button size="xs" icon={Copy} onClick={duplicate}>Duplica</Button>
                <Button size="xs" icon={Trash2} className="text-red-400" onClick={del}>Elimina</Button>
              </div>
              <p className="text-xs text-gray-500">Usa lo strumento Specchio (M) per specchiare la selezione.</p>
            </div>
          ) : (
            <div className="space-y-3 text-xs text-gray-400">
              <div className="text-sm font-semibold text-white">Proprietà</div>
              <p>Seleziona un'entità per modificarne i parametri.</p>
              <div className="rounded-md border border-line bg-bg p-2 leading-relaxed">
                <div>Entità: <b className="text-gray-200">{entities.length}</b></div>
                <div>Da tagliare: <b className="text-gray-200">{cutEntities.length}</b></div>
                <div>Ponticelli: <b className="text-gray-200">{entities.filter((e) => e.type === 'bridge').length}</b></div>
              </div>
              <p className="leading-relaxed">Origine (0,0) = centro dello stock. Il bordo verde tratteggiato è il pezzo grezzo ({project.stock_x}×{project.stock_y} mm).</p>
              <p className="leading-relaxed"><span className="kbd">Alt</span> disattiva lo snap · <span className="kbd">Shift</span> orto · <span className="kbd">Ctrl+Z</span> annulla · <span className="kbd">Canc</span> elimina</p>
              {layer.gcode && <p className="flex items-center gap-1 text-accent"><Check size={13} /> G-code presente ({OPERATION_NAMES[layer.operation]})</p>}
            </div>
          )}
        </aside>
      </div>

      {ctx && (
        <div className="fixed inset-0 z-50" onMouseDown={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null) }}>
          <div className="animate-fade absolute w-48 rounded-md border border-line bg-bg-card py-1 text-sm shadow-xl" style={{ left: ctx.x, top: ctx.y }} onMouseDown={(e) => e.stopPropagation()}>
            {[
              ['Elimina', () => del()],
              ['Duplica', () => duplicate()],
              ...(!['bridge', 'dimension'].includes(ctx.entity.type) ? [[ctx.entity.is_construction ? 'Converti in normale' : 'Converti in costruzione', toggleConstruction]] : []),
            ].map(([l, fn]) => (
              <button key={l} className="block w-full px-3 py-1.5 text-left text-gray-200 hover:bg-bg-hover" onClick={() => { fn(); setCtx(null) }}>{l}</button>
            ))}
          </div>
        </div>
      )}

      <GenerateModal open={genOpen} onClose={() => setGenOpen(false)} project={project} layer={layer} tools={tools} materials={materials}
        settings={settings} hasBridges={entities.some((e) => e.type === 'bridge')}
        onDone={(l) => onLayerUpdated(l)} onStartCutting={() => { setGenOpen(false); onStartCutting() }} />
    </div>
  )
}

function GenerateModal({ open, onClose, project, layer, tools, materials, settings, hasBridges, onDone, onStartCutting }) {
  const notify = useStore((s) => s.notify)
  const mat = materials[project.material] || {}
  const prev = layer.params || {}
  const [f, setF] = useState({})
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  const defaultsFor = (toolId) => {
    const t = tools.find((x) => x.id === toolId) || {}
    const pick = (k) => { const c = [mat[k], t[k]].filter((v) => v != null).map(Number); return c.length ? Math.min(...c) : undefined }
    return {
      feed_rate: pick('feed_rate'), plunge_rate: pick('plunge_rate'), spindle_rpm: t.spindle_rpm || mat.spindle_rpm,
      step_over: pick('step_over'), depth_per_pass: mat.depth_per_pass || 1,
    }
  }

  useEffect(() => {
    if (!open) return
    const toolId = layer.tool_id || prev.tool_id || tools[0]?.id
    setResult(null)
    setF({
      operation: layer.operation || 'profile_outside', tool_id: toolId, depth_total: prev.depth_total || Math.min(3, project.stock_z),
      pocket_direction: prev.pocket_direction || 'horizontal', safe_height: settings?.cutting?.safe_height ?? 5,
      bridge_height: settings?.cutting?.bridge_height ?? 1.5, ...defaultsFor(toolId),
      ...(prev.tool_id === toolId ? { feed_rate: prev.feed_rate, plunge_rate: prev.plunge_rate, spindle_rpm: prev.spindle_rpm, step_over: prev.step_over, depth_per_pass: prev.depth_per_pass } : {}),
    })
  }, [open])

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
  const setTool = (id) => setF((p) => ({ ...p, tool_id: id, ...defaultsFor(id) }))
  const tool = tools.find((t) => t.id === f.tool_id)

  const generate = async () => {
    setBusy(true)
    try {
      const body = { ...f }
      for (const k of ['depth_total', 'depth_per_pass', 'feed_rate', 'plunge_rate', 'spindle_rpm', 'step_over', 'safe_height', 'bridge_height']) body[k] = Number(body[k])
      const r = await Layers.generate(layer.id, body)
      setResult(r)
      onDone(r.layer)
      notify('G-code generato', 'success')
    } catch (e) { notify(errMsg(e), 'error') } finally { setBusy(false) }
  }

  const num = (k, label, step = 0.1, tip) => (
    <div>
      <Tooltip text={tip}><span className={`label ${tip ? 'cursor-help' : ''}`}>{label}</span></Tooltip>
      <input type="number" step={step} className="input" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title="Genera percorso utensile" width="max-w-2xl"
      footer={<>
        <Button onClick={onClose}>Chiudi</Button>
        {result && <Button variant="outline" icon={Play} onClick={onStartCutting}>Vai al taglio</Button>}
        <Button variant="primary" icon={Cog} disabled={busy || !f.tool_id} onClick={generate}>{busy ? 'Generazione…' : 'Genera G-code'}</Button>
      </>}>
      <div className="space-y-4">
        <div>
          <span className="label">Operazione</span>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(OPERATION_NAMES).map(([k, l]) => (
              <button key={k} onClick={() => set('operation', k)}
                className={`rounded-md border px-2 py-2 text-xs transition ${f.operation === k ? 'border-accent bg-accent/10 text-white' : 'border-line text-gray-400 hover:border-gray-500'}`}>{l}</button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            {{ profile_outside: 'La fresa gira all\'esterno del contorno: il pezzo mantiene le dimensioni disegnate.', profile_inside: 'La fresa gira all\'interno del contorno: il foro mantiene le dimensioni disegnate.', profile_on: 'Il centro fresa segue esattamente la linea (incisioni, linee aperte).', pocket: 'Svuota tutta l\'area chiusa fino alla profondità indicata.' }[f.operation]}
          </p>
        </div>
        {f.operation === 'pocket' && (
          <div>
            <span className="label">Direzione riempimento</span>
            <select className="input" value={f.pocket_direction} onChange={(e) => set('pocket_direction', e.target.value)}>
              <option value="horizontal">Orizzontale (zig-zag X)</option>
              <option value="vertical">Verticale (zig-zag Y)</option>
              <option value="contour">Contorno (offset concentrici)</option>
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="label">Utensile</span>
            <select className="input" value={f.tool_id || ''} onChange={(e) => setTool(e.target.value)}>
              {tools.map((t) => <option key={t.id} value={t.id}>{t.name} (Ø{t.diameter})</option>)}
            </select>
          </div>
          {num('depth_total', `Profondità totale (mm) · stock ${project.stock_z}`, 0.1, 'Profondità finale del taglio dalla superficie (Z0). Per tagliare passante usa lo spessore stock + 0.2 mm (con piano sacrificale).')}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {num('feed_rate', 'Feed (mm/min)', 10, TOOL_TIPS.feed_rate)}
          {num('plunge_rate', 'Plunge (mm/min)', 10, TOOL_TIPS.plunge_rate)}
          {num('spindle_rpm', 'RPM', 500, TOOL_TIPS.spindle_rpm)}
          {num('depth_per_pass', 'Prof. passata (mm)', 0.1, 'Profondità asportata per ogni passata in Z.')}
          {num('step_over', 'Step-over (0-1)', 0.05, TOOL_TIPS.step_over)}
          {num('safe_height', 'Altezza sicurezza', 0.5, 'Quota Z per i movimenti rapidi.')}
          {hasBridges && f.operation !== 'pocket' && num('bridge_height', 'Altezza ponticelli', 0.1, 'Materiale lasciato sotto i ponticelli (dal fondo del taglio).')}
        </div>
        <p className="text-xs text-gray-500">Parametri pre-caricati dal materiale <b className="text-gray-300">{mat.name}</b> e dall'utensile <b className="text-gray-300">{tool?.name}</b> (valore più conservativo).</p>
        {result && (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat k="Linee" v={result.line_count} />
              <Stat k="Taglio" v={`${result.cut_length_mm} mm`} />
              <Stat k="Percorso tot." v={`${result.path_length_mm} mm`} />
              <Stat k="Tempo stimato" v={`${result.estimated_time_min} min`} />
            </div>
            {result.warnings.map((w) => <div key={w} className="mt-2 text-xs text-yellow-300">⚠ {w}</div>)}
          </div>
        )}
      </div>
    </Modal>
  )
}

const Stat = ({ k, v }) => (<div><div className="text-[10px] uppercase text-gray-400">{k}</div><div className="font-mono font-semibold text-white">{v}</div></div>)
