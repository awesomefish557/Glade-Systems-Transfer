/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN: string
  readonly VITE_OS_API_KEY?: string
  readonly VITE_USE_PROXY?: string
  /** Overpass interpreter endpoint; defaults to Hetzner instance */
  readonly VITE_OVERPASS_URL?: string
  /** EPC Open Data Communities key (value or "email:key" pair) */
  readonly VITE_EPC_API_KEY?: string
  /** Anthropic API key — dev: proxied via `/anthropic-api` in vite.config */
  readonly VITE_ANTHROPIC_API_KEY?: string
  /** Optional absolute origin for share links (e.g. https://sonde.gladesystems.uk) */
  readonly VITE_SONDE_SHARE_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
