import { useEffect, useState } from 'react'
import type { FloodData, SiteLocation } from '../types'
import { proxied } from '../utils/proxy'

export type FloodFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: FloodData }

export function useFloodData(site: SiteLocation | null, radiusKm: number): FloodFetchState {
  const [state, setState] = useState<FloodFetchState>({ status: 'idle' })

  useEffect(() => {
    if (!site?.lat || site.lat === 0) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })

    ;(async () => {
      const floodApiUrl = `https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${site.lat}&long=${site.lng}&dist=${Math.max(
        1,
        Math.round(radiusKm * 1000)
      )}`
      const res = await fetch(proxied(floodApiUrl))
      const json = res.ok ? ((await res.json()) as { items?: Array<Record<string, unknown>> }) : null
      const items = json?.items ?? []
      const areas = items.slice(0, 8).map((item, idx) => ({
        id: String(item['floodAreaID'] ?? item['id'] ?? `area-${idx + 1}`),
        label: String(item['description'] ?? item['message'] ?? `Flood alert ${idx + 1}`),
        riverOrSea: typeof item['riverOrSea'] === 'string' ? item['riverOrSea'] : undefined,
      }))

      const data: FloodData = {
        provider: 'nrw',
        region: 'wales',
        radiusKm,
        areas,
        rawCount: items.length,
        floodZone: items.length > 0 ? '2' : '1',
        historicalEvents:
          items.length > 0
            ? `Live monitoring returned ${items.length} nearby alert item(s). Confirm flood zones on NRW map before planning decisions.`
            : 'No live flood alerts returned nearby. Confirm zoning and historic extents on NRW flood map.',
        climateProjection2050: 'Use NRW/UKCP18 mapping layers to review 2050 and 2080 scenarios.',
        nearestWatercourse: areas.find((a) => a.riverOrSea)?.riverOrSea,
        surfaceWaterRisk: items.length > 3 ? 'High' : items.length > 0 ? 'Medium' : 'Low',
        mapUrl: `https://flood.map.nrw.wales/en/?lat=${site.lat}&lng=${site.lng}&zoom=15`,
      }
      if (!cancelled) setState({ status: 'ok', data })
    })().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Flood data failed' })
    })

    return () => {
      cancelled = true
    }
  }, [site?.lat, site?.lng, radiusKm])

  return state
}
