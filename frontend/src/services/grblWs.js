// Client WebSocket GRBL con riconnessione automatica.
let ws = null
let listeners = new Set()
let retry = null
let wanted = false

const url = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws/grbl`

function open() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return
  ws = new WebSocket(url())
  ws.onopen = () => emit({ type: 'ws', connected: true })
  ws.onmessage = (ev) => {
    try { emit(JSON.parse(ev.data)) } catch { /* ignore */ }
  }
  ws.onclose = () => {
    emit({ type: 'ws', connected: false })
    if (wanted) { clearTimeout(retry); retry = setTimeout(open, 1500) }
  }
  ws.onerror = () => ws?.close()
}

function emit(msg) { listeners.forEach((fn) => fn(msg)) }

export const grblWs = {
  connect() { wanted = true; open() },
  disconnect() { wanted = false; clearTimeout(retry); ws?.close() },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  send(obj) { if (ws?.readyState === 1) { ws.send(JSON.stringify(obj)); return true } return false },
}
