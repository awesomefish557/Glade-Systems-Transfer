import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Same-origin proxy: Anthropic does not allow browser CORS to api.anthropic.com. */
const anthropicProxy = {
  '/delphi/anthropic-api': {
    target: 'https://api.anthropic.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/delphi\/anthropic-api/, ''),
  },
} as const

// Served at https://gladesystems.uk/delphi/* via glade-router (build: Delphi/scenario-explorer).
export default defineConfig({
  base: '/delphi/',
  plugins: [react(), tailwindcss()],
  server: { proxy: { ...anthropicProxy } },
  preview: { proxy: { ...anthropicProxy } },
})
