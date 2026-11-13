const VARIANTS = {
  primary: 'bg-accent text-black hover:bg-accent-light font-semibold',
  secondary: 'bg-bg-card text-gray-200 hover:bg-bg-hover border border-line',
  ghost: 'text-gray-300 hover:bg-bg-hover hover:text-white',
  danger: 'bg-red-600 text-white hover:bg-red-500 font-semibold',
  outline: 'border border-accent/60 text-accent hover:bg-accent/10',
}
const SIZES = { xs: 'px-2 py-1 text-xs', sm: 'px-2.5 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-3 text-base' }

export default function Button({ variant = 'secondary', size = 'md', icon: Icon, className = '', children, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md transition-all duration-150 active:scale-[.98]
        disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={size === 'xs' ? 13 : size === 'lg' ? 20 : 16} />}
      {children}
    </button>
  )
}
