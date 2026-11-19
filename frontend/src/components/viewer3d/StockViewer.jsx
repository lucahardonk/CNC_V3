import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Edges, GizmoHelper, GizmoViewport, Grid, Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { create } from 'zustand'
import { MATERIAL_COLORS, useStore } from '../../store/store'
import { parseGcode } from '../../utils/gcodeParser'
import { Download, Eye, EyeOff, Play } from 'lucide-react'
import { errMsg, Export, Layers } from '../../services/api'
import { arcSweep, polar, primitives } from '../cad/geometry'
import { normalizeDrawLayers } from '../cad/drawLayers'

THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

// ---------------------------------------------------------------- overlay macchina CNC
// Gantry in alluminio: area di lavoro X 1000 × Y 1000 × Z 300 mm, origine pezzo = centro XY della macchina.
export const CNC_WORK = { x: 1000, y: 1000, z: 300 }
const CNC_KEY = 'cnc_v3_show_cnc'
// stato condiviso (viewer 3D, anteprima layer, simulazione) e ricordato nel browser
export const useCncOverlay = create((set) => ({
  showCnc: (() => { try { return localStorage.getItem(CNC_KEY) !== '0' } catch { return true } })(),
  setShowCnc: (v) => { try { localStorage.setItem(CNC_KEY, v ? '1' : '0') } catch { /* noop */ } set({ showCnc: v }) },
}))

export function CncToggle({ className = 'left-3 bottom-12' }) {
  const { showCnc, setShowCnc } = useCncOverlay()
  return (
    <label className={`absolute z-10 flex cursor-pointer items-center gap-2 rounded-md border border-line bg-black/70 px-2.5 py-1 text-xs text-gray-300 hover:text-white ${className}`}
      title="Mostra/nascondi il volume di lavoro della CNC (1000×1000×300 mm) e il gantry">
      <input type="checkbox" className="accent-green-500" checked={showCnc} onChange={(e) => setShowCnc(e.target.checked)} /> Mostra CNC
    </label>
  )
}

const ALU = '#c0c4cc'
const AluBox = ({ args, position, opacity = 0.12 }) => (
  <mesh position={position}>
    <boxGeometry args={args} />
    <meshStandardMaterial color={ALU} metalness={0.7} roughness={0.35} transparent opacity={opacity} depthWrite={false} />
    <Edges color={ALU} transparent opacity={Math.min(1, opacity * 2.5)} />
  </mesh>
)

// Volume di lavoro + gantry semplificato. Il piano macchina coincide con il fondo del pezzo (z = -stock_z).
export function CncOverlay({ project }) {
  const { x: W, y: D, z: H } = CNC_WORK
  const z0 = -project.stock_z, zTop = z0 + H
  const gy = D / 2 - 160 // gantry "parcheggiato" verso il fondo per non coprire il pezzo
  const beamZ = zTop + 50
  const sideX = W / 2 + 45
  return (
    <group renderOrder={-2}>
      {/* volume di lavoro: wireframe grigio (opacity 0.15) e spigoli evidenziati */}
      <mesh position={[0, 0, z0 + H / 2]}>
        <boxGeometry args={[W, D, H, 10, 10, 3]} />
        <meshBasicMaterial color="#9ca3af" wireframe transparent opacity={0.15} depthWrite={false} />
        <Edges color="#d1d5db" transparent opacity={0.5} />
      </mesh>
      {/* piano macchina */}
      <mesh position={[0, 0, z0 - 0.6]}>
        <boxGeometry args={[W + 60, D + 60, 1]} />
        <meshBasicMaterial color="#6b7280" transparent opacity={0.06} depthWrite={false} />
      </mesh>
      {/* guide asse Y (estrusi laterali) */}
      <AluBox args={[40, D + 120, 40]} position={[-sideX, 0, z0 - 20]} opacity={0.1} />
      <AluBox args={[40, D + 120, 40]} position={[sideX, 0, z0 - 20]} opacity={0.1} />
      {/* montanti verticali laterali del gantry */}
      <AluBox args={[24, 140, beamZ + 40 - z0]} position={[-sideX, gy, (z0 + beamZ + 40) / 2]} opacity={0.12} />
      <AluBox args={[24, 140, beamZ + 40 - z0]} position={[sideX, gy, (z0 + beamZ + 40) / 2]} opacity={0.12} />
      {/* traversa (asse X) */}
      <AluBox args={[W + 114, 60, 80]} position={[0, gy, beamZ]} opacity={0.1} />
      {/* carrello Z sulla traversa + mandrino */}
      <AluBox args={[130, 24, 200]} position={[0, gy - 45, beamZ - 40]} opacity={0.14} />
      <mesh position={[0, gy - 85, beamZ - 120]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[34, 34, 170, 28]} />
        <meshStandardMaterial color={ALU} metalness={0.8} roughness={0.3} transparent opacity={0.13} depthWrite={false} />
      </mesh>
      {/* assi macchina */}
      <Line points={[[-W / 2, -D / 2, z0], [W / 2, -D / 2, z0]]} color="#ef4444" lineWidth={1.5} transparent opacity={0.55} />
      <Line points={[[-W / 2, -D / 2, z0], [-W / 2, D / 2, z0]]} color="#22c55e" lineWidth={1.5} transparent opacity={0.55} />
      <Html position={[W / 2 + 25, -D / 2, z0]} center className="pointer-events-none whitespace-nowrap text-[11px] font-semibold text-red-300/80">X macchina →</Html>
      <Html position={[-W / 2, D / 2 + 30, z0]} center className="pointer-events-none whitespace-nowrap text-[11px] font-semibold text-green-300/80">↑ Y macchina</Html>
      <Html position={[-W / 2 - 20, -D / 2 - 20, zTop]} center className="pointer-events-none whitespace-nowrap text-[10px] text-gray-400/80">Area {W}×{D}×{H} mm</Html>
    </group>
  )
}

const MAT_PROPS = { softwood: { roughness: 0.9, metalness: 0 }, hardwood: { roughness: 0.85, metalness: 0 }, aluminum: { roughness: 0.3, metalness: 0.8 } }

// Stock: origine al centro XY, Z0 = superficie superiore, il pezzo scende fino a -stock_z.
export function StockMesh({ project, opacity = 1 }) {
  const materials = useStore((s) => s.materials)
  const color = materials[project.material]?.color || MATERIAL_COLORS[project.material] || '#999'
  const props = MAT_PROPS[project.material] || MAT_PROPS.softwood
  return (
    <mesh position={[0, 0, -project.stock_z / 2]} receiveShadow castShadow>
      <boxGeometry args={[project.stock_x, project.stock_y, project.stock_z]} />
      <meshStandardMaterial color={color} {...props} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} />
      <Edges color={opacity < 1 ? '#888' : '#111'} />
    </mesh>
  )
}

export function Axes({ project }) {
  const L = Math.max(project.stock_x, project.stock_y) / 2 + 10
  return (
    <group>
      <Line points={[[0, 0, 0.05], [L, 0, 0.05]]} color="#ef4444" lineWidth={2} />
      <Line points={[[0, 0, 0.05], [0, L, 0.05]]} color="#22c55e" lineWidth={2} />
      <Line points={[[0, 0, 0.05], [0, 0, project.stock_z + 10]]} color="#3b82f6" lineWidth={2} />
      <Html position={[L + 4, 0, 0]} className="pointer-events-none text-xs font-bold text-red-400">X</Html>
      <Html position={[0, L + 4, 0]} className="pointer-events-none text-xs font-bold text-green-400">Y</Html>
      <Html position={[0, 0, project.stock_z + 14]} className="pointer-events-none text-xs font-bold text-blue-400">Z</Html>
    </group>
  )
}

const segGeo = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); return g }

// layerColors: i tagli vengono colorati con il colore del layer di disegno (commenti `; DLAYER` del G-code);
// onlyGroups: Set di id dei layer di disegno da mostrare (null = tutti)
export function Toolpath({ gcode, rapidColor = '#facc15', cutColor = '#fb923c', opacity = 1, showRapid = true, layerColors = false, onlyGroups = null }) {
  const parsed = useMemo(() => parseGcode(gcode), [gcode])
  const rapidGeo = useMemo(() => segGeo(parsed.rapid), [parsed])
  const cutGeo = useMemo(() => segGeo(parsed.cut), [parsed])
  const groupGeos = useMemo(() => parsed.groups.map((g) => ({ ...g, geo: segGeo(g.cut) })), [parsed])
  const byLayer = layerColors && groupGeos.length > 0
  return (
    <group>
      {showRapid && <lineSegments geometry={rapidGeo}><lineBasicMaterial color={rapidColor} transparent opacity={0.45 * opacity} /></lineSegments>}
      {byLayer
        ? groupGeos.filter((g) => !onlyGroups || onlyGroups.has(g.id)).map((g) => (
          <lineSegments key={g.id} geometry={g.geo} renderOrder={10}><lineBasicMaterial color={g.color || cutColor} transparent opacity={opacity} depthTest={false} /></lineSegments>
        ))
        : <lineSegments geometry={cutGeo}><lineBasicMaterial color={cutColor} transparent={opacity < 1} opacity={opacity} /></lineSegments>}
    </group>
  )
}

// Layer di disegno presenti in un G-code (per legenda e filtri)
export function useGcodeLayers(gcode) {
  return useMemo(() => parseGcode(gcode).groups.map(({ id, color, name, cut }) => ({ id, color, name, segments: cut.length / 6 })), [gcode])
}

// Legenda dei percorsi per layer di disegno, con filtro (click = mostra/nascondi, doppio click = solo questo)
export function ToolpathLayerLegend({ groups, hidden, setHidden, scopeName }) {
  if (!groups.length) return null
  const toggle = (id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n })
  const solo = (id) => setHidden(new Set(groups.filter((g) => g.id !== id).map((g) => g.id)))
  return (
    <div className="absolute right-3 top-3 w-56 rounded-md border border-line bg-black/70 px-3 py-2 text-xs text-gray-300">
      <div className="mb-1 font-semibold text-white">Percorsi per layer</div>
      <div className="mb-1.5 text-[11px] text-gray-400">{scopeName ? <>G-code solo del layer <b className="text-gray-200">{scopeName}</b></> : 'G-code di tutti i layer visibili'}</div>
      {groups.map((g) => (
        <label key={g.id} className="flex cursor-pointer items-center gap-2 py-0.5" onDoubleClick={() => solo(g.id)} title="Click: mostra/nascondi · doppio click: solo questo">
          <input type="checkbox" checked={!hidden.has(g.id)} onChange={() => toggle(g.id)} />
          <span className="h-2.5 w-4 shrink-0 rounded-sm" style={{ background: g.color || '#fb923c' }} />
          <span className={`min-w-0 flex-1 truncate ${hidden.has(g.id) ? 'text-gray-500 line-through' : ''}`}>{g.name}</span>
        </label>
      ))}
      {hidden.size > 0 && <button className="mt-1 text-[11px] text-accent hover:underline" onClick={() => setHidden(new Set())}>Mostra tutti</button>}
    </div>
  )
}

// Entità da mostrare come profilo: esclude i layer di disegno nascosti e, se il G-code è di un solo layer, gli altri
export function scopeEntities(entities, layer) {
  const dls = layer?.draw_layers || []
  const hiddenDl = new Set(dls.filter((d) => d.visible === false).map((d) => d.id))
  const only = layer?.gcode ? layer?.params?.draw_layer_id : null
  return (entities || []).filter((e) => {
    const dl = e?.data?._meta?.dlayer || '0'
    return !hiddenDl.has(dl) && (!only || dl === only)
  })
}

// Profilo originale del CAD (riferimento per capire se il taglio è interno/esterno/sulla linea)
export const PROFILE_COLOR = '#0e7490'
const SKIP_TYPES = new Set(['dimension', 'dim_radial', 'dim_angle', 'constraint', 'bridge', 'point', 'construction'])
const PROFILE_Z = 0.05
function profileSegments(entities) {
  const out = []
  const push = (a, b) => out.push(a.x, a.y, PROFILE_Z, b.x, b.y, PROFILE_Z)
  for (const e of entities || []) {
    if (!e?.data || e.is_construction || SKIP_TYPES.has(e.type)) continue
    let prims
    try { prims = primitives(e) } catch { continue }
    for (const p of prims) {
      if (p.kind === 'seg') { push(p.a, p.b); continue }
      // cerchio/arco: angoli in gradi, verso antiorario da start a end
      const full = p.start === undefined
      const sweep = full ? 360 : arcSweep(p.start, p.end)
      const n = Math.max(8, Math.ceil(sweep / 3))
      const a0 = full ? 0 : p.start
      let prev = polar(p.c, p.r, a0)
      for (let i = 1; i <= n; i++) { const q = polar(p.c, p.r, a0 + (sweep * i) / n); push(prev, q); prev = q }
    }
  }
  return new Float32Array(out)
}
export function ProfileOutline({ entities, color = PROFILE_COLOR, opacity = 0.9 }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(profileSegments(entities), 3))
    return g
  }, [entities])
  return <lineSegments geometry={geo} renderOrder={-1}><lineBasicMaterial color={color} transparent opacity={opacity} /></lineSegments>
}
// Entità del layer (caricate dal backend; errori ignorati)
export function useLayerEntities(layerId) {
  const [ents, setEnts] = useState([])
  useEffect(() => {
    let alive = true
    setEnts([])
    if (layerId) Layers.entities(layerId).then((l) => { if (alive) setEnts(Array.isArray(l) ? l : []) }).catch(() => {})
    return () => { alive = false }
  }, [layerId])
  return ents
}

export function SceneBase({ project, children, cameraDist }) {
  const showCnc = useCncOverlay((s) => s.showCnc)
  const base = Math.max(project.stock_x, project.stock_y) * 1.1 + 50
  const d = cameraDist || (showCnc ? Math.max(base, 900) : base)
  return (
    <Canvas shadows camera={{ position: [d * 0.6, -d * 0.9, d * 0.8], fov: 45, near: 0.5, far: 20000, up: [0, 0, 1] }} gl={{ antialias: true }}>
      <color attach="background" args={['#141414']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[200, -300, 400]} intensity={1.2} castShadow />
      <directionalLight position={[-200, 200, 200]} intensity={0.35} />
      <Grid rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -project.stock_z - 0.05]} args={[2000, 2000]} cellSize={10} sectionSize={50}
        cellColor="#262626" sectionColor="#3a3a3a" fadeDistance={d * 4} infiniteGrid />
      <Axes project={project} />
      {showCnc && <CncOverlay project={project} />}
      {children}
      <OrbitControls makeDefault target={[0, 0, -project.stock_z / 2]} enableDamping dampingFactor={0.12} />
      <GizmoHelper alignment="bottom-right" margin={[70, 70]}><GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" /></GizmoHelper>
    </Canvas>
  )
}

const Ico = ({ tip, onClick, disabled, children, green }) => (
  <button title={tip} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick() }}
    className={`rounded p-1 transition disabled:opacity-30 ${green ? 'text-accent hover:bg-accent/15' : 'text-gray-400 hover:bg-white/10 hover:text-white'}`}>{children}</button>
)

// Lista di TUTTI i layer del pezzo nella vista 3D: colore, visibilità, Play (simulazione solo di quel layer)
// e Scarica .nc (G-code solo di quel layer). I layer di disegno interni sono percorsi indipendenti.
function LayerList({ layers, activeLayerId, activeDl, hidden, toggle, onSelect, onCut }) {
  const notify = useStore((s) => s.notify)
  const [busy, setBusy] = useState(null)
  const download = async (lid, dl) => {
    setBusy(`${lid}:${dl}`)
    try { notify(`Scaricato ${await Export.layerNc(lid, dl)}`, 'success') } catch (e) { notify(`Download fallito: ${errMsg(e)}`, 'error') } finally { setBusy(null) }
  }
  // elenco piatto: un layer del disegno = una riga tagliabile (il contenitore non compare)
  const rows = layers.flatMap((l) => normalizeDrawLayers(l.draw_layers).map((d) => ({ l, d, key: `${l.id}:${d.id}`, n: l.dl_counts?.[d.id] || 0 })))
  return (
    <div className="absolute right-3 top-3 max-h-[70%] w-64 overflow-y-auto rounded-md border border-line bg-black/75 px-3 py-2 text-xs text-gray-300" data-testid="layer-list-3d">
      <div className="mb-1 font-semibold text-white">Layer del pezzo <span className="text-gray-500">{rows.length}</span></div>
      {!rows.length && <div className="text-[11px] text-gray-500">Nessun layer: creane uno dal pannello a sinistra.</div>}
      {rows.map(({ l, d, key, n }) => {
        const off = hidden.has(key)
        const why = d.visible === false ? 'Layer nascosto nel CAD' : !n ? 'Layer vuoto: disegna qualcosa prima' : null
        const active = l.id === activeLayerId && d.id === activeDl
        return (
          <div key={key} className="flex items-center gap-1.5 py-0.5" data-testid="layer-row-3d">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className={`min-w-0 flex-1 cursor-pointer truncate ${off || why ? 'text-gray-500' : active ? 'text-accent' : ''} ${off ? 'line-through' : ''}`}
              onClick={() => onSelect?.(l.id, d.id)} title={why || `${n} entità`}>{d.name}</span>
            <Ico tip={off ? 'Mostra nel 3D' : 'Nascondi nel 3D'} onClick={() => toggle(key)}>{off ? <EyeOff size={12} /> : <Eye size={12} />}</Ico>
            <Ico green tip={why || `Simula solo «${d.name}»`} disabled={!!why} onClick={() => onCut?.(l.id, d.id)}><Play size={12} /></Ico>
            <Ico tip={why || `Scarica .nc solo di «${d.name}»`} disabled={!!why || busy === key} onClick={() => download(l.id, d.id)}><Download size={12} /></Ico>
          </div>
        )
      })}
    </div>
  )
}

export default function StockViewer({ project, layers, activeLayerId, activeDl, onSelect, onCut }) {
  const active = layers.find((l) => l.id === activeLayerId)
  const activeEnts = useLayerEntities(active?.id)
  // visibilità nel 3D per layer: chiavi "<disegno>:<layer>" (solo vista, non cambia il G-code)
  const [hidden, setHidden] = useState(() => new Set())
  const profileEnts = useMemo(() => scopeEntities(activeEnts, active).filter((e) => !hidden.has(`${active.id}:${e?.data?._meta?.dlayer || '0'}`)), [activeEnts, active, hidden])
  const toggle = (k) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const visible = layers.filter((l) => l.gcode)
  return (
    <div className="relative h-full w-full">
      <SceneBase project={project}>
        <StockMesh project={project} opacity={visible.length ? 0.85 : 1} />
        {active && <ProfileOutline entities={profileEnts} />}
        {visible.map((l) => <LayerToolpath key={l.id} layer={l} active={l.id === activeLayerId} hidden={hidden} />)}
      </SceneBase>
      <div className="pointer-events-none absolute left-3 top-3 space-y-1 rounded-md bg-black/60 px-3 py-2 text-xs text-gray-300">
        <div className="font-semibold text-white">{project.name}</div>
        <div className="font-mono">{project.stock_x} × {project.stock_y} × {project.stock_z} mm</div>
        <div className="text-gray-500">Origine: centro XY · Z0 superficie</div>
        {active && <div className="pt-1 text-accent">Layer: {active.name} {active.gcode ? '' : '(nessun G-code)'}</div>}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-3 py-1.5 text-xs text-gray-400">
        Sinistro: ruota · Destro: pan · Rotella: zoom
        <span className="ml-3"><span className="text-yellow-400">━</span> rapido G0 (layer attivo) <span className="ml-2 text-orange-400">━</span> taglio G1 (colore del layer di disegno) <span className="ml-2" style={{ color: PROFILE_COLOR }}>━</span> profilo originale</span>
      </div>
      <CncToggle />
      <LayerList layers={layers} activeLayerId={activeLayerId} activeDl={activeDl} hidden={hidden} toggle={toggle} onSelect={onSelect} onCut={onCut} />
    </div>
  )
}

function LayerToolpath({ layer, active, hidden }) {
  const groups = useGcodeLayers(layer.gcode)
  const only = useMemo(() => {
    const off = groups.filter((g) => hidden.has(`${layer.id}:${g.id}`))
    return off.length ? new Set(groups.filter((g) => !off.includes(g)).map((g) => g.id)) : null
  }, [groups, hidden, layer.id])
  return <Toolpath gcode={layer.gcode} layerColors onlyGroups={only} showRapid={active} opacity={active ? 1 : 0.55} />
}
