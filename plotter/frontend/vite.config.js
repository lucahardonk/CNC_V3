import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In sviluppo (npm run dev) le chiamate /api vanno al backend FastAPI su 3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    allowedHosts: true,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
})
