const PREFIX = 'sonde_analysis_v1_'
const TTL_MS = 24 * 60 * 60 * 1000

type Cached<T> = { expiresAt: number; data: T }

export function analysisCacheKey(parts: string[]): string {
  return PREFIX + parts.join('_').replace(/[^a-zA-Z0-9_.-]+/g, '_')
}

export function analysisCacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const o = JSON.parse(raw) as Cached<T>
    if (!o || typeof o.expiresAt !== 'number' || o.expiresAt < Date.now()) {
      localStorage.removeItem(key)
      return null
    }
    return o.data
  } catch {
    return null
  }
}

export function analysisCacheSet<T>(key: string, data: T): void {
  try {
    const payload: Cached<T> = { expiresAt: Date.now() + TTL_MS, data }
    localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    /* quota */
  }
}
