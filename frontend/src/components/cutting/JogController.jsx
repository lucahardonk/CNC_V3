import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, ChevronsDown, ChevronsUp, Crosshair, Gamepad2, OctagonX } from 'lucide-react'
import { errMsg, Grbl } from '../../services/api'
import { grblWs } from '../../services/grblWs'
import { useStore } from '../../store/store'

const STEPS = [0.01, 0.1, 1, 10]

export default function JogController({ compact = false }) {
  const { grbl, settings, notify } = useStore()
  const [step, setStep] = useState(1)
  const [feed, setFeed] = useState(settings?.grbl?.jog_feed_xy || 1000)
  const [pad, setPad] = useState(null)
  const disabled = !grbl.connected || grbl.job?.running
  const js = settings?.joystick

  const jog = async (x, y, z) => {
    if (disabled) return
    const f = z && !x && !y ? Math.min(feed, settings?.grbl?.jog_feed_z || 400) : feed
    try { await Grbl.jog(x * step, y * step, z * step, f) } catch (e) { notify(errMsg(e), 'error') }
  }
  const stop = async () => { try { await Grbl.stop() } catch (e) { notify(errMsg(e), 'error') } }
  const zero = async (a) => { try { await Grbl.zero(a); notify(`Zero ${a.toUpperCase()} impostato`, 'success') } catch (e) { notify(errMsg(e), 'error') } }

  // tastiera: frecce = XY, PagSu/PagGiù = Z
  const jogRef = useRef(jog)
  jogRef.current = jog
  useEffect(() => {
    const h = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.repeat && e.key.startsWith('Page')) return
      const map = { ArrowUp: [0, 1, 0], ArrowDown: [0, -1, 0], ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], PageUp: [0, 0, 1], PageDown: [0, 0, -1] }
      if (map[e.key]) { e.preventDefault(); jogRef.current(...map[e.key]) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // gamepad: jog continuo proporzionale alla leva
  useEffect(() => {
    if (!js?.enabled) return
    let active = false
    let prevButtons = []
    const iv = setInterval(() => {
      const gp = [...(navigator.getGamepads?.() || [])].find(Boolean)
      if (!gp) { setPad(null); return }
      const dz = js.deadzone ?? 0.15
      const ax = (i, inv) => { const v = gp.axes[i] ?? 0; return Math.abs(v) < dz ? 0 : (inv ? -v : v) }
      const vx = ax(js.axis_x, js.invert_x), vy = ax(js.axis_y, js.invert_y), vz = ax(js.axis_z, js.invert_z)
      setPad({ id: gp.id, axes: gp.axes.map((a) => a.toFixed(2)), buttons: gp.buttons.map((b) => b.pressed) })
      gp.buttons.forEach((b, i) => {
        if (b.pressed && !prevButtons[i]) {
          if (i === js.button_stop) Grbl.stop().catch(() => {})
          if (i === js.button_zero_all) Grbl.zero('all').catch(() => {})
        }
      })
      prevButtons = gp.buttons.map((b) => b.pressed)
      const st = useStore.getState().grbl
      if (!st.connected || st.job?.running) return
      const dt = 0.12
      if (vx || vy || vz) {
        const fxy = (js.max_feed_xy || 2000) * Math.max(Math.abs(vx), Math.abs(vy))
        const fz = (js.max_feed_z || 400) * Math.abs(vz)
        const f = Math.max(fxy, fz, 50)
        const k = (f / 60) * dt
        const mag = Math.hypot(vx, vy, vz) || 1
        grblWs.send({ action: 'jog', x: (vx / mag) * k, y: (vy / mag) * k, z: (vz / mag) * k, feed: f })
        active = true
      } else if (active) {
        grblWs.send({ action: 'jog_cancel' })
        active = false
      }
    }, 100)
    return () => clearInterval(iv)
  }, [js])

  const B = ({ icon: I, onClick, label, className = '' }) => (
    <button disabled={disabled} onClick={onClick} title={label}
      className={`flex h-11 items-center justify-center rounded-md border border-line bg-bg-card text-gray-200 transition hover:border-accent hover:text-accent active:scale-95 disabled:opacity-30 ${className}`}>
      <I size={18} />
      {label && <span className="ml-0.5 text-[10px] font-bold">{label.length <= 3 ? label : ''}</span>}
    </button>
  )

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <div className="grid flex-1 grid-cols-3 gap-1.5">
          <B icon={ArrowUpLeft} onClick={() => jog(-1, 1, 0)} />
          <B icon={ArrowUp} label="Y+" onClick={() => jog(0, 1, 0)} />
          <B icon={ArrowUpRight} onClick={() => jog(1, 1, 0)} />
          <B icon={ArrowLeft} label="X-" onClick={() => jog(-1, 0, 0)} />
          <button disabled={disabled} onClick={() => zero('xy')} title="Zero X e Y" className="flex h-11 items-center justify-center rounded-md border border-line bg-bg text-[10px] font-bold text-gray-400 hover:text-accent disabled:opacity-30"><Crosshair size={14} className="mr-0.5" />XY0</button>
          <B icon={ArrowRight} label="X+" onClick={() => jog(1, 0, 0)} />
          <B icon={ArrowDownLeft} onClick={() => jog(-1, -1, 0)} />
          <B icon={ArrowDown} label="Y-" onClick={() => jog(0, -1, 0)} />
          <B icon={ArrowDownRight} onClick={() => jog(1, -1, 0)} />
        </div>
        <div className="flex w-14 flex-col gap-1.5">
          <B icon={ChevronsUp} label="Z+" onClick={() => jog(0, 0, 1)} className="flex-1" />
          <B icon={ChevronsDown} label="Z-" onClick={() => jog(0, 0, -1)} className="flex-1" />
        </div>
      </div>
      <div>
        <span className="label">Passo (mm)</span>
        <div className="grid grid-cols-4 gap-1">
          {STEPS.map((s) => (
            <button key={s} onClick={() => setStep(s)} className={`rounded py-1 font-mono text-xs transition ${step === s ? 'bg-accent font-bold text-black' : 'border border-line text-gray-300 hover:border-gray-500'}`}>{s}</button>
          ))}
        </div>
      </div>
      <div>
        <span className="label flex justify-between"><span>Feed jog</span><span className="font-mono normal-case text-gray-300">{feed} mm/min</span></span>
        <input type="range" min="100" max="3000" step="50" value={feed} onChange={(e) => setFeed(Number(e.target.value))} className="w-full accent-green-500" />
      </div>
      {!compact && (
        <div className="grid grid-cols-4 gap-1">
          {['x', 'y', 'z', 'all'].map((a) => (
            <button key={a} disabled={!grbl.connected} onClick={() => zero(a)} className="rounded border border-line py-1 text-xs font-semibold text-gray-300 hover:border-accent hover:text-accent disabled:opacity-30">Zero {a.toUpperCase()}</button>
          ))}
        </div>
      )}
      <button onClick={stop} disabled={!grbl.connected}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-3 text-sm font-extrabold tracking-wide text-white shadow-lg shadow-red-900/40 transition hover:bg-red-500 active:scale-[.98] disabled:opacity-40">
        <OctagonX size={20} /> ⚡ EMERGENCY STOP
      </button>
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
        <Gamepad2 size={12} className={pad ? 'text-accent' : ''} />
        {pad ? <span className="truncate" title={`${pad.id}\nassi: ${pad.axes.join(' ')}`}>{pad.id.slice(0, 28)} · assi {pad.axes.slice(0, 4).join(' ')}</span>
          : js?.enabled ? 'Gamepad: premi un tasto per attivarlo' : 'Gamepad disabilitato'}
        <span className="ml-auto">⌨ frecce / PagSu PagGiù</span>
      </div>
    </div>
  )
}
