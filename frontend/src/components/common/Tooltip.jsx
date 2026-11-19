import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Tooltip visivo (classe .cnc-tooltip) renderizzato in un portal con posizione fissa:
// non viene tagliato da contenitori con overflow (es. la Toolbar) e compare dopo un piccolo ritardo.
export default function Tooltip({ text, children, side = 'top', className = '', delay = 350 }) {
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!text) return children

  const enter = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const p = {
        top: { left: r.left + r.width / 2, top: r.top - 8, transform: 'translate(-50%, -100%)' },
        bottom: { left: r.left + r.width / 2, top: r.bottom + 8, transform: 'translateX(-50%)' },
        right: { left: r.right + 8, top: r.top + r.height / 2, transform: 'translateY(-50%)' },
        left: { left: r.left - 8, top: r.top + r.height / 2, transform: 'translate(-100%, -50%)' },
      }[side]
      setPos(p)
    }, delay)
  }
  const leave = () => { clearTimeout(timer.current); setPos(null) }

  return (
    <span ref={ref} className={`relative inline-flex ${className}`} onMouseEnter={enter} onMouseLeave={leave} onMouseDown={leave}>
      {children}
      {pos && createPortal(
        <span role="tooltip" style={pos} className={`cnc-tooltip cnc-tooltip-${side}`}>{text}</span>,
        document.body)}
    </span>
  )
}
