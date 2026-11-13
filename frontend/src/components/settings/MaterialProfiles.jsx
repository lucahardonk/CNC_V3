import Tooltip from '../common/Tooltip'
import { TOOL_TIPS } from './ToolBox'

const FIELDS = [
  ['feed_rate', 'Feed (mm/min)', 10], ['plunge_rate', 'Plunge (mm/min)', 10], ['spindle_rpm', 'RPM', 500],
  ['depth_per_pass', 'Prof. passata (mm)', 0.1], ['step_over', 'Step-over', 0.05],
]
const TIPS = { ...TOOL_TIPS, depth_per_pass: "Profondità massima asportata ad ogni passata in Z. Regola pratica: ≤ 50% del diametro fresa nel legno, molto meno nell'alluminio." }

export default function MaterialProfiles({ materials, onChange }) {
  const upd = (key, k, v) => onChange({ ...materials, [key]: { ...materials[key], [k]: v } })
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">Durante la generazione del G-code viene usato il valore più conservativo tra profilo materiale e utensile (modificabile nel dialog di generazione).</p>
      {Object.entries(materials).map(([key, m]) => (
        <div key={key} className="rounded-lg border border-line bg-bg p-3">
          <div className="mb-3 flex items-center gap-3">
            <input type="color" value={m.color} onChange={(e) => upd(key, 'color', e.target.value)} className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent" />
            <input className="input max-w-[200px] font-semibold" value={m.name} onChange={(e) => upd(key, 'name', e.target.value)} />
            <span className="font-mono text-xs text-gray-500">{key}</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {FIELDS.map(([k, l, step]) => (
              <div key={k}>
                <Tooltip text={TIPS[k]}><span className="label cursor-help">{l}</span></Tooltip>
                <input type="number" step={step} className="input" value={m[k]} onChange={(e) => upd(key, k, e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><span className="label">Descrizione</span><input className="input" value={m.description || ''} onChange={(e) => upd(key, 'description', e.target.value)} /></div>
            <div><span className="label">Note</span><input className="input" value={m.notes || ''} onChange={(e) => upd(key, 'notes', e.target.value)} /></div>
          </div>
        </div>
      ))}
    </div>
  )
}
