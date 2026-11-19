import axios from 'axios'

export const api = axios.create({ baseURL: '/api', timeout: 60000 })

export const errMsg = (e) => e?.response?.data?.detail
  ? (typeof e.response.data.detail === 'string' ? e.response.data.detail : JSON.stringify(e.response.data.detail))
  : (e?.message || 'Errore sconosciuto')

const d = (p) => p.then((r) => r.data)

export const Projects = {
  list: () => d(api.get('/projects')),
  get: (id) => d(api.get(`/projects/${id}`)),
  create: (body) => d(api.post('/projects', body)),
  update: (id, body) => d(api.put(`/projects/${id}`, body)),
  remove: (id) => d(api.delete(`/projects/${id}`)),
}

export const Layers = {
  list: (pid) => d(api.get(`/projects/${pid}/layers`)),
  create: (pid, body) => d(api.post(`/projects/${pid}/layers`, body)),
  update: (id, body) => d(api.put(`/layers/${id}`, body)),
  patch: (id, body) => d(api.patch(`/layers/${id}`, body)),
  remove: (id) => d(api.delete(`/layers/${id}`)),
  entities: (id) => d(api.get(`/layers/${id}/entities`)),
  saveEntities: (id, entities) => d(api.post(`/layers/${id}/entities`, { entities, replace: true })),
  generate: (id, body) => d(api.post(`/layers/${id}/generate`, body)),
}

export const Tools = {
  list: () => d(api.get('/tools')),
  replaceAll: (tools) => d(api.put('/tools', tools)),
  add: (t) => d(api.post('/tools', t)),
  update: (id, t) => d(api.put(`/tools/${id}`, t)),
  remove: (id) => d(api.delete(`/tools/${id}`)),
}

export const Settings = {
  get: () => d(api.get('/settings')),
  save: (s) => d(api.put('/settings', s)),
  materials: () => d(api.get('/materials')),
  saveMaterials: (m) => d(api.put('/materials', m)),
}

export const Grbl = {
  status: () => d(api.get('/grbl/status')),
  connect: (body = {}) => d(api.post('/grbl/connect', body)),
  disconnect: () => d(api.post('/grbl/disconnect')),
  jog: (x = 0, y = 0, z = 0, feed = 1000) => d(api.post('/grbl/jog', { x, y, z, feed })),
  jogCancel: () => d(api.post('/grbl/jog/cancel')),
  zero: (axis) => d(api.post(`/grbl/zero/${axis}`)),
  stop: () => d(api.post('/grbl/stop')),
  pause: () => d(api.post('/grbl/pause')),
  resume: () => d(api.post('/grbl/resume')),
  unlock: () => d(api.post('/grbl/unlock')),
  home: () => d(api.post('/grbl/home')),
  command: (command) => d(api.post('/grbl/command', { command })),
  sendLayer: (layer_id) => d(api.post('/grbl/send', { layer_id })),
}

export const Dxf = {
  parse: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return d(api.post('/dxf/parse', fd))
  },
}

// G-code di un solo layer di disegno (non salvato): JSON con statistiche, oppure blob .nc
export const Export = {
  layerGcode: (layerId, body) => d(api.post(`/export/layer/${layerId}`, body)),
  layerGcodeFile: async (layerId, body) => {
    const r = await api.post(`/export/layer/${layerId}`, body, { params: { format: 'nc' }, responseType: 'blob' })
    const m = /filename="?([^";]+)"?/.exec(r.headers['content-disposition'] || '')
    return { blob: r.data, filename: m ? m[1] : 'layer.nc' }
  },
}

// Scarica un .nc (GET) con il nome file dal Content-Disposition; gli errori del backend arrivano come Blob JSON
const downloadNc = async (url, fallback) => {
  try {
    const r = await api.get(url, { responseType: 'blob' })
    const m = /filename="?([^";]+)"?/.exec(r.headers['content-disposition'] || '')
    const name = m ? m[1] : fallback
    const href = URL.createObjectURL(r.data)
    const el = Object.assign(document.createElement('a'), { href, download: name })
    document.body.appendChild(el); el.click(); el.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    return name
  } catch (e) {
    if (e?.response?.data instanceof Blob) {
      try { e.response.data = JSON.parse(await e.response.data.text()) } catch { /* noop */ }
    }
    throw e
  }
}
// .nc generati con i parametri di taglio salvati nei layer
Export.layerNc = (layerId) => downloadNc(`/export/layer/${layerId}`, 'layer.nc')
Export.projectNc = (projectId) => downloadNc(`/export/all/${projectId}`, 'progetto_all.nc')

export const exportUrl = '/api/export'
export const importZip = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return d(api.post('/import', fd))
}
