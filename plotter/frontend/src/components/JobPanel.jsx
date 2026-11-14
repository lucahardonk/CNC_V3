import { useEffect, useState } from 'react'
import { Play, Square, Eye, AlertTriangle, PlayCircle } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { fmtTime } from '../lib/gcode'
import { Btn } from './ui'

export default function JobPanel({ plan, status }) {
  const { preview, setPreview, projectName, notify, settings } = useStore()
  const [job, setJob] = useState(null)

  const active = job && ['running', 'paused'].includes(job.state)
  useEffect(() => {
    let alive = true
    const tick = async () => { try { const j = await api.job(); if (alive) setJob(j) } catch { /* backend offline */ } }
    tick()
    const t = setInterval(tick, active ? 1000 : 4000)
    return () => { alive = false; clearInterval(t) }
  }, [active])

  const s = plan?.stats
  const ready = status?.klippy_state === 'ready'
  const homedNeeded = !settings.home_before && !(status?.homed_axes || '').includes('xyz')

  const start = async () => {
    if (!plan?.paths.length) return notify('Niente da disegnare', 'warn')
    const warn = s.outOfReach ? `\n⚠ ${s.outOfReach} tratti escono dall'area raggiungibile (raggio ${settings.print_radius} mm)!` : ''
    if (!confirm(`Inviare "${projectName}" alla FLSUN?\n${s.paths} tratti · ${(s.drawLen / 1000).toFixed(2)} m · ~${fmtTime(s.estSec)}\nPenna giù Z=${s.zDown.toFixed(3)} · su Z=${s.zUp.toFixed(3)}${warn}`)) return
    try { setJob(await api.startJob(plan.gcode, projectName)); notify('Disegno avviato', 'ok') } catch (e) { notify(e.message, 'error') }
  }
  const stop = async () => { try { setJob(await api.stopJob()); notify('Stop inviato') } catch (e) { notify(e.message, 'error') } }
  const resume = async () => { try { setJob(await api.resumeJob()) } catch (e) { notify(e.message, 'error') } }

  const pct = Math.round(((job?.progress ?? 0) * 100))
  const stateLabel = { idle: 'pronto', running: 'in esecuzione', paused: 'in pausa (cambio penna?)', done: 'completato', cancelled: 'annullato', error: 'errore' }

  return (
    <div className="space-y-2.5 border-t border-line p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="label mb-0">Disegno</span>
        <Btn variant={preview ? 'primary' : 'default'} className="py-1 text-xs" onClick={() => setPreview(!preview)}><Eye size={13} /> Anteprima G-code</Btn>
      </div>
      {s && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-gray-400">
          <span>tratti: <b className="text-gray-200">{s.paths}</b></span>
          <span>tempo: <b className="text-gray-200">~{fmtTime(s.estSec)}</b></span>
          <span>disegno: <b className="text-gray-200">{(s.drawLen / 1000).toFixed(2)} m</b></span>
          <span>a vuoto: <b className="text-gray-200">{(s.travelLen / 1000).toFixed(2)} m</b></span>
          <span>righe: <b className="text-gray-200">{s.lines}</b></span>
          <span>modo: <b className="text-gray-200">{settings.send_mode}</b></span>
        </div>
      )}
      {s?.outOfReach > 0 && (
        <div className="flex gap-1.5 rounded border border-amber-600/50 bg-amber-500/10 p-2 text-[11px] text-amber-300">
          <AlertTriangle size={14} className="shrink-0" /> {s.outOfReach} tratti escono dal raggio stampabile ({settings.print_radius} mm). Gli angoli dell'A4 non sono raggiungibili dalla Delta.
        </div>
      )}
      {homedNeeded && <p className="text-[11px] text-amber-400">Macchina non homed e "G28 all'inizio" disattivato.</p>}

      {job && job.state !== 'idle' && (
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-gray-400">
            <span>{stateLabel[job.state] || job.state}</span><span>{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-bg-card"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
          {job.error && <p className="mt-1 text-[11px] text-red-400">{job.error}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {job?.state === 'paused'
          ? <Btn variant="primary" onClick={resume}><PlayCircle size={15} /> Riprendi</Btn>
          : <Btn variant="primary" disabled={!ready || active || !plan?.paths.length} onClick={start}><Play size={15} /> Invia & Disegna</Btn>}
        <Btn variant="danger" disabled={!active} onClick={stop}><Square size={14} /> Stop</Btn>
      </div>
      {job && ['done', 'cancelled', 'error'].includes(job.state) && (
        <button className="w-full text-[11px] text-gray-500 hover:text-gray-300" onClick={async () => setJob(await api.resetJob())}>azzera stato job</button>
      )}
    </div>
  )
}
