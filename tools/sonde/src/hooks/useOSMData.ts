import { useEffect, useState } from 'react'
import type { OSMBuilding, OSMPlanData, OSMRoad, OSMTree, OSMWoodland, SiteLocation } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'
import { queryOverpass } from '../utils/overpass'

type OsmJson = {
  elements?: Array<{
    type: string
    id: number
    tags?: Record<string, string>
    geometry?: { lat: number; lon: number }[]
    lat?: number
    lon?: number
    nodes?: number[]
  }>
}

function buildNodes(elements: OsmJson['elements']): Map<number, [number, number]> {
  const m = new Map<number, [number, number]>()
  if (!elements) return m
  for (const el of elements) {
    if (el.type === 'node' && el.lat != null && el.lon != null) {
      m.set(el.id, [el.lat, el.lon] as [number, number])
    }
  }
  return m
}

function parseOverpass(json: OsmJson): OSMPlanData {
  const elements = json.elements ?? []
  const nodeMap = buildNodes(elements)
  const buildings: OSMBuilding[] = []
  const roads: OSMRoad[] = []
  const trees: OSMTree[] = []
  const woodlands: OSMWoodland[] = []

  for (const el of elements) {
    if (el.type === 'node' && el.tags?.natural === 'tree' && el.lat != null && el.lon != null) {
      const h = Number(el.tags.height ?? '')
      const c = Number(el.tags.diameter_crown ?? '')
      const lc = el.tags.leaf_cycle
      const lt = el.tags.leaf_type
      trees.push({
        id: String(el.id),
        lat: el.lat,
        lng: el.lon,
        height: Number.isFinite(h) && h > 0 ? h : 8,
        crownDiameter: Number.isFinite(c) && c > 0 ? c : 6,
        leafCycle: lc === 'deciduous' || lc === 'evergreen' ? lc : 'unknown',
        leafType: lt === 'broadleaved' || lt === 'needleleaved' ? lt : 'unknown',
        species: el.tags.species,
      })
      continue
    }
    if (el.type !== 'way' || !el.tags) continue
    const geom = el.geometry
    let coords: [number, number][] = []
    if (geom && geom.length) {
      coords = geom.map((g) => [g.lat, g.lon] as [number, number])
    } else if (el.nodes) {
      coords = el.nodes
        .map((id) => nodeMap.get(id))
        .filter((c): c is [number, number] => !!c)
    }
    if (coords.length < 2) continue

    if (el.tags.building) {
      const closed =
        coords[0][0] === coords[coords.length - 1][0] &&
        coords[0][1] === coords[coords.length - 1][1]
      const ring = closed ? coords : [...coords, coords[0]]
      const parsedLevels = Number(el.tags['building:levels'])
      const parsedHeight = Number(String(el.tags['height'] ?? el.tags['building:height'] ?? ''))
      buildings.push({
        id: String(el.id),
        rings: [ring],
        levels: Number.isFinite(parsedLevels) && parsedLevels > 0 ? parsedLevels : undefined,
        heightM:
          Number.isFinite(parsedHeight) && parsedHeight > 0
            ? parsedHeight
            : Number.isFinite(parsedLevels) && parsedLevels > 0
              ? parsedLevels * 3
              : undefined,
        name: el.tags['name'],
        buildingType: el.tags['building'],
        roofShape: el.tags['roof:shape'],
      })
    }
    if (el.tags.highway) {
      roads.push({
        coords,
        highway: el.tags.highway,
      })
    }
    if (el.tags.landuse === 'forest' || el.tags.natural === 'wood') {
      const closed =
        coords[0][0] === coords[coords.length - 1][0] &&
        coords[0][1] === coords[coords.length - 1][1]
      const ring = closed ? coords : [...coords, coords[0]]
      woodlands.push({ id: String(el.id), ring })
    }
  }

  return { buildings, roads, trees, woodlands }
}

async function fetchOverpass(lat: number, lng: number, radiusM: number): Promise<OSMPlanData> {
  const q = `
[out:json][timeout:90];
(
  way["building"](around:${radiusM},${lat},${lng});
  way["highway"](around:${radiusM},${lat},${lng});
  node["natural"="tree"](around:${radiusM},${lat},${lng});
  node["natural"="tree_row"](around:${radiusM},${lat},${lng});
  way["landuse"="forest"](around:${radiusM},${lat},${lng});
  way["natural"="wood"](around:${radiusM},${lat},${lng});
);
out geom;
`
  const json = await queryOverpass<OsmJson>(q, 2)
  return parseOverpass(json)
}

export type OSMFetchState =
  | { status: 'idle' }
  | { status: 'loading'; message?: string }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: OSMPlanData }

const OSM_CACHE_TTL_MS = 48 * 60 * 60 * 1000

export function useOSMData(site: SiteLocation | null, radiusM: number): OSMFetchState {
  const [state, setState] = useState<OSMFetchState>({ status: 'idle' })

  useEffect(() => {
    if (!site?.lat || site.lat === 0) {
      setState({ status: 'idle' })
      return
    }
    const key = cacheKey('osm', [
      site.lat.toFixed(5),
      site.lng.toFixed(5),
      radiusM,
    ])
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const cached = JSON.parse(raw) as { expiresAt: number; data: OSMPlanData }
        if (cached.expiresAt > Date.now()) {
          setState({ status: 'ok', data: cached.data })
          return
        }
      }
    } catch {
      const cached = cacheGet<OSMPlanData>(key)
      if (cached) {
        setState({ status: 'ok', data: cached })
        return
      }
    }
    let cancelled = false
    setState({ status: 'loading', message: 'Loading map data... (may take a moment)' })
    fetchOverpass(site.lat, site.lng, radiusM)
      .then((data) => {
        if (cancelled) return
        cacheSet(key, data)
        try {
          localStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + OSM_CACHE_TTL_MS, data }))
        } catch {
          /* ignore */
        }
        setState({ status: 'ok', data })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: e instanceof Error ? e.message : 'OSM fetch failed',
        })
      })
    return () => {
      cancelled = true
    }
  }, [site?.lat, site?.lng, radiusM])

  return state
}
