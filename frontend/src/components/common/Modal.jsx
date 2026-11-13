import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, children, footer, width = 'max-w-lg', closable = true }) {
  useEffect(() => {
    if (!open || !closable) return
    const h = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose, closable])
  if (!open) return null
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => closable && e.target === e.currentTarget && onClose?.()}>
      <div className={`animate-pop flex max-h-[92vh] w-full ${width} flex-col rounded-xl border border-line bg-bg-panel shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {closable && (
            <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-bg-hover hover:text-white"><X size={18} /></button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
