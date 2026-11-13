import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import LayerPanel from '../components/cad/LayerPanel'
import CADView from '../components/cad/CADView'
import StockViewer from '../components/viewer3d/StockViewer'
import CuttingView from '../components/cutting/CuttingView'
import JogController from '../components/cutting/JogController'
import GRBLConsole from '../components/cutting/GRBLConsole'
import Modal from '../components/common/Modal'
import Button from '../components/common/Button'
import { errMsg, Layers, Projects } from '../services/api'
import { useStore } from '../store/store'

export default function Project() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { notify, setBreadcrumb } = useStore()
  const [project, setProject] = useState(null)
  const [layers, setLayers] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [mode, setMode] = useState('view') // view | cad | cutting
  const [toDelete, setToDelete] = useState(null)

  useEffect(() => {
    Projects.get(id).then((p) => {
      setProject(p); setLayers(p.layers); setBreadcrumb(p.name)
      if (p.layers.length) setActiveId(p.layers[0].id)
    }).catch((e) => { notify(errMsg(e), 'error'); navigate('/') })
    return () => setBreadcrumb(null)
  }, [id])

  const updateLayer = (l) => setLayers((ls) => ls.map((x) => (x.id === l.id ? l : x)))

  const addLayer = async () => {
    try {
      const l = await Layers.create(id, { name: `Layer ${layers.length + 1}` })
      setLayers((ls) => [...ls, l]); setActiveId(l.id); setMode('cad')
    } catch (e) { notify(errMsg(e), 'error') }
  }
  const deleteLayer = async () => {
    try {
      await Layers.remove(toDelete.id)
      setLayers((ls) => ls.filter((x) => x.id !== toDelete.id))
      if (activeId === toDelete.id) { setActiveId(null); setMode('view') }
      setToDelete(null)
    } catch (e) { notify(errMsg(e), 'error') }
  }
  const rename = async (lid, name) => {
    if (!name.trim()) return
    try { updateLayer(await Layers.update(lid, { name: name.trim() })) } catch (e) { notify(errMsg(e), 'error') }
  }
  const move = async (lid, dir) => {
    const i = layers.findIndex((l) => l.id === lid), j = i + dir
    if (j < 0 || j >= layers.length) return
    const next = [...layers];[next[i], next[j]] = [next[j], next[i]]
    setLayers(next)
    try { await Promise.all(next.map((l, k) => (l.order_index !== k ? Layers.update(l.id, { order_index: k }) : null))) ; setLayers(next.map((l, k) => ({ ...l, order_index: k }))) }
    catch (e) { notify(errMsg(e), 'error') }
  }

  if (!project) return <div className="flex h-full items-center justify-center text-gray-500">Caricamento progetto…</div>
  const active = layers.find((l) => l.id === activeId)

  return (
    <div className="flex h-full">
      {mode !== 'cad' && (
        <LayerPanel layers={layers} activeId={activeId} mode={mode}
          onSelect={(lid, show) => { setActiveId(lid); if (show || mode === 'cutting') setMode(mode === 'cutting' && !show ? 'cutting' : 'view') }}
          onEdit={(lid) => { setActiveId(lid); setMode('cad') }}
          onCut={(lid) => { setActiveId(lid); setMode('cutting') }}
          onAdd={addLayer} onDelete={setToDelete} onRename={rename} onMove={move} />
      )}
      <div className="relative min-w-0 flex-1">
        {mode === 'cad' && active ? (
          <CADView key={active.id} project={project} layer={active} onClose={() => setMode('view')}
            onLayerUpdated={updateLayer} onStartCutting={() => setMode('cutting')} />
        ) : mode === 'cutting' && active?.gcode ? (
          <CuttingView key={active.id} project={project} layer={active} onBack={() => setMode('view')} onLayerUpdated={updateLayer} />
        ) : (
          <>
            <StockViewer project={project} layers={layers} activeLayerId={activeId} />
            {layers.length === 0 && (
              <div className="absolute inset-x-0 bottom-16 flex justify-center">
                <Button variant="primary" onClick={addLayer}>+ Crea il primo layer e inizia a disegnare</Button>
              </div>
            )}
          </>
        )}
      </div>
      {mode === 'cutting' && active?.gcode && (
        <aside className="flex w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-bg-panel p-3">
          <JogController />
          <GRBLConsole />
        </aside>
      )}
      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Elimina layer"
        footer={<><Button onClick={() => setToDelete(null)}>Annulla</Button><Button variant="danger" onClick={deleteLayer}>Elimina</Button></>}>
        <p className="text-sm text-gray-300">Eliminare il layer <b className="text-white">{toDelete?.name}</b> con il suo disegno e G-code?</p>
      </Modal>
    </div>
  )
}
