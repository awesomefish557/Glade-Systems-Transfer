import { useEffect, useState } from 'react'
import type { EcologyData, SiteLocation } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'
import { circlePolygon, fetchJsonSafe } from '../utils/moduleHelpers'

type GenericState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T }

type OverpassResp = { elements?: Array<Record<string, unknown>> }

export type EcologyFetchState = GenericState<EcologyData>

export function useEcologyData(site: SiteLocation | null): EcologyFetchState {
  const [state, setState] = useState<EcologyFetchState>({ status: 'idle' })
  useEffect(() => {
    if (!site || (site.lat === 0 && site.lng === 0)) return void setState({ status: 'idle' })
    const key = cacheKey('ecology', [site.lat.toFixed(4), site.lng.toFixed(4)])
    const cached = cacheGet<EcologyData>(key)
    if (cached) return void setState({ status: 'ok', data: cached })
    let cancelled = false
    setState({ status: 'loading' })
    ;(async () => {
      const aqUrl = `https://api.uk-air.defra.gov.uk/open-api/so2?lat=${site.lat}&lon=${site.lng}`
      const aqMapUrl = 'https://uk-air.defra.gov.uk/interactive-map'
      const overpassQ = `[out:json][timeout:45];(node["natural"="tree"](around:200,${site.lat},${site.lng});way["landuse"="forest"](around:500,${site.lat},${site.lng});way["leisure"="park"](around:500,${site.lat},${site.lng});way["landuse"="grass"](around:500,${site.lat},${site.lng}););out geom;`
      const osm = await fetchJsonSafe<OverpassResp>('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: overpassQ,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      })
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
        nearestStation: 'Use UK-AIR interactive map for nearest station',
        no2Annual: undefined,
        pm25Annual: undefined,
        treesCount: treeNodes.length,
        greenInfraPct,
        rag,
        parks,
        trees,
        sources: [
          { label: 'DEFRA UK-AIR API', url: aqUrl, mode: 'fallback' },
          { label: 'UK-AIR interactive map', url: aqMapUrl, mode: 'live' },
          { label: 'Overpass OSM', url: 'https://overpass-api.de/', mode: osm ? 'partial' : 'fallback' },
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
