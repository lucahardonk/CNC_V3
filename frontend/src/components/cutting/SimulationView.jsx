import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ArrowLeft, Pause, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { CncToggle, PROFILE_COLOR, ProfileOutline, SceneBase, StockMesh, Toolpath, useLayerEntities } from '../viewer3d/StockViewer'
import Button from '../common/Button'
import { errMsg, Layers } from '../../services/api'
import { useStore } from '../../store/store'

// Limiti della macchina (GRBL 1.1h): velocità massima 1500 mm/min, usata anche per i rapidi G0
const MAX_FEED = 1500
const SPEEDS = [1, 2, 5, 10, 25, 50, 100]

// G-code → sequenza di movimenti con durata stimata (minuti)
function buildTimeline(gcode) {
  const moves = []
  let x = 0, y = 0, z = 0, mode = 0, abs = true, feed = MAX_FEED
  for (const raw of (gcode || '').split('\n')) {
    const line = raw.replace(/\(.*?\)|;.*/g, '').trim().toUpperCase()
    if (!line) continue
    const w = {}
    const re = /([A-Z])\s*(-?\d*\.?\d+)/g
    let m
    while ((m = re.exec(line))) {
      const k = m[1], v = parseFloat(m[2])
      if (k === 'G') { if (v === 0 || v === 1) mode = v; else if (v === 90) abs = true; else if (v === 91) abs = false } else if (!(k in w)) w[k] = v
    }
    if ('F' in w && w.F > 0) feed = Math.min(w.F, MAX_FEED)
    const nx = 'X' in w ? (abs ? w.X : x + w.X) : x
    const ny = 'Y' in w ? (abs ? w.Y : y + w.Y) : y
    const nz = 'Z' in w ? (abs ? w.Z : z + w.Z) : z
    const len = Math.hypot(nx - x, ny - y, nz - z)
    if (len > 1e-9) moves.push({ a: [x, y, z], b: [nx, ny, nz], rapid: mode === 0, dur: len / (mode === 0 ? MAX_FEED : feed) })
    x = nx; y = ny; z = nz
  }
  let t = 0
  for (const mv of moves) { mv.t0 = t; t += mv.dur }
  return { moves, total: t }
}

// indice del movimento in corso al tempo t (ricerca binaria)
function moveAt(moves, t) {
  let lo = 0, hi = moves.length - 1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (moves[mid].t0 <= t) lo = mid; else hi = mid - 1 }
  return lo
}
function posAt(tl, t) {
  if (!tl.moves.length) return [0, 0, 0]
  const i = moveAt(tl.moves, t), mv = tl.moves[i]
  const k = mv.dur > 0 ? Math.min(1, Math.max(0, (t - mv.t0) / mv.dur)) : 1
  return [mv.a[0] + (mv.b[0] - mv.a[0]) * k, mv.a[1] + (mv.b[1] - mv.a[1]) * k, mv.a[2] + (mv.b[2] - mv.a[2]) * k]
}

function ToolBit({ diameter, posRef }) {
  const g = useRef()
  useFrame(() => { const p = posRef.current; if (g.current && p) g.current.position.set(p[0], p[1], p[2]) })
  const h = 25
  return (
    <group ref={g}>
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

// Percorso di taglio già eseguito (verde), aggiornato a ogni frame con drawRange
function DonePath({ tl, timeRef }) {
  const geo = useMemo(() => {
    const arr = new Float32Array(tl.moves.length * 6)
    tl.moves.forEach((m, i) => arr.set([...m.a, ...m.b], i * 6))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    g.setDrawRange(0, 0)
    return g
  }, [tl])
  useFrame(() => {
    if (!tl.moves.length) return
    const i = moveAt(tl.moves, timeRef.current)
    const p = posAt(tl, timeRef.current)
    const attr = geo.attributes.position
    // il segmento corrente termina alla posizione attuale dell'utensile
    const m = tl.moves[i]
    attr.array.set([...m.a, ...p], i * 6)
    if (i + 1 < tl.moves.length) attr.array.set([...tl.moves[i + 1].a, ...tl.moves[i + 1].b], (i + 1) * 6)
    attr.needsUpdate = true
    geo.setDrawRange(0, (i + 1) * 2)
  })
  return <lineSegments geometry={geo} renderOrder={12}><lineBasicMaterial color="#4ade80" depthTest={false} /></lineSegments>
}

const fmtMin = (m) => { const s = Math.round(m * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

// Simulazione 3D del percorso utensile del layer (nessuna connessione alla macchina).
// All'apertura il percorso viene ricalcolato dal backend con i parametri di taglio del layer.
export default function SimulationView({ project, layer, onBack, onLayerUpdated }) {
  const notify = useStore((s) => s.notify)
  const [gcode, setGcode] = useState(layer.gcode || '')
  const [busy, setBusy] = useState(false)
  const [warnings, setWarnings] = useState([])
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(10)
  const [t, setT] = useState(0)
  const timeRef = useRef(0)
  const posRef = useRef([0, 0, 0])
  const profileEnts = useLayerEntities(layer.id)
  const tl = useMemo(() => buildTimeline(gcode), [gcode])
  const dia = Number(layer.tool_diameter) || 3

  const compute = async () => {
    setBusy(true); setPlaying(false)
    try {
      const r = await Layers.generate(layer.id, {})
      setGcode(r.layer.gcode || ''); setWarnings(r.warnings || [])
      onLayerUpdated?.(r.layer)
    } catch (e) {
      notify(`Calcolo percorso fallito: ${errMsg(e)}`, 'error')
    } finally { setBusy(false) }
  }
  useEffect(() => { compute() }, [layer.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // nuovo percorso → si riparte dall'inizio
  useEffect(() => { timeRef.current = 0; setT(0); posRef.current = posAt(tl, 0) }, [tl])

  // animazione: il tempo simulato avanza di (dt reale × velocità)
  useEffect(() => {
    if (!playing) return
    let raf, last = performance.now(), lastUi = 0
    const step = (now) => {
      const dtMin = ((now - last) / 60000) * speed
      last = now
      timeRef.current = Math.min(tl.total, timeRef.current + dtMin)
      posRef.current = posAt(tl, timeRef.current)
      if (now - lastUi > 80) { lastUi = now; setT(timeRef.current) }
      if (timeRef.current >= tl.total) { setT(tl.total); setPlaying(false); return }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, tl])

  const seek = (v) => { timeRef.current = v; posRef.current = posAt(tl, v); setT(v) }
  const restart = () => { seek(0); setPlaying(true) }
  const pct = tl.total ? (t / tl.total) * 100 : 0
  const pos = posAt(tl, t)
  const done = tl.total > 0 && t >= tl.total

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-bg-panel px-3">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack}>Vista 3D</Button>
        <div className="mx-2 h-5 w-px bg-line" />
        <span className="text-sm text-gray-400">Simulazione layer:</span><span className="text-sm font-semibold text-white">{layer.name}</span>
        <span className="text-xs text-gray-500">· fresa Ø {dia} mm · {tl.moves.length} movimenti</span>
        <Button size="sm" variant="ghost" icon={RefreshCw} className="ml-auto" disabled={busy} onClick={compute}
          title="Ricalcola il percorso con il disegno e i parametri di taglio attuali del layer">{busy ? 'Calcolo…' : 'Ricalcola percorso'}</Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <SceneBase project={project}>
          <StockMesh project={project} opacity={0.3} />
          <ProfileOutline entities={profileEnts} />
          {gcode && <Toolpath gcode={gcode} rapidColor="#facc15" cutColor="#22d3ee" opacity={0.6} />}
          {tl.moves.length > 0 && <DonePath tl={tl} timeRef={timeRef} />}
          <ToolBit posRef={posRef} diameter={dia} />
        </SceneBase>
        <div className="pointer-events-none absolute left-3 top-3 space-y-1 rounded-md bg-black/60 px-3 py-2 font-mono text-xs text-gray-300">
          <div>X {pos[0].toFixed(3)}</div><div>Y {pos[1].toFixed(3)}</div><div>Z {pos[2].toFixed(3)}</div>
        </div>
        {busy && <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-sm text-gray-200">Calcolo del percorso utensile…</div>}
        {!busy && !tl.moves.length && <div className="absolute inset-x-0 top-1/3 text-center text-sm text-gray-400">Nessun percorso da simulare: controlla il disegno e i parametri di taglio del layer.</div>}
        {warnings.length > 0 && (
          <div className="absolute right-3 top-3 max-w-sm space-y-1 rounded-md border border-yellow-500/40 bg-black/70 px-3 py-2 text-[11px] text-yellow-300">
            {warnings.map((w) => <div key={w}>⚠ {w}</div>)}
          </div>
        )}
        <CncToggle />
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-3 py-1.5 text-xs text-gray-400">
          <span className="text-yellow-400">━</span> rapido G0 <span className="ml-2 text-cyan-400">━</span> taglio G1 <span className="ml-2 text-green-400">━</span> già simulato <span className="ml-2" style={{ color: PROFILE_COLOR }}>━</span> profilo originale · utensile Ø {dia} mm in scala
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-line bg-bg-panel px-4 py-3">
        <button onClick={() => (done ? restart() : setPlaying(!playing))} disabled={busy || !tl.moves.length}
          className={`flex w-40 items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-bold text-black transition active:scale-95 disabled:opacity-40 ${playing ? 'bg-yellow-500' : 'bg-accent hover:bg-accent-light'}`}>
          {playing ? <><Pause size={18} /> Pausa</> : <><Play size={18} fill="black" /> {done ? 'Riproduci' : t > 0 ? 'Riprendi' : 'Simula'}</>}
        </button>
        <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy || !tl.moves.length} onClick={() => { setPlaying(false); seek(0) }} title="Torna all'inizio">Inizio</Button>
        <label className="flex items-center gap-1.5 text-xs text-gray-400" title="Velocità della simulazione rispetto al tempo reale stimato">Velocità
          <select className="input w-20 py-1 text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <div className="flex-1">
          <div className="mb-1 flex justify-between text-xs text-gray-400">
            <span>Tempo simulato {fmtMin(t)} / {fmtMin(tl.total)} (stima a max {MAX_FEED} mm/min)</span><span className="font-mono">{pct.toFixed(0)}%</span>
          </div>
          <input type="range" min={0} max={tl.total || 0} step={tl.total / 1000 || 0.001} value={t} disabled={!tl.moves.length}
            onChange={(e) => seek(Number(e.target.value))} className="w-full accent-green-500" />
        </div>
      </div>
    </div>
  )
}
