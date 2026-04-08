import { useEffect, useState } from 'react'
import type { FloodAreaItem, FloodData, SiteLocation } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'

type EaFloodItem = {
  '@id'?: string
  id?: string
  label?: string
  riverOrSea?: string
}

type EaFloodResponse = {
  items?: EaFloodItem[]
  meta?: { items?: EaFloodItem[] }
}

function extractItems(json: EaFloodResponse & { '@graph'?: EaFloodItem[] }): EaFloodItem[] {
  if (Array.isArray(json.items)) return json.items
  if (Array.isArray(json.meta?.items)) return json.meta.items
  if (Array.isArray(json['@graph'])) return json['@graph']
  return []
}

function parseFlood(json: EaFloodResponse & { '@graph'?: EaFloodItem[] }): FloodData {
  const items = extractItems(json)
  const areas: FloodAreaItem[] = items.map((it) => ({
    id: it['@id'] ?? it.id ?? '',
    label: it.label ?? 'Flood area',
    riverOrSea: it.riverOrSea,
  }))
  return { areas, rawCount: items.length }
}

export type FloodFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: FloodData }

export function useFloodData(site: SiteLocation | null): FloodFetchState {
  const [state, setState] = useState<FloodFetchState>({ status: 'idle' })

  useEffect(() => {
    if (!site) {
      setState({ status: 'idle' })
      return
    }
    const key = cacheKey('flood', [site.lat.toFixed(3), site.lng.toFixed(3)])
    const cached = cacheGet<FloodData>(key)
    if (cached) {
      setState({ status: 'ok', data: cached })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    const url = new URL(
      'https://environment.data.gov.uk/flood-monitoring/id/floodAreas'
    )
    url.searchParams.set('lat', String(site.lat))
    url.searchParams.set('long', String(site.lng))
    url.searchParams.set('dist', '1')

    fetch(url.toString(), { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(`Flood API ${r.status}`)
        return r.json()
      })
      .then((j: EaFloodResponse) => {
        if (cancelled) return
        const data = parseFlood(j)
        cacheSet(key, data)
        setState({ status: 'ok', data })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: e instanceof Error ? e.message : 'Flood fetch failed',
        })
      })
    return () => {
      cancelled = true
    }
  }, [site?.lat, site?.lng])

  return state
}
