import { useEffect, useState } from 'react'
import { Eye, EyeOff, GripVertical, Lock, LockOpen, Plus, Trash2, CornerDownLeft } from 'lucide-react'
import Modal from '../common/Modal'
import Button from '../common/Button'
import Tooltip from '../common/Tooltip'
import { DEFAULT_LAYER_ID, LAYER_PALETTE, nextLayerColor } from './drawLayers'

const DRAG_MIME = 'application/x-cnc-selection'

// Pannello Layer di disegno (stile AutoCAD/Photoshop): visibilità, blocco, colore, layer corrente,
// assegnazione della selezione (pulsante, drag & drop del badge selezione, menu tasto destro nel canvas).
export default function DrawLayerPanel({ layers, activeId, setActive, counts, selectionCount, onToggleVisible, onToggleLock, onColor, onRename, onAdd, onDelete, onAssignSelection }) {
  const [adding, setAdding] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [dropOver, setDropOver] = useState(null)
  const active = layers.find((l) => l.id === activeId)

  const openAdd = () => setAdding(true)

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Layer</span>
        <div className="flex items-center gap-0.5">
          <Tooltip text="Nuovo layer (nome + colore)">
            <button onClick={openAdd} className="rounded p-1 text-gray-300 hover:bg-bg-hover hover:text-white"><Plus size={15} /></button>
          </Tooltip>
          <Tooltip text={active?.id === DEFAULT_LAYER_ID ? 'Il Layer 0 non può essere eliminato' : `Elimina "${active?.name}" (entità → Layer 0)`}>
            <button disabled={!active || active.id === DEFAULT_LAYER_ID} onClick={() => setToDelete(active)}
              className="rounded p-1 text-red-400 hover:bg-red-500/15 disabled:opacity-30"><Trash2 size={15} /></button>
          </Tooltip>
        </div>
      </div>

      {selectionCount > 0 && (
        <div draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_MIME, '1'); e.dataTransfer.setData('text/plain', 'selection'); e.dataTransfer.effectAllowed = 'move' }}
          className="mx-2 mb-1.5 flex cursor-grab items-center gap-1.5 rounded-md border border-dashed border-blue-500/60 bg-blue-500/10 px-2 py-1 text-[11px] text-blue-200 active:cursor-grabbing"
          title="Trascina su un layer per spostare la selezione">
          <GripVertical size={12} /> {selectionCount} entità selezionate · trascina su un layer
        </div>
      )}

      <div className="max-h-[38vh] min-h-[90px] space-y-0.5 overflow-y-auto px-2 pb-2">
        {layers.map((l) => {
          const isActive = l.id === activeId
          return (
            <div key={l.id} onClick={() => setActive(l.id)}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setDropOver(l.id) } }}
              onDragLeave={() => setDropOver((d) => (d === l.id ? null : d))}
              onDrop={(e) => { e.preventDefault(); setDropOver(null); if (e.dataTransfer.types.includes(DRAG_MIME)) onAssignSelection(l.id) }}
              className={`group flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-1 transition ${dropOver === l.id ? 'border-blue-400 bg-blue-500/20'
                : isActive ? 'border-accent/60 bg-accent/10' : 'border-transparent hover:bg-bg-hover'}`}>
              <IconBtn tip={l.visible ? 'Nascondi (esclude anche dal G-code)' : 'Mostra'} onClick={() => onToggleVisible(l.id)}>
                {l.visible ? <Eye size={14} /> : <EyeOff size={14} className="text-gray-600" />}
              </IconBtn>
              <IconBtn tip={l.locked ? 'Sblocca' : 'Blocca (non selezionabile né modificabile)'} onClick={() => onToggleLock(l.id)}>
                {l.locked ? <Lock size={13} className="text-yellow-400" /> : <LockOpen size={13} className="text-gray-500" />}
              </IconBtn>
              <Tooltip text="Cambia colore">
                <label className="relative h-3.5 w-3.5 shrink-0 cursor-pointer rounded-sm border border-black/40" style={{ background: l.color }} onClick={(e) => e.stopPropagation()}>
                  <input type="color" value={l.color} onChange={(e) => onColor(l.id, e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                </label>
              </Tooltip>
              {editing === l.id ? (
                <input autoFocus className="input ml-1 min-w-0 flex-1 py-0 text-xs" value={name} onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim()) onRename(l.id, name.trim()); setEditing(null) }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null) }} />
              ) : (
                <span className={`ml-1 min-w-0 flex-1 truncate text-xs ${l.visible ? 'text-gray-100' : 'text-gray-500 line-through'} ${isActive ? 'font-semibold' : ''}`}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditing(l.id); setName(l.name) }} title="Doppio click per rinominare · click = layer corrente">
                  {l.name}
                </span>
              )}
              <span className="font-mono text-[10px] text-gray-500">{counts[l.id] || 0}</span>
              {selectionCount > 0 && (
                <IconBtn tip={`Sposta qui le ${selectionCount} entità selezionate`} onClick={() => onAssignSelection(l.id)} className="opacity-0 group-hover:opacity-100">
                  <CornerDownLeft size={13} />
                </IconBtn>
              )}
            </div>
          )
        })}
      </div>
      <p className="px-3 pb-2 text-[10px] leading-snug text-gray-500">Layer corrente (evidenziato) = dove finiscono le nuove entità. Tasto destro su un'entità → «Assegna a layer».</p>

      <NewLayerModal open={adding} layers={layers} selectionCount={selectionCount} onCancel={() => setAdding(false)}
        onCreate={(n, c) => { onAdd(n, c); setAdding(false) }} />

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Elimina layer"
        footer={<><Button onClick={() => setToDelete(null)}>Annulla</Button><Button variant="danger" onClick={() => { onDelete(toDelete.id); setToDelete(null) }}>Elimina</Button></>}>
        <p className="text-sm text-gray-300">Eliminare il layer <b className="text-white">{toDelete?.name}</b>? Le sue <b className="text-white">{counts[toDelete?.id] || 0}</b> entità verranno spostate sul <b className="text-white">Layer 0</b>.</p>
      </Modal>
    </div>
  )
}

const IconBtn = ({ children, tip, onClick, className = '' }) => (
  <Tooltip text={tip}>
    <button onClick={(e) => { e.stopPropagation(); onClick() }} className={`rounded p-0.5 text-gray-300 hover:bg-bg-hover hover:text-white ${className}`}>{children}</button>
  </Tooltip>
)

// Dialog nuovo layer (nome + colore), riusato anche dal menu tasto destro del canvas
export function NewLayerModal({ open, layers, selectionCount = 0, onCancel, onCreate, title = 'Nuovo layer' }) {
  const [f, setF] = useState({ name: '', color: LAYER_PALETTE[1] })
  useEffect(() => { if (open) setF({ name: `Layer ${layers.length}`, color: nextLayerColor(layers) }) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const ok = () => { if (f.name.trim()) onCreate(f.name.trim(), f.color) }
  return (
    <Modal open={!!open} onClose={onCancel} title={title}
      footer={<><Button onClick={onCancel}>Annulla</Button><Button variant="primary" onClick={ok} disabled={!f.name.trim()}>Crea layer</Button></>}>
      <div className="space-y-3">
        <div>
          <span className="label">Nome</span>
          <input autoFocus className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') ok() }} />
          {layers.some((l) => l.name.toLowerCase() === f.name.trim().toLowerCase()) && <p className="mt-1 text-xs text-yellow-400">Esiste già un layer con questo nome</p>}
        </div>
        <div>
          <span className="label">Colore</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {LAYER_PALETTE.map((c) => (
              <button key={c} onClick={() => setF({ ...f, color: c })} style={{ background: c }}
                className={`h-6 w-6 rounded border-2 ${f.color === c ? 'border-white' : 'border-transparent'}`} />
            ))}
            <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" title="Colore personalizzato" />
          </div>
        </div>
        {selectionCount > 0 && <p className="text-xs text-gray-400">Le {selectionCount} entità selezionate possono essere spostate qui (trascina il badge o tasto destro → Assegna a layer).</p>}
      </div>
    </Modal>
  )
}
