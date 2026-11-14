async function req(method, url, body) {
  const r = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const ct = r.headers.get('content-type') || ''
  const data = ct.includes('json') ? await r.json() : await r.text()
  if (!r.ok) throw new Error(data?.detail || data || `HTTP ${r.status}`)
  return data
}

export const api = {
  settings: () => req('GET', '/settings'),
  saveSettings: (s) => req('PUT', '/settings', s),
  projects: () => req('GET', '/projects'),
  project: (id) => req('GET', `/projects/${id}`),
  saveProject: (p) => req('POST', '/projects', p),
  deleteProject: (id) => req('DELETE', `/projects/${id}`),
  status: () => req('GET', '/machine/status'),
  gcode: (script) => req('POST', '/machine/gcode', { script }),
  jog: (x, y, z, feed) => req('POST', '/machine/jog', { x, y, z, feed }),
  home: () => req('POST', '/machine/home'),
  estop: () => req('POST', '/machine/emergency_stop'),
  firmwareRestart: () => req('POST', '/machine/firmware_restart'),
  restart: () => req('POST', '/machine/restart'),
  job: () => req('GET', '/job'),
  startJob: (gcode, name, mode) => req('POST', '/job/start', { gcode, name, mode }),
  stopJob: () => req('POST', '/job/stop'),
  resumeJob: () => req('POST', '/job/resume'),
  resetJob: () => req('POST', '/job/reset'),
}

export function downloadText(text, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
