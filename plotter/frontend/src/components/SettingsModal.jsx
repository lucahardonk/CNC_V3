import { useState } from 'react'
import { useStore } from '../store'
import { Btn, Field, Modal, NumInput } from './ui'

const NUMS = [
  ['sheet_z', 'Zero foglio Z (mm)', 'Z assoluta in cui la penna tocca il foglio (dopo G28). 0 se usi G92 Z0 sul foglio.', 0.001],
  ['pen_up', 'Alzata penna (mm)', 'Penna su = zero foglio + questo valore', 0.1],
  ['pen_down_extra', 'Pressione extra (mm)', 'Penna giù = zero foglio − questo valore', 0.05],
  ['feed_draw', 'Velocità disegno (mm/min)', '', 10],
  ['feed_travel', 'Velocità spostamento (mm/min)', '', 100],
  ['feed_z_down', 'Velocità discesa penna (mm/min)', '', 10],
  ['feed_z_up', 'Velocità salita penna (mm/min)', '', 10],
  ['offset_x', 'Offset centro foglio X (mm)', 'Se il foglio non è centrato sul piano', 0.5],
  ['offset_y', 'Offset centro foglio Y (mm)', '', 0.5],
  ['print_radius', 'Raggio stampabile (mm)', 'print_radius di printer.cfg (132)', 1],
  ['stream_chunk', 'Righe per blocco (stream)', '', 1],
]

export default function SettingsModal({ onClose, onSave }) {
  const { settings } = useStore()
  const [s, setS] = useState({ ...settings })
  const set = (k, v) => setS({ ...s, [k]: v })

  return (
    <Modal title="Impostazioni plotter" onClose={onClose} wide>
      <div className="grid gap-3 md:grid-cols-3">
        {NUMS.map(([k, l, hint, step]) => (
          <Field key={k} label={l} hint={hint}><NumInput value={s[k]} step={step} onChange={(v) => set(k, v)} /></Field>
        ))}
        <Field label="Modalità invio" hint="Upload: file su Moonraker + stampa (progress affidabile, PAUSE/RESUME). Stream: blocchi via /printer/gcode/script.">
          <select className="input" value={s.send_mode} onChange={(e) => set('send_mode', e.target.value)}>
            <option value="upload">Upload + Print (consigliato)</option>
            <option value="stream">Stream a blocchi</option>
          </select>
        </Field>
        <Field label="Comando riprendi" hint="RESUME del tuo printer.cfg richiede il sensore filamento: RESUME_BASE lo bypassa.">
          <input className="input font-mono" value={s.resume_cmd} onChange={(e) => set('resume_cmd', e.target.value)} />
        </Field>
        <div className="space-y-2 pt-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!s.home_before} onChange={(e) => set('home_before', e.target.checked)} /> G28 all'inizio del disegno</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!s.home_after} onChange={(e) => set('home_after', e.target.checked)} /> G28 alla fine</label>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>Annulla</Btn>
        <Btn variant="primary" onClick={async () => { await onSave(s); onClose() }}>Salva</Btn>
      </div>
    </Modal>
  )
}
