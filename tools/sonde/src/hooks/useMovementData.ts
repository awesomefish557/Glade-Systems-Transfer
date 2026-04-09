import { useEffect, useState } from 'react'
import type { MovementData, SiteLocation } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'
import { circlePolygon, distanceFromSite, fetchJsonSafe } from '../utils/moduleHelpers'

type GenericState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T }

type OverpassResp = { elements?: Array<Record<string, unknown>> }

export type MovementFetchState = GenericState<MovementData>

export function useMovementData(site: SiteLocation | null): MovementFetchState {
  const [state, setState] = useState<MovementFetchState>({ status: 'idle' })
  useEffect(() => {
    if (!site) return void setState({ status: 'idle' })
    const key = cacheKey('movement', [site.lat.toFixed(4), site.lng.toFixed(4)])
    const cached = cacheGet<MovementData>(key)
    if (cached) return void setState({ status: 'ok', data: cached })
    let cancelled = false
    setState({ status: 'loading' })
    ;(async () => {
      const token = (import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim()
      const walkUrl = `https://api.mapbox.com/isochrone/v1/mapbox/walking/${site.lng},${site.lat}?contours_minutes=5,10,15&polygons=true&access_token=${token}`
      const cycleUrl = `https://api.mapbox.com/isochrone/v1/mapbox/cycling/${site.lng},${site.lat}?contours_minutes=5,10&polygons=true&access_token=${token}`
      const walkLive = token ? await fetchJsonSafe<GeoJSON.FeatureCollection>(walkUrl) : null
      const cycleLive = token ? await fetchJsonSafe<GeoJSON.FeatureCollection>(cycleUrl) : null
      const overpassQ = `[out:json][timeout:45];(node["highway"="bus_stop"](around:500,${site.lat},${site.lng});way["highway"="cycleway"](around:500,${site.lat},${site.lng}););out geom;`
      const osm = await fetchJsonSafe<OverpassResp>('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: overpassQ,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      })
      const busStops = (osm?.elements ?? [])
        .filter((e) => e['type'] === 'node' && e['lat'] != null && e['lon'] != null)
        .slice(0, 24)
        .map((e, i) => {
          const lat = Number(e['lat'])
          const lng = Number(e['lon'])
          const tags = (e['tags'] as Record<string, unknown> | undefined) ?? {}
          const routeRef = String(tags['route_ref'] ?? tags['routes'] ?? tags['bus'] ?? '').trim()
          const routes = routeRef
            ? routeRef.split(/[;,/]/).map((s) => s.trim()).filter(Boolean)
            : []
          return {
            id: String(e['id'] ?? `bus-${i}`),
            name: String(tags['name'] ?? 'Bus stop'),
            lat,
            lng,
            distanceM: distanceFromSite(site.lat, site.lng, lat, lng),
            routes,
          }
        })
      const cycleways: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: (osm?.elements ?? [])
          .filter((e) => e['type'] === 'way' && Array.isArray(e['geometry']))
          .map((e) => ({
            type: 'Feature',
            properties: { id: e['id'] },
            geometry: {
              type: 'LineString',
              coordinates: ((e['geometry'] as Array<Record<string, unknown>>) ?? []).map((g) => [Number(g['lon']), Number(g['lat'])]),
            },
          })) as GeoJSON.Feature[],
      }
      const walkIsochrones =
        walkLive ??
        ({
          type: 'FeatureCollection',
          features: [300, 700, 1100].map((m, i) => ({
            ...circlePolygon(site.lat, site.lng, m),
            properties: { minutes: [5, 10, 15][i] },
          })),
        } as GeoJSON.FeatureCollection)
      const cycleIsochrones =
        cycleLive ??
        ({
          type: 'FeatureCollection',
          features: [900, 1800].map((m, i) => ({
            ...circlePolygon(site.lat, site.lng, m),
            properties: { minutes: [5, 10][i] },
          })),
        } as GeoJSON.FeatureCollection)

      const data: MovementData = {
        walkIsochrones,
        cycleIsochrones,
        busStops,
        cycleways,
        keyDistances: [
          { label: 'City centre', distanceM: 1200 },
          { label: 'Nearest school', distanceM: 650 },
          { label: 'Nearest park', distanceM: 430 },
          { label: 'Nearest station', distanceM: 1750 },
        ],
        sources: [
          { label: 'Mapbox Isochrone', url: 'https://docs.mapbox.com/api/navigation/isochrone/', mode: walkLive ? 'partial' : 'fallback' },
          { label: 'Overpass OSM', url: 'https://overpass-api.de/', mode: osm ? 'partial' : 'fallback' },
        ],
      }
      if (cancelled) return
      cacheSet(key, data)
      setState({ status: 'ok', data })
    })().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Movement failed' })
    })
    return () => {
      cancelled = true
    }
  }, [site?.lat, site?.lng])
  return state
}
