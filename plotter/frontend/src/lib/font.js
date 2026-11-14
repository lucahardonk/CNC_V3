// Font "single stroke" minimale per penna: griglia 4x6 (baseline y=0, altezza maiuscole 6).
// Ogni glifo è una lista di tratti separati da "|", ogni tratto una lista di punti "x,y".
const O = '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0'
const G = {
  A: '0,0 2,6 4,0|0.7,2 3.3,2', B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0',
  C: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1', D: '0,0 0,6 2.5,6 4,4.5 4,1.5 2.5,0 0,0',
  E: '4,6 0,6 0,0 4,0|0,3 3,3', F: '4,6 0,6 0,0|0,3 3,3',
  G: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3', H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: '1,6 3,6|2,6 2,0|1,0 3,0', J: '4,6 4,1 3,0 1,0 0,1', K: '0,0 0,6|4,6 0,2|1.3,3.3 4,0',
  L: '0,6 0,0 4,0', M: '0,0 0,6 2,3 4,6 4,0', N: '0,0 0,6 4,0 4,6', O,
  P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3', Q: `${O}|2.5,1.5 4,0`, R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0',
  S: '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1', T: '0,6 4,6|2,6 2,0',
  U: '0,6 0,1 1,0 3,0 4,1 4,6', V: '0,6 2,0 4,6', W: '0,6 1,0 2,4 3,0 4,6', X: '0,0 4,6|0,6 4,0',
  Y: '0,6 2,3 4,6|2,3 2,0', Z: '0,6 4,6 0,0 4,0',
  0: `${O}|0.5,0.5 3.5,5.5`, 1: '1,5 2,6 2,0|1,0 3,0', 2: '0,5 1,6 3,6 4,5 4,4 0,0 4,0',
  3: '0,5 1,6 3,6 4,5 4,4 3,3 1.5,3|3,3 4,2 4,1 3,0 1,0 0,1', 4: '3,0 3,6 0,2 4,2',
  5: '4,6 0,6 0,3.5 3,3.5 4,2.5 4,1 3,0 1,0 0,1', 6: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3',
  7: '0,6 4,6 1.5,0', 8: '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3',
  9: '4,3 1,3 0,4 0,5 1,6 3,6 4,5 4,1 3,0 1,0 0,1',
  '-': '1,3 3,3', '.': '2,0 2,0.3', ',': '2,0.5 1.5,-1', ':': '2,1 2,1.3|2,4 2,4.3', ';': '2,4 2,4.3|2,0.5 1.5,-1',
  '/': '0,0 4,6', '+': '0,3 4,3|2,1 2,5', '=': '0.5,2 3.5,2|0.5,4 3.5,4', '!': '2,6 2,2|2,0 2,0.3',
  '?': '0,5 1,6 3,6 4,5 4,4 2,3 2,2|2,0 2,0.3', '(': '2.5,6 1.5,4.5 1.5,1.5 2.5,0', ')': '1.5,6 2.5,4.5 2.5,1.5 1.5,0',
  '_': '0,0 4,0', "'": '2,6 2,4.5', '"': '1.5,6 1.5,4.5|2.5,6 2.5,4.5', '*': '2,1.5 2,4.5|0.7,2.2 3.3,3.8|0.7,3.8 3.3,2.2',
  '#': '1,0 1.5,6|2.5,0 3,6|0,2 4,2|0,4 4,4', '%': '0,0 4,6|0.5,5.5 0.5,5|3.5,1 3.5,0.5', '&': '4,0 0.5,4.5 1,6 2,6 2.5,4.5 0,2 0,1 1,0 2.5,0 4,2',
  '@': '3,2 1.5,2 1.5,4 3,4 3,1.5 4,2 4,5 3,6 1,6 0,5 0,1 1,0 3.5,0', '<': '4,5 0,3 4,1', '>': '0,5 4,3 0,1',
}
const PARSED = Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v.split('|').map((s) => s.trim().split(/\s+/).map((p) => p.split(',').map(Number)))]))

export const CHAR_ADVANCE = 6 // unità griglia
export const LINE_HEIGHT = 10

/** Converte un testo in polilinee (mm). (x,y) = angolo in basso a sinistra della prima riga. */
export function textToPolylines(text, x, y, size) {
  const k = size / 6
  const out = []
  const lines = String(text).split('\n')
  lines.forEach((line, li) => {
    const clean = line.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    let cx = 0
    for (const ch of clean) {
      const g = PARSED[ch]
      if (g) for (const stroke of g) out.push(stroke.map(([gx, gy]) => [x + (cx + gx) * k, y - li * LINE_HEIGHT * k + gy * k]))
      cx += CHAR_ADVANCE
    }
  })
  return out
}

/** Font interno nel formato dei font Hershey (usato come fallback mentre i font vengono caricati). */
export const BUILTIN_FONT = {
  name: 'Semplice (interno)',
  cap: 6,
  upper: true,
  glyphs: Object.fromEntries([[' ', [CHAR_ADVANCE, []]], ...Object.entries(PARSED).map(([k, strokes]) => [k, [CHAR_ADVANCE, strokes.map((s) => s.flat())]])]),
}
