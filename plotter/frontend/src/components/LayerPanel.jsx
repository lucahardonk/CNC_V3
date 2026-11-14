import { useState } from 'react'
import { Eye, EyeOff, Plus, Trash2, GripVertical, PauseCircle, ArrowDownToLine } from 'lucide-react'
import { useStore } from '../store'

export default function LayerPanel() {
  const { layers, shapes, activeLayerId, setActiveLayer, addLayer, updateLayer, removeLayer, moveLayer, selected, selectedToLayer } = useStore()
  const [editing, setEditing] = useState(null)
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="label mb-0">Layer · ordine di disegno ↓</span>
        <button onClick={() => addLayer()} title="Nuovo layer" className="rounded p-1 text-gray-400 hover:bg-bg-hover hover:text-white"><Plus size={16} /></button>
      </div>
      <div className="space-y-1 px-2 pb-2">
        {layers.map((l, i) => {
          const count = shapes.filter((s) => s.layerId === l.id).length
          return (
            <div key={l.id}
              draggable={editing !== l.id}
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(i) }}
              onDrop={() => { if (dragIdx !== null) moveLayer(dragIdx, i); setDragIdx(null); setOverIdx(null) }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
              onClick={() => setActiveLayer(l.id)}
              className={`group flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-sm ${l.id === activeLayerId ? 'border-accent/60 bg-accent/10' : 'border-line bg-bg-card'} ${overIdx === i && dragIdx !== i ? 'ring-1 ring-blue-500' : ''}`}>
              <GripVertical size={14} className="cursor-grab text-gray-600" />
              <input type="color" value={l.color} onClick={(e) => e.stopPropagation()} onChange={(e) => updateLayer(l.id, { color: e.target.value })}
                className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0" title="Colore anteprima" />
              {editing === l.id ? (
                <input autoFocus className="input py-0.5" defaultValue={l.name}
                  onBlur={(e) => { updateLayer(l.id, { name: e.target.value || l.name }); setEditing(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(null) }} />
              ) : (
                <span className="flex-1 truncate" onDoubleClick={() => setEditing(l.id)} title="Doppio click per rinominare">{l.name}</span>
              )}
              <span className="text-[10px] text-gray-500">{count}</span>
              <button title="Pausa per cambio penna prima di questo layer" onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { pause: !l.pause }) }}
                className={l.pause ? 'text-amber-400' : 'text-gray-600 hover:text-gray-300'}><PauseCircle size={15} /></button>
              <button title={l.visible ? 'Nascondi (escluso dal G-code)' : 'Mostra'} onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { visible: !l.visible }) }}
                className="text-gray-400 hover:text-white">{l.visible ? <Eye size={15} /> : <EyeOff size={15} className="text-gray-600" />}</button>
              <button title="Elimina layer e contenuto" onClick={(e) => { e.stopPropagation(); if (!count || confirm(`Eliminare "${l.name}" e ${count} oggetti?`)) removeLayer(l.id) }}
                className="text-gray-600 opacity-0 hover:text-red-400 group-hover:opacity-100"><Trash2 size={14} /></button>
            </div>
          )
        })}
      </div>
      {selected.length > 0 && (
        <button onClick={() => selectedToLayer(activeLayerId)} className="mx-2 mb-2 flex items-center justify-center gap-1 rounded-md border border-line py-1 text-xs text-gray-300 hover:bg-bg-hover">
          <ArrowDownToLine size={13} /> Sposta {selected.length} selezionati nel layer attivo
        </button>
      )}
    </div>
  )
}
