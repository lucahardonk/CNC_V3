import { useState } from 'react'
import { Circle, CheckCircle2, Download, Eye, Pencil, Play, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import Tooltip from '../common/Tooltip'
import { useStore } from '../../store/store'
import { errMsg, Export } from '../../services/api'
import { cutSummary, effectiveCut } from './LayerParams'
import { DEFAULT_LAYER_ID, normalizeDrawLayers } from './drawLayers'

// Layer del pezzo = layer del disegno unico (stessi nomi e colori del pannello LAYER del CAD).
// Ogni layer è un percorso indipendente: modifica (CAD), simulazione, mostra nel 3D, download .nc.
export default function LayerPanel({ work, activeDl, mode, onSelect, onEdit, onCut, onAdd, onDelete, onRename, onMove }) {
  const tools = useStore((s) => s.tools)
  const notify = useStore((s) => s.notify)
  const settings = useStore((s) => s.settings)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(null)
  const dls = work ? normalizeDrawLayers(work.draw_layers) : []
  const downloadNc = async (d) => {
    setBusy(d.id)
    try { notify(`Scaricato ${await Export.layerNc(work.id, d.id)}`, 'success') } catch (e) { notify(`Download fallito: ${errMsg(e)}`, 'error') } finally { setBusy(null) }
  }

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-r border-line bg-bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Layer <span className="text-gray-500">{dls.length}</span></span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2" data-testid="layer-panel">
        {!dls.length && <p className="p-3 text-center text-xs text-gray-500">Nessun layer. Crea il primo layer per iniziare a disegnare.</p>}
        {dls.map((d, i) => {
          const n = work.dl_counts?.[d.id] || 0
          const why = d.visible === false ? 'Layer nascosto nel CAD' : !n ? 'Layer vuoto: disegna qualcosa prima' : null
          const active = d.id === activeDl
          const computed = !!work.gcode?.includes(`; DLAYER ${d.id} `)
          return (
            <div key={d.id} onClick={() => onSelect(d.id)}
              className={`group cursor-pointer rounded-lg border p-2.5 transition ${active ? 'border-accent/70 bg-accent/5' : 'border-line bg-bg hover:border-gray-600'}`}>
              <div className="flex items-center gap-2">
                <span className="w-5 text-center font-mono text-xs text-gray-500">{i + 1}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} title="Colore del layer (come nel CAD)" />
                {editing === d.id ? (
                  <input autoFocus className="input py-0.5 text-sm" value={name} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setName(e.target.value)} onBlur={() => { onRename(d.id, name); setEditing(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null) }} />
                ) : (
                  <span className="flex-1 truncate text-sm font-medium text-white" onDoubleClick={(e) => { e.stopPropagation(); setEditing(d.id); setName(d.name) }} title="Doppio click per rinominare">{d.name}</span>
                )}
                <Tooltip text={computed ? 'Percorso utensile calcolato' : 'Percorso non ancora calcolato (si calcola aprendo la simulazione)'}>
                  {computed ? <CheckCircle2 size={15} className="text-sky-400" /> : <Circle size={15} className="text-gray-600" />}
                </Tooltip>
              </div>
              <div className="ml-7 mt-1 text-[11px] text-gray-500">{cutSummary(effectiveCut(work, d, settings), tools)} · {n} entità</div>
              <div className="ml-7 mt-2 flex items-center gap-1">
                <Btn tip="Modifica disegno e parametri di taglio (CAD)" onClick={() => onEdit(d.id)} active={mode === 'cad' && active}><Pencil size={13} /></Btn>
                <Btn tip={why || `Simulazione 3D solo di «${d.name}»`} disabled={!!why} onClick={() => onCut(d.id)} active={mode === 'cutting' && active} green><Play size={13} /></Btn>
                <Btn tip="Mostra nel 3D" onClick={() => onSelect(d.id, true)}><Eye size={13} /></Btn>
                <Btn tip={why || `Scarica .nc solo di «${d.name}», da caricare sul bridge wireless`} disabled={!!why || busy === d.id} onClick={() => downloadNc(d)}><Download size={13} className={busy === d.id ? 'animate-pulse' : ''} /></Btn>
                {d.id !== DEFAULT_LAYER_ID && (
                  <div className="ml-auto flex opacity-0 transition group-hover:opacity-100">
                    <Btn tip="Sposta su" disabled={i <= 1} onClick={() => onMove(d.id, -1)}><ArrowUp size={13} /></Btn>
                    <Btn tip="Sposta giù" disabled={i === dls.length - 1} onClick={() => onMove(d.id, 1)}><ArrowDown size={13} /></Btn>
                    <Btn tip="Elimina layer" onClick={() => onDelete(d)} red><Trash2 size={13} /></Btn>
                  </div>
                )}
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
