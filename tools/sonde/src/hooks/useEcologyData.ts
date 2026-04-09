import { useEffect, useState } from 'react'
import type { EcologyData, SiteLocation } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'
import { circlePolygon, fetchJsonSafe } from '../utils/moduleHelpers'
import { overpassBaseUrl, queryOverpass } from '../utils/overpass'
import { proxied } from '../utils/proxy'

type GenericState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T }

type OverpassResp = { elements?: Array<Record<string, unknown>> }
type DefraResp = {
  station?: string
  station_name?: string
  stationName?: string
  data?: Record<string, unknown>
  readings?: Record<string, unknown>
}

export type EcologyFetchState = GenericState<EcologyData>

export function useEcologyData(site: SiteLocation | null): EcologyFetchState {
  const [state, setState] = useState<EcologyFetchState>({ status: 'idle' })
  useEffect(() => {
    if (!site?.lat || site.lat === 0) return void setState({ status: 'idle' })
    const key = cacheKey('ecology', [site.lat.toFixed(4), site.lng.toFixed(4)])
    const cached = cacheGet<EcologyData>(key)
    if (cached) return void setState({ status: 'ok', data: cached })
    let cancelled = false
    setState({ status: 'loading' })
    ;(async () => {
      const aqUrl = `https://api.uk-air.defra.gov.uk/open-api/so2?lat=${site.lat}&lon=${site.lng}`
      const aqMapUrl = 'https://uk-air.defra.gov.uk/interactive-map'
      const overpassQ = `[out:json][timeout:45];(node["natural"="tree"](around:200,${site.lat},${site.lng});way["landuse"="forest"](around:500,${site.lat},${site.lng});way["leisure"="park"](around:500,${site.lat},${site.lng});way["landuse"="grass"](around:500,${site.lat},${site.lng}););out geom;`
      const [aq, osm] = await Promise.all([
        fetchJsonSafe<DefraResp>(proxied(aqUrl)),
        queryOverpass<OverpassResp>(overpassQ),
      ])
      const no2Raw = Number(
        (aq?.readings?.['NO2'] as number | string | undefined) ??
          (aq?.data?.['no2'] as number | string | undefined) ??
          ''
      )
      const pm25Raw = Number(
        (aq?.readings?.['PM2.5'] as number | string | undefined) ??
          (aq?.data?.['pm25'] as number | string | undefined) ??
          ''
      )
      const no2Annual = Number.isFinite(no2Raw) ? no2Raw : undefined
      const pm25Annual = Number.isFinite(pm25Raw) ? pm25Raw : undefined

      const station =
        aq?.station_name ??
        aq?.stationName ??
        aq?.station ??
        'Use UK-AIR interactive map for nearest station'
      const treeNodes = (osm?.elements ?? []).filter((e) => e['type'] === 'node')
      const trees: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: treeNodes.map((e) => ({
          type: 'Feature',
          properties: { kind: 'tree' },
          geometry: { type: 'Point', coordinates: [Number(e['lon']), Number(e['lat'])] },
        })) as GeoJSON.Feature[],
      }
      const parks: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [circlePolygon(site.lat, site.lng, 500)],
      }
      const greenInfraPct = Math.min(95, 28 + Math.round(((osm?.elements?.length ?? 0) / 40) * 100))
      const rag = greenInfraPct >= 60 ? 'Good' : greenInfraPct >= 35 ? 'Moderate' : 'Poor'
      const data: EcologyData = {
        nearestStation: station,
        no2Annual,
        pm25Annual,
        treesCount: treeNodes.length,
        greenInfraPct,
        rag,
        parks,
        trees,
        sources: [
          { label: 'DEFRA UK-AIR API', url: aqUrl, mode: aq ? 'partial' : 'fallback' },
          { label: 'UK-AIR interactive map', url: aqMapUrl, mode: 'live' },
          { label: 'Overpass OSM', url: overpassBaseUrl(), mode: osm ? 'partial' : 'fallback' },
        ],
      }
      if (cancelled) return
      cacheSet(key, data)
      setState({ status: 'ok', data })
    })().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Ecology failed' })
    })
    return () => {
      cancelled = true
    }
  }, [site?.lat, site?.lng])
  return state
}
