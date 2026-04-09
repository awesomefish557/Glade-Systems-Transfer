import { haversineM, offsetLatMeters, offsetLngMeters } from './geoHelpers'

export async function fetchJsonSafe<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const run = async () => {
      const res = await fetch(url, init)
      if (res.status === 429 && url.includes('overpass-api.de')) {
        await new Promise((resolve) => setTimeout(resolve, 15_000))
        return fetch(url, init)
      }
      return res
    }
    const res = await run()
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function circlePolygon(lat: number, lng: number, radiusM: number, steps = 40): GeoJSON.Feature {
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2
    const north = Math.cos(a) * radiusM
    const east = Math.sin(a) * radiusM
    const pLat = lat + offsetLatMeters(north)
    const pLng = lng + offsetLngMeters(lat, east)
    ring.push([pLng, pLat])
  }
  return {
    type: 'Feature',
    properties: { radiusM },
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

export function distanceFromSite(lat: number, lng: number, toLat: number, toLng: number): number {
  return haversineM(lat, lng, toLat, toLng)
}

export function fmtDateISO(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}
