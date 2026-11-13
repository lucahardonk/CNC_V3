import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Circle, Copy, CornerDownRight, FlipHorizontal2, GitCommitHorizontal, Grid3x3, Minus, MousePointer2, RefreshCw, Ruler, Scissors, Slash, Spline, Square } from 'lucide-react'
import Tooltip from '../common/Tooltip'

// Icone SVG semplici (stile lucide) per le varianti senza icona dedicata
const ico = (children) => function Ico({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  )
}
const Dot = ({ x, y }) => <circle cx={x} cy={y} r={1.6} fill="currentColor" stroke="none" />
const I = {
  lineMid: ico(<><path d="M4 20 20 4" /><Dot x={12} y={12} /></>),
  rectCenter: ico(<><rect x="3" y="5" width="18" height="14" rx="1" /><Dot x={12} y={12} /></>),
  rect3: ico(<><path d="M4 15 13 4l7 6-9 11z" /><Dot x={4} y={15} /><Dot x={13} y={4} /><Dot x={20} y={10} /></>),
  circle2: ico(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" strokeDasharray="2 2" /><Dot x={3} y={12} /><Dot x={21} y={12} /></>),
  circle3: ico(<><circle cx="12" cy="12" r="9" /><Dot x={3.5} y={9} /><Dot x={18} y={5} /><Dot x={15} y={20.5} /></>),
  arc3: ico(<><path d="M4 18A9 9 0 0 1 20 18" /><Dot x={4} y={18} /><Dot x={12} y={9} /><Dot x={20} y={18} /></>),
  arcSER: ico(<><path d="M4 18A9 9 0 0 1 20 18" /><path d="M12 18 6.5 11" strokeDasharray="2 2" /><Dot x={4} y={18} /><Dot x={20} y={18} /></>),
  ellipse: ico(<ellipse cx="12" cy="12" rx="10" ry="6" />),
  slot: ico(<rect x="2" y="8" width="20" height="8" rx="4" />),
  spline: ico(<><path d="M3 17c3-8 6-8 9-4s6 4 9-4" /><Dot x={3} y={17} /><Dot x={12} y={13} /><Dot x={21} y={9} /></>),
  mirrorLine: ico(<><path d="M12 3v18" /><path d="M8 7 4 12l4 5" /><path d="m16 7 4 5-4 5" /></>),
  dim: ico(<><path d="M4 7v10M20 7v10M4 12h16" /><path d="m7 9-3 3 3 3M17 9l3 3-3 3" /></>),
}

const T = (id, icon, label, help) => ({ id, icon, label, help })

// Gruppi di strumenti: ogni gruppo ha un tasto, il tasto cicla tra le varianti.
export const TOOL_GROUPS = [
  { id: 'select', key: 'S', items: [T('select', MousePointer2, 'Seleziona', 'Click per selezionare (Shift = aggiungi), trascina per box-select, trascina un oggetto selezionato per spostarlo.')] },
  { id: 'line', key: 'L', label: 'Linea', items: [
    T('line', Slash, 'Linea punto-punto', 'Click inizio, click fine (concatena). Shift = orto. Esc/tasto destro per terminare.'),
    T('line_midpoint', I.lineMid, 'Linea dal punto medio', 'Click punto medio, click estremo: la linea si estende simmetrica.'),
  ] },
  { id: 'rect', key: 'R', label: 'Rettangolo', items: [
    T('rect', Square, 'Rettangolo 2 angoli', 'Click un angolo, click angolo opposto.'),
    T('rect_center', I.rectCenter, 'Rettangolo dal centro', 'Click centro, click vertice.'),
    T('rect_3pt', I.rect3, 'Rettangolo 3 punti', 'Click inizio lato, click fine lato, click per la larghezza (anche ruotato).'),
  ] },
  { id: 'circle', key: 'C', label: 'Cerchio', items: [
    T('circle', Circle, 'Cerchio centro-raggio', 'Click centro, click punto sul raggio.'),
    T('circle_2pt', I.circle2, 'Cerchio 2 punti (diametro)', 'Click due estremi del diametro.'),
    T('circle_3pt', I.circle3, 'Cerchio 3 punti', 'Click tre punti sulla circonferenza.'),
  ] },
  { id: 'arc', key: 'A', label: 'Arco', items: [
    T('arc', Spline, 'Arco centro-inizio-fine', 'Click centro, click inizio, click fine (antiorario).'),
    T('arc_3pt', I.arc3, 'Arco 3 punti', 'Click inizio, click punto intermedio, click fine.'),
    T('arc_start_end_radius', I.arcSER, 'Arco inizio-fine-raggio', 'Click inizio, click fine, imposta il raggio e click dal lato della curvatura.'),
  ] },
  { id: 'ellipse', key: 'E', label: 'Ellisse', items: [T('ellipse', I.ellipse, 'Ellisse', 'Click centro, click estremo asse X (rx e rotazione), click per il semiasse Y.')] },
  { id: 'slot', key: 'O', label: 'Asola', items: [T('slot_center', I.slot, 'Asola dal centro', 'Click centro, click estremo (centro semicerchio). La larghezza si imposta nel pannello.')] },
  { id: 'spline', key: 'P', label: 'Spline', items: [T('spline', I.spline, 'Spline', 'Click N punti, Invio / doppio click / tasto destro per confermare.')] },
  { id: 'construction', key: 'X', items: [T('construction', Minus, 'Costruzione', 'Linea di costruzione tratteggiata: non genera percorso utensile.')] },
  { sep: true },
  { id: 'trim', key: 'T', items: [T('trim', Scissors, 'Taglia (Trim)', 'Click sul tratto da eliminare tra le due intersezioni più vicine. Senza intersezioni elimina tutta la geometria.')] },
  { id: 'mirror', key: 'M', label: 'Specchio', needsSel: true, items: [
    T('mirror', FlipHorizontal2, 'Specchio su 2 punti', "Seleziona le entità, poi click due punti dell'asse."),
    T('mirror_on_line', I.mirrorLine, 'Specchio su linea esistente', "Seleziona le entità, poi click su una linea del disegno come asse."),
  ] },
  { id: 'array', key: 'G', label: 'Serie', needsSel: true, items: [
    T('array_circular', RefreshCw, 'Serie circolare', 'Seleziona le entità, click centro di rotazione, imposta quantità e angolo.'),
    T('array_rect', Grid3x3, 'Serie rettangolare', 'Seleziona le entità, imposta colonne, righe e passi X/Y.'),
  ] },
  { id: 'fillet', key: 'F', items: [T('fillet', CornerDownRight, 'Raccordo', 'Click prima linea, poi passa sulla seconda (anteprima) e click: arco tangente col raggio R.')] },
  { id: 'dimension', key: 'D', items: [T('dimension', I.dim, 'Quota', 'Linea → quota lineare, cerchio → diametro, arco → raggio, due linee → angolo, due punti → distanza.')] },
  { id: 'measure', key: 'N', items: [T('measure', Ruler, 'Misura', 'Click su linea, cerchio/arco, due linee o due punti: mostra le misure senza creare entità.')] },
  { id: 'bridge', key: 'B', items: [T('bridge', GitCommitHorizontal, 'Ponticello (tab)', 'Click vicino a un contorno per aggiungere un ponticello, oppure due click per un rettangolo libero.')] },
]

export const SELECTION_TOOLS = ['mirror', 'mirror_on_line', 'array_circular', 'array_rect']
export const ALL_TOOLS = TOOL_GROUPS.filter((g) => !g.sep).flatMap((g) => g.items.map((t) => ({ ...t, group: g.id, key: g.key })))

// Tasto → prossimo strumento (cicla le varianti del gruppo se già attivo)
export function toolForKey(key, current) {
  const g = TOOL_GROUPS.find((x) => x.key && x.key.toLowerCase() === key.toLowerCase())
  if (!g) return null
  const i = g.items.findIndex((t) => t.id === current)
  return g.items[i === -1 ? 0 : (i + 1) % g.items.length].id
}

export default function Toolbar({ tool, setTool, onCopy, canCopy, hasSelection }) {
  const [openGroup, setOpenGroup] = useState(null) // {id, top, left}
  const [last, setLast] = useState({})
  const closeT = useRef(null)

  useEffect(() => {
    const g = TOOL_GROUPS.find((x) => x.items?.some((t) => t.id === tool))
    if (g) setLast((l) => (l[g.id] === tool ? l : { ...l, [g.id]: tool }))
    setOpenGroup(null)
  }, [tool])

  const open = (g, el) => {
    clearTimeout(closeT.current)
    const r = el.getBoundingClientRect()
    setOpenGroup({ id: g.id, top: r.top, left: r.right + 6 })
  }
  const scheduleClose = () => { clearTimeout(closeT.current); closeT.current = setTimeout(() => setOpenGroup(null), 180) }

  const btnCls = (active, disabled) => `relative flex h-9 w-9 items-center justify-center rounded-md transition ${disabled ? 'cursor-not-allowed text-gray-600'
    : active ? 'bg-accent text-black' : 'text-gray-300 hover:bg-bg-hover hover:text-white'}`

  const flyGroup = openGroup && TOOL_GROUPS.find((g) => g.id === openGroup.id)

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line bg-bg-panel py-2">
      {TOOL_GROUPS.map((g, gi) => {
        if (g.sep) return <div key={'sep' + gi} className="my-1 h-px w-8 shrink-0 bg-line" />
        const cur = g.items.find((t) => t.id === tool) || g.items.find((t) => t.id === last[g.id]) || g.items[0]
        const active = g.items.some((t) => t.id === tool)
        const disabled = g.needsSel && !hasSelection
        if (g.items.length === 1) {
          const t = g.items[0]
          return (
            <Tooltip key={g.id} side="right" text={<span><b>{t.label}</b> <span className="kbd">{g.key}</span><br />{t.help}</span>}>
              <button disabled={disabled} onClick={() => setTool(t.id)} className={btnCls(active, disabled)}><t.icon size={18} /></button>
            </Tooltip>
          )
        }
        return (
          <div key={g.id} className="shrink-0" onMouseEnter={(e) => open(g, e.currentTarget)} onMouseLeave={scheduleClose}>
            <button disabled={disabled} className={btnCls(active, disabled)}
              onClick={(e) => { setTool(cur.id); open(g, e.currentTarget.parentElement) }}>
              <cur.icon size={18} />
              <svg className="absolute bottom-[3px] right-[3px] opacity-60" width="5" height="5"><path d="M5 0V5H0z" fill="currentColor" /></svg>
            </button>
          </div>
        )
      })}
      <div className="my-1 h-px w-8 shrink-0 bg-line" />
      <Tooltip side="right" text={<span><b>Copia selezionati</b> <span className="kbd">Ctrl+D</span><br />Duplica le entità selezionate con un offset.</span>}>
        <button disabled={!canCopy} onClick={onCopy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-300 hover:bg-bg-hover hover:text-white disabled:opacity-30">
          <Copy size={18} />
        </button>
      </Tooltip>

      {flyGroup && createPortal(
        <div className="animate-fade fixed z-[60] w-64 rounded-lg border border-line bg-bg-card py-1 shadow-2xl"
          style={{ top: openGroup.top, left: openGroup.left }}
          onMouseEnter={() => clearTimeout(closeT.current)} onMouseLeave={scheduleClose}>
          <div className="flex items-center justify-between px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <span>{flyGroup.label}</span><span className="kbd">{flyGroup.key}</span>
          </div>
          {flyGroup.needsSel && !hasSelection && <div className="px-3 pb-1 text-[11px] text-yellow-400">Seleziona prima le entità</div>}
          {flyGroup.items.map((t) => {
            const dis = flyGroup.needsSel && !hasSelection
            return (
              <button key={t.id} disabled={dis} onClick={() => { setTool(t.id); setOpenGroup(null) }}
                className={`flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition disabled:opacity-40 ${tool === t.id ? 'bg-accent/15 text-white' : 'text-gray-300 hover:bg-bg-hover'}`}>
                <span className={`mt-0.5 ${tool === t.id ? 'text-accent' : ''}`}><t.icon size={16} /></span>
                <span className="min-w-0">
                  <span className="block text-sm">{t.label}</span>
                  <span className="block text-[11px] leading-snug text-gray-500">{t.help}</span>
                </span>
              </button>
            )
          })}
        </div>, document.body)}
    </div>
  )
}
