import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Send API calls to the FastAPI backend during development.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
