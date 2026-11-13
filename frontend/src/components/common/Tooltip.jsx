import { useState } from 'react'

export default function Tooltip({ text, children, side = 'top', className = '' }) {
  const [show, setShow] = useState(false)
  if (!text) return children
  const pos = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  }[side]
  return (
    <span className={`relative inline-flex ${className}`} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className={`animate-fade pointer-events-none absolute z-[60] w-max max-w-[260px] whitespace-normal rounded-md border border-line
          bg-[#111] px-2.5 py-1.5 text-xs font-normal normal-case leading-snug tracking-normal text-gray-200 shadow-xl ${pos}`}>
          {text}
        </span>
      )}
    </span>
  )
}
