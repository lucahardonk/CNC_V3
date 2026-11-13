import { Circle, Copy, FlipHorizontal2, GitCommitHorizontal, MousePointer2, Ruler, Scissors, Slash, Spline, Square, Minus, CornerDownRight } from 'lucide-react'
import Tooltip from '../common/Tooltip'

export const TOOLS = [
  { id: 'select', icon: MousePointer2, label: 'Seleziona', key: 'S', help: 'Click per selezionare (Shift = aggiungi), trascina per box-select, trascina un oggetto selezionato per spostarlo.' },
  { id: 'line', icon: Slash, label: 'Linea', key: 'L', help: 'Click inizio, click fine (concatena). Shift = orizzontale/verticale. Esc o tasto destro per terminare.' },
  { id: 'rect', icon: Square, label: 'Rettangolo', key: 'R', help: 'Click un angolo, click angolo opposto.' },
  { id: 'circle', icon: Circle, label: 'Cerchio', key: 'C', help: 'Click centro, click punto sul raggio.' },
  { id: 'arc', icon: Spline, label: 'Arco', key: 'A', help: 'Click centro, click inizio, click fine (verso antiorario).' },
  { id: 'construction', icon: Minus, label: 'Costruzione', key: 'X', help: 'Linea di costruzione tratteggiata: non genera percorso utensile.' },
  { id: 'trim', icon: Scissors, label: 'Taglia (Trim)', key: 'T', help: 'Click sul tratto da eliminare tra due intersezioni.' },
  { id: 'mirror', icon: FlipHorizontal2, label: 'Specchio', key: 'M', help: "Seleziona le entità, poi click due punti dell'asse di specchio." },
  { id: 'fillet', icon: CornerDownRight, label: 'Raccordo', key: 'F', help: 'Click prima linea, click seconda linea (dal lato da mantenere): inserisce un arco tangente col raggio impostato.' },
  { id: 'dimension', icon: Ruler, label: 'Quota', key: 'D', help: 'Click due punti: mostra la distanza (solo visivo).' },
  { id: 'bridge', icon: GitCommitHorizontal, label: 'Ponticello (tab)', key: 'B', help: 'Click vicino a un contorno per aggiungere un ponticello, oppure due click per un rettangolo libero. Il taglio si alza in quei tratti.' },
]

export default function Toolbar({ tool, setTool, onCopy, canCopy }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-bg-panel py-2">
      {TOOLS.map((t) => (
        <Tooltip key={t.id} side="right" text={<span><b>{t.label}</b> <span className="kbd">{t.key}</span><br />{t.help}</span>}>
          <button onClick={() => setTool(t.id)}
            className={`flex h-9 w-9 items-center justify-center rounded-md transition ${tool === t.id ? 'bg-accent text-black' : 'text-gray-300 hover:bg-bg-hover hover:text-white'}`}>
            <t.icon size={18} />
          </button>
        </Tooltip>
      ))}
      <div className="my-1 h-px w-8 bg-line" />
      <Tooltip side="right" text={<span><b>Copia selezionati</b> <span className="kbd">Ctrl+D</span><br />Duplica le entità selezionate con un offset.</span>}>
        <button disabled={!canCopy} onClick={onCopy} className="flex h-9 w-9 items-center justify-center rounded-md text-gray-300 hover:bg-bg-hover hover:text-white disabled:opacity-30">
          <Copy size={18} />
        </button>
      </Tooltip>
    </div>
  )
}
