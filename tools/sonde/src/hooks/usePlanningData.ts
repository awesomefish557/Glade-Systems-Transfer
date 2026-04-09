import { useEffect, useState } from 'react'
import type { PlanningData, SiteLocation } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'
import { distanceFromSite, fetchJsonSafe } from '../utils/moduleHelpers'

type GenericState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T }

type PlanningResponse = { results?: Array<Record<string, unknown>> }

export type PlanningFetchState = GenericState<PlanningData>

function postcodeFromAddress(address: string): string {
  const m = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)
  return m ? m[0].toUpperCase().replace(/\s+/, ' ') : ''
}

export function usePlanningData(site: SiteLocation | null): PlanningFetchState {
  const [state, setState] = useState<PlanningFetchState>({ status: 'idle' })
  useEffect(() => {
    if (!site?.lat || site.lat === 0) return void setState({ status: 'idle' })
    const key = cacheKey('planning', [site.lat.toFixed(4), site.lng.toFixed(4)])
    const cached = cacheGet<PlanningData>(key)
    if (cached) return void setState({ status: 'ok', data: cached })
    let cancelled = false
    setState({ status: 'loading' })
    ;(async () => {
      const url = `https://www.planning.data.gov.uk/api/entity/?geometry_intersects=${site.lat},${site.lng}&dataset=listed-building,conservation-area,local-planning-authority`
      const live = await fetchJsonSafe<PlanningResponse>(url, { headers: { Accept: 'application/json' } })
      const listed = (live?.results ?? []).slice(0, 8).map((r, i) => {
        const lat = Number(r['lat'] ?? site.lat + i * 0.0004)
        const lng = Number(r['lng'] ?? site.lng + i * 0.0004)
        return {
          id: String(r['entity'] ?? `listed-${i}`),
          name: String(r['name'] ?? r['label'] ?? `Listed building ${i + 1}`),
          grade: String(r['grade'] ?? 'Unspecified'),
          distanceM: distanceFromSite(site.lat, site.lng, lat, lng),
          lat,
          lng,
        }
      })
      const postcode = postcodeFromAddress(site.address)
      const data: PlanningData = {
        zone: live ? 'Local planning authority area identified' : 'Fallback zoning summary (live source unavailable)',
        conservationArea: listed.length > 0 ? 'Potential conservation constraints nearby' : 'No conservation area returned',
        listedBuildings: listed,
        recentApplications: (live?.results ?? []).slice(0, 6).map((r, i) => ({
          id: String(r['entity'] ?? `app-${i}`),
          description: String(r['description'] ?? r['name'] ?? 'Planning record'),
          date: String(r['entry-date'] ?? r['start-date'] ?? ''),
        })),
        brownfieldStatus: live ? 'Check local register required' : 'Unavailable from live source; verify with local planning portal',
        portalUrl: postcode
          ? `https://www.cardiffidoxcloud.wales/publicaccess/simpleSearchResults.do?action=firstPage&searchType=Application&simpleSearchString=${encodeURIComponent(postcode)}`
          : 'https://www.cardiffidoxcloud.wales/publicaccess/',
        sources: [
          { label: 'Planning Data API', url, mode: live ? 'partial' : 'fallback' },
          { label: 'Cardiff Planning Portal', url: 'https://www.cardiffidoxcloud.wales/publicaccess/', mode: 'live' },
        ],
      }
      if (cancelled) return
      cacheSet(key, data)
      setState({ status: 'ok', data })
    })().catch((e: unknown) => {
      if (cancelled) return
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Planning data failed' })
    })
    return () => {
      cancelled = true
    }
  }, [site?.lat, site?.lng, site?.address])
  return state
}
