import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In sviluppo (npm run dev) le chiamate /api vengono inoltrate al backend FastAPI su 5550.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://localhost:5550', changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
})
