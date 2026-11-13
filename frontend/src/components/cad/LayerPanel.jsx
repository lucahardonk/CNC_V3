import { useState } from 'react'
import { CheckCircle2, Circle, Download, Eye, Pencil, Play, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import Tooltip from '../common/Tooltip'
import { OPERATION_NAMES, useStore } from '../../store/store'

export default function LayerPanel({ layers, activeId, mode, onSelect, onEdit, onCut, onAdd, onDelete, onRename, onMove }) {
  const tools = useStore((s) => s.tools)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-r border-line bg-bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Layer di lavorazione</span>
        <span className="text-xs text-gray-500">{layers.length}</span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {layers.length === 0 && <p className="p-3 text-center text-xs text-gray-500">Nessun layer. Crea il primo layer per iniziare a disegnare.</p>}
        {layers.map((l, i) => {
          const tool = tools.find((t) => t.id === l.tool_id)
          const active = l.id === activeId
          return (
            <div key={l.id} onClick={() => onSelect(l.id)}
              className={`group cursor-pointer rounded-lg border p-2.5 transition ${active ? 'border-accent/70 bg-accent/5' : 'border-line bg-bg hover:border-gray-600'}`}>
              <div className="flex items-center gap-2">
                <span className="w-5 text-center font-mono text-xs text-gray-500">{i + 1}</span>
                {editing === l.id ? (
                  <input autoFocus className="input py-0.5 text-sm" value={name} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setName(e.target.value)} onBlur={() => { onRename(l.id, name); setEditing(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null) }} />
                ) : (
                  <span className="flex-1 truncate text-sm font-medium text-white" onDoubleClick={(e) => { e.stopPropagation(); setEditing(l.id); setName(l.name) }} title="Doppio click per rinominare">{l.name}</span>
                )}
                <Tooltip text={l.is_complete ? 'Taglio completato' : l.gcode ? 'G-code pronto' : 'G-code non generato'}>
                  {l.is_complete ? <CheckCircle2 size={15} className="text-accent" /> : <Circle size={15} className={l.gcode ? 'text-sky-400' : 'text-gray-600'} />}
                </Tooltip>
              </div>
              <div className="ml-7 mt-1 text-[11px] text-gray-500">
                {l.gcode ? `${OPERATION_NAMES[l.operation]} · ${tool ? `Ø${tool.diameter}` : '?'} · ${l.params?.depth_total ?? '?'} mm` : `${l.entity_count} entità · nessun G-code`}
              </div>
              <div className="ml-7 mt-2 flex items-center gap-1">
                <Btn tip="Modifica disegno (CAD)" onClick={() => onEdit(l.id)} active={mode === 'cad' && active}><Pencil size={13} /></Btn>
                <Btn tip={l.gcode ? 'Vai al taglio' : 'Genera prima il G-code'} disabled={!l.gcode} onClick={() => onCut(l.id)} active={mode === 'cutting' && active} green><Play size={13} /></Btn>
                <Btn tip="Mostra nel 3D" onClick={() => onSelect(l.id, true)}><Eye size={13} /></Btn>
                {l.gcode && <a href={`/api/layers/${l.id}/gcode`} onClick={(e) => e.stopPropagation()}><Btn tip="Scarica .nc"><Download size={13} /></Btn></a>}
                <div className="ml-auto flex opacity-0 transition group-hover:opacity-100">
                  <Btn tip="Sposta su" disabled={i === 0} onClick={() => onMove(l.id, -1)}><ArrowUp size={13} /></Btn>
                  <Btn tip="Sposta giù" disabled={i === layers.length - 1} onClick={() => onMove(l.id, 1)}><ArrowDown size={13} /></Btn>
                  <Btn tip="Elimina layer" onClick={() => onDelete(l)} red><Trash2 size={13} /></Btn>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="border-t border-line p-2">
        <button onClick={onAdd} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2.5 text-sm text-gray-400 transition hover:border-accent hover:text-accent">
          <Plus size={16} /> Nuovo Layer
        </button>
      </div>
    </div>
  )
}

const Btn = ({ children, tip, onClick, disabled, active, green, red }) => (
  <Tooltip text={tip}>
    <button disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick?.() }}
      className={`rounded p-1.5 transition disabled:opacity-30 ${active ? 'bg-accent text-black' : green ? 'text-accent hover:bg-accent/15' : red ? 'text-red-400 hover:bg-red-500/15' : 'text-gray-400 hover:bg-bg-hover hover:text-white'}`}>
      {children}
    </button>
  </Tooltip>
)
