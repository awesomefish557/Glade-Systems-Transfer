export function cacheGet<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function cacheSet(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota or private mode */
  }
}

export function cacheKey(prefix: string, parts: (string | number)[]): string {
  return `sonde:${prefix}:${parts.join(':')}`
}
