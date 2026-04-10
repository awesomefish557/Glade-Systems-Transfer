/** Same-origin Pages Function (KV cache); Vite dev proxies this path to overpass-api.de. */
const OVERPASS_CACHE_PATH = '/overpass-cache'

const PUBLIC_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

/** Serialise Overpass calls so parallel hooks do not burst the public API (429). */
let overpassQueue: Promise<unknown> = Promise.resolve()
let lastOverpassRequest = 0
const MIN_INTERVAL_MS = 2000

export type OverpassSourceMode = 'edge' | 'public' | 'unknown'

let lastEndpoint = ''
let lastMode: OverpassSourceMode = 'unknown'
const listeners = new Set<() => void>()

function notifySourceChange(): void {
  listeners.forEach((listener) => {
    try {
      listener()
    } catch {
      // no-op
    }
  })
}

function setLastSourceFromResponse(cacheHeader: string | null): void {
  if (cacheHeader === 'HIT') {
    lastMode = 'edge'
    lastEndpoint = OVERPASS_CACHE_PATH
  } else if (cacheHeader === 'MISS') {
    lastMode = 'public'
    lastEndpoint = 'overpass-api.de'
  } else {
    lastMode = 'public'
    lastEndpoint = lastEndpoint || 'overpass-api.de'
  }
  notifySourceChange()
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

/** Public Overpass URL for attribution / source links in module UI. */
export function overpassInterpreterUrl(): string {
  return PUBLIC_OVERPASS_ENDPOINTS[0]
}

export function overpassBaseUrl(): string {
  return 'https://overpass-api.de/'
}

export function getOverpassSourceStatus(): { mode: OverpassSourceMode; endpoint: string } {
  return { mode: lastMode, endpoint: lastEndpoint }
}

export function subscribeOverpassSource(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function queryOverpass<T>(query: string, _retries = 3): Promise<T> {
  const body = `data=${encodeURIComponent(query)}`

  const task = overpassQueue.then(async () => {
    const now = Date.now()
    const wait = Math.max(0, lastOverpassRequest + MIN_INTERVAL_MS - now)
    if (wait > 0) {
      await new Promise<void>((r) => setTimeout(r, wait))
    }
    lastOverpassRequest = Date.now()

    const response = await fetch(OVERPASS_CACHE_PATH, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: timeoutSignal(import.meta.env.DEV ? 30_000 : 60_000),
    })

    if (!response.ok) {
      throw new Error(`Overpass cache ${response.status}`)
    }

    const xh = response.headers.get('X-Cache')
    if (import.meta.env.DEV || !xh) {
      lastMode = 'public'
      lastEndpoint = PUBLIC_OVERPASS_ENDPOINTS[0]
      notifySourceChange()
    } else {
      setLastSourceFromResponse(xh)
    }
    return (await response.json()) as T
  })

  overpassQueue = task.then(
    () => undefined,
    () => undefined
  )

  return task
}
