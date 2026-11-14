import { useEffect, useState } from 'react'
import { FolderOpen, Trash2, Upload } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { Btn, Modal } from './ui'

export default function ProjectsModal({ onClose }) {
  const { loadProject, notify, dirty } = useStore()
  const [list, setList] = useState(null)

  const refresh = () => api.projects().then(setList).catch((e) => { notify(e.message, 'error'); setList([]) })
  useEffect(() => { refresh() }, [])

  const open = async (id) => {
    if (dirty && !confirm('Modifiche non salvate: continuare?')) return
    try { loadProject(await api.project(id)); onClose() } catch (e) { notify(e.message, 'error') }
  }
  const del = async (p) => {
    if (!confirm(`Eliminare il progetto "${p.name}"?`)) return
    await api.deleteProject(p.id); refresh()
  }
  const importJson = async (f) => {
    try {
      const p = JSON.parse(await f.text())
      delete p.id
      loadProject({ ...p, id: null })
      useStore.getState().setProjectMeta({ dirty: true })
      onClose()
    } catch (e) { notify(`JSON non valido: ${e.message}`, 'error') }
  }

  return (
    <Modal title="Progetti" onClose={onClose}>
      <div className="space-y-1.5">
        {list === null && <p className="text-sm text-gray-500">Caricamento…</p>}
        {list?.length === 0 && <p className="text-sm text-gray-500">Nessun progetto salvato.</p>}
        {list?.map((p) => (
          <div key={p.id} className="group flex items-center gap-2 rounded-md border border-line bg-bg-card px-3 py-2 hover:border-accent/50">
            <button className="flex-1 text-left" onClick={() => open(p.id)}>
              <div className="text-sm text-gray-100">{p.name}</div>
              <div className="text-[11px] text-gray-500">{new Date(p.updated * 1000).toLocaleString('it-IT')} · {p.layers} layer · {p.shapes} oggetti</div>
            </button>
            <button onClick={() => open(p.id)} className="text-gray-400 hover:text-white"><FolderOpen size={16} /></button>
            <button onClick={() => del(p)} className="text-gray-600 hover:text-red-400"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-400 hover:text-white"><Upload size={13} /> Importa progetto .json</span>
        <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files[0] && importJson(e.target.files[0])} />
      </label>
      <div className="mt-3 flex justify-end"><Btn onClick={onClose}>Chiudi</Btn></div>
    </Modal>
  )
}
