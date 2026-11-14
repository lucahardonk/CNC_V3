/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0f0f0f', panel: '#1a1a1a', card: '#2a2a2a', hover: '#333333' },
        accent: { DEFAULT: '#22c55e', dark: '#16a34a', light: '#4ade80' },
        line: '#3a3a3a',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
}
