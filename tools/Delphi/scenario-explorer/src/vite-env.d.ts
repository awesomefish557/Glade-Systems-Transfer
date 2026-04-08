/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_API_KEY: string
  readonly VITE_ANTHROPIC_MODEL?: string
  /** Optional Messages API origin. Default is same-origin `/anthropic-api` (Vite proxy). */
  readonly VITE_ANTHROPIC_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
