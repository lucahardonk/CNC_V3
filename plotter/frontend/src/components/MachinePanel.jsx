import { useState } from 'react'
import { Home, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ChevronsUp, ChevronsDown, Crosshair, Save, Power, RotateCcw, OctagonX, Send, PenLine, PenOff } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { Btn } from './ui'

const XY_STEPS = [0.1, 1, 10, 50]
const Z_STEPS = [0.01, 0.1, 1, 10]

export default function MachinePanel({ status, refresh, onSettingsSave }) {
  const { settings, notify } = useStore()
  const [xyStep, setXyStep] = useState(10)
  const [zStep, setZStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [cmd, setCmd] = useState('')
  const [log, setLog] = useState([])

  const ready = status?.klippy_state === 'ready'
  const pos = status?.position
  const homed = (status?.homed_axes || '').includes('xyz')
  const printing = ['printing', 'paused'].includes(status?.print_stats?.state)
  const zUp = Number(settings.sheet_z) + Number(settings.pen_up)

  const run = async (label, fn) => {
    setBusy(true)
    try {
      await fn()
      setLog((l) => [{ t: new Date().toLocaleTimeString(), msg: label, ok: true }, ...l].slice(0, 30))
    } catch (e) {
      setLog((l) => [{ t: new Date().toLocaleTimeString(), msg: `${label}: ${e.message}`, ok: false }, ...l].slice(0, 30))
      notify(e.message, 'error')
    } finally {
      setBusy(false)
      refresh()
    }
  }
  const jog = (x, y, z) => run(`Jog ${x ? `X${x}` : ''}${y ? `Y${y}` : ''}${z ? `Z${z}` : ''}`, () => api.jog(x, y, z, z ? 600 : settings.feed_travel))
  const gc = (label, script) => run(label, () => api.gcode(script))

  const saveSheetZ = async () => {
    if (!pos) return
    const z = Number(pos[2].toFixed(3))
    await onSettingsSave({ sheet_z: z })
    notify(`Zero foglio salvato: Z = ${z} mm`, 'ok')
  }
  const setZ0 = () => run('G92 Z0', async () => {
    await api.gcode('G92 Z0')
    await onSettingsSave({ sheet_z: 0 })
    notify('Z=0 impostato qui: zero foglio = 0 (valido fino al prossimo G28)', 'ok')
  })

  const stateColor = { ready: 'bg-accent', startup: 'bg-amber-400', shutdown: 'bg-red-500', error: 'bg-red-500', offline: 'bg-gray-500' }[status?.klippy_state] || 'bg-gray-500'
  const dis = !ready || busy || printing
  const jb = 'flex h-9 items-center justify-center rounded-md border border-line bg-bg-card text-gray-200 hover:bg-bg-hover disabled:opacity-30'

  return (
    <div className="space-y-3 p-3 text-sm">
      {/* stato */}
      <div className="rounded-md border border-line bg-bg-card p-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${stateColor}`} />
            <span className="font-medium">Klipper: {status?.klippy_state || '…'}</span>
          </div>
          <span className={`text-xs ${homed ? 'text-accent-light' : 'text-amber-400'}`}>{ready ? (homed ? 'homed' : 'non homed') : ''}</span>
        </div>
        {status?.message && !ready && <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-[11px] text-red-300">{status.message}</pre>}
        <div className="mt-2 grid grid-cols-3 gap-1 font-mono text-xs">
          {['X', 'Y', 'Z'].map((a, i) => (
            <div key={a} className="rounded bg-bg px-2 py-1"><span className="text-gray-500">{a}</span> {pos ? pos[i].toFixed(3) : '—'}</div>
          ))}
        </div>
        {!ready && (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Btn onClick={() => run('FIRMWARE_RESTART', api.firmwareRestart)}><RotateCcw size={14} /> Firmware restart</Btn>
            <Btn onClick={() => run('RESTART', api.restart)}><RotateCcw size={14} /> Restart</Btn>
          </div>
        )}
      </div>

      {/* homing + penna */}
      <div className="grid grid-cols-2 gap-1.5">
        <Btn variant="primary" disabled={dis} onClick={() => run('G28 Homing', api.home)}><Home size={15} /> Homing</Btn>
        <Btn disabled={dis || !homed} onClick={() => gc('Centro foglio', `G90\nG1 Z${zUp.toFixed(3)} F${settings.feed_z_up}\nG1 X${settings.offset_x} Y${settings.offset_y} F${settings.feed_travel}`)}><Crosshair size={15} /> Centro</Btn>
        <Btn disabled={dis || !homed} onClick={() => gc('Penna su', `G90\nG1 Z${zUp.toFixed(3)} F${settings.feed_z_up}`)}><PenOff size={15} /> Penna su</Btn>
        <Btn disabled={dis || !homed} onClick={() => gc('Penna giù', `G90\nG1 Z${(Number(settings.sheet_z) - Number(settings.pen_down_extra || 0)).toFixed(3)} F${settings.feed_z_down}`)}><PenLine size={15} /> Penna giù</Btn>
      </div>

      {/* jog XY */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="label mb-0">Jog XY</span>
          <div className="flex gap-0.5">{XY_STEPS.map((s) => (
            <button key={s} onClick={() => setXyStep(s)} className={`rounded px-1.5 py-0.5 text-[11px] ${xyStep === s ? 'bg-accent-dark text-white' : 'bg-bg-card text-gray-400'}`}>{s}</button>
          ))}</div>
        </div>
        <div className="flex gap-2">
          <div className="grid flex-1 grid-cols-3 gap-1">
            <span />
            <button className={jb} disabled={dis || !homed} onClick={() => jog(0, xyStep, 0)}><ArrowUp size={16} /></button>
            <span />
            <button className={jb} disabled={dis || !homed} onClick={() => jog(-xyStep, 0, 0)}><ArrowLeft size={16} /></button>
            <span className="flex items-center justify-center text-[10px] text-gray-500">{xyStep} mm</span>
            <button className={jb} disabled={dis || !homed} onClick={() => jog(xyStep, 0, 0)}><ArrowRight size={16} /></button>
            <span />
            <button className={jb} disabled={dis || !homed} onClick={() => jog(0, -xyStep, 0)}><ArrowDown size={16} /></button>
            <span />
          </div>
          <div className="flex w-16 flex-col gap-1">
            <button className={jb} disabled={dis || !homed} onClick={() => jog(0, 0, zStep)} title="Z su"><ChevronsUp size={16} /></button>
            <select className="input px-1 py-0.5 text-[11px]" value={zStep} onChange={(e) => setZStep(Number(e.target.value))}>
              {Z_STEPS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className={jb} disabled={dis || !homed} onClick={() => jog(0, 0, -zStep)} title="Z giù"><ChevronsDown size={16} /></button>
          </div>
        </div>
      </div>

      {/* zero foglio */}
      <div className="rounded-md border border-line bg-bg-card p-2.5">
        <div className="flex items-center justify-between">
          <span className="label mb-0">Zero foglio</span>
          <span className="font-mono text-sm text-accent-light">Z = {Number(settings.sheet_z).toFixed(3)}</span>
        </div>
        <p className="mt-1 text-[11px] text-gray-500">Abbassa la penna col jog Z finché tocca il foglio, poi salva.</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Btn disabled={!ready || !pos || !homed} onClick={saveSheetZ}><Save size={14} /> Salva Z corrente</Btn>
          <Btn disabled={dis || !homed} onClick={setZ0} title="G92 Z0: la posizione attuale diventa Z=0"><Crosshair size={14} /> Set Z=0 (G92)</Btn>
        </div>
      </div>

      {/* console */}
      <div>
        <span className="label">Console G-code</span>
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (cmd.trim()) { gc(cmd.trim(), cmd.trim()); setCmd('') } }}>
          <input className="input font-mono" placeholder="es. M114, M84, BED_MESH…" value={cmd} onChange={(e) => setCmd(e.target.value)} disabled={!ready} />
          <Btn type="submit" disabled={!ready || busy}><Send size={14} /></Btn>
        </form>
        <div className="mt-1 max-h-24 overflow-auto font-mono text-[11px]">
          {log.map((l, i) => <div key={i} className={l.ok ? 'text-gray-400' : 'text-red-400'}><span className="text-gray-600">{l.t}</span> {l.msg}</div>)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Btn disabled={dis} onClick={() => gc('Motori off', 'M84')}><Power size={14} /> Motori off</Btn>
        <Btn variant="danger" onClick={() => run('EMERGENCY STOP', api.estop)}><OctagonX size={15} /> Emergenza</Btn>
      </div>
    </div>
  )
}
