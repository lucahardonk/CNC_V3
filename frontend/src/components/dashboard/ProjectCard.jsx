import { FolderOpen, Layers, Trash2 } from 'lucide-react'
import { MATERIAL_COLORS, MATERIAL_NAMES } from '../../store/store'

export default function ProjectCard({ project, onOpen, onDelete }) {
  const color = MATERIAL_COLORS[project.material] || '#888'
  const ratio = project.stock_y / project.stock_x
  const w = ratio > 1 ? 70 / ratio : 70
  const h = ratio > 1 ? 70 : 70 * ratio
  return (
    <div onClick={onOpen}
      className="group relative flex h-64 cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg hover:shadow-accent/5">
      <div className="relative flex flex-1 items-center justify-center bg-gradient-to-br from-[#202020] to-[#151515]">
        <div style={{ width: `${w}%`, height: `${h}%`, background: color, boxShadow: `6px 8px 0 ${color}55` }}
          className="rounded-sm opacity-90 transition group-hover:scale-105" />
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition group-hover:opacity-100">
          <button onClick={(e) => { e.stopPropagation(); onOpen() }}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-black hover:bg-accent-light">
            <FolderOpen size={15} /> Apri
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500">
            <Trash2 size={15} /> Elimina
          </button>
        </div>
      </div>
      <div className="space-y-1.5 border-t border-line p-3">
        <div className="truncate font-semibold text-white">{project.name}</div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
          {MATERIAL_NAMES[project.material] || project.material}
          <span className="ml-auto flex items-center gap-1"><Layers size={12} />{project.layer_count}</span>
        </div>
        <div className="flex justify-between font-mono text-[11px] text-gray-500">
          <span>{project.stock_x}×{project.stock_y}×{project.stock_z} mm</span>
          <span>{project.created_at ? new Date(project.created_at + 'Z').toLocaleDateString('it-IT') : ''}</span>
        </div>
      </div>
    </div>
  )
}
