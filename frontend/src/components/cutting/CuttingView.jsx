import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Crosshair, Pause, Play, Square } from 'lucide-react'
import { PROFILE_COLOR, ProfileOutline, SceneBase, StockMesh, Toolpath, useLayerEntities } from '../viewer3d/StockViewer'
import Modal from '../common/Modal'
import Button from '../common/Button'
import JogController from './JogController'
import { stateColor } from './GRBLConsole'
import { errMsg, Grbl, Layers } from '../../services/api'
import { useStore } from '../../store/store'
import { parseGcode } from '../../utils/gcodeParser'

function ToolBit({ pos, diameter }) {
  const h = 25
  return (
    <group position={[pos[0], pos[1], pos[2]]}>
      <mesh position={[0, 0, h / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[diameter / 2, diameter / 2, h, 24]} />
        <meshStandardMaterial color="#d1d5db" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0, h + 15]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[diameter * 1.8, diameter * 1.8, 30, 24]} />
        <meshStandardMaterial color="#374151" metalness={0.5} roughness={0.5} transparent opacity={0.6} />
      </mesh>
    </group>
  )
}

export default function CuttingView({ project, layer, onBack, onLayerUpdated }) {
  const { grbl, tools, notify, lastJobDone } = useStore()
  const [zeroOpen, setZeroOpen] = useState(true)
  const [confirmPlay, setConfirmPlay] = useState(false)
  const tool = tools.find((t) => t.id === layer.tool_id)
  const parsed = useMemo(() => parseGcode(layer.gcode), [layer.gcode])
  const profileEnts = useLayerEntities(layer.id)
  const job = grbl.job || {}
  const myJob = job.layer_id === layer.id
  const running = myJob && job.running
  const pct = myJob && job.total ? Math.round((job.acked / job.total) * 100) : 0

  useEffect(() => {
    if (lastJobDone && lastJobDone.layer_id === layer.id && lastJobDone.completed && Date.now() - lastJobDone.at < 5000) {
      Layers.update(layer.id, { is_complete: true }).then(onLayerUpdated).catch(() => {})
      notify('Taglio completato ✓', 'success')
    }
  }, [lastJobDone])

  const act = (fn) => async () => { try { await fn() } catch (e) { notify(errMsg(e), 'error') } }
  const play = act(async () => { setConfirmPlay(false); await Grbl.sendLayer(layer.id) })
  const zero = (a) => act(async () => { await Grbl.zero(a); notify(`Zero ${a.toUpperCase()} impostato`, 'success') })

  const pos = grbl.wpos || [0, 0, 0]

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-bg-panel px-3">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack} disabled={running}>Vista 3D</Button>
        <div className="mx-2 h-5 w-px bg-line" />
        <span className="text-sm text-gray-400">Taglio layer:</span><span className="text-sm font-semibold text-white">{layer.name}</span>
        <span className="text-xs text-gray-500">· {tool?.name || 'utensile ?'} · {parsed.points.length} linee</span>
        <Button size="sm" variant="ghost" icon={Crosshair} className="ml-auto" onClick={() => setZeroOpen(true)} disabled={running}>Imposta zero pezzo</Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <SceneBase project={project}>
          <StockMesh project={project} opacity={0.3} />
          <ProfileOutline entities={profileEnts} />
          <Toolpath gcode={layer.gcode} rapidColor="#facc15" cutColor="#22d3ee" />
          <ToolBit pos={pos} diameter={tool?.diameter || 3} />
        </SceneBase>
        <div className="pointer-events-none absolute left-3 top-3 space-y-1 rounded-md bg-black/60 px-3 py-2 font-mono text-xs text-gray-300">
          <div>X {pos[0].toFixed(3)}</div><div>Y {pos[1].toFixed(3)}</div><div>Z {pos[2].toFixed(3)}</div>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-3 py-1.5 text-xs text-gray-400">
          <span className="text-yellow-400">━</span> rapido G0 <span className="ml-2 text-cyan-400">━</span> taglio G1 <span className="ml-2" style={{ color: PROFILE_COLOR }}>━</span> profilo originale · utensile Ø {tool?.diameter || 3} mm in scala
        </div>
        {grbl.simulated && <div className="absolute right-3 top-12 rounded-md border border-yellow-500/40 bg-black/70 px-3 py-1 text-[11px] text-yellow-300">Modalità simulazione: nessuna macchina collegata</div>}
      </div>
      <div className="flex shrink-0 items-center gap-4 border-t border-line bg-bg-panel px-4 py-3">
        {!running ? (
          <button onClick={() => setConfirmPlay(true)} disabled={!grbl.connected || job.running || !grbl.state?.startsWith('Idle')}
            className="flex items-center gap-2 rounded-lg bg-accent px-7 py-3 text-base font-extrabold text-black shadow-lg shadow-green-900/40 transition hover:bg-accent-light active:scale-95 disabled:opacity-40">
            <Play size={22} fill="black" /> PLAY
          </button>
        ) : job.paused ? (
          <button onClick={act(Grbl.resume)} className="flex items-center gap-2 rounded-lg bg-accent px-6 py-3 font-bold text-black"><Play size={20} /> RIPRENDI</button>
        ) : (
          <button onClick={act(Grbl.pause)} className="flex items-center gap-2 rounded-lg bg-yellow-500 px-6 py-3 font-bold text-black"><Pause size={20} /> PAUSA</button>
        )}
        <button onClick={act(Grbl.stop)} disabled={!grbl.connected}
          className="flex items-center gap-2 rounded-lg bg-red-600 px-6 py-3 text-base font-extrabold text-white shadow-lg shadow-red-900/40 hover:bg-red-500 active:scale-95 disabled:opacity-40">
          <Square size={20} fill="white" /> STOP
        </button>
        <div className={`rounded-md border px-3 py-1.5 text-sm font-bold ${stateColor(grbl.state)}`}>{grbl.state}</div>
        <div className="flex-1">
          <div className="mb-1 flex justify-between text-xs text-gray-400">
            <span>{myJob ? `${job.acked}/${job.total} linee${job.errors ? ` · ${job.errors} errori` : ''}` : 'Pronto'}</span><span className="font-mono">{pct}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-bg-card">
            <div className="h-full rounded-full bg-gradient-to-r from-accent-dark to-accent transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <Modal open={zeroOpen} onClose={() => setZeroOpen(false)} title="Imposta Zero Pezzo" width="max-w-3xl"
        footer={<Button variant="primary" onClick={() => setZeroOpen(false)}>Fatto</Button>}>
        <div className="grid grid-cols-2 gap-5">
          <div className="space-y-3 text-sm text-gray-300">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Fissa il pezzo grezzo ({project.stock_x}×{project.stock_y}×{project.stock_z} mm) sul piano.</li>
              <li>Con il jog porta la punta della fresa sul <b className="text-white">centro del pezzo</b> (X0 Y0).</li>
              <li>Abbassa Z finché la punta <b className="text-white">sfiora la superficie</b> (usa passo 0.1 / 0.01, un foglio di carta aiuta).</li>
              <li>Premi <b className="text-accent">Zero All</b> (oppure X, Y, Z singolarmente).</li>
              <li>Alza Z di qualche mm, chiudi questa finestra e premi <b className="text-accent">PLAY</b>.</li>
            </ol>
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-line bg-black p-3 font-mono">
              {['X', 'Y', 'Z'].map((a, i) => <div key={a}><span className="text-xs text-gray-500">{a}</span><div className="text-lg text-cyan-300">{pos[i].toFixed(3)}</div></div>)}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {['x', 'y', 'z'].map((a) => <Button key={a} size="sm" onClick={zero(a)} disabled={!grbl.connected}>Zero {a.toUpperCase()}</Button>)}
              <Button size="sm" variant="primary" onClick={zero('all')} disabled={!grbl.connected}>Zero All</Button>
            </div>
            <p className="text-xs text-gray-500">Lo zero viene salvato nel sistema di coordinate G54 di GRBL (G10 L20 P1) e resta valido anche dopo un reset.</p>
          </div>
          <JogController compact />
        </div>
      </Modal>

      <Modal open={confirmPlay} onClose={() => setConfirmPlay(false)} title="Avviare il taglio?"
        footer={<><Button onClick={() => setConfirmPlay(false)}>Annulla</Button><Button variant="primary" icon={Play} onClick={play}>Avvia</Button></>}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-gray-300">
          <li>Utensile montato: <b className="text-white">{tool?.name}</b> (Ø{tool?.diameter} mm)</li>
          <li>Zero pezzo impostato al centro, Z0 sulla superficie</li>
          <li>Pezzo fissato saldamente, aspirazione/occhiali pronti</li>
          <li>Il mandrino partirà (M3) a {layer.params?.spindle_rpm} RPM</li>
        </ul>
      </Modal>
    </div>
  )
}
