import { useEffect } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { ChevronRight, Cpu, Settings as SettingsIcon, Wifi, WifiOff } from 'lucide-react'
import Dashboard from './pages/Dashboard.jsx'
import Project from './pages/Project.jsx'
import SettingsModal from './components/settings/SettingsModal.jsx'
import { useStore } from './store/store'
import { errMsg } from './services/api'

const STATE_COLOR = (s = '') => s.startsWith('Alarm') ? 'bg-red-500' : s.startsWith('Hold') ? 'bg-yellow-400'
  : s === 'Run' || s === 'Jog' ? 'bg-sky-400' : s === 'Idle' ? 'bg-accent' : 'bg-gray-500'

export default function App() {
  const { loadConfig, initGrbl, settingsOpen, setSettingsOpen, toast, breadcrumb, grbl, wsConnected, notify } = useStore()

  useEffect(() => {
    loadConfig().catch((e) => notify(`Errore caricamento configurazione: ${errMsg(e)}`, 'error'))
    initGrbl()
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="z-20 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg-panel px-4">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-white">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-black"><Cpu size={16} /></span>
          CNC <span className="text-accent">V3</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm text-gray-400">
          <ChevronRight size={14} />
          <Link to="/" className="hover:text-white">Progetti</Link>
          {breadcrumb && (<><ChevronRight size={14} /><span className="text-gray-200">{breadcrumb}</span></>)}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-2.5 py-1 text-xs" title={grbl.port}>
            {wsConnected ? <Wifi size={13} className="text-accent" /> : <WifiOff size={13} className="text-red-400" />}
            <span className={`h-2 w-2 rounded-full ${STATE_COLOR(grbl.state)}`} />
            <span className="font-mono text-gray-300">{grbl.state}</span>
            {grbl.simulated && <span className="rounded bg-yellow-500/20 px-1.5 text-[10px] font-semibold text-yellow-300">SIM</span>}
          </div>
          <button onClick={() => setSettingsOpen(true)} className="rounded-md p-2 text-gray-400 transition hover:bg-bg-hover hover:text-white" title="Impostazioni">
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/:id" element={<Project />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {toast && (
        <div className={`animate-pop fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-2xl
          ${toast.kind === 'error' ? 'border-red-500/50 bg-red-950 text-red-200' : toast.kind === 'success' ? 'border-accent/50 bg-green-950 text-green-200' : 'border-line bg-bg-card text-gray-200'}`}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
