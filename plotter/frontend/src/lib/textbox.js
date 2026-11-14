// Casella di testo per pen plotter: font single-stroke (Hershey/EMS), allineamento, ancore,
// corsivo (inclinazione), grassetto (passate multiple), rotazione.
import { BUILTIN_FONT } from './font'
import INDEX from './fonts/index.json'

export const FONTS = [{ id: 'builtin', name: BUILTIN_FONT.name }, ...INDEX]
export const ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']
export const DEFAULT_TEXTBOX = {
  text: 'Testo', font: 'hershey_sans', size: 10, anchor: 'bl', align: 'left',
  italic: false, slant: 12, bold: false, boldWidth: 0.3, lineHeight: 1.6, letterSpacing: 0, rotation: 0,
}

const loaders = import.meta.glob('./fonts/*.json')
const cache = { builtin: BUILTIN_FONT }
const pending = {}
const listeners = new Set()

export const onFontLoaded = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

export function loadFont(id) {
  if (cache[id]) return Promise.resolve(cache[id])
  if (!pending[id]) {
    const loader = loaders[`./fonts/${id}.json`]
    if (!loader) return Promise.resolve(BUILTIN_FONT)
    pending[id] = loader().then((m) => {
      cache[id] = m.default || m
      listeners.forEach((fn) => fn(id))
      return cache[id]
    })
  }
  return pending[id]
}

function getFont(id) {
  if (cache[id]) return cache[id]
  loadFont(id) // asincrono: nel frattempo si usa il font interno
  return BUILTIN_FONT
}

/** Restituisce {polylines, corners, anchorPt} di una casella di testo in mm. */
export function layoutTextbox(s) {
  const font = getFont(s.font)
  const size = Number(s.size) || 10
  const k = size / font.cap
  const pitch = size * (Number(s.lineHeight) || 1.6)
  const ls = Number(s.letterSpacing) || 0
  const lines = String(s.text ?? '').split('\n')
  const fallback = font.glyphs['?'] || [font.cap * 0.6, []]

  const glyphOf = (ch) => {
    let c = font.upper ? ch.toUpperCase() : ch
    if (!font.glyphs[c]) c = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (font.upper) c = c.toUpperCase()
    return font.glyphs[c] || (ch === ' ' ? [font.cap * 0.5, []] : fallback)
  }

  // larghezza righe
  const widths = lines.map((line) => {
    const chars = [...line]
    return chars.reduce((w, ch) => w + glyphOf(ch)[0] * k, 0) + Math.max(0, chars.length - 1) * ls
  })
  const W = Math.max(0, ...widths)
  const H = size + (lines.length - 1) * pitch

  const raw = []
  lines.forEach((line, li) => {
    let x = s.align === 'center' ? (W - widths[li]) / 2 : s.align === 'right' ? W - widths[li] : 0
    const base = -size - li * pitch
    for (const ch of line) {
      const [adv, strokes] = glyphOf(ch)
      for (const st of strokes) {
        const pl = []
        for (let i = 0; i < st.length; i += 2) pl.push([x + st[i] * k, base + st[i + 1] * k, st[i + 1] * k])
        if (pl.length > 1) raw.push(pl)
      }
      x += adv * k + ls
    }
  })

  const ax = s.anchor?.[1] === 'c' ? W / 2 : s.anchor?.[1] === 'r' ? W : 0
  const ay = s.anchor?.[0] === 'm' ? -H / 2 : s.anchor?.[0] === 'b' ? -H : 0
  const sh = s.italic ? Math.tan(((Number(s.slant) || 12) * Math.PI) / 180) : 0
  const rot = ((Number(s.rotation) || 0) * Math.PI) / 180
  const cr = Math.cos(rot), sr = Math.sin(rot)
  const T = (x, y) => {
    const lx = x - ax, ly = y - ay
    return [s.x + lx * cr - ly * sr, s.y + lx * sr + ly * cr]
  }

  const passes = s.bold ? boldOffsets(Number(s.boldWidth) || 0.3) : [[0, 0]]
  const polylines = []
  for (const [dx, dy] of passes) {
    for (const pl of raw) polylines.push(pl.map(([x, y, gy]) => T(x + gy * sh + dx, y + dy)))
  }
  const corners = [T(0, 0), T(W, 0), T(W, -H), T(0, -H), T(0, 0)]
  return { polylines, corners, W, H }
}

function boldOffsets(w) {
  // passata centrale + anello di passate sfalsate (più spessore = più passate)
  const n = w <= 0.25 ? 3 : w <= 0.5 ? 5 : 7
  const out = [[0, 0]]
  for (let i = 0; i < n - 1; i++) {
    const a = (i / (n - 1)) * Math.PI * 2
    out.push([(w / 2) * Math.cos(a), (w / 2) * Math.sin(a)])
  }
  return out
}

/** Punti chiave del foglio (margine in mm) per posizionare rapidamente la casella. */
export function sheetKeyPoint(anchor, sheetW, sheetH, margin) {
  const x = anchor[1] === 'l' ? -sheetW / 2 + margin : anchor[1] === 'r' ? sheetW / 2 - margin : 0
  const y = anchor[0] === 't' ? sheetH / 2 - margin : anchor[0] === 'b' ? -sheetH / 2 + margin : 0
  return [x, y]
}
