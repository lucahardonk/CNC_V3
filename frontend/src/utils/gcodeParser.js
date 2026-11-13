// Parser G-code minimale -> segmenti per la visualizzazione 3D.
// Ritorna { rapid: Float32Array, cut: Float32Array, lineIndex: number[], bounds }
export function parseGcode(text) {
  const rapid = []
  const cut = []
  const points = [] // posizione dopo ogni linea eseguibile (per animazione progress)
  let x = 0, y = 0, z = 0, mode = 0, abs = true
  const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity }
  if (!text) return { rapid: new Float32Array(), cut: new Float32Array(), points, bounds: null }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\(.*?\)|;.*/g, '').trim().toUpperCase()
    if (!line) continue
    const words = {}
    const re = /([A-Z])\s*(-?\d*\.?\d+)/g
    let m
    while ((m = re.exec(line))) {
      const k = m[1], v = parseFloat(m[2])
      if (k === 'G') {
        if (v === 0 || v === 1) mode = v
        else if (v === 90) abs = true
        else if (v === 91) abs = false
      } else if (!(k in words)) words[k] = v
    }
    let nx = x, ny = y, nz = z
    if ('X' in words) nx = abs ? words.X : x + words.X
    if ('Y' in words) ny = abs ? words.Y : y + words.Y
    if ('Z' in words) nz = abs ? words.Z : z + words.Z
    if (nx !== x || ny !== y || nz !== z) {
      const arr = mode === 0 ? rapid : cut
      arr.push(x, y, z, nx, ny, nz)
      if (mode === 1) {
        b.minX = Math.min(b.minX, x, nx); b.maxX = Math.max(b.maxX, x, nx)
        b.minY = Math.min(b.minY, y, ny); b.maxY = Math.max(b.maxY, y, ny)
        b.minZ = Math.min(b.minZ, z, nz); b.maxZ = Math.max(b.maxZ, z, nz)
      }
      x = nx; y = ny; z = nz
    }
    points.push([x, y, z])
  }
  return { rapid: new Float32Array(rapid), cut: new Float32Array(cut), points, bounds: isFinite(b.minX) ? b : null }
}
