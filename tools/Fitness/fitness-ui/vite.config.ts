import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Root-relative /assets/* breaks when HTML is proxied from gladesystems.uk/fitness (browser loads gladesystems.uk/assets).
// Absolute origin keeps JS/CSS on Pages regardless of entry host.
const PAGES_ORIGIN = 'https://fitness-ui.pages.dev'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? `${PAGES_ORIGIN}/` : '/',
}))
