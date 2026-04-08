import { useEffect, useState } from 'react'
import type { OSMBuilding, OSMPlanData, OSMRoad, SiteLocation } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'

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

  for (const el of elements) {
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
      buildings.push({
        rings: [ring],
        levels: Number.isFinite(parsedLevels) && parsedLevels > 0 ? parsedLevels : undefined,
      })
    }
    if (el.tags.highway) {
      roads.push({
        coords,
        highway: el.tags.highway,
      })
    }
  }

  return { buildings, roads }
}

async function fetchOverpass(lat: number, lng: number, radiusM: number): Promise<OSMPlanData> {
  const q = `
[out:json][timeout:90];
(
  way["building"](around:${radiusM},${lat},${lng});
  way["highway"](around:${radiusM},${lat},${lng});
);
out geom;
`
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: q,
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  })
  if (!res.ok) throw new Error(`Overpass ${res.status}`)
  const json = (await res.json()) as OsmJson
  return parseOverpass(json)
}

export type OSMFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: OSMPlanData }

export function useOSMData(site: SiteLocation | null, radiusM: number): OSMFetchState {
  const [state, setState] = useState<OSMFetchState>({ status: 'idle' })

  useEffect(() => {
    if (!site) {
      setState({ status: 'idle' })
      return
    }
    const key = cacheKey('osm', [
      site.lat.toFixed(5),
      site.lng.toFixed(5),
      radiusM,
    ])
    const cached = cacheGet<OSMPlanData>(key)
    if (cached) {
      setState({ status: 'ok', data: cached })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    fetchOverpass(site.lat, site.lng, radiusM)
      .then((data) => {
        if (cancelled) return
        cacheSet(key, data)
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
