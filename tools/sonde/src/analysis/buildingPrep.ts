import type { OSMBuilding } from '../types'
import { M_PER_DEG_LAT, metersPerDegreeLng } from '../utils/geoHelpers'
import type { BuildingObstacle } from './analysisCore'

export function ringCentroid(ring: [number, number][]): { lat: number; lng: number } {
  let slat = 0
  let slng = 0
  const n = ring.length
  for (let i = 0; i < n; i += 1) {
    slat += ring[i][0]
    slng += ring[i][1]
  }
  return { lat: slat / n, lng: slng / n }
}

export function ringRadiusM(ring: [number, number][], refLat: number): number {
  const c = ringCentroid(ring)
  const mLng = metersPerDegreeLng(refLat)
  let r = 6
  for (const [lat, lng] of ring) {
    const dx = (lng - c.lng) * mLng
    const dy = (lat - c.lat) * M_PER_DEG_LAT
    r = Math.max(r, Math.hypot(dx, dy))
  }
  return Math.min(80, r + 2)
}

export function buildingsToObstacles(
  buildings: OSMBuilding[],
  heightM: (b: OSMBuilding) => number
): BuildingObstacle[] {
  const out: BuildingObstacle[] = []
  for (const b of buildings) {
    const ring0 = b.rings[0]
    if (!ring0 || ring0.length < 3) continue
    const c = ringCentroid(ring0)
    const h = heightM(b)
    if (!Number.isFinite(h) || h < 1) continue
    out.push({
      lat: c.lat,
      lng: c.lng,
      heightM: h,
      radiusM: ringRadiusM(ring0, c.lat),
    })
  }
  return out
}
