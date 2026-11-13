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

export function Toolpath({ gcode, rapidColor = '#facc15', cutColor = '#fb923c', opacity = 1, showRapid = true }) {
  const parsed = useMemo(() => parseGcode(gcode), [gcode])
  const rapidGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(parsed.rapid, 3)); return g }, [parsed])
  const cutGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(parsed.cut, 3)); return g }, [parsed])
  return (
    <group>
      {showRapid && <lineSegments geometry={rapidGeo}><lineBasicMaterial color={rapidColor} transparent opacity={0.45 * opacity} /></lineSegments>}
      <lineSegments geometry={cutGeo}><lineBasicMaterial color={cutColor} transparent={opacity < 1} opacity={opacity} /></lineSegments>
    </group>
  )
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
  return (
    <div className="relative h-full w-full">
      <SceneBase project={project}>
        <StockMesh project={project} opacity={active?.gcode ? 0.85 : 1} />
        {layers.filter((l) => l.gcode && l.id !== activeLayerId).map((l) => (
          <Toolpath key={l.id} gcode={l.gcode} showRapid={false} cutColor="#64748b" opacity={0.5} />
        ))}
        {active && <ProfileOutline entities={activeEnts} />}
        {active?.gcode && <Toolpath gcode={active.gcode} />}
      </SceneBase>
      <div className="pointer-events-none absolute left-3 top-3 space-y-1 rounded-md bg-black/60 px-3 py-2 text-xs text-gray-300">
        <div className="font-semibold text-white">{project.name}</div>
        <div className="font-mono">{project.stock_x} × {project.stock_y} × {project.stock_z} mm</div>
        <div className="text-gray-500">Origine: centro XY · Z0 superficie</div>
        {active && <div className="pt-1 text-accent">Layer: {active.name} {active.gcode ? '' : '(nessun G-code)'}</div>}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-3 py-1.5 text-xs text-gray-400">
        Sinistro: ruota · Destro: pan · Rotella: zoom
        <span className="ml-3"><span className="text-yellow-400">━</span> rapido G0 <span className="ml-2 text-orange-400">━</span> taglio G1 <span className="ml-2" style={{ color: PROFILE_COLOR }}>━</span> profilo originale</span>
      </div>
    </div>
  )
}
