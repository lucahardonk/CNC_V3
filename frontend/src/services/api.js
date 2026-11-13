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

export const exportUrl = '/api/export'
export const importZip = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return d(api.post('/import', fd))
}
