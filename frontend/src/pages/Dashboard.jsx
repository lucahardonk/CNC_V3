import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import ProjectCard from '../components/dashboard/ProjectCard'
import NewProjectWizard from '../components/dashboard/NewProjectWizard'
import Modal from '../components/common/Modal'
import Button from '../components/common/Button'
import { errMsg, Projects } from '../services/api'
import { useStore } from '../store/store'

export default function Dashboard() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [wizard, setWizard] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const navigate = useNavigate()
  const { notify, setBreadcrumb } = useStore()

  const load = () => Projects.list().then(setProjects).catch((e) => notify(errMsg(e), 'error')).finally(() => setLoading(false))
  useEffect(() => { setBreadcrumb(null); load() }, [])

  const doDelete = async () => {
    try {
      await Projects.remove(toDelete.id)
      notify(`Progetto "${toDelete.name}" eliminato`, 'success')
      setToDelete(null)
      load()
    } catch (e) { notify(errMsg(e), 'error') }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl p-8">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Progetti</h1>
            <p className="mt-1 text-sm text-gray-400">{loading ? 'Caricamento…' : `${projects.length} progett${projects.length === 1 ? 'o' : 'i'}`}</p>
          </div>
          <Button variant="primary" icon={Plus} onClick={() => setWizard(true)}>Nuovo progetto</Button>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <button onClick={() => setWizard(true)}
            className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line text-gray-400 transition hover:border-accent hover:bg-accent/5 hover:text-accent">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-current"><Plus size={28} /></span>
            <span className="font-semibold">Nuovo Progetto</span>
          </button>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => navigate(`/project/${p.id}`)} onDelete={() => setToDelete(p)} />
          ))}
        </div>
      </div>
      <NewProjectWizard open={wizard} onClose={() => setWizard(false)} onCreated={(p) => { setWizard(false); navigate(`/project/${p.id}`) }} />
      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Elimina progetto"
        footer={<><Button onClick={() => setToDelete(null)}>Annulla</Button><Button variant="danger" onClick={doDelete}>Elimina</Button></>}>
        <p className="text-sm text-gray-300">Eliminare definitivamente <b className="text-white">{toDelete?.name}</b> con tutti i suoi layer e G-code?</p>
      </Modal>
    </div>
  )
}
