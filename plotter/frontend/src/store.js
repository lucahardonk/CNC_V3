import { create } from 'zustand'
import { uid, translateShape } from './lib/geometry'
import { DEFAULT_TEXTBOX } from './lib/textbox'

const COLORS = ['#22c55e', '#3b82f6', '#ef4444', '#eab308', '#a855f7', '#06b6d4', '#f97316', '#ec4899']
export const newLayer = (i = 0, extra = {}) => ({ id: uid(), name: `Layer ${i + 1}`, color: COLORS[i % COLORS.length], visible: true, pause: false, ...extra })

const DEFAULT_SETTINGS = {
  sheet_z: -4.777, pen_up: 3, pen_down_extra: 0, feed_draw: 600, feed_travel: 3000, feed_z_down: 60, feed_z_up: 180,
  offset_x: 0, offset_y: 0, print_radius: 132, home_before: true, home_after: false, send_mode: 'upload',
  stream_chunk: 20, resume_cmd: 'RESUME_BASE', grid: 1, snap: true,
}

const blankProject = () => {
  const l = newLayer(0)
  return { projectId: null, projectName: 'Nuovo disegno', layers: [l], shapes: [], activeLayerId: l.id, selected: [], dirty: false }
}

export const useStore = create((set, get) => ({
  ...blankProject(),
  settings: DEFAULT_SETTINGS,
  tool: 'select',
  textStyle: { ...DEFAULT_TEXTBOX },
  fontsVersion: 0,
  focusText: null,
  preview: false,
  history: [],
  future: [],
  toast: null,

  notify: (msg, kind = 'info') => {
    set({ toast: { msg, kind, t: Date.now() } })
    setTimeout(() => { if (Date.now() - (get().toast?.t || 0) >= 3900) set({ toast: null }) }, 4000)
  },
  setTool: (tool) => set({ tool }),
  setTextStyle: (patch) => set({ textStyle: { ...get().textStyle, ...patch } }),
  bumpFonts: () => set({ fontsVersion: get().fontsVersion + 1 }),
  setFocusText: (focusText) => set({ focusText }),
  setPreview: (preview) => set({ preview }),
  setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),

  // ---- undo/redo
  snapshot: () => {
    const { layers, shapes, history } = get()
    set({ history: [...history.slice(-99), { layers, shapes }], future: [], dirty: true })
  },
  undo: () => {
    const { history, future, layers, shapes } = get()
    if (!history.length) return
    const prev = history[history.length - 1]
    set({ ...prev, history: history.slice(0, -1), future: [{ layers, shapes }, ...future], selected: [] })
  },
  redo: () => {
    const { history, future, layers, shapes } = get()
    if (!future.length) return
    set({ ...future[0], future: future.slice(1), history: [...history, { layers, shapes }], selected: [] })
  },

  // ---- shapes
  addShape: (shape) => {
    get().snapshot()
    const s = { id: uid(), layerId: get().activeLayerId, ...shape }
    set({ shapes: [...get().shapes, s], selected: [s.id] })
    return s
  },
  addShapes: (list) => {
    get().snapshot()
    const items = list.map((s) => ({ id: uid(), ...s }))
    set({ shapes: [...get().shapes, ...items] })
  },
  updateShape: (id, patch, snap = true) => {
    if (snap) get().snapshot()
    set({ shapes: get().shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  },
  moveSelected: (dx, dy, snap = true) => {
    if (snap) get().snapshot()
    const sel = new Set(get().selected)
    set({ shapes: get().shapes.map((s) => (sel.has(s.id) ? translateShape(s, dx, dy) : s)) })
  },
  deleteSelected: () => {
    const sel = new Set(get().selected)
    if (!sel.size) return
    get().snapshot()
    set({ shapes: get().shapes.filter((s) => !sel.has(s.id)), selected: [] })
  },
  duplicateSelected: () => {
    const sel = new Set(get().selected)
    if (!sel.size) return
    get().snapshot()
    const copies = get().shapes.filter((s) => sel.has(s.id)).map((s) => ({ ...translateShape(s, 5, -5), id: uid() }))
    set({ shapes: [...get().shapes, ...copies], selected: copies.map((c) => c.id) })
  },
  setSelected: (selected) => set({ selected }),
  selectedToLayer: (layerId) => {
    const sel = new Set(get().selected)
    if (!sel.size) return
    get().snapshot()
    set({ shapes: get().shapes.map((s) => (sel.has(s.id) ? { ...s, layerId } : s)) })
  },

  // ---- layers
  addLayer: (extra = {}) => {
    get().snapshot()
    const l = newLayer(get().layers.length, extra)
    set({ layers: [...get().layers, l], activeLayerId: l.id })
    return l
  },
  updateLayer: (id, patch) => {
    get().snapshot()
    set({ layers: get().layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  },
  removeLayer: (id) => {
    const { layers, shapes, activeLayerId } = get()
    if (layers.length <= 1) return get().notify('Serve almeno un layer', 'warn')
    get().snapshot()
    const rest = layers.filter((l) => l.id !== id)
    set({ layers: rest, shapes: shapes.filter((s) => s.layerId !== id), activeLayerId: activeLayerId === id ? rest[0].id : activeLayerId, selected: [] })
  },
  moveLayer: (from, to) => {
    const layers = get().layers.slice()
    if (from === to || to < 0 || to >= layers.length) return
    get().snapshot()
    const [l] = layers.splice(from, 1)
    layers.splice(to, 0, l)
    set({ layers })
  },
  setActiveLayer: (activeLayerId) => set({ activeLayerId }),

  // ---- project
  newProject: () => set({ ...blankProject(), history: [], future: [] }),
  loadProject: (p) => {
    const layers = p.layers?.length ? p.layers : [newLayer(0)]
    set({ projectId: p.id, projectName: p.name, layers, shapes: p.shapes || [], activeLayerId: layers[0].id,
      selected: [], history: [], future: [], dirty: false })
  },
  projectData: () => {
    const { projectId, projectName, layers, shapes } = get()
    return { id: projectId || undefined, name: projectName, layers, shapes, version: 1 }
  },
  setProjectMeta: (patch) => set(patch),
}))
