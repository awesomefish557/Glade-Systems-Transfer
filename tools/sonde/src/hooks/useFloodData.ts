import type { FloodData, SiteLocation } from '../types'

export type FloodFetchState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: FloodData }

export function useFloodData(site: SiteLocation | null, radiusKm: number): FloodFetchState {
  if (!site) return { status: 'idle' }
  return {
    status: 'ok',
    data: {
      provider: 'nrw',
      region: 'wales',
      radiusKm,
      areas: [],
      rawCount: 0,
      floodZone: '1',
      historicalEvents:
        'Flood data for Welsh sites is managed by Natural Resources Wales. The official map is shown above — check flood zones before any planning application.',
      climateProjection2050: '',
      nearestWatercourse: undefined,
      surfaceWaterRisk: 'Low',
      mapUrl: `https://flood.map.nrw.wales/en/?lat=${site.lat}&lng=${site.lng}&zoom=15`,
    },
  }
}
