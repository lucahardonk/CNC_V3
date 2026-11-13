import { useEffect, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import Modal from '../common/Modal'
import Button from '../common/Button'
import Tooltip from '../common/Tooltip'
import MaterialProfiles from './MaterialProfiles'
import ToolBox from './ToolBox'
import { useStore } from '../../store/store'
import { errMsg, exportUrl, Grbl, importZip, Settings, Tools } from '../../services/api'

const TABS = [['machine', 'Macchina'], ['materials', 'Materiali'], ['tools', 'Utensili'], ['cutting', 'Taglio'], ['joystick', 'Joystick'], ['backup', 'Esporta/Importa']]

const Field = ({ label, tip, value, onChange, type = 'number', step = 'any' }) => (
  <div>
    <Tooltip text={tip}><span className={`label ${tip ? 'cursor-help' : ''}`}>{label}</span></Tooltip>
    {type === 'checkbox'
      ? <input type="checkbox" className="h-4 w-4 accent-green-500" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      : <input type={type} step={step} className="input" value={value ?? ''} onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />}
  </div>
)

export default function SettingsModal({ open, onClose }) {
  const store = useStore()
  const [tab, setTab] = useState('machine')
  const [s, setS] = useState(null)
  const [mats, setMats] = useState({})
  const [tools, setTools] = useState([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    if (!open) return
    Promise.all([Settings.get(), Settings.materials(), Tools.list()])
      .then(([a, b, c]) => { setS(a); setMats(b); setTools(c) })
      .catch((e) => store.notify(errMsg(e), 'error'))
  }, [open])

  const set = (sec, k, v) => setS((p) => ({ ...p, [sec]: { ...p[sec], [k]: v } }))

  const save = async () => {
    setBusy(true)
    try {
      const bad = tools.find((t) => !t.name || !(Number(t.diameter) > 0))
      if (bad) throw new Error('Ogni utensile deve avere nome e diametro > 0')
      const [ns, nm, nt] = await Promise.all([Settings.save(s), Settings.saveMaterials(mats), Tools.replaceAll(tools)])
      store.setSettings(ns); store.setMaterials(nm); store.setTools(nt)
      store.notify('Impostazioni salvate', 'success')
      onClose()
    } catch (e) { store.notify(errMsg(e), 'error') } finally { setBusy(false) }
  }

  const doImport = async (file) => {
    if (!file) return
    if (!confirm('Importare il backup? I dati attuali verranno sostituiti (una copia viene salvata in data/backup_before_import).')) return
    try {
      const r = await importZip(file)
      store.notify(`Import completato: ${r.restored.join(', ')}`, 'success')
      await store.loadConfig()
      setTimeout(() => location.reload(), 800)
    } catch (e) { store.notify(errMsg(e), 'error') }
  }

  const reconnect = async () => {
    try { await Settings.save(s); await Grbl.connect({ port: s.machine.port, baud: s.machine.baud_rate }); store.notify('Riconnessione eseguita', 'success') }
    catch (e) { store.notify(errMsg(e), 'error') }
  }

  return (
    <Modal open={open} onClose={onClose} title="Impostazioni" width="max-w-5xl"
      footer={<><Button onClick={onClose}>Annulla</Button><Button variant="primary" disabled={!s || busy} onClick={save}>{busy ? 'Salvataggio…' : 'Salva tutto'}</Button></>}>
      <div className="mb-5 flex gap-1 border-b border-line">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${tab === k ? 'border-accent text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>{l}</button>
        ))}
      </div>
      {!s ? <div className="text-sm text-gray-400">Caricamento…</div> : (
        <div className="min-h-[340px]">
          {tab === 'machine' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Porta seriale" type="text" value={s.machine.port} onChange={(v) => set('machine', 'port', v)} tip="Device dell'Arduino GRBL dentro il container (mappato in docker-compose.yml)." />
                <Field label="Baud rate" value={s.machine.baud_rate} onChange={(v) => set('machine', 'baud_rate', v)} tip="GRBL 1.1 usa 115200." />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Area lavoro X (mm)" value={s.machine.work_area_x} onChange={(v) => set('machine', 'work_area_x', v)} />
                <Field label="Area lavoro Y (mm)" value={s.machine.work_area_y} onChange={(v) => set('machine', 'work_area_y', v)} />
                <Field label="Area lavoro Z (mm)" value={s.machine.work_area_z} onChange={(v) => set('machine', 'work_area_z', v)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Poll stato (ms)" value={s.grbl.status_poll_interval_ms} onChange={(v) => set('grbl', 'status_poll_interval_ms', v)} tip="Frequenza richiesta stato '?' a GRBL." />
                <Field label="Feed jog XY default" value={s.grbl.jog_feed_xy} onChange={(v) => set('grbl', 'jog_feed_xy', v)} />
                <Field label="Feed jog Z default" value={s.grbl.jog_feed_z} onChange={(v) => set('grbl', 'jog_feed_z', v)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Griglia CAD (mm)" value={s.ui.grid_size} onChange={(v) => set('ui', 'grid_size', v)} />
                <Field label="Snap attivo" type="checkbox" value={s.ui.snap_enabled} onChange={(v) => set('ui', 'snap_enabled', v)} />
                <Field label="Distanza snap (px)" value={s.ui.snap_distance} onChange={(v) => set('ui', 'snap_distance', v)} />
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-line bg-bg p-3 text-sm">
                <span className="text-gray-400">Stato: <b className="text-white">{store.grbl.state}</b> {store.grbl.simulated && '(simulazione)'}</span>
                <Button size="sm" className="ml-auto" onClick={reconnect}>Salva e riconnetti</Button>
                <Button size="sm" onClick={() => Grbl.connect({ simulate: true }).then(() => store.notify('Simulatore attivo'))}>Usa simulatore</Button>
                <Button size="sm" onClick={() => Grbl.disconnect()}>Disconnetti</Button>
              </div>
            </div>
          )}
          {tab === 'materials' && <MaterialProfiles materials={mats} onChange={setMats} />}
          {tab === 'tools' && <ToolBox tools={tools} onChange={setTools} />}
          {tab === 'cutting' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Altezza di sicurezza (mm)" value={s.cutting.safe_height} onChange={(v) => set('cutting', 'safe_height', v)} tip="Quota Z sopra il pezzo per i movimenti rapidi G0." />
              <Field label="Altezza ponticelli (mm)" value={s.cutting.bridge_height} onChange={(v) => set('cutting', 'bridge_height', v)} tip="Spessore di materiale lasciato nei ponticelli (tab), misurato dal fondo del taglio." />
              <Field label="Larghezza ponticelli (mm)" value={s.cutting.bridge_width} onChange={(v) => set('cutting', 'bridge_width', v)} tip="Larghezza di default del ponticello disegnato nel CAD." />
              <Field label="Spaziatura auto ponticelli (mm)" value={s.cutting.bridge_auto_spacing} onChange={(v) => set('cutting', 'bridge_auto_spacing', v)} tip="Distanza tra ponticelli quando li aggiungi automaticamente." />
            </div>
          )}
          {tab === 'joystick' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">Gamepad via Gamepad API del browser. Premi un tasto del controller per attivarlo. Indici assi/pulsanti: vedi la pagina "Taglio" (pannello Jog) per la lettura live.</p>
              <div className="grid grid-cols-4 gap-3">
                <Field label="Abilitato" type="checkbox" value={s.joystick.enabled} onChange={(v) => set('joystick', 'enabled', v)} />
                <Field label="Deadzone" value={s.joystick.deadzone} step="0.05" onChange={(v) => set('joystick', 'deadzone', v)} />
                <Field label="Max feed XY" value={s.joystick.max_feed_xy} onChange={(v) => set('joystick', 'max_feed_xy', v)} />
                <Field label="Max feed Z" value={s.joystick.max_feed_z} onChange={(v) => set('joystick', 'max_feed_z', v)} />
                <Field label="Asse X (indice)" value={s.joystick.axis_x} onChange={(v) => set('joystick', 'axis_x', v)} />
                <Field label="Asse Y (indice)" value={s.joystick.axis_y} onChange={(v) => set('joystick', 'axis_y', v)} />
                <Field label="Asse Z (indice)" value={s.joystick.axis_z} onChange={(v) => set('joystick', 'axis_z', v)} />
                <div />
                <Field label="Inverti X" type="checkbox" value={s.joystick.invert_x} onChange={(v) => set('joystick', 'invert_x', v)} />
                <Field label="Inverti Y" type="checkbox" value={s.joystick.invert_y} onChange={(v) => set('joystick', 'invert_y', v)} />
                <Field label="Inverti Z" type="checkbox" value={s.joystick.invert_z} onChange={(v) => set('joystick', 'invert_z', v)} />
                <div />
                <Field label="Pulsante STOP" value={s.joystick.button_stop} onChange={(v) => set('joystick', 'button_stop', v)} />
                <Field label="Pulsante Zero All" value={s.joystick.button_zero_all} onChange={(v) => set('joystick', 'button_zero_all', v)} />
              </div>
            </div>
          )}
          {tab === 'backup' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-line bg-bg p-4 text-sm text-gray-300">
                I dati sono salvati nella cartella <code className="text-accent">./data</code> accanto a docker-compose.yml (volume persistente):
                riavviare o ricostruire il container <b>non</b> cancella nulla. Per sicurezza puoi comunque esportare tutto in un unico ZIP
                (database progetti, utensili, materiali, impostazioni e tutti i G-code in formato .nc).
              </div>
              <div className="flex gap-3">
                <a href={exportUrl} download><Button variant="primary" icon={Download}>📦 Esporta tutto (ZIP)</Button></a>
                <Button icon={Upload} onClick={() => fileRef.current?.click()}>📂 Importa ZIP</Button>
                <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={(e) => { doImport(e.target.files[0]); e.target.value = '' }} />
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
