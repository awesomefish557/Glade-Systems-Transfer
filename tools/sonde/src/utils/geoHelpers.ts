export const M_PER_DEG_LAT = 111_320

export function metersPerDegreeLng(latDeg: number): number {
  return M_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180)
}

/** Approximate offset in degrees for a given east/north distance in metres. */
export function offsetLngMeters(latDeg: number, metersEast: number): number {
  const m = metersPerDegreeLng(latDeg)
  return m === 0 ? 0 : metersEast / m
}

export function offsetLatMeters(metersNorth: number): number {
  return metersNorth / M_PER_DEG_LAT
}

export function bboxAroundPoint(
  lat: number,
  lng: number,
  radiusM: number
): { south: number; west: number; north: number; east: number } {
  const dLat = offsetLatMeters(radiusM)
  const dLng = offsetLngMeters(lat, radiusM)
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lng - dLng,
    east: lng + dLng,
  }
}

/** Local tangent plane: metres east/north from origin. */
export function lngLatToLocalM(
  originLat: number,
  originLng: number,
  lat: number,
  lng: number
): { x: number; y: number } {
  const x = (lng - originLng) * metersPerDegreeLng(originLat)
  const y = (lat - originLat) * M_PER_DEG_LAT
  return { x, y }
}

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const φ1 = (aLat * Math.PI) / 180
  const φ2 = (bLat * Math.PI) / 180
  const Δφ = ((bLat - aLat) * Math.PI) / 180
  const Δλ = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}
