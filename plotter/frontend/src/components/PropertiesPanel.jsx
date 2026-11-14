import { useStore } from '../store'
import { boundsOf, shapeToPolylines } from '../lib/geometry'
import { NumInput } from './ui'
import TextboxProps from './TextboxProps'

const FIELDS = {
  line: [['x1', 'X1'], ['y1', 'Y1'], ['x2', 'X2'], ['y2', 'Y2']],
  rect: [['x', 'X'], ['y', 'Y'], ['w', 'Larghezza'], ['h', 'Altezza']],
  circle: [['cx', 'Centro X'], ['cy', 'Centro Y'], ['r', 'Raggio']],
  text: [['x', 'X'], ['y', 'Y'], ['size', 'Altezza']],
}
const NAMES = { textbox: 'Casella di testo', line: 'Linea', rect: 'Rettangolo', circle: 'Cerchio', polyline: 'Polilinea', polygon: 'Poligono', multi: 'Gruppo', text: 'Testo' }

export default function PropertiesPanel() {
  const { shapes, selected, updateShape, settings, setSettings, tool } = useStore()
  const sel = shapes.filter((s) => selected.includes(s.id))
  const one = sel.length === 1 ? sel[0] : null
  const b = sel.length ? boundsOf(sel.flatMap(shapeToPolylines)) : null

  return (
    <div className="space-y-3 border-t border-line px-3 py-3 text-sm">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-300">
          <input type="checkbox" checked={!!settings.snap} onChange={(e) => setSettings({ snap: e.target.checked })} /> Snap griglia
        </label>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          passo
          <select className="input w-20 py-0.5" value={settings.grid} onChange={(e) => setSettings({ grid: Number(e.target.value) })}>
            {[0.5, 1, 2, 5, 10].map((g) => <option key={g} value={g}>{g} mm</option>)}
          </select>
        </div>
      </div>
      {tool === 'text' && !one && <TextboxProps shape={null} />}
      {!sel.length && <p className="text-xs text-gray-500">Nessun oggetto selezionato.</p>}
      {sel.length > 1 && <p className="text-xs text-gray-400">{sel.length} oggetti selezionati</p>}
      {one?.type === 'textbox' && <TextboxProps shape={one} />}
      {one && one.type !== 'textbox' && (
        <div>
          <div className="label">{NAMES[one.type]}</div>
          {one.type === 'text' && (
            <textarea className="input mb-2 font-mono" rows={2} value={one.text} onChange={(e) => updateShape(one.id, { text: e.target.value })} />
          )}
          {FIELDS[one.type] && (
            <div className="grid grid-cols-2 gap-2">
              {FIELDS[one.type].map(([k, l]) => (
                <label key={k} className="text-[11px] text-gray-500">{l}
                  <NumInput value={Number(one[k]?.toFixed?.(3) ?? one[k])} onChange={(v) => v !== '' && updateShape(one.id, { [k]: v })} />
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {b && isFinite(b.minX) && (
        <p className="font-mono text-[11px] text-gray-500">
          bbox: {b.w.toFixed(1)} × {b.h.toFixed(1)} mm · centro ({((b.minX + b.maxX) / 2).toFixed(1)}, {((b.minY + b.maxY) / 2).toFixed(1)})
        </p>
      )}
    </div>
  )
}
