import { useEffect, useRef, useState } from 'react'
import { Eraser, Home, Plug, PlugZap, Send, Unlock } from 'lucide-react'
import { errMsg, Grbl } from '../../services/api'
import { useStore } from '../../store/store'
import Button from '../common/Button'

export const stateColor = (s = '') => s.startsWith('Alarm') ? 'text-red-400 border-red-500/50 bg-red-500/10'
  : s.startsWith('Hold') || s.startsWith('Door') ? 'text-yellow-300 border-yellow-500/50 bg-yellow-500/10'
  : s === 'Run' || s === 'Jog' || s === 'Home' ? 'text-sky-300 border-sky-500/50 bg-sky-500/10'
  : s === 'Idle' ? 'text-accent border-accent/50 bg-accent/10' : 'text-gray-400 border-line bg-bg'

export default function GRBLConsole() {
  const { grbl, grblLog, clearLog, notify } = useStore()
  const [cmd, setCmd] = useState('')
  const [hist, setHist] = useState([])
  const [hi, setHi] = useState(-1)
  const [showOk, setShowOk] = useState(false)
  const box = useRef(null)

  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [grblLog])

  const send = async (e) => {
    e?.preventDefault()
    const c = cmd.trim()
    if (!c) return
    try { await Grbl.command(c); setHist((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50)); setCmd(''); setHi(-1) }
    catch (err) { notify(errMsg(err), 'error') }
  }
  const act = (fn) => async () => { try { await fn() } catch (err) { notify(errMsg(err), 'error') } }

  const lines = showOk ? grblLog : grblLog.filter((l) => !(l.dir === 'rx' && l.text === 'ok') && !(l.dir === 'tx' && grbl.job?.running))
  const p = grbl.wpos || [0, 0, 0], m = grbl.mpos || [0, 0, 0]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${stateColor(grbl.state)}`}>
        <span className="text-lg font-bold tracking-wide">{grbl.state?.toUpperCase()}</span>
        <span className="text-[10px] text-gray-400">{grbl.simulated ? 'SIMULAZIONE' : grbl.port} · F{Math.round(grbl.feed || 0)} · S{Math.round(grbl.spindle || 0)}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {['X', 'Y', 'Z'].map((ax, i) => (
          <div key={ax} className="rounded-md border border-line bg-black px-2 py-1.5">
            <div className="flex items-baseline justify-between"><span className={`text-xs font-bold ${['text-red-400', 'text-green-400', 'text-blue-400'][i]}`}>{ax}</span>
              <span className="font-mono text-base font-semibold text-cyan-300">{p[i].toFixed(2)}</span></div>
            <div className="text-right font-mono text-[10px] text-gray-500">M {m[i].toFixed(2)}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {grbl.connected
          ? <Button size="xs" icon={PlugZap} onClick={act(Grbl.disconnect)}>Disconnetti</Button>
          : <Button size="xs" icon={Plug} variant="outline" onClick={act(() => Grbl.connect())}>Connetti</Button>}
        <Button size="xs" icon={Unlock} onClick={act(Grbl.unlock)} disabled={!grbl.connected} title="$X - sblocca allarme">Sblocca</Button>
        <Button size="xs" icon={Home} onClick={act(Grbl.home)} disabled={!grbl.connected} title="$H - homing (richiede finecorsa)">Home</Button>
        <Button size="xs" icon={Eraser} onClick={clearLog} title="Pulisci console" />
        <label className="ml-auto flex items-center gap-1 text-[10px] text-gray-500"><input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} className="accent-green-500" /> verbose</label>
      </div>
      <div ref={box} className="min-h-[120px] flex-1 overflow-y-auto rounded-md border border-line bg-black p-2 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 && <div className="text-gray-600">Nessun messaggio…</div>}
        {lines.map((l, i) => (
          <div key={i} className={l.dir === 'tx' ? 'text-sky-300' : l.dir === 'sys' ? 'text-yellow-300' : l.dir === 'err' || l.text?.startsWith('error') || l.text?.startsWith('ALARM') ? 'text-red-400' : 'text-gray-300'}>
            <span className="text-gray-600">{l.dir === 'tx' ? '>' : l.dir === 'sys' ? '#' : '<'} </span>{l.text}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-1">
        <input className="input font-mono text-xs" placeholder="Comando G-code / $$ / ?" value={cmd} disabled={!grbl.connected}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); const n = Math.min(hi + 1, hist.length - 1); setHi(n); setCmd(hist[n]) }
            if (e.key === 'ArrowDown') { e.preventDefault(); const n = hi - 1; setHi(n); setCmd(n >= 0 ? hist[n] : '') }
          }} />
        <Button size="sm" variant="primary" icon={Send} type="submit" disabled={!grbl.connected} />
      </form>
    </div>
  )
}
