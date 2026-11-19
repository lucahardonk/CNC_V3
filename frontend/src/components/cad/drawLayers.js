// Layer di disegno (stile AutoCAD) interni a un layer di lavorazione.
// Ogni entità ha `dlayer` (id del layer di disegno); senza dlayer appartiene al Layer 0.
export const DEFAULT_LAYER_ID = '0'
export const DEFAULT_LAYER_COLOR = '#e5e7eb'
export const LAYER_PALETTE = ['#e5e7eb', '#ef4444', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899', '#f97316', '#84cc16', '#14b8a6']

export const layerOf = (e) => e?.dlayer || DEFAULT_LAYER_ID

// Garantisce la presenza del Layer 0 (sempre primo) e campi completi
export function normalizeDrawLayers(list) {
  const out = (Array.isArray(list) ? list : []).filter((l) => l && l.id).map((l) => ({
    id: String(l.id), name: String(l.name || 'Layer'), color: l.color || DEFAULT_LAYER_COLOR,
    visible: l.visible !== false, locked: !!l.locked, ...(l.cut && typeof l.cut === 'object' ? { cut: l.cut } : {}),
  }))
  const zero = out.find((l) => l.id === DEFAULT_LAYER_ID)
  const rest = out.filter((l) => l.id !== DEFAULT_LAYER_ID)
  return [{ id: DEFAULT_LAYER_ID, name: 'Layer 1', color: DEFAULT_LAYER_COLOR, visible: true, locked: false, ...(zero || {}) }, ...rest]
}

export const newLayerId = () => 'dl_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)

export function nextLayerColor(layers) {
  const used = new Set(layers.map((l) => l.color.toLowerCase()))
  return LAYER_PALETTE.find((c) => !used.has(c)) || LAYER_PALETTE[layers.length % LAYER_PALETTE.length]
}

// Nome unico e progressivo nel pezzo: "Layer N" con N = massimo numero usato + 1
export function nextLayerName(layers) {
  const nums = layers.map((l) => /^layer (\d+)$/i.exec(String(l.name).trim())).filter(Boolean).map((m) => Number(m[1]))
  return `Layer ${Math.max(0, ...nums) + 1}`
}
