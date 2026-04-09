import { proxied } from './proxy'

const DEFAULT_OVERPASS_URL = 'https://overpass.gladesystems.uk/api/interpreter'

const OVERPASS_FALLBACKS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

type OverpassSourceMode = 'own' | 'public' | 'unknown'

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

function setLastSource(endpoint: string): void {
  lastEndpoint = endpoint
  const ownBase = (import.meta.env.VITE_OVERPASS_URL?.trim() || DEFAULT_OVERPASS_URL).replace(/\/+$/, '')
  lastMode = endpoint.replace(/\/+$/, '') === ownBase ? 'own' : 'public'
  notifySourceChange()
}

function overpassEndpoints(): string[] {
  const configured = import.meta.env.VITE_OVERPASS_URL?.trim()
  const primary = configured || DEFAULT_OVERPASS_URL
  return [primary, ...OVERPASS_FALLBACKS.filter((x) => x !== primary)]
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

export function overpassInterpreterUrl(): string {
  return overpassEndpoints()[0]
}

export function overpassBaseUrl(): string {
  const endpoint = overpassInterpreterUrl()
  return endpoint.replace(/\/api\/interpreter\/?$/i, '/')
}

export function getOverpassSourceStatus(): { mode: OverpassSourceMode; endpoint: string } {
  return { mode: lastMode, endpoint: lastEndpoint }
}

export function subscribeOverpassSource(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function queryOverpass<T>(query: string, retries = 3): Promise<T> {
  const endpoints = overpassEndpoints()
  const body = `data=${encodeURIComponent(query)}`
  for (let attempt = 0; attempt < retries; attempt += 1) {
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(proxied(endpoint), {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: timeoutSignal(15_000),
        })
        if (response.ok) {
          setLastSource(endpoint)
          return (await response.json()) as T
        }
        if (response.status === 429 || response.status >= 500) continue
      } catch {
        // try next endpoint
      }
    }
  }
  throw new Error('All Overpass endpoints failed')
}
