import { Info, Plus, Trash2 } from 'lucide-react'
import Tooltip from '../common/Tooltip'
import Button from '../common/Button'

export const TOOL_TIPS = {
  diameter: "Diametro dell'utensile in mm. Influenza la larghezza del taglio e la velocità di avanzamento.",
  flutes: 'Numero di lame taglienti. 1-2 per alluminio/plastica (evacuazione truciolo), 3+ per legno (finitura migliore).',
  feed_rate: 'Velocità di avanzamento XY in mm/min. Troppo lento = bruciature, troppo veloce = rottura fresa.',
  plunge_rate: 'Velocità di affondamento Z in mm/min. Deve essere più basso del feed rate XY.',
  spindle_rpm: 'Velocità di rotazione mandrino. Legno: 15000-20000 RPM. Alluminio: 18000-20000 RPM.',
  step_over: 'Percentuale del diametro come passo laterale per le pockets. 40% = ottimo compromesso.',
  max_depth: 'Lunghezza utile di taglio (mm): profondità massima raggiungibile dalla fresa.',
  type: 'Geometria: upcut (estrae truciolo, finitura sopra peggiore), downcut (finitura superiore pulita), compression, ball nose (3D), V-bit (incisione).',
  name: "Nome descrittivo dell'utensile mostrato nei menu.",
}

const TYPES = ['upcut_spiral', 'downcut_spiral', 'compression', 'straight', 'ball_nose', 'v_bit']

export const Label = ({ k, children }) => (
  <Tooltip text={TOOL_TIPS[k]}>
    <span className="label flex cursor-help items-center gap-1">{children}{TOOL_TIPS[k] && <Info size={11} className="text-gray-500" />}</span>
  </Tooltip>
)

const NEW_TOOL = { name: 'Nuova fresa', diameter: 4, flutes: 2, type: 'upcut_spiral', material: 'carbide', coating: 'none', max_depth: 20, feed_rate: 1000, plunge_rate: 250, spindle_rpm: 18000, step_over: 0.4, notes: '' }

export default function ToolBox({ tools, onChange }) {
  const upd = (i, k, v) => onChange(tools.map((t, j) => (j === i ? { ...t, [k]: v } : t)))
  const num = (i, k) => (e) => upd(i, k, e.target.value === '' ? '' : Number(e.target.value))
  return (
    <div className="space-y-3">
      {tools.map((t, i) => (
        <div key={t.id || i} className="rounded-lg border border-line bg-bg p-3">
          <div className="mb-3 flex items-end gap-3">
            <div className="flex-1"><Label k="name">Nome</Label><input className="input" value={t.name} onChange={(e) => upd(i, 'name', e.target.value)} /></div>
            <div className="w-44"><Label k="type">Tipo</Label>
              <select className="input" value={t.type} onChange={(e) => upd(i, 'type', e.target.value)}>
                {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <Button variant="ghost" size="sm" icon={Trash2} className="text-red-400" onClick={() => onChange(tools.filter((_, j) => j !== i))} title="Elimina utensile" />
          </div>
          <div className="grid grid-cols-7 gap-2">
            <div><Label k="diameter">Diametro</Label><input type="number" step="0.1" className="input" value={t.diameter} onChange={num(i, 'diameter')} /></div>
            <div><Label k="flutes">Taglienti</Label><input type="number" min="1" className="input" value={t.flutes} onChange={num(i, 'flutes')} /></div>
            <div><Label k="feed_rate">Feed</Label><input type="number" className="input" value={t.feed_rate} onChange={num(i, 'feed_rate')} /></div>
            <div><Label k="plunge_rate">Plunge</Label><input type="number" className="input" value={t.plunge_rate} onChange={num(i, 'plunge_rate')} /></div>
            <div><Label k="spindle_rpm">RPM</Label><input type="number" step="500" className="input" value={t.spindle_rpm} onChange={num(i, 'spindle_rpm')} /></div>
            <div><Label k="step_over">Step-over</Label><input type="number" step="0.05" min="0.05" max="1" className="input" value={t.step_over} onChange={num(i, 'step_over')} /></div>
            <div><Label k="max_depth">Max prof.</Label><input type="number" className="input" value={t.max_depth} onChange={num(i, 'max_depth')} /></div>
          </div>
          <div className="mt-2"><span className="label">Note</span><input className="input" value={t.notes || ''} onChange={(e) => upd(i, 'notes', e.target.value)} /></div>
        </div>
      ))}
      <Button variant="outline" icon={Plus} onClick={() => onChange([...tools, { ...NEW_TOOL }])}>Aggiungi Utensile</Button>
    </div>
  )
}
