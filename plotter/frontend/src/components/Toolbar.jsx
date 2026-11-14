import { MousePointer2, Minus, Square, Circle, Spline, Pentagon, Type, Undo2, Redo2, Copy, Trash2, Maximize } from 'lucide-react'
import { useStore } from '../store'

const TOOLS = [
  ['select', MousePointer2, 'Seleziona / sposta (V)'],
  ['line', Minus, 'Linea (L)'],
  ['rect', Square, 'Rettangolo (R)'],
  ['circle', Circle, 'Cerchio (C)'],
  ['polyline', Spline, 'Polilinea (P) – doppio click/Invio per finire'],
  ['polygon', Pentagon, 'Poligono chiuso (G) – click sul primo punto/Invio'],
  ['text', Type, 'Casella di testo (T) – click sul foglio per inserirla'],
]

export default function Toolbar() {
  const { tool, setTool, undo, redo, duplicateSelected, deleteSelected, selected, history, future, preview } = useStore()
  const b = 'flex h-9 w-9 items-center justify-center rounded-md transition'
  return (
    <div className="flex w-12 flex-col items-center gap-1 border-r border-line bg-bg-panel py-2">
      {TOOLS.map(([id, Icon, title]) => (
        <button key={id} title={title} disabled={preview} onClick={() => setTool(id)}
          className={`${b} ${tool === id ? 'bg-accent-dark text-white' : 'text-gray-400 hover:bg-bg-hover hover:text-white'} disabled:opacity-30`}>
          <Icon size={18} />
        </button>
      ))}
      <div className="my-1 h-px w-8 bg-line" />
      <button title="Annulla (Ctrl+Z)" disabled={!history.length} onClick={undo} className={`${b} text-gray-400 hover:bg-bg-hover disabled:opacity-30`}><Undo2 size={17} /></button>
      <button title="Ripeti (Ctrl+Y)" disabled={!future.length} onClick={redo} className={`${b} text-gray-400 hover:bg-bg-hover disabled:opacity-30`}><Redo2 size={17} /></button>
      <button title="Duplica (Ctrl+D)" disabled={!selected.length} onClick={duplicateSelected} className={`${b} text-gray-400 hover:bg-bg-hover disabled:opacity-30`}><Copy size={17} /></button>
      <button title="Elimina (Canc)" disabled={!selected.length} onClick={deleteSelected} className={`${b} text-gray-400 hover:bg-bg-hover disabled:opacity-30`}><Trash2 size={17} /></button>
      <div className="my-1 h-px w-8 bg-line" />
      <button title="Adatta vista (F)" onClick={() => window.dispatchEvent(new Event('plotter:fit'))} className={`${b} text-gray-400 hover:bg-bg-hover`}><Maximize size={17} /></button>
    </div>
  )
}
