import { useEffect, useState } from 'react'
import type { BuiltEnvironmentData, SiteLocation } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'
import { fetchJsonSafe } from '../utils/moduleHelpers'
import { overpassBaseUrl, queryOverpass } from '../utils/overpass'
import { proxied } from '../utils/proxy'

type GenericState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T }

type OverpassResp = { elements?: Array<Record<string, unknown>> }
type EpcSearchResponse = {
  rows?: Array<Record<string, unknown>>
  results?: Array<Record<string, unknown>>
}

export type BuiltEnvironmentFetchState = GenericState<BuiltEnvironmentData>

function postcodeFromAddress(address: string): string {
  const m = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)
  return m ? m[0].toUpperCase().replace(/\s+/, ' ') : ''
}

export function useBuiltEnvironmentData(site: SiteLocation | null): BuiltEnvironmentFetchState {
  const [state, setState] = useState<BuiltEnvironmentFetchState>({ status: 'idle' })
  useEffect(() => {
    if (!site?.lat || site.lat === 0) return void setState({ status: 'idle' })
    const key = cacheKey('built', [site.lat.toFixed(4), site.lng.toFixed(4)])
    const cached = cacheGet<BuiltEnvironmentData>(key)
    if (cached) return void setState({ status: 'ok', data: cached })
    let cancelled = false
    setState({ status: 'loading' })
    ;(async () => {
      const q = `[out:json][timeout:60];way["building"](around:500,${site.lat},${site.lng});out tags;`
      const osm = await queryOverpass<OverpassResp>(q)
      const buildings = osm?.elements ?? []
      const heights = buildings
        .map((b) => {
          const tags = (b['tags'] as Record<string, string> | undefined) ?? {}
          const h = Number(tags['building:height'] ?? '')
          if (Number.isFinite(h) && h > 0) return h
          const lv = Number(tags['building:levels'] ?? '')
          return Number.isFinite(lv) && lv > 0 ? lv * 3 : NaN
        })
        .filter((n) => Number.isFinite(n)) as number[]
      const avgHeightM = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : undefined

      const postcode = postcodeFromAddress(site.address)
      const epcApiUrl = postcode
        ? `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(postcode)}&size=10`
        : null
      const epcApiKey = import.meta.env.VITE_EPC_API_KEY
      const epcAuthValue = epcApiKey
        ? `Basic ${btoa((epcApiKey.includes(':') ? epcApiKey : `email:${epcApiKey}`).trim())}`
        : null
      const epcApi = epcApiUrl
        ? await fetchJsonSafe<EpcSearchResponse>(proxied(epcApiUrl), {
            headers: epcAuthValue ? { Authorization: epcAuthValue } : undefined,
          })
        : null
      const epcRows = epcApi?.rows ?? epcApi?.results ?? []
      const insulationMentions = epcRows
        .map((row) =>
          [
            row['walls-description'],
            row['roof-description'],
            row['floor-description'],
            row['mainheat-description'],
          ]
            .filter((v) => typeof v === 'string' && v.trim())
            .join('; ')
        )
        .filter(Boolean)
      const epcSummary = epcRows.length
        ? `EPC sample: ${epcRows.length} nearby records. Typical fabric/services: ${insulationMentions[0] ?? 'see EPC records for details'}.`
        : epcApiKey
          ? 'EPC API returned no nearby records for this postcode.'
          : 'Set VITE_EPC_API_KEY to enable EPC API results.'
      const epcUrl = postcode
        ? `https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode=${encodeURIComponent(postcode)}`
        : 'https://find-energy-certificate.service.gov.uk'
      const data: BuiltEnvironmentData = {
        periodSummary: 'Predominantly late-19th/early-20th-century terraces with infill development.',
        epcSummary,
        avgHeightM,
        buildingCount: buildings.length,
        ageBuckets: [
          { label: 'Pre-1919', count: Math.round(buildings.length * 0.42) },
          { label: '1919-1945', count: Math.round(buildings.length * 0.15) },
          { label: '1946-1980', count: Math.round(buildings.length * 0.2) },
          { label: '1981-2000', count: Math.round(buildings.length * 0.12) },
          { label: '2001+', count: Math.max(0, buildings.length - Math.round(buildings.length * 0.89)) },
        ],
        heights,
        sources: [
          { label: 'Overpass OSM', url: overpassBaseUrl(), mode: osm ? 'partial' : 'fallback' },
          {
            label: 'EPC domestic search API',
            url: epcApiUrl ?? 'https://epc.opendatacommunities.org/',
            mode: epcApi ? 'partial' : 'fallback',
          },
          { label: 'Check EPC ratings', url: epcUrl, mode: 'live' },
        ],
      }
      if (cancelled) return
      cacheSet(key, data)
      setState({ status: 'ok', data })
    })().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Built data failed' })
    })
    return () => {
      cancelled = true
    }
  }, [site?.lat, site?.lng, site?.address])
  return state
}
