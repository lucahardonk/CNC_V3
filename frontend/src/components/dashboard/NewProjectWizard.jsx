import { useState } from 'react'
import { Check } from 'lucide-react'
import Modal from '../common/Modal'
import Button from '../common/Button'
import { MATERIAL_COLORS, MATERIAL_NAMES, useStore } from '../../store/store'
import { errMsg, Projects } from '../../services/api'

const STEPS = ['Nome', 'Materiale', 'Dimensioni', 'Riepilogo']

export default function NewProjectWizard({ open, onClose, onCreated }) {
  const materials = useStore((s) => s.materials)
  const notify = useStore((s) => s.notify)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', material: 'softwood', stock_x: 200, stock_y: 150, stock_z: 18 })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const valid = [
    form.name.trim().length > 0,
    !!form.material,
    [form.stock_x, form.stock_y, form.stock_z].every((v) => Number(v) > 0),
    true,
  ]

  const reset = () => { setStep(0); setForm({ name: '', material: 'softwood', stock_x: 200, stock_y: 150, stock_z: 18 }) }
  const close = () => { reset(); onClose() }

  const create = async () => {
    setBusy(true)
    try {
      const p = await Projects.create({ ...form, name: form.name.trim(), stock_x: +form.stock_x, stock_y: +form.stock_y, stock_z: +form.stock_z })
      reset()
      onCreated(p)
    } catch (e) { notify(errMsg(e), 'error') } finally { setBusy(false) }
  }

  const next = () => { if (valid[step]) step < 3 ? setStep(step + 1) : create() }

  return (
    <Modal open={open} onClose={close} title="Nuovo progetto" width="max-w-2xl"
      footer={<>
        {step > 0 && <Button onClick={() => setStep(step - 1)}>Indietro</Button>}
        <Button variant="primary" disabled={!valid[step] || busy} onClick={next}>{step < 3 ? 'Avanti' : busy ? 'Creazione…' : 'Crea progetto'}</Button>
      </>}>
      <div className="mb-6 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-2">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition
              ${i < step ? 'bg-accent text-black' : i === step ? 'border-2 border-accent text-accent' : 'border border-line text-gray-500'}`}>
              {i < step ? <Check size={14} /> : i + 1}
            </div>
            <span className={`text-xs ${i === step ? 'text-white' : 'text-gray-500'}`}>{s}</span>
            {i < 3 && <div className={`h-px flex-1 ${i < step ? 'bg-accent' : 'bg-line'}`} />}
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); next() }}>
        {step === 0 && (
          <div>
            <label className="label">Nome progetto</label>
            <input autoFocus className="input text-base" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="es. Insegna officina" />
          </div>
        )}
        {step === 1 && (
          <div className="grid grid-cols-3 gap-3">
            {['softwood', 'hardwood', 'aluminum'].map((m) => (
              <button type="button" key={m} onClick={() => set('material', m)}
                className={`rounded-lg border p-3 text-left transition ${form.material === m ? 'border-accent bg-accent/10' : 'border-line bg-bg hover:border-gray-500'}`}>
                <div className="mb-2 h-14 rounded" style={{ background: MATERIAL_COLORS[m] }} />
                <div className="font-semibold text-white">{materials[m]?.name || MATERIAL_NAMES[m]}</div>
                <div className="mt-1 text-xs leading-snug text-gray-400">{materials[m]?.description}</div>
              </button>
            ))}
          </div>
        )}
        {step === 2 && (
          <div>
            <div className="grid grid-cols-3 gap-3">
              {[['stock_x', 'Larghezza X'], ['stock_y', 'Profondità Y'], ['stock_z', 'Spessore Z']].map(([k, l]) => (
                <div key={k}>
                  <label className="label">{l} (mm)</label>
                  <input type="number" min="0.1" step="0.1" className={`input ${Number(form[k]) > 0 ? '' : 'border-red-500'}`}
                    value={form[k]} onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-gray-500">L'origine pezzo (X0 Y0) sarà al centro dello stock, Z0 sulla superficie superiore.</p>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-2 rounded-lg border border-line bg-bg p-4 text-sm">
            <Row k="Nome" v={form.name} />
            <Row k="Materiale" v={<span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: MATERIAL_COLORS[form.material] }} />{materials[form.material]?.name || MATERIAL_NAMES[form.material]}</span>} />
            <Row k="Stock" v={`${form.stock_x} × ${form.stock_y} × ${form.stock_z} mm`} />
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

const Row = ({ k, v }) => (
  <div className="flex justify-between"><span className="text-gray-400">{k}</span><span className="font-medium text-white">{v}</span></div>
)
