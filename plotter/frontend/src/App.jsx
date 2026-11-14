import { useCallback, useEffect, useMemo, useState } from 'react'
import { FilePlus, FolderOpen, Save, ImageUp, Download, Settings, PenTool, FileJson } from 'lucide-react'
import { useStore } from './store'
import { api, downloadText } from './lib/api'
import { generateGcode } from './lib/gcode'
import { onFontLoaded, loadFont, DEFAULT_TEXTBOX } from './lib/textbox'
import PlotCanvas from './components/PlotCanvas'
import Toolbar from './components/Toolbar'
import LayerPanel from './components/LayerPanel'
import PropertiesPanel from './components/PropertiesPanel'
import MachinePanel from './components/MachinePanel'
import JobPanel from './components/JobPanel'
import SvgImportModal from './components/SvgImportModal'
import ProjectsModal from './components/ProjectsModal'
import SettingsModal from './components/SettingsModal'
import { Btn } from './components/ui'

export default function App() {
  const st = useStore()
  const { layers, shapes, settings, projectName, dirty, toast, notify, fontsVersion } = st
  const [modal, setModal] = useState(null)
  const [status, setStatus] = useState(null)

  // i font vengono caricati on-demand: al caricamento si ricalcolano anteprima e G-code
  useEffect(() => { loadFont(DEFAULT_TEXTBOX.font); return onFontLoaded(() => useStore.getState().bumpFonts()) }, [])

  // impostazioni dal server
  useEffect(() => { api.settings().then((s) => st.setSettings(s)).catch((e) => notify(`Backend non raggiungibile: ${e.message}`, 'error')) }, [])

  const saveSettings = useCallback(async (patch) => {
    const merged = { ...useStore.getState().settings, ...patch }
    useStore.getState().setSettings(merged)
    try { useStore.getState().setSettings(await api.saveSettings(merged)) } catch (e) { notify(e.message, 'error') }
  }, [])

  // stato macchina (polling)
  const refresh = useCallback(() => api.status().then(setStatus).catch(() => setStatus({ online: false, klippy_state: 'offline', message: 'Backend PlotterCAM non raggiungibile' })), [])
  useEffect(() => { refresh(); const t = setInterval(refresh, 1500); return () => clearInterval(t) }, [refresh])

  const plan = useMemo(() => generateGcode({ layers, shapes, settings, name: projectName }), [layers, shapes, settings, projectName, fontsVersion])

  const save = async () => {
    try {
      const r = await api.saveProject(st.projectData())
      st.setProjectMeta({ projectId: r.id, dirty: false })
      notify('Progetto salvato', 'ok')
    } catch (e) { notify(e.message, 'error') }
  }

  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const fileBase = projectName.replace(/[^\w.-]+/g, '_') || 'plottercam'

  return (
    <div className="flex h-full flex-col text-gray-100">
      {/* barra superiore */}
      <header className="flex h-12 items-center gap-2 border-b border-line bg-bg-panel px-3">
        <PenTool size={20} className="text-accent" />
        <span className="font-semibold">PlotterCAM</span>
        <span className="mr-2 text-xs text-gray-500">FLSUN Delta</span>
        <input className="input w-56 py-1" value={projectName} onChange={(e) => st.setProjectMeta({ projectName: e.target.value, dirty: true })} />
        {dirty && <span className="text-xs text-amber-400">●</span>}
        <div className="ml-2 flex gap-1">
          <Btn variant="ghost" title="Nuovo" onClick={() => (!dirty || confirm('Modifiche non salvate: continuare?')) && st.newProject()}><FilePlus size={16} /></Btn>
          <Btn variant="ghost" title="Apri progetto" onClick={() => setModal('projects')}><FolderOpen size={16} /></Btn>
          <Btn variant="ghost" title="Salva (Ctrl+S)" onClick={save}><Save size={16} /></Btn>
          <Btn variant="ghost" title="Esporta progetto JSON" onClick={() => downloadText(JSON.stringify(st.projectData(), null, 1), `${fileBase}.json`)}><FileJson size={16} /></Btn>
        </div>
        <div className="ml-auto flex gap-1.5">
          <Btn onClick={() => setModal('svg')}><ImageUp size={15} /> Importa SVG</Btn>
          <Btn onClick={() => downloadText(plan.gcode, `${fileBase}.gcode`)} disabled={!plan.paths.length}><Download size={15} /> Esporta G-code</Btn>
          <Btn variant="ghost" title="Impostazioni" onClick={() => setModal('settings')}><Settings size={17} /></Btn>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Toolbar />
        <aside className="flex w-64 flex-col overflow-y-auto border-r border-line bg-bg-panel">
          <LayerPanel />
          <PropertiesPanel />
        </aside>
        <main className="min-w-0 flex-1"><PlotCanvas plan={plan} machinePos={status?.position} /></main>
        <aside className="w-80 overflow-y-auto border-l border-line bg-bg-panel">
          <MachinePanel status={status} refresh={refresh} onSettingsSave={saveSettings} />
          <JobPanel plan={plan} status={status} />
        </aside>
      </div>

      {modal === 'svg' && <SvgImportModal onClose={() => setModal(null)} />}
      {modal === 'projects' && <ProjectsModal onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} onSave={saveSettings} />}

      {toast && (
        <div className={`animate-pop fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-sm shadow-lg ${
          { ok: 'border-accent-dark bg-accent-dark/90', error: 'border-red-700 bg-red-800/95', warn: 'border-amber-600 bg-amber-700/90' }[toast.kind] || 'border-line bg-bg-card'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
