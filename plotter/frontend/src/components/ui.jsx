import { X } from 'lucide-react'

export function Btn({ children, variant = 'default', className = '', ...p }) {
  const v = {
    default: 'border-line bg-bg-card hover:bg-bg-hover text-gray-200',
    primary: 'border-accent-dark bg-accent-dark hover:bg-accent text-white',
    danger: 'border-red-700 bg-red-700 hover:bg-red-600 text-white',
    ghost: 'border-transparent bg-transparent hover:bg-bg-hover text-gray-300',
  }[variant]
  return (
    <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${v} ${className}`}>
      {children}
    </button>
  )
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div className={`animate-pop panel flex max-h-[90vh] w-full flex-col ${wide ? 'max-w-5xl' : 'max-w-lg'}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>
        <div className="overflow-auto p-4">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-gray-500">{hint}</span>}
    </label>
  )
}

export function NumInput({ value, onChange, step = 0.1, ...p }) {
  return <input type="number" className="input" value={value ?? ''} step={step} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} {...p} />
}
