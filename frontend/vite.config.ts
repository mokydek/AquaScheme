import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // The project workspace lazily loads maplibre, epanet and pdfmake; those
    // chunks are large by nature and only fetched when their screen is opened.
    chunkSizeWarningLimit: 1500,
  },
})
