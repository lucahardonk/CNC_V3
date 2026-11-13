import { create } from 'zustand'
import { Settings, Tools } from '../services/api'
import { grblWs } from '../services/grblWs'

export const MATERIAL_COLORS = { softwood: '#D4A96A', hardwood: '#6B3F2A', aluminum: '#A8A9AD' }
export const MATERIAL_NAMES = { softwood: 'Legno Morbido', hardwood: 'Legno Duro', aluminum: 'Alluminio' }
export const OPERATION_NAMES = {
  profile_outside: 'Profilo esterno', profile_inside: 'Profilo interno', profile_on: 'Profilo sul centro', pocket: 'Pocket',
}

const MAX_LOG = 600

export const useStore = create((set, get) => ({
  // ---- configurazione
  settings: null,
  materials: {},
  tools: [],
  settingsOpen: false,
  toast: null,
  breadcrumb: null,

  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setBreadcrumb: (b) => set({ breadcrumb: b }),
  notify: (text, kind = 'info') => {
    const id = Date.now()
    set({ toast: { id, text, kind } })
    setTimeout(() => { if (get().toast?.id === id) set({ toast: null }) }, 3500)
  },

  loadConfig: async () => {
    const [settings, materials, tools] = await Promise.all([Settings.get(), Settings.materials(), Tools.list()])
    set({ settings, materials, tools })
  },
  setTools: (tools) => set({ tools }),
  setMaterials: (materials) => set({ materials }),
  setSettings: (settings) => set({ settings }),

  // ---- GRBL
  grbl: { connected: false, simulated: false, state: 'Disconnected', mpos: [0, 0, 0], wpos: [0, 0, 0], wco: [0, 0, 0], feed: 0, spindle: 0, job: { running: false, sent: 0, acked: 0, total: 0 } },
  wsConnected: false,
  grblLog: [],
  lastJobDone: null,

  initGrbl: () => {
    if (get()._grblInit) return
    set({ _grblInit: true })
    grblWs.subscribe((msg) => {
      if (msg.type === 'status') set({ grbl: msg })
      else if (msg.type === 'ws') set({ wsConnected: msg.connected })
      else if (msg.type === 'log' || msg.type === 'error') {
        const entry = { dir: msg.dir || 'err', text: msg.text, t: msg.t || Date.now() / 1000 }
        set((s) => ({ grblLog: [...s.grblLog.slice(-MAX_LOG + 1), entry] }))
      } else if (msg.type === 'job_done') set({ lastJobDone: { ...msg, at: Date.now() } })
    })
    grblWs.connect()
  },
  clearLog: () => set({ grblLog: [] }),
}))
