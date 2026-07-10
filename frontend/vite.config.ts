import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Emit into the repo root `dist` (frontend is a workspace under the root).
    // Vercel looks for `dist` at the root, so this avoids output directory
    // resolution issues for the monorepo.
    outDir: '../dist',
    emptyOutDir: true,
    // The project workspace lazily loads maplibre, epanet and pdfmake; those
    // chunks are large by nature and only fetched when their screen is opened.
    chunkSizeWarningLimit: 1500,
  },
})
