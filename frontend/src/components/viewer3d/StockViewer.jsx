import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Edges, GizmoHelper, GizmoViewport, Grid, Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { MATERIAL_COLORS, useStore } from '../../store/store'
import { parseGcode } from '../../utils/gcodeParser'
import { Layers } from '../../services/api'
import { arcSweep, polar, primitives } from '../cad/geometry'

THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

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
          <lineSegments key={g.id} geometry={g.geo}><lineBasicMaterial color={g.color || cutColor} transparent={opacity < 1} opacity={opacity} /></lineSegments>
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
  const d = cameraDist || Math.max(project.stock_x, project.stock_y) * 1.1 + 50
  return (
    <Canvas shadows camera={{ position: [d * 0.6, -d * 0.9, d * 0.8], fov: 45, near: 0.5, far: 20000, up: [0, 0, 1] }} gl={{ antialias: true }}>
      <color attach="background" args={['#141414']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[200, -300, 400]} intensity={1.2} castShadow />
      <directionalLight position={[-200, 200, 200]} intensity={0.35} />
      <Grid rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -project.stock_z - 0.05]} args={[2000, 2000]} cellSize={10} sectionSize={50}
        cellColor="#262626" sectionColor="#3a3a3a" fadeDistance={d * 4} infiniteGrid />
      <Axes project={project} />
      {children}
      <OrbitControls makeDefault target={[0, 0, -project.stock_z / 2]} enableDamping dampingFactor={0.12} />
      <GizmoHelper alignment="bottom-right" margin={[70, 70]}><GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" /></GizmoHelper>
    </Canvas>
  )
}

export default function StockViewer({ project, layers, activeLayerId }) {
  const active = layers.find((l) => l.id === activeLayerId)
  const activeEnts = useLayerEntities(active?.id)
  const profileEnts = useMemo(() => scopeEntities(activeEnts, active), [activeEnts, active])
  const groups = useGcodeLayers(active?.gcode)
  const [hiddenGroups, setHiddenGroups] = useState(new Set())
  useEffect(() => setHiddenGroups(new Set()), [active?.id, active?.gcode])
  const onlyGroups = useMemo(() => (hiddenGroups.size ? new Set(groups.map((g) => g.id).filter((id) => !hiddenGroups.has(id))) : null), [groups, hiddenGroups])
  const scopeName = active?.params?.draw_layer_name
  return (
    <div className="relative h-full w-full">
      <SceneBase project={project}>
        <StockMesh project={project} opacity={active?.gcode ? 0.85 : 1} />
        {layers.filter((l) => l.gcode && l.id !== activeLayerId).map((l) => (
          <Toolpath key={l.id} gcode={l.gcode} showRapid={false} cutColor="#64748b" opacity={0.5} />
        ))}
        {active && <ProfileOutline entities={profileEnts} />}
        {active?.gcode && <Toolpath gcode={active.gcode} layerColors onlyGroups={onlyGroups} />}
      </SceneBase>
      <div className="pointer-events-none absolute left-3 top-3 space-y-1 rounded-md bg-black/60 px-3 py-2 text-xs text-gray-300">
        <div className="font-semibold text-white">{project.name}</div>
        <div className="font-mono">{project.stock_x} × {project.stock_y} × {project.stock_z} mm</div>
        <div className="text-gray-500">Origine: centro XY · Z0 superficie</div>
        {active && <div className="pt-1 text-accent">Layer: {active.name} {active.gcode ? '' : '(nessun G-code)'}</div>}
        {active?.gcode && scopeName && <div className="text-[11px] text-yellow-300">G-code solo del layer di disegno «{scopeName}»</div>}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-3 py-1.5 text-xs text-gray-400">
        Sinistro: ruota · Destro: pan · Rotella: zoom
        <span className="ml-3"><span className="text-yellow-400">━</span> rapido G0 <span className="ml-2 text-orange-400">━</span> taglio G1{groups.length > 0 && ' (colore del layer)'} <span className="ml-2" style={{ color: PROFILE_COLOR }}>━</span> profilo originale</span>
      </div>
      {active?.gcode && <ToolpathLayerLegend groups={groups} hidden={hiddenGroups} setHidden={setHiddenGroups} scopeName={scopeName} />}
    </div>
  )
}
