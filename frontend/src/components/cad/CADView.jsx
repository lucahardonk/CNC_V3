import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Scissors, FileUp, Layers as LayersIcon, Play, Plus, Redo2, Ruler, Trash2, Undo2, Repeat } from 'lucide-react'
import CADCanvas from './CADCanvas'
import Toolbar from './Toolbar'
import Modal from '../common/Modal'
import Button from '../common/Button'
import Tooltip from '../common/Tooltip'
import { Dxf, errMsg, Layers } from '../../services/api'
import { OPERATION_NAMES, useStore } from '../../store/store'
import { arcSweep, catmullRomPoints, isDim, rad, layerColor, lineConstrained, syncDims, translate, uid } from './geometry'
import DrawLayerPanel, { NewLayerModal } from './DrawLayerPanel'
import LayerParams, { effectiveCut } from './LayerParams'
import DxfImportModal from './DxfImportModal'
import TextTool from './TextTool'
import SvgImportTool from './SvgImportTool'
import PlacementOverlay from './PlacementOverlay'
import { entitiesBBox } from './vectorize'
import { DEFAULT_LAYER_COLOR, DEFAULT_LAYER_ID, layerOf, newLayerId, normalizeDrawLayers } from './drawLayers'
import { acceptGeometry, fillDimValues, isConstraint, packEnt, pruneRefs, refilletArc, solveCommit, unpackEnt } from './constraints'

const FIELD_LABELS = { x1: 'X1', y1: 'Y1', x2: 'X2', y2: 'Y2', x: 'X', y: 'Y', w: 'Larghezza', h: 'Altezza', cx: 'Centro X', cy: 'Centro Y', r: 'Raggio', start: 'Angolo inizio°', end: 'Angolo fine°', rx: 'Semiasse X', ry: 'Semiasse Y', rotation: 'Rotazione°', length: 'Interasse', width: 'Larghezza', angle: 'Angolo°', off: 'Offset', a1: 'Angolo 1°', a2: 'Angolo 2°' }
const CTX_FIELDS = { fillet: ['filletRadius', 'R:'], slot_center: ['slotWidth', 'Larghezza asola:'], arc_start_end_radius: ['arcRadius', 'Raggio arco:'] }
const TYPE_NAMES = { line: 'Linea', rect: 'Rettangolo', circle: 'Cerchio', arc: 'Arco', bridge: 'Ponticello', dimension: 'Quota', dim_radial: 'Quota radiale', dim_angle: 'Quota angolare', ellipse: 'Ellisse', slot: 'Asola', spline: 'Spline', construction: 'Costruzione', constraint: 'Vincolo di coincidenza', point: 'Punto' }

export default function CADView({ project, layer, layers = [], initialDrawLayer, onClose, onLayerUpdated, onStartCutting }) {
  const { settings, tools, notify } = useStore()
  const [entities, setEntities] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [tool, setTool] = useState('line')
  const [options, setOptions] = useState({ filletRadius: 3, slotWidth: 5, arcRadius: 10, bridgeWidth: settings?.cutting?.bridge_width || 4 })
  const [saveState, setSaveState] = useState('saved')
  const [ctx, setCtx] = useState(null)
  const [parallelFor, setParallelFor] = useState(null) // id della linea da rendere parallela
  const hist = useRef({ past: [], future: [] })
  const saveTimer = useRef(null)
  const latest = useRef([])
  // ---- layer di disegno
  const [drawLayers, setDrawLayers] = useState(() => normalizeDrawLayers(layer.draw_layers))
  const [activeDL, setActiveDL] = useState(initialDrawLayer || DEFAULT_LAYER_ID)
  const activeDLRef = useRef(DEFAULT_LAYER_ID)
  activeDLRef.current = drawLayers.some((l) => l.id === activeDL) ? activeDL : DEFAULT_LAYER_ID
  const dlTimer = useRef(null)
  const [newLayerFor, setNewLayerFor] = useState(false) // dialog "nuovo layer" dal menu contestuale
  const [assignOpen, setAssignOpen] = useState(false) // dialog "Sposta a layer…"
  const [canvasMeasure, setCanvasMeasure] = useState(null) // misura attiva nel canvas (strumento distanza)
  // ---- import DXF
  const fileRef = useRef(null)
  const [dxfData, setDxfData] = useState(null)
  const [dxfBusy, setDxfBusy] = useState(false)
  const [fitRequest, setFitRequest] = useState(null)
  // ---- testo / SVG da incidere: pannello attivo e anteprima posizionabile nel canvas
  const [vectorTool, setVectorTool] = useState(null) // 'text' | 'svg' | null
  const [placement, setPlacement] = useState(null)

  useEffect(() => {
    Layers.entities(layer.id).then((list) => {
      const ents = list.map(unpackEnt)
      setEntities(ents); latest.current = ents; setLoaded(true)
    }).catch((e) => notify(errMsg(e), 'error'))
  }, [layer.id])

  const [otherLayerEntities, setOther] = useState([])
  const layerKey = layers.map((l) => `${l.id}:${l.entity_count}`).join('|')
  useEffect(() => {
    let alive = true
    const others = layers.map((l, i) => ({ l, color: layerColor(i) })).filter(({ l }) => l.id !== layer.id)
    Promise.all(others.map(({ l, color }) => Layers.entities(l.id)
      .then((list) => ({ layerName: l.name, color, entities: list.filter((e) => !e.is_construction).map(({ id, type, data }) => ({ id, type, data })) }))
      .catch(() => null)))
      .then((res) => { if (alive) setOther(res.filter(Boolean)) })
    return () => { alive = false }
  }, [layer.id, layerKey])

  const save = useCallback(async () => {
    clearTimeout(saveTimer.current)
    setSaveState('saving')
    try {
      await Layers.saveEntities(layer.id, latest.current.map(packEnt))
      setSaveState('saved')
    } catch (e) { setSaveState('error'); notify(`Salvataggio fallito: ${errMsg(e)}`, 'error') }
  }, [layer.id])

  useEffect(() => () => { if (saveTimer.current) { clearTimeout(saveTimer.current); Layers.saveEntities(layer.id, latest.current.map(packEnt)).catch(() => {}) } }, [layer.id])

  // opts.fixed: entità/punti toccati dall'utente → il solver muove il resto per rispettare vincoli e quote guida.
  // Senza opts.fixed (disegno, taglio, raccordo…) la geometria disegnata vince e i vincoli rotti vengono rimossi.
  const commit = useCallback((raw, opts = {}) => {
    // le nuove entità senza layer di disegno finiscono sul layer corrente
    const cur = activeDLRef.current
    if (cur !== DEFAULT_LAYER_ID) {
      const prev = new Set(latest.current.map((e) => e.id))
      raw = raw.map((e) => (!prev.has(e.id) && !e.dlayer && !isConstraint(e) ? { ...e, dlayer: cur } : e))
    }
    let next = pruneRefs(syncDims(raw))
    if (opts.fixed) {
      const r = solveCommit(fillDimValues(next), opts.fixed, opts)
      if (r.rejected) return notify('Quota incompatibile con i vincoli esistenti: modifica annullata (elimina un vincolo o una quota)', 'error')
      next = syncDims(r.list)
      if (r.err > 1e-3) notify('Vincoli/quote incompatibili: geometria non risolta del tutto', 'error')
    } else next = acceptGeometry(next)
    hist.current.past.push(latest.current)
    if (hist.current.past.length > 200) hist.current.past.shift()
    hist.current.future = []
    latest.current = next
    setEntities(next)
    setSaveState('dirty')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 700)
  }, [save, notify])

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
    const copies = latest.current.filter((e) => selected.has(e.id) && !isConstraint(e)).map((e) => ({ ...translate(e, off, -off), id: uid() }))
    commit([...latest.current, ...copies]); setSelected(new Set(copies.map((c) => c.id)))
  }, [selected, commit, settings])

  const toggleConstruction = () => {
    commit(latest.current.map((e) => (selected.has(e.id) && e.type !== 'bridge' && !isDim(e) && !isConstraint(e) ? { ...e, is_construction: !e.is_construction } : e)))
  }

  // ---------------------------------------------------------------- layer di disegno
  const saveDrawLayers = useCallback((list) => {
    clearTimeout(dlTimer.current)
    dlTimer.current = setTimeout(async () => {
      try { onLayerUpdated(await Layers.update(layer.id, { draw_layers: list })) } catch (e) { notify(`Salvataggio layer fallito: ${errMsg(e)}`, 'error') }
    }, 400)
  }, [layer.id, onLayerUpdated, notify])
  const updateDrawLayers = (fn) => setDrawLayers((ls) => { const next = normalizeDrawLayers(fn(ls)); saveDrawLayers(next); return next })
  // parametri di taglio per layer di disegno (draw_layers[i].cut): salvati subito con la lista completa
  const drawLayersRef = useRef(drawLayers)
  drawLayersRef.current = drawLayers
  const withCut = (ls, id, ch) => ls.map((x) => (x.id === id ? { ...x, cut: { ...(x.cut || {}), ...ch } } : x))
  const [paramsOpen, setParamsOpen] = useState(true)
  const activeDrawLayer = drawLayers.find((l) => l.id === activeDLRef.current) || drawLayers[0]
  const cutProps = activeDrawLayer.id === DEFAULT_LAYER_ID ? {} : {
    persist: (ch) => {
      clearTimeout(dlTimer.current) // la lista inviata qui contiene già le altre modifiche in sospeso
      const next = withCut(drawLayersRef.current, activeDrawLayer.id, ch)
      drawLayersRef.current = next
      setDrawLayers(next)
      return Layers.update(layer.id, { draw_layers: next })
    },
    onLocal: (ch) => setDrawLayers((ls) => withCut(ls, activeDrawLayer.id, ch)),
  }
  const toolpathPreview = useMemo(() => ({
    diameter: Number(layer.tool_diameter) || 0, operation: layer.operation,
    byLayer: Object.fromEntries(drawLayers.map((d) => { const c = effectiveCut(layer, d, settings); return [d.id, { diameter: Number(c.tool_diameter) || 0, operation: c.operation }] })),
  }), [layer, drawLayers, settings])
  const dlCounts = useMemo(() => {
    const c = {}
    for (const e of entities) if (!isConstraint(e)) c[layerOf(e)] = (c[layerOf(e)] || 0) + 1
    return c
  }, [entities])
  const dropFromSelection = (layerId) => setSelected((sel) => new Set([...sel].filter((id) => layerOf(latest.current.find((e) => e.id === id)) !== layerId)))
  const toggleVisible = (id) => {
    const l = drawLayers.find((x) => x.id === id)
    if (l?.visible) dropFromSelection(id)
    updateDrawLayers((ls) => ls.map((x) => (x.id === id ? { ...x, visible: !x.visible } : x)))
  }
  const toggleLock = (id) => {
    const l = drawLayers.find((x) => x.id === id)
    if (l && !l.locked) dropFromSelection(id)
    updateDrawLayers((ls) => ls.map((x) => (x.id === id ? { ...x, locked: !x.locked } : x)))
  }
  const addDrawLayer = (name, color) => {
    const id = newLayerId()
    updateDrawLayers((ls) => [...ls, { id, name, color, visible: true, locked: false }])
    setActiveDL(id)
    return id
  }
  const deleteDrawLayer = (id) => {
    if (id === DEFAULT_LAYER_ID) return
    if (latest.current.some((e) => e.dlayer === id)) commit(latest.current.map((e) => (e.dlayer === id ? { ...e, dlayer: undefined } : e)))
    updateDrawLayers((ls) => ls.filter((x) => x.id !== id))
    setActiveDL(DEFAULT_LAYER_ID)
  }
  const assignSelection = (id, name) => {
    const ids = [...selected].filter((sid) => !isConstraint(latest.current.find((e) => e.id === sid)))
    if (!ids.length) return notify('Seleziona prima le entità nel canvas')
    const set = new Set(ids)
    commit(latest.current.map((e) => (set.has(e.id) ? { ...e, dlayer: id === DEFAULT_LAYER_ID ? undefined : id } : e)))
    const target = drawLayers.find((l) => l.id === id)
    if (target && (!target.visible || target.locked)) setSelected(new Set())
    notify(`${ids.length} entità spostate su "${name || target?.name || id}"${target && !target.visible ? ' (layer nascosto)' : ''}`, 'success')
  }

  // ---------------------------------------------------------------- import DXF
  const onDxfFile = async (file) => {
    if (!file) return
    setDxfBusy(true)
    try {
      const data = await Dxf.parse(file)
      if (!data.entities.length) notify('Nessuna geometria supportata nel file DXF', 'error')
      else setDxfData(data)
    } catch (e) { notify(`Import DXF fallito: ${errMsg(e)}`, 'error') } finally { setDxfBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const confirmDxf = ({ entities: ents, layers: dxfLayers, asConstruction }) => {
    // i layer del DXF diventano layer di disegno (riusati se esiste già un layer con lo stesso nome)
    let list = [...drawLayers]
    const idOf = {}
    for (const dl of dxfLayers) {
      if (dl.name === '0') { idOf[dl.name] = DEFAULT_LAYER_ID; continue }
      const ex = list.find((l) => l.name.toLowerCase() === dl.name.toLowerCase())
      if (ex) { idOf[dl.name] = ex.id; continue }
      const id = newLayerId()
      list.push({ id, name: dl.name, color: dl.color || DEFAULT_LAYER_COLOR, visible: true, locked: false })
      idOf[dl.name] = id
    }
    list = normalizeDrawLayers(list.map((l) => (Object.values(idOf).includes(l.id) ? { ...l, visible: true } : l)))
    setDrawLayers(list); saveDrawLayers(list)
    const news = ents.map((e) => {
      const dl = idOf[e.layer] || DEFAULT_LAYER_ID
      return { id: uid(), type: e.type, is_construction: !!asConstruction, data: e.data, ...(dl !== DEFAULT_LAYER_ID ? { dlayer: dl } : {}) }
    })
    activeDLRef.current = DEFAULT_LAYER_ID // le entità hanno già il loro layer
    commit([...latest.current, ...news])
    setSelected(new Set(news.map((e) => e.id)))
    const xs = [], ys = []
    for (const e of news) {
      const d = e.data
      if (e.type === 'line') { xs.push(d.x1, d.x2); ys.push(d.y1, d.y2) }
      else if (d.cx !== undefined) { const r = d.r ?? Math.max(d.rx, d.ry); xs.push(d.cx - r, d.cx + r); ys.push(d.cy - r, d.cy + r) }
      else if (d.points) d.points.forEach((q) => { xs.push(q.x); ys.push(q.y) })
    }
    if (xs.length) setFitRequest({ n: Date.now(), bbox: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) } })
    setDxfData(null)
    setTool('select')
    notify(`Importate ${news.length} entità da ${dxfData?.filename || 'DXF'}`, 'success')
  }

  const selCount = [...selected].filter((id) => { const e = entities.find((x) => x.id === id); return e && !isConstraint(e) }).length
  const selLayers = new Set(entities.filter((e) => selected.has(e.id) && !isConstraint(e)).map(layerOf))
  const selEntity = selected.size === 1 ? entities.find((e) => selected.has(e.id)) : null
  const constrainLine = (id, kind, ref) => {
    const ln = latest.current.find((e) => e.id === id)
    if (!ln) return
    const data = lineConstrained(ln.data, kind, ref)
    if (!data) return notify('Impossibile applicare il vincolo (linea di lunghezza nulla)')
    commit(latest.current.map((e) => (e.id === id ? { ...e, data } : e)), { fixed: [id] })
  }
  const onPickParallel = (refLine) => {
    const id = parallelFor
    setParallelFor(null)
    if (!refLine) return
    if (refLine.id === id) return notify('Scegli una linea diversa da quella selezionata')
    constrainLine(id, 'parallel', refLine.data)
  }
  const updateSel = (k, val) => {
    // raggio di un raccordo dal pannello proprietà: linee ancorate, si spostano solo i punti di tangenza
    if (selEntity.type === 'arc' && k === 'r') {
      const rf = refilletArc(latest.current, selEntity.id, Number(val))
      if (rf === null) return notify('Raggio non compatibile con il raccordo (linee troppo corte): modifica annullata', 'error')
      if (rf) return commit(rf.list, { fixed: rf.fixed })
    }
    return updateSelRaw(k, val)
  }
  const updateSelRaw = (k, val) => commit(latest.current.map((e) => (e.id === selEntity.id ? { ...e, data: { ...e.data, [k]: val } } : e)), { fixed: [selEntity.id] })
  const cutEntities = entities.filter((e) => !e.is_construction && !isDim(e) && e.type !== 'bridge')
  // testo/SVG convertiti in entità: finiscono sul layer di disegno attivo (commit)
  const openVectorTool = (kind) => { setTool('select'); setSelected(new Set()); setVectorTool(kind) }
  const insertVector = (ents, label) => {
    const target = drawLayers.find((l) => l.id === activeDLRef.current)
    if (target?.locked) return notify(`Il layer «${target.name}» è bloccato: sbloccalo o scegli un altro layer`, 'error')
    commit([...latest.current, ...ents])
    setSelected(new Set(ents.map((e) => e.id)))
    const bb = entitiesBBox(ents)
    if (bb) setFitRequest({ n: Date.now(), bbox: bb })
    setVectorTool(null); setPlacement(null)
    notify(`Inserite ${ents.length} entità da ${label} nel layer «${target?.name || 'corrente'}»`, 'success')
  }
  const openAssign = () => (selCount ? setAssignOpen(true) : notify('Seleziona prima una o più entità nel canvas'))
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
        <input ref={fileRef} type="file" accept=".dxf,.DXF" hidden onChange={(e) => onDxfFile(e.target.files?.[0])} />
        <Button size="sm" variant="outline" icon={FileUp} disabled={dxfBusy} onClick={() => fileRef.current?.click()} title="Importa geometrie da un file DXF (LINE, ARC, CIRCLE, POLYLINE, LWPOLYLINE, SPLINE)">
          {dxfBusy ? 'Analisi…' : 'Importa DXF'}
        </Button>
        <div className="mx-2 h-5 w-px bg-line" />
        <label className="flex items-center gap-1.5 text-xs text-gray-400">Largh. ponticello
          <input type="number" min="0.5" step="0.5" className="input w-16 py-1" value={options.bridgeWidth} onChange={(e) => setOptions({ ...options, bridgeWidth: Number(e.target.value) || 1 })} /> mm
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="primary" icon={Play} disabled={!cutEntities.length} onClick={async () => { await save(); onStartCutting(activeDLRef.current) }}
            title="Salva e apri la simulazione 3D del layer corrente con i suoi parametri">Simula</Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <Toolbar tool={tool} setTool={(t) => { setVectorTool(null); setTool(t) }} onCopy={duplicate} canCopy={selected.size > 0} hasSelection={selected.size > 0}
          onText={() => openVectorTool('text')} onSvg={() => openVectorTool('svg')} vectorTool={vectorTool} />
        <div className="relative min-w-0 flex-1">
          {CTX_FIELDS[tool] && (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-line bg-bg-card/95 px-3 py-1.5 text-xs text-gray-300 shadow-lg">
              <span className="text-gray-400">{CTX_FIELDS[tool][1]}</span>
              <input type="number" min="0.1" step="0.5" className="input w-20 py-1" value={options[CTX_FIELDS[tool][0]]}
                onChange={(e) => setOptions((o) => ({ ...o, [CTX_FIELDS[tool][0]]: e.target.value === '' ? '' : Number(e.target.value) }))} />
              <span>mm</span>
            </div>
          )}
          {loaded && (
            <CADCanvas entities={entities} onChange={commit} selected={selected} setSelected={setSelected} tool={tool} setTool={setTool}
              stock={{ x: project.stock_x, y: project.stock_y }} ui={settings?.ui} options={options} notify={notify}
              onContextMenu={(e, pos) => setCtx({ entity: e, ...pos })} onUndo={undo} onRedo={redo} onDelete={del} onDuplicate={duplicate} maxToolDia={maxToolDia} otherLayerEntities={otherLayerEntities} pickLine={parallelFor ? onPickParallel : null}
              drawLayers={drawLayers} fitRequest={fitRequest} onMeasure={setCanvasMeasure}
              toolpath={toolpathPreview}
              overlay={placement ? (view) => <PlacementOverlay view={view} {...placement} /> : null} />
          )}
          {vectorTool === 'text' && <TextTool center={{ x: 0, y: 0 }} notify={notify} setPlacement={setPlacement}
            onClose={() => { setVectorTool(null); setPlacement(null) }} onConfirm={insertVector} />}
          {vectorTool === 'svg' && <SvgImportTool center={{ x: 0, y: 0 }} stock={{ x: project.stock_x, y: project.stock_y }} notify={notify} setPlacement={setPlacement}
            onClose={() => { setVectorTool(null); setPlacement(null) }} onConfirm={insertVector} />}
        </div>
        <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-bg-panel text-sm">
          <DrawLayerPanel layers={drawLayers} activeId={activeDLRef.current} setActive={setActiveDL} counts={dlCounts} selectionCount={selCount}
            onToggleVisible={toggleVisible} onToggleLock={toggleLock}
            onColor={(id, color) => updateDrawLayers((ls) => ls.map((x) => (x.id === id ? { ...x, color } : x)))}
            onRename={(id, name) => updateDrawLayers((ls) => ls.map((x) => (x.id === id ? { ...x, name } : x)))}
            onAdd={addDrawLayer} onDelete={deleteDrawLayer} onAssignSelection={assignSelection}
            onOpenAssign={openAssign} />
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-3">
          <div className="mb-3 border-b border-line pb-3" data-testid="cad-cut-params">
            <button onClick={() => setParamsOpen((o) => !o)} className="mb-2 flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-white">
              {paramsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Scissors size={13} /> Parametri di taglio
              <span className="ml-auto flex min-w-0 items-center gap-1 normal-case tracking-normal text-gray-300">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: activeDrawLayer.color }} /><span className="truncate">{activeDrawLayer.name}</span>
              </span>
            </button>
            {paramsOpen && <>
              <p className="mb-2 text-[10px] leading-snug text-gray-500">
                Percorso indipendente: solo le entità di questo layer, con questi parametri. Le modifiche si salvano e aggiornano da sole percorso e simulazione.
              </p>
              <LayerParams layer={layer} drawLayer={activeDrawLayer} material={project.material} onLayerUpdated={onLayerUpdated} {...cutProps} />
            </>}
          </div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400"><Ruler size={13} /> Proprietà / Misure</div>
          {canvasMeasure?.distance != null ? (
            <div className="mb-3 rounded-md border border-cyan-500/50 bg-cyan-500/10 p-2 text-xs">
              <div className="text-sm font-semibold text-cyan-200" data-testid="dist-summary">Distanza: {canvasMeasure.distance.toFixed(2)} mm</div>
              <div className="mt-1 space-y-0.5 font-mono text-[11px] text-gray-300">{canvasMeasure.rows.slice(1).map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-gray-400">{k}</span><span>{v}</span></div>)}</div>
            </div>
          ) : tool === 'measure_dist' && (
            <div className="mb-3 rounded-md border border-cyan-500/40 bg-cyan-500/5 p-2 text-xs text-cyan-200">
              Misura distanza: {canvasMeasure?.first ? 'punto A fissato — click sul punto B' : 'click sul punto A, poi sul punto B'}
            </div>
          )}
          {selEntity ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{selEntity.kind === 'on_line' ? 'Vincolo punto su linea' : TYPE_NAMES[selEntity.type] || selEntity.type}</span>
                {selEntity.is_construction && !isDim(selEntity) && !isConstraint(selEntity) && <span className="rounded bg-gray-700 px-1.5 text-[10px] text-gray-300">costruzione</span>}
              </div>
              <EntityMeasures e={selEntity} />
              {!isDim(selEntity) && !isConstraint(selEntity) && <LayerAssignBox layers={drawLayers} layerIds={[layerOf(selEntity)]} count={1} onOpen={openAssign} />}
              <div className="grid grid-cols-2 gap-2">
                {Object.keys(selEntity.data).filter((k) => typeof selEntity.data[k] === 'number').map((k) => (
                  <div key={k}>
                    <span className="label">{FIELD_LABELS[k] || k}</span>
                    <input type="number" step="0.1" className="input py-1" value={selEntity.data[k]}
                      onChange={(e) => e.target.value !== '' && updateSel(k, Number(e.target.value))} />
                  </div>
                ))}
              </div>
              {isDim(selEntity) && (
                <div className="text-xs text-gray-400">{!(selEntity.targetId || selEntity.pa || selEntity.la) ? 'Quota libera (non collegata)' : selEntity.driving === false ? 'Quota di riferimento (sola lettura)' : 'Quota guida · click sulla quota per modificarla'}</div>
              )}
              {isConstraint(selEntity) && selEntity.kind === 'on_line' && (
                <div className="text-xs leading-relaxed text-gray-400">Vincolo punto su linea: il punto scorre sulla linea e la segue quando si sposta.<br />
                  <b className="text-gray-300">{pointName(selEntity.data.a, entities)}</b> ∈ <b className="text-gray-300">{pointName(selEntity.data.b, entities)}</b><br />Canc o Elimina per rimuovere il vincolo.</div>
              )}
              {isConstraint(selEntity) && selEntity.kind !== 'on_line' && (
                <div className="text-xs leading-relaxed text-gray-400">I due punti restano sovrapposti (cardine): muovendo una figura l'altra la segue.<br />
                  <b className="text-gray-300">{pointName(selEntity.data.a, entities)}</b> ≡ <b className="text-gray-300">{pointName(selEntity.data.b, entities)}</b><br />Canc o Elimina per rimuovere il vincolo.</div>
              )}
              {isDim(selEntity) && selEntity.driving !== false && selEntity.value > 0 && <div className="text-xs text-gray-400">Valore imposto: <b className="text-gray-200">{(+selEntity.value).toFixed(selEntity.type === 'dim_angle' ? 1 : 2)}{selEntity.type === 'dim_angle' ? '°' : ' mm'}</b></div>}
              {selEntity.type === 'spline' && <div className="text-xs text-gray-400">Punti di controllo: <b className="text-gray-200">{selEntity.data.points.length}</b></div>}
              {(selEntity.type === 'line' || selEntity.type === 'construction') && (
                <div>
                  <span className="label">Allinea linea</span>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="xs" onClick={() => constrainLine(selEntity.id, 'horizontal')} title="Rende la linea orizzontale (mantiene punto iniziale e lunghezza)">Orizzontale</Button>
                    <Button size="xs" onClick={() => constrainLine(selEntity.id, 'vertical')} title="Rende la linea verticale (mantiene punto iniziale e lunghezza)">Verticale</Button>
                    <Button size="xs" variant={parallelFor ? 'primary' : undefined} onClick={() => setParallelFor(parallelFor ? null : selEntity.id)} title="Poi click su una linea di riferimento">{parallelFor ? 'Scegli riferimento…' : 'Parallela a…'}</Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {selEntity.type !== 'bridge' && !isDim(selEntity) && !isConstraint(selEntity) && <Button size="xs" icon={Repeat} onClick={toggleConstruction}>{selEntity.is_construction ? 'Normale' : 'Costruzione'}</Button>}
                {!isConstraint(selEntity) && <Button size="xs" icon={Copy} onClick={duplicate}>Duplica</Button>}
                <Button size="xs" icon={Trash2} className="text-red-400" onClick={del}>Elimina</Button>
              </div>
            </div>
          ) : selected.size > 1 ? (
            <div className="space-y-3">
              <MultiMeasures list={entities.filter((e) => selected.has(e.id))} />
              {selCount > 0 && <LayerAssignBox layers={drawLayers} layerIds={[...selLayers]} count={selCount} onOpen={openAssign} />}
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" icon={Repeat} onClick={toggleConstruction}>Costruzione ⇄</Button>
                <Button size="xs" icon={Copy} onClick={duplicate}>Duplica</Button>
                <Button size="xs" icon={Trash2} className="text-red-400" onClick={del}>Elimina</Button>
              </div>
              <p className="text-xs text-gray-500">Usa lo strumento Specchio (M) per specchiare la selezione.</p>
            </div>
          ) : (
            <div className="space-y-3 text-xs text-gray-400">
              <div className="rounded-md border border-dashed border-line bg-bg p-2.5 text-center text-sm text-gray-300" data-testid="no-selection">Seleziona un'entità per vedere le misure</div>
              <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 leading-relaxed">
                <div className="mb-1 font-semibold text-gray-200">Come si usa</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li><b className="text-gray-300">Click</b> su un'entità (strumento Seleziona, <span className="kbd">S</span>) → selezione e misure qui</li>
                  <li><b className="text-gray-300">Trascina</b> nel vuoto → selezione rettangolare</li>
                  <li><span className="kbd">Ctrl</span>/<span className="kbd">Shift</span>+click → aggiungi/rimuovi dalla selezione</li>
                  <li><span className="kbd">Esc</span> → deseleziona tutto</li>
                  <li><b className="text-gray-300">Sposta a layer…</b> (pannello Layer/Proprietà o tasto destro) → cambia layer alla selezione</li>
                  <li><b className="text-gray-300">Testo</b> / <b className="text-gray-300">SVG</b> (toolbar) → percorsi di incisione sul layer corrente</li>
                  <li><b className="text-gray-300">Misura distanza</b> (toolbar, <span className="kbd">K</span>): click su A poi su B</li>
                  <li><b className="text-gray-300">Importa DXF</b> in alto per caricare un disegno</li>
                </ul>
              </div>
              <div className="rounded-md border border-line bg-bg p-2 leading-relaxed">
                <div>Entità: <b className="text-gray-200">{entities.filter((e) => !isConstraint(e)).length}</b></div>
                <div>Vincoli di coincidenza: <b className="text-gray-200">{entities.filter(isConstraint).length}</b></div>
                <div>Da tagliare: <b className="text-gray-200">{cutEntities.length}</b></div>
                <div>Ponticelli: <b className="text-gray-200">{entities.filter((e) => e.type === 'bridge').length}</b></div>
              </div>
              <p className="leading-relaxed">Origine (0,0) = centro dello stock. Il bordo verde tratteggiato è il pezzo grezzo ({project.stock_x}×{project.stock_y} mm).</p>
              <p className="leading-relaxed"><span className="kbd">Alt</span> disattiva lo snap · <span className="kbd">Shift</span> orto · <span className="kbd">Ctrl+Z</span> annulla · <span className="kbd">Canc</span> elimina</p>
              <p className="leading-relaxed">Trascina un punto chiave per spostare la figura (o stirare l'estremo di una linea/spline): rilasciato su un altro punto o sull'origine crea un vincolo di coincidenza (quadratino verde).</p>
              {layer.gcode && <p className="flex items-center gap-1 text-accent"><Check size={13} /> G-code presente ({OPERATION_NAMES[layer.operation]})</p>}
            </div>
          )}
          </div>
        </aside>
      </div>

      {ctx && (
        <div className="fixed inset-0 z-50" onMouseDown={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null) }}>
          <div className="animate-fade absolute w-48 rounded-md border border-line bg-bg-card py-1 text-sm shadow-xl" style={{ left: ctx.x, top: ctx.y }} onMouseDown={(e) => e.stopPropagation()}>
            {[
              ['Elimina', () => del()],
              ['Duplica', () => duplicate()],
              ...(ctx.entity && ctx.entity.type !== 'bridge' && !isDim(ctx.entity) && !isConstraint(ctx.entity) ? [[ctx.entity.is_construction ? 'Converti in normale' : 'Converti in costruzione', toggleConstruction]] : []),
            ].map(([l, fn]) => (
              <button key={l} className="block w-full px-3 py-1.5 text-left text-gray-200 hover:bg-bg-hover" onClick={() => { fn(); setCtx(null) }}>{l}</button>
            ))}
            <div className="my-1 border-t border-line" />
            <div className="px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-wider text-gray-500">Assegna a layer ({selCount})</div>
            <div className="max-h-48 overflow-y-auto">
              {drawLayers.map((l) => (
                <button key={l.id} className="flex w-full items-center gap-2 px-3 py-1 text-left text-gray-200 hover:bg-bg-hover" onClick={() => { assignSelection(l.id); setCtx(null) }}>
                  <span className="h-3 w-3 shrink-0 rounded-sm border border-black/40" style={{ background: l.color }} />
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  {selLayers.size === 1 && selLayers.has(l.id) && <Check size={12} className="text-accent" />}
                </button>
              ))}
            </div>
            <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-accent hover:bg-bg-hover" onClick={() => { setNewLayerFor(true); setCtx(null) }}>
              <Plus size={13} /> Nuovo layer…
            </button>
          </div>
        </div>
      )}

      <AssignLayerModal open={assignOpen} layers={drawLayers} counts={dlCounts} current={selLayers} count={selCount}
        onClose={() => setAssignOpen(false)} onPick={(id) => { assignSelection(id); setAssignOpen(false) }}
        onNew={() => { setAssignOpen(false); setNewLayerFor(true) }} />
      <NewLayerModal open={newLayerFor} layers={drawLayers} selectionCount={selCount} title="Nuovo layer per la selezione"
        onCancel={() => setNewLayerFor(false)} onCreate={(n, c) => { const id = addDrawLayer(n, c); assignSelection(id, n); setNewLayerFor(false) }} />
      {dxfData && <DxfImportModal data={dxfData} stock={{ x: project.stock_x, y: project.stock_y }} onClose={() => setDxfData(null)} onConfirm={confirmDxf} />}
    </div>
  )
}

const PT_NAMES = { p1: 'inizio', p2: 'fine', m: 'punto medio', c: 'centro', s: 'inizio', e: 'fine', o: '', p: '', line: '' }
function pointName(r, entities) {
  if (r.id === '__origin') return 'Origine'
  const e = entities.find((x) => x.id === r.id)
  const n = PT_NAMES[r.ref] ?? (/^v\d/.test(r.ref) ? 'vertice ' + (+r.ref.slice(1) + 1) : /^m\d/.test(r.ref) ? 'punto medio lato ' + (+r.ref.slice(1) + 1) : /^i\d/.test(r.ref) ? 'punto ' + (+r.ref.slice(1) + 1) : r.ref)
  return `${TYPE_NAMES[e?.type] || '?'} ${n}`.trim()
}

// ---------------------------------------------------------------- misure
const mm = (v) => `${(+v).toFixed(2)} mm`
const deg2 = (v) => `${(+v).toFixed(2)}°`
const polyLen = (pts, closed) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (closed && pts.length > 2) L += Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y); return L }
// lunghezza (perimetro) di un'entità in mm, null se non applicabile
function entityLength(e) {
  const d = e?.data || {}
  switch (e?.type) {
    case 'line': case 'construction': return Math.hypot(d.x2 - d.x1, d.y2 - d.y1)
    case 'circle': return 2 * Math.PI * d.r
    case 'arc': return d.r * rad(arcSweep(d.start, d.end))
    case 'rect': return 2 * (Math.abs(d.w) + Math.abs(d.h))
    case 'ellipse': { const a = d.rx, b = d.ry, h = ((a - b) / (a + b)) ** 2; return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))) }
    case 'slot': return 2 * Math.abs(d.length || 0) + Math.PI * Math.abs(d.width || 0)
    case 'spline': return d.points?.length > 1 ? polyLen(catmullRomPoints(d.points, 16), d.closed) : 0
    default: return null
  }
}
const Row = ({ k, v, strong }) => (<div className="flex justify-between gap-2"><span className="text-gray-400">{k}</span><b className={`font-mono ${strong ? 'text-accent' : 'text-gray-100'}`}>{v}</b></div>)

function EntityMeasures({ e }) {
  const d = e.data
  let rows = null
  if (e.type === 'line' || e.type === 'construction') {
    const dx = d.x2 - d.x1, dy = d.y2 - d.y1
    rows = <><Row k="Lunghezza" v={mm(Math.hypot(dx, dy))} strong /><Row k="ΔX" v={mm(Math.abs(dx))} /><Row k="ΔY" v={mm(Math.abs(dy))} /><Row k="Angolo" v={deg2((Math.atan2(dy, dx) * 180) / Math.PI)} /></>
  } else if (e.type === 'circle') {
    rows = <><Row k="Diametro" v={mm(2 * d.r)} strong /><Row k="Raggio" v={mm(d.r)} strong /><Row k="Circonferenza" v={mm(2 * Math.PI * d.r)} /><Row k="Centro" v={`${(+d.cx).toFixed(2)}, ${(+d.cy).toFixed(2)}`} /></>
  } else if (e.type === 'arc') {
    const sw = arcSweep(d.start, d.end)
    rows = <><Row k="Raggio" v={mm(d.r)} strong /><Row k="Angolo inizio" v={deg2(d.start)} /><Row k="Angolo fine" v={deg2(d.end)} /><Row k="Ampiezza" v={deg2(sw)} /><Row k="Lunghezza arco" v={mm(d.r * rad(sw))} strong /><Row k="Corda" v={mm(2 * d.r * Math.sin(rad(sw) / 2))} /></>
  } else if (e.type === 'rect') {
    rows = <><Row k="Larghezza" v={mm(Math.abs(d.w))} strong /><Row k="Altezza" v={mm(Math.abs(d.h))} strong /><Row k="Perimetro" v={mm(entityLength(e))} /><Row k="Diagonale" v={mm(Math.hypot(d.w, d.h))} /></>
  } else {
    const L = entityLength(e)
    if (L != null) rows = <Row k={e.type === 'spline' ? 'Lunghezza (approx.)' : 'Perimetro'} v={mm(L)} strong />
  }
  if (!rows) return null
  const sum = measureSummary(e)
  return (
    <div className="space-y-1 rounded-md border border-accent/30 bg-accent/5 p-2 text-xs">
      {sum && <div className="mb-1 border-b border-accent/20 pb-1.5 text-[13px] font-semibold text-accent" data-testid="measure-summary">{sum}</div>}
      {rows}
    </div>
  )
}

const degShort = (v) => `${+(+v).toFixed(2)}°`
// riepilogo in una riga (formato richiesto nel pannello Proprietà)
function measureSummary(e) {
  const d = e.data
  if (e.type === 'line' || e.type === 'construction') return `Lunghezza: ${mm(Math.hypot(d.x2 - d.x1, d.y2 - d.y1))}`
  if (e.type === 'circle') return `Diametro: ${mm(2 * d.r)} | Raggio: ${mm(d.r)}`
  if (e.type === 'arc') return `Raggio: ${mm(d.r)} | Angolo: ${degShort(d.start)}→${degShort(d.end)} | Lunghezza arco: ${mm(d.r * rad(arcSweep(d.start, d.end)))}`
  return null
}

function MultiMeasures({ list }) {
  const ents = list.filter((e) => !isConstraint(e) && !isDim(e))
  const lines = ents.filter((e) => e.type === 'line' || e.type === 'construction')
  const lineLen = lines.reduce((s, e) => s + entityLength(e), 0)
  const total = ents.reduce((s, e) => s + (entityLength(e) || 0), 0)
  const byType = {}
  for (const e of list) byType[e.type] = (byType[e.type] || 0) + 1
  return (
    <div className="space-y-1 rounded-md border border-accent/30 bg-accent/5 p-2 text-xs">
      <div className="mb-1 border-b border-accent/20 pb-1.5 text-[13px] font-semibold text-accent" data-testid="multi-summary">{list.length} entità selezionate | Lunghezza totale linee: {mm(lineLen)}</div>
      <Row k={`Lunghezza linee (${lines.length})`} v={mm(lineLen)} strong />
      {total - lineLen > 1e-9 && <Row k="Lunghezza totale (tutte)" v={mm(total)} />}
      <div className="pt-1 text-[11px] text-gray-500">{Object.entries(byType).map(([t, n]) => `${TYPE_NAMES[t] || t}: ${n}`).join(' · ')}</div>
    </div>
  )
}

// layer delle entità selezionate (pallino colore = colore nel canvas) + pulsante "Sposta a layer…"
function LayerAssignBox({ layers, layerIds, count, onOpen }) {
  const ls = layerIds.map((id) => layers.find((l) => l.id === id)).filter(Boolean)
  return (
    <div className="space-y-1.5 rounded-md border border-line bg-bg p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-gray-400">{ls.length > 1 ? 'Layer (misti):' : 'Layer:'}</span>
        {ls.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-gray-100">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />{l.name}
          </span>
        ))}
      </div>
      <button onClick={onOpen} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600/80 px-2 py-1.5 font-semibold text-white hover:bg-blue-500">
        <LayersIcon size={13} /> Sposta a layer…{count > 1 ? ` (${count})` : ''}
      </button>
    </div>
  )
}

function AssignLayerModal({ open, layers, counts, current, count, onClose, onPick, onNew }) {
  return (
    <Modal open={open} onClose={onClose} title={`Sposta ${count} entità a layer`}
      footer={<Button onClick={onClose}>Annulla</Button>}>
      <p className="mb-2 text-xs text-gray-400">Scegli il layer di destinazione: le entità prendono subito il colore del layer.</p>
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {layers.map((l) => {
          const isCur = current.size === 1 && current.has(l.id)
          return (
            <button key={l.id} onClick={() => onPick(l.id)} data-testid={`assign-${l.id}`}
              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition hover:border-blue-400 hover:bg-blue-500/10 ${isCur ? 'border-accent/60 bg-accent/10' : 'border-line'}`}>
              <span className="h-4 w-4 shrink-0 rounded border border-black/40" style={{ background: l.color }} />
              <span className="min-w-0 flex-1 truncate text-gray-100">{l.name}</span>
              {l.locked && <span className="text-[10px] text-yellow-400">bloccato</span>}
              {!l.visible && <span className="text-[10px] text-gray-500">nascosto</span>}
              <span className="font-mono text-[10px] text-gray-500">{counts[l.id] || 0}</span>
              {isCur && <Check size={14} className="text-accent" />}
            </button>
          )
        })}
      </div>
      <button onClick={onNew} className="mt-2 flex w-full items-center gap-2 rounded-md border border-dashed border-accent/50 px-3 py-2 text-left text-sm text-accent hover:bg-accent/10">
        <Plus size={14} /> Nuovo layer…
      </button>
    </Modal>
  )
}
