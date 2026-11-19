import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import LayerPanel from '../components/cad/LayerPanel'
import CADView from '../components/cad/CADView'
import StockViewer from '../components/viewer3d/StockViewer'
import SimulationView from '../components/cutting/SimulationView'
import Modal from '../components/common/Modal'
import Button from '../components/common/Button'
import { errMsg, Layers, Projects } from '../services/api'
import { useStore } from '../store/store'
import { DEFAULT_LAYER_ID, newLayerId, nextLayerColor, nextLayerName, normalizeDrawLayers } from '../components/cad/drawLayers'

export default function Project() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { notify, setBreadcrumb } = useStore()
  const [project, setProject] = useState(null)
  const [layers, setLayers] = useState([])
  const [activeDl, setActiveDl] = useState(DEFAULT_LAYER_ID) // layer di disegno selezionato
  const [mode, setMode] = useState('view') // view | cad | cutting
  const [simDl, setSimDl] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const work = layers[0] // un solo disegno con n layer
  const startSim = (dl) => { setActiveDl(dl); setSimDl(dl); setMode('cutting') }

  useEffect(() => {
    Projects.get(id).then((p) => { setProject(p); setLayers(p.layers); setBreadcrumb(p.name) })
      .catch((e) => { notify(errMsg(e), 'error'); navigate('/') })
    return () => setBreadcrumb(null)
  }, [id])
  // Uscendo dal CAD si rileggono i layer (conteggi entità e percorsi aggiornati)
  useEffect(() => {
    if (mode === 'cad' || !project) return
    const t = setTimeout(() => Layers.list(id).then(setLayers).catch(() => {}), 500)
    return () => clearTimeout(t)
  }, [mode])

  const updateLayer = (l) => setLayers((ls) => ls.map((x) => (x.id === l.id ? l : x)))
  const dls = work ? normalizeDrawLayers(work.draw_layers) : []
  const saveDls = async (list) => {
    try { updateLayer(await Layers.update(work.id, { draw_layers: list })) } catch (e) { notify(errMsg(e), 'error') }
  }

  // Nuovo layer = nuovo layer di disegno con nome unico, poi si apre il CAD su di lui
  const addLayer = async () => {
    try {
      if (!work) {
        const l = await Layers.create(id, { name: 'Layer 1' })
        setLayers([l]); setActiveDl(DEFAULT_LAYER_ID); setMode('cad'); return
      }
      const d = { id: newLayerId(), name: nextLayerName(dls), color: nextLayerColor(dls), visible: true, locked: false }
      updateLayer(await Layers.update(work.id, { draw_layers: [...dls, d] }))
      setActiveDl(d.id); setMode('cad')
    } catch (e) { notify(errMsg(e), 'error') }
  }
  // Elimina un layer di disegno: le sue entità passano al primo layer (nessuna geometria persa)
  const deleteLayer = async () => {
    const d = toDelete; setToDelete(null)
    try {
      const ents = await Layers.entities(work.id)
      if (ents.some((e) => e.data?._meta?.dlayer === d.id)) {
        await Layers.saveEntities(work.id, ents.map((e) => {
          if (e.data?._meta?.dlayer !== d.id) return e
          const { dlayer, ...meta } = e.data._meta
          const { _meta, ...data } = e.data
          return { ...e, data: Object.keys(meta).length ? { ...data, _meta: meta } : data }
        }))
      }
      await saveDls(dls.filter((x) => x.id !== d.id))
      if (activeDl === d.id) { setActiveDl(DEFAULT_LAYER_ID); setMode('view') }
    } catch (e) { notify(errMsg(e), 'error') }
  }
  const rename = (dl, name) => { if (name.trim()) saveDls(dls.map((x) => (x.id === dl ? { ...x, name: name.trim() } : x))) }
  const move = (dl, dir) => {
    const i = dls.findIndex((x) => x.id === dl), j = i + dir
    if (i < 1 || j < 1 || j >= dls.length) return // il primo layer resta in cima
    const next = [...dls];[next[i], next[j]] = [next[j], next[i]]
    saveDls(next)
  }

  if (!project) return <div className="flex h-full items-center justify-center text-gray-500">Caricamento progetto…</div>


  return (
    <div className="flex h-full">
      {mode !== 'cad' && (
        <LayerPanel work={work} activeDl={activeDl} mode={mode}
          onSelect={(dl, show) => { setActiveDl(dl); if (show) setMode('view') }}
          onEdit={(dl) => { setActiveDl(dl); setMode('cad') }}
          onCut={startSim} onAdd={addLayer} onDelete={setToDelete} onRename={rename} onMove={move} />
      )}
      <div className="relative min-w-0 flex-1">
        {mode === 'cad' && work ? (
          <CADView key={work.id} project={project} layer={work} layers={layers} initialDrawLayer={activeDl} onClose={() => setMode('view')}
            onLayerUpdated={updateLayer} onStartCutting={(dl) => startSim(dl || DEFAULT_LAYER_ID)} />
        ) : mode === 'cutting' && work ? (
          <SimulationView key={`${work.id}:${simDl}`} project={project} layer={work} drawLayerId={simDl} onBack={() => setMode('view')} onLayerUpdated={updateLayer} />
        ) : (
          <>
            <StockViewer project={project} layers={layers} activeLayerId={work?.id} activeDl={activeDl}
              onSelect={(lid, dl) => setActiveDl(dl)} onCut={(lid, dl) => startSim(dl)} />
            {!work && (
              <div className="absolute inset-x-0 bottom-16 flex justify-center">
                <Button variant="primary" onClick={addLayer}>+ Crea il primo layer e inizia a disegnare</Button>
              </div>
            )}
          </>
        )}
      </div>
      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Elimina layer"
        footer={<><Button onClick={() => setToDelete(null)}>Annulla</Button><Button variant="danger" onClick={deleteLayer}>Elimina</Button></>}>
        <p className="text-sm text-gray-300">Eliminare il layer <b className="text-white">{toDelete?.name}</b>? Le sue entità passano a «{dls[0]?.name}».</p>
      </Modal>
    </div>
  )
}
