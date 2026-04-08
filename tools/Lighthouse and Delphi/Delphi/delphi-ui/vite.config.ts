import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served under https://gladesystems.uk/delphi/* via glade-router proxy — paths must match.
export default defineConfig({
  base: '/delphi/',
  plugins: [react()],
})
