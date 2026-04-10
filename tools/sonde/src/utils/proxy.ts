const PROXY_BASE = '/proxy?url='

export type ProxiedMode = 'if-flag' | 'always'

/**
 * Same-origin `/proxy` (Cloudflare Pages Functions in prod, Vite middleware in dev).
 * - `always` (default): same-origin `/proxy` in dev and prod (CORS-safe).
 * - `if-flag`: only when `VITE_USE_PROXY=true` (legacy / local direct fetch).
 */
export function proxied(url: string, mode: ProxiedMode = 'always'): string {
  const wrapped = PROXY_BASE + encodeURIComponent(url)
  if (mode === 'always') return wrapped
  return import.meta.env.VITE_USE_PROXY === 'true' ? wrapped : url
}
