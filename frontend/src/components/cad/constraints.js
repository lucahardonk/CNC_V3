// Vincoli geometrici del CAD: punti con nome, vincolo di coincidenza (anche con l'origine)
// e quote guida con valore (lunghezza, larghezza/altezza, raggio/diametro, distanza tra punti, angolo).
// Il solver è un rilassamento iterativo (Gauss-Seidel): semplice, robusto per schizzi piccoli.
import { EPS, angleOf, arcSweep, dist, isDim, keyPoints, lineIntersection, polar, rectLines, uid } from './geometry'

export const ORIGIN_ID = '__origin'
export const isConstraint = (e) => e?.type === 'constraint'
export const isGeo = (e) => e && !isDim(e) && !isConstraint(e) && e.type !== 'bridge'

// ---------------------------------------------------------------- punti con nome
export function namedPoints(e) {
  const d = e.data
  switch (e.type) {
    case 'line': case 'construction':
      return [{ ref: 'p1', x: d.x1, y: d.y1 }, { ref: 'p2', x: d.x2, y: d.y2 }, { ref: 'm', x: (d.x1 + d.x2) / 2, y: (d.y1 + d.y2) / 2 }]
    case 'rect': {
      const L = rectLines(d)
      return [...L.map((s, i) => ({ ref: 'v' + i, ...s.a })), { ref: 'c', x: d.x + d.w / 2, y: d.y + d.h / 2 },
        ...L.map((s, i) => ({ ref: 'm' + i, x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }))]
    }
    case 'point': return [{ ref: 'p', x: d.x, y: d.y }]
    case 'circle': {
      const c = { x: d.cx, y: d.cy }
      return [{ ref: 'c', ...c }, ...[0, 90, 180, 270].map((a, i) => ({ ref: 'q' + i, ...polar(c, d.r, a) }))]
    }
    case 'arc': {
      const c = { x: d.cx, y: d.cy }
      return [{ ref: 'c', ...c }, { ref: 's', ...polar(c, d.r, d.start) }, { ref: 'e', ...polar(c, d.r, d.end) }]
    }
    case 'spline': return (d.points || []).map((p, i) => ({ ref: 'i' + i, x: p.x, y: p.y }))
    case 'ellipse': case 'slot': return keyPoints(e).map((p, i) => ({ ref: 'k' + i, x: p.x, y: p.y }))
    default: return []
  }
}

// Categoria di un punto con nome: 'vtx' vertice/estremo, 'mid' punto medio, 'ctr' centro, 'pt' entità Punto.
// Nome stabile del key-point: mid_<id>_<lato> / ctr_<id> / pt_<id> (vedi keyPointName)
export function pointKind(e, ref) {
  if (!e) return 'vtx'
  if (e.type === 'point') return 'pt'
  if (ref === 'm' && (e.type === 'line' || e.type === 'construction')) return 'mid'
  if (e.type === 'rect' && /^m\d$/.test(ref)) return 'mid'
  if (ref === 'c' || ((e.type === 'ellipse' || e.type === 'slot') && ref === 'k0')) return 'ctr'
  return 'vtx'
}
export function keyPointName(e, ref) {
  const k = pointKind(e, ref)
  if (k === 'mid') return `mid_${e.id}_${ref === 'm' ? 0 : ref.slice(1)}`
  if (k === 'ctr') return `ctr_${e.id}`
  if (k === 'pt') return `pt_${e.id}`
  return `${ref}_${e.id}`
}

export function getPt(e, ref) {
  if (!e) return null
  const p = namedPoints(e).find((q) => q.ref === ref)
  return p ? { x: p.x, y: p.y } : null
}

// Punti che si spostano da soli (stiramento); tutti gli altri spostano l'intera figura (rigida)
export const isStretch = (e, ref) => !!e && (e.type === 'point' || ((e.type === 'line' || e.type === 'construction') && (ref === 'p1' || ref === 'p2')) || (e.type === 'spline' && /^i\d+$/.test(ref)))

export function shift(e, dx, dy) {
  const d = { ...e.data }
  for (const k of ['x1', 'x2', 'x', 'cx']) if (k in d) d[k] += dx
  for (const k of ['y1', 'y2', 'y', 'cy']) if (k in d) d[k] += dy
  if (Array.isArray(d.points)) d.points = d.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  return { ...e, data: d }
}

export function setPt(e, ref, p) {
  if (e.type === 'point') return { ...e, data: { ...e.data, x: p.x, y: p.y } }
  if (e.type === 'line' || e.type === 'construction') {
    if (ref === 'p1') return { ...e, data: { ...e.data, x1: p.x, y1: p.y } }
    if (ref === 'p2') return { ...e, data: { ...e.data, x2: p.x, y2: p.y } }
  }
  if (e.type === 'spline' && /^i\d+$/.test(ref)) {
    const i = Number(ref.slice(1)), points = [...e.data.points]
    points[i] = { x: p.x, y: p.y }
    return { ...e, data: { ...e.data, points } }
  }
  const cur = getPt(e, ref)
  return cur ? shift(e, p.x - cur.x, p.y - cur.y) : e
}

// Punto con nome esattamente in `p` (escluse le entità in `excludeIds`). Preferisce gli estremi stirabili.
export function pointRefAt(list, p, excludeIds = new Set(), tol = 1e-6) {
  if (Math.hypot(p.x, p.y) <= tol) return { id: ORIGIN_ID, ref: 'o' }
  let best = null
  for (const e of list) {
    if (!isGeo(e) || excludeIds.has(e.id)) continue
    for (const q of namedPoints(e)) {
      if (dist(q, p) > tol) continue
      const score = isStretch(e, q.ref) ? 0 : 1
      if (!best || score < best.score) best = { id: e.id, ref: q.ref, score }
    }
  }
  return best && { id: best.id, ref: best.ref }
}

const sameRef = (a, b) => !!a && !!b && a.id === b.id && a.ref === b.ref
// Vincolo "punto su linea": data.a = punto con nome, data.b = { id: linea, ref: 'line' }
export const isOnLine = (c) => isConstraint(c) && c.kind === 'on_line'
export const onLine = (a, lineId) => ({ id: uid(), type: 'constraint', is_construction: true, kind: 'on_line', data: { a: { ...a }, b: { id: lineId, ref: 'line' } } })
// Proiezione di p sulla retta della linea l
export function projectOnLine(l, p) {
  const d = l.data, ux = d.x2 - d.x1, uy = d.y2 - d.y1, L2 = ux * ux + uy * uy
  if (L2 < EPS) return { x: d.x1, y: d.y1 }
  const t = ((p.x - d.x1) * ux + (p.y - d.y1) * uy) / L2
  return { x: d.x1 + ux * t, y: d.y1 + uy * t }
}
const onLineErr = (byId, c) => {
  const a = refPt(byId, c.data.a), l = byId.get(c.data.b.id)
  return a && l ? dist(a, projectOnLine(l, a)) : 0
}
export const coincident = (a, b) => ({ id: uid(), type: 'constraint', is_construction: true, kind: 'coincident', data: { a: { ...a }, b: { ...b } } })
export function hasCoincident(list, a, b) {
  return list.some((c) => isConstraint(c) && c.kind !== 'on_line' && ((sameRef(c.data.a, a) && sameRef(c.data.b, b)) || (sameRef(c.data.a, b) && sameRef(c.data.b, a))))
}

// Punti che generano vincoli automatici: estremi di linee/spline/archi, vertici di rettangoli, centri
// + punti medi delle linee/lati e centri (key-point "di seconda categoria") + entità Punto
const AUTO_REF = (e, ref) => isStretch(e, ref) || e.type === 'arc' || e.type === 'rect' || ((e.type === 'line' || e.type === 'construction') && ref === 'm') || ((e.type === 'circle' || e.type === 'ellipse' || e.type === 'slot') && (ref === 'c' || ref === 'k0'))
// Crea i vincoli di coincidenza per gli estremi di `newEnts` che cadono esattamente su punti esistenti
export function autoCoincide(list, newEnts) {
  const pool = [...list, ...newEnts]
  const out = []
  for (const e of newEnts) {
    if (!isGeo(e)) continue
    for (const q of namedPoints(e)) {
      if (!AUTO_REF(e, q.ref)) continue
      const a = { id: e.id, ref: q.ref }
      const b = pointRefAt(pool, q, new Set([e.id]), 1e-4)
      if (b && !hasCoincident([...list, ...out], a, b)) out.push(coincident(a, b))
    }
  }
  return out
}

// ---------------------------------------------------------------- valori delle quote
const lineEnds = (e) => ({ p1: { x: e.data.x1, y: e.data.y1 }, p2: { x: e.data.x2, y: e.data.y2 } })
const other = (r) => (r === 'p1' ? 'p2' : 'p1')

// Valore geometrico attuale di una quota collegata (null se non collegata o riferimenti mancanti)
export function measureDim(dim, byId) {
  if (dim.targetId) {
    const t = byId.get(dim.targetId)
    if (!t) return null
    const d = t.data
    switch (dim.param) {
      case 'length': return Math.hypot(d.x2 - d.x1, d.y2 - d.y1)
      case 'width': return d.w
      case 'height': return d.h
      case 'diameter': return 2 * d.r
      case 'radius': return d.r
      default: return null
    }
  }
  if (dim.pa && dim.pb) {
    const a = refPt(byId, dim.pa), b = refPt(byId, dim.pb)
    return a && b ? dist(a, b) : null
  }
  if (dim.la && dim.lb) {
    const A = byId.get(dim.la.id), B = byId.get(dim.lb.id)
    if (!A || !B) return null
    const ea = lineEnds(A), eb = lineEnds(B)
    return arcSweep(angleOf(ea[dim.la.v], ea[other(dim.la.v)]), angleOf(eb[dim.lb.v], eb[other(dim.lb.v)]))
  }
  return null
}
const refPt = (byId, r) => (r.id === ORIGIN_ID ? { x: 0, y: 0 } : getPt(byId.get(r.id), r.ref))

export const isLinkedDim = (e) => isDim(e) && !!(e.targetId || (e.pa && e.pb) || (e.la && e.lb))

// Imposta `value` dalle geometrie attuali per le quote guida collegate alle entità `ids` (o a tutte se ids = null)
export function refreshDimValues(list, ids = null) {
  const byId = new Map(list.map((e) => [e.id, e]))
  const touches = (e) => !ids || ids.has(e.targetId) || ids.has(e.pa?.id) || ids.has(e.pb?.id) || ids.has(e.la?.id) || ids.has(e.lb?.id)
  return list.map((e) => {
    if (!isLinkedDim(e) || e.driving === false || !touches(e)) return e
    const v = measureDim(e, byId)
    return v != null ? { ...e, value: v } : e
  })
}

// ---------------------------------------------------------------- pulizia riferimenti
// Rimuove vincoli orfani e scollega le quote i cui riferimenti non esistono più
export function pruneRefs(list) {
  const ids = new Set(list.map((e) => e.id))
  const ok = (r) => r && (r.id === ORIGIN_ID || ids.has(r.id))
  return list.filter((e) => !isConstraint(e) || (ok(e.data?.a) && ok(e.data?.b) && !sameRef(e.data.a, e.data.b))).map((e) => {
    if (!isDim(e)) return e
    if ((e.pa || e.pb) && !(ok(e.pa) && ok(e.pb))) { const { pa, pb, value, driving, ...r } = e; return r }
    if ((e.la || e.lb) && !(ok(e.la) && ok(e.lb))) { const { la, lb, value, driving, ...r } = e; return r }
    if (e.value != null && !e.targetId && !e.pa && !e.la) { const { value, ...r } = e; return r }
    return e
  })
}

// Aggiorna la posizione delle quote tra punti e angolari dalle geometrie
export function syncRefDims(list) {
  const byId = new Map(list.map((e) => [e.id, e]))
  return list.map((e) => {
    if (e.type === 'dimension' && e.pa && e.pb) {
      const a = refPt(byId, e.pa), b = refPt(byId, e.pb)
      return a && b ? { ...e, data: { ...e.data, x1: a.x, y1: a.y, x2: b.x, y2: b.y } } : e
    }
    if (e.type === 'dim_angle' && e.la && e.lb) {
      const A = byId.get(e.la.id), B = byId.get(e.lb.id)
      if (!A || !B) return e
      const ea = lineEnds(A), eb = lineEnds(B)
      const P = lineIntersection(ea.p1, ea.p2, eb.p1, eb.p2) || ea[e.la.v]
      return { ...e, data: { ...e.data, cx: P.x, cy: P.y, a1: angleOf(ea[e.la.v], ea[other(e.la.v)]), a2: angleOf(eb[e.lb.v], eb[other(e.lb.v)]) } }
    }
    return e
  })
}

// ---------------------------------------------------------------- solver
// fixed: array di chiavi "id" (entità bloccata) o "id:ref" (punto bloccato).
// Ritorna { list, err } con err = violazione massima residua (mm o gradi/100).
export function solve(list, { fixed = [], iters = 400, tol = 1e-7 } = {}) {
  const cons = list.filter((e) => isConstraint(e) && e.kind === 'coincident')
  const onl = list.filter(isOnLine)
  const dims = list.filter((e) => isLinkedDim(e) && e.driving !== false && e.value > 0)
  if (!cons.length && !dims.length && !onl.length) return { list, err: 0 }
  const ents = new Map(list.map((e) => [e.id, e]))
  const fx = new Set(fixed)
  const fixedEnt = (id) => fx.has(id) || [...fx].some((k) => k.startsWith(id + ':'))
  const isFixed = (r) => {
    if (r.id === ORIGIN_ID) return true
    const e = ents.get(r.id)
    if (!e) return true
    if (fx.has(r.id)) return true
    return isStretch(e, r.ref) ? fx.has(`${r.id}:${r.ref}`) : fixedEnt(r.id)
  }
  const P = (r) => (r.id === ORIGIN_ID ? { x: 0, y: 0 } : getPt(ents.get(r.id), r.ref))
  const S = (r, p) => { if (r.id !== ORIGIN_ID) ents.set(r.id, setPt(ents.get(r.id), r.ref, p)) }
  const stretch = (r) => isStretch(ents.get(r.id), r.ref)
  // un punto bloccato blocca anche i punti coincidenti (altrimenti i vincoli si "contendono" il punto)
  for (let grow = true; grow;) {
    grow = false
    for (const c of cons) {
      for (const [x, y] of [[c.data.a, c.data.b], [c.data.b, c.data.a]]) {
        if (y.id === ORIGIN_ID || !ents.get(y.id) || isFixed(y) || !isFixed(x) || x.id === ORIGIN_ID) continue
        const px = P(x)
        if (px) S(y, px) // il punto coincidente segue quello bloccato, poi resta fermo lì
        fx.add(stretch(y) ? `${y.id}:${y.ref}` : y.id)
        grow = true
      }
    }
  }
  // figure "ancorate" (collegate all'origine tramite vincoli): a parità di condizioni si muove l'altra
  const anchored = new Set([ORIGIN_ID])
  for (let grow = true; grow;) {
    grow = false
    for (const c of cons) {
      const ia = c.data.a.id, ib = c.data.b.id
      if (anchored.has(ia) !== anchored.has(ib)) { anchored.add(ia); anchored.add(ib); grow = true }
    }
  }
  const heavier = (A, B) => anchored.has(A.id) && !anchored.has(B.id)
  // "peso" di un'entità = numero di vincoli/quote che la toccano (+ancoraggio): si muove la meno vincolata
  const weight = (id) => {
    let w = anchored.has(id) ? 2 : 0
    for (const e of list) {
      if (isConstraint(e)) w += (e.data.a.id === id) + (e.data.b.id === id)
      else if (isLinkedDim(e) && e.driving !== false) w += (e.targetId === id) + (e.pa?.id === id) + (e.pb?.id === id)
    }
    return w
  }
  const rot = (p, c, ang) => { const r = ang * Math.PI / 180, dx = p.x - c.x, dy = p.y - c.y; return { x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r) } }
  let err = 0

  const distCon = (A, B, v) => {
    const pa = P(A), pb = P(B)
    if (!pa || !pb) return
    const d = dist(pa, pb), diff = Math.abs(d - v)
    if (diff < tol) return
    if (A.id === B.id && !stretch(A) && !stretch(B)) return // due punti della stessa figura rigida
    let fa = isFixed(A), fb = isFixed(B)
    if (fa && fb) return
    if (!fa && !fb) { if (heavier(A, B)) fa = true; else if (heavier(B, A)) fb = true }
    err = Math.max(err, diff)
    const u = d > EPS ? { x: (pb.x - pa.x) / d, y: (pb.y - pa.y) / d } : { x: 1, y: 0 }
    if (fa) S(B, { x: pa.x + u.x * v, y: pa.y + u.y * v })
    else if (fb) S(A, { x: pb.x - u.x * v, y: pb.y - u.y * v })
    else {
      const m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
      S(A, { x: m.x - u.x * v / 2, y: m.y - u.y * v / 2 })
      S(B, { x: m.x + u.x * v / 2, y: m.y + u.y * v / 2 })
    }
  }

  for (let it = 0; it < iters; it++) {
    err = 0
    for (const c of cons) {
      const A = c.data.a, B = c.data.b
      const pa = P(A), pb = P(B)
      if (!pa || !pb) continue
      const d = dist(pa, pb)
      if (d < tol) continue
      let fa = isFixed(A), fb = isFixed(B)
      if (fa && fb) continue
      if (!fa && !fb) { if (heavier(A, B)) fa = true; else if (heavier(B, A)) fb = true }
      err = Math.max(err, d)
      const sa = !fa && stretch(A), sb = !fb && stretch(B)
      if (fa || (!fb && sb && !sa)) S(B, pa)
      else if (fb || (sa && !sb)) S(A, pb)
      else { const m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }; S(A, m); S(B, m) }
    }
    for (const dm of dims) {
      const v = dm.value
      if (dm.targetId) {
        const t = ents.get(dm.targetId)
        if (!t) continue
        if (dm.param === 'length' && (t.type === 'line' || t.type === 'construction')) { distCon({ id: t.id, ref: 'p1' }, { id: t.id, ref: 'p2' }, v); continue }
        const key = { width: 'w', height: 'h', diameter: 'r', radius: 'r' }[dm.param]
        if (!key) continue
        const want = dm.param === 'diameter' ? v / 2 : v
        const diff = Math.abs((t.data[key] ?? want) - want)
        if (diff > tol && !fx.has(t.id)) { err = Math.max(err, diff); ents.set(t.id, { ...t, data: { ...t.data, [key]: want } }) }
      } else if (dm.pa && dm.pb) distCon(dm.pa, dm.pb, v)
      else if (dm.la && dm.lb) {
        const A = ents.get(dm.la.id), B = ents.get(dm.lb.id)
        if (!A || !B) continue
        const ea = lineEnds(A), eb = lineEnds(B)
        const va = ea[dm.la.v], fa_ = ea[other(dm.la.v)], vb = eb[dm.lb.v], fb_ = eb[other(dm.lb.v)]
        const ua = angleOf(va, fa_), ub = angleOf(vb, fb_)
        const cur = arcSweep(ua, ub)
        const delta = ((v - cur + 540) % 360) - 180
        if (Math.abs(delta) < 1e-6) continue
        // rotazione rigida della linea meno vincolata attorno all'intersezione delle due linee
        const Pi = lineIntersection(ea.p1, ea.p2, eb.p1, eb.p2) || vb
        const canRot = (L, e) => !fx.has(L.id) && ['p1', 'p2'].every((r) => !fx.has(`${L.id}:${r}`) || dist(e[r], Pi) < 1e-6)
        const wa = canRot(A, ea) ? weight(A.id) : Infinity, wb = canRot(B, eb) ? weight(B.id) : Infinity
        if (wa === Infinity && wb === Infinity) continue
        const [L, e, ang] = wb <= wa ? [B, eb, delta] : [A, ea, -delta]
        const q1 = rot(e.p1, Pi, ang), q2 = rot(e.p2, Pi, ang)
        ents.set(L.id, { ...L, data: { ...L.data, x1: q1.x, y1: q1.y, x2: q2.x, y2: q2.y } })
        err = Math.max(err, Math.abs(delta) / 100)
      }
    }
    for (const c of onl) {
      const A = c.data.a, l = ents.get(c.data.b.id), pa = P(A)
      if (!l || !pa) continue
      const q = projectOnLine(l, pa), d = dist(pa, q)
      if (d < tol) continue
      err = Math.max(err, d)
      if (!isFixed(A)) S(A, q)
      else if (!fixedEnt(l.id)) ents.set(l.id, shift(l, pa.x - q.x, pa.y - q.y))
    }
    if (err < tol) break
  }
  // errore residuo reale (dopo l'ultima iterazione)
  return { list: list.map((e) => ents.get(e.id) || e), err: residual(list.map((e) => ents.get(e.id) || e)) }
}

// Violazione massima dei vincoli nella lista (mm; angoli in gradi/100)
export function residual(list) {
  const byId = new Map(list.map((e) => [e.id, e]))
  let err = 0
  for (const c of list) {
    if (isOnLine(c)) err = Math.max(err, onLineErr(byId, c))
    else if (isConstraint(c)) {
      const a = refPt(byId, c.data.a), b = refPt(byId, c.data.b)
      if (a && b) err = Math.max(err, dist(a, b))
    } else if (isLinkedDim(c) && c.driving !== false && c.value > 0) {
      const m = measureDim(c, byId)
      if (m == null) continue
      if (c.la) err = Math.max(err, Math.abs(((c.value - m + 540) % 360) - 180) / 100)
      else err = Math.max(err, Math.abs(m - c.value))
    }
  }
  return err
}

// Arrotonda le coordinate (evita rumore numerico nel salvataggio)
const r4 = (v) => Math.round(v * 1e4) / 1e4
export function roundEnt(e) {
  if (!isGeo(e) && !isDim(e)) return e
  const d = {}
  for (const [k, v] of Object.entries(e.data)) d[k] = typeof v === 'number' ? r4(v) : v
  if (Array.isArray(d.points)) d.points = d.points.map((p) => ({ x: r4(p.x), y: r4(p.y) }))
  return { ...e, data: d }
}

// Posizione di un vincolo (punto A)
export function constraintPos(c, byId) { return refPt(byId, c.data.a) }

// ---------------------------------------------------------------- persistenza
// Il backend salva solo type/data/is_construction: i campi extra viaggiano in data._meta
// lo = offset etichetta della quota RELATIVO al suo punto medio (mm, {dx, dy})
const META_KEYS = ['targetId', 'param', 'side', 'driving', 'value', 'pa', 'pb', 'la', 'lb', 'kind', 'lo']
export function packEnt(e) {
  const meta = {}
  for (const k of META_KEYS) if (e[k] !== undefined) meta[k] = e[k]
  const data = { ...e.data }
  delete data._meta
  if (Object.keys(meta).length) data._meta = meta
  return { id: e.id, type: e.type, data, is_construction: !!e.is_construction }
}
export function unpackEnt({ id, type, data, is_construction }) {
  const { _meta, ...rest } = data || {}
  return { ...(_meta || {}), id, type, data: rest, is_construction }
}

// ---------------------------------------------------------------- pipeline di commit
// fixed: chiavi bloccate (entità/punti appena modificati dall'utente).
// 1) risolve tenendo fermo ciò che l'utente ha toccato; 2) se impossibile, le quote guida
// dell'entità toccata prendono il nuovo valore; 3) se ancora impossibile vincono i vincoli.
const SOLVE_TOL = 1e-3
export function solveCommit(list, fixed = [], { refresh = true } = {}) {
  let r = solve(list, { fixed })
  // modifica di una quota (refresh = false) impossibile: si rifiuta invece di stravolgere il disegno
  if (r.err > SOLVE_TOL && !refresh) return { list, err: r.err, rejected: true }
  if (r.err > SOLVE_TOL && fixed.length) {
    const ids = new Set(fixed.map((k) => String(k).split(':')[0]))
    r = solve(refreshDimValues(r.list, ids), { fixed })
    if (r.err > SOLVE_TOL) r = solve(r.list, { fixed: [] })
  }
  return { list: syncRefDims(r.list).map(roundEnt), err: r.err }
}

// Operazioni "dirette" (disegno, taglio, raccordo, specchio, incolla...): la geometria dell'utente vince.
// I vincoli di coincidenza violati vengono rimossi, le quote guida prendono il valore attuale.
export function acceptGeometry(list, tol = SOLVE_TOL) {
  const byId = new Map(list.map((e) => [e.id, e]))
  return list.filter((c) => {
    if (!isConstraint(c)) return true
    if (isOnLine(c)) return onLineErr(byId, c) <= tol
    const a = refPt(byId, c.data.a), b = refPt(byId, c.data.b)
    return !a || !b || dist(a, b) <= tol
  }).map((e) => {
    if (!isLinkedDim(e) || e.driving === false) return e
    const m = measureDim(e, byId)
    if (m == null) return e
    const off = e.value == null ? Infinity : e.la ? Math.abs(((e.value - m + 540) % 360) - 180) : Math.abs(e.value - m)
    return off > tol ? { ...e, value: m } : e
  })
}
// Imposta `value` sulle quote guida collegate che non lo hanno ancora
export function fillDimValues(list) {
  const byId = new Map(list.map((e) => [e.id, e]))
  return list.map((e) => {
    if (!isLinkedDim(e) || e.driving === false || e.value != null) return e
    const m = measureDim(e, byId)
    return m != null ? { ...e, value: m } : e
  })
}
