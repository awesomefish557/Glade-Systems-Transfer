import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { RootErrorBoundary } from './components/RootErrorBoundary.tsx'
import './index.css'
import App from './App.tsx'

// Defer SW install until after first paint so precache + claim cannot race the initial JS/CSS load.
window.addEventListener('load', () => {
  registerSW({
    immediate: true,
    onRegisterError(err) {
      console.warn('Sonde: service worker registration failed (app still runs):', err)
    },
  })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
