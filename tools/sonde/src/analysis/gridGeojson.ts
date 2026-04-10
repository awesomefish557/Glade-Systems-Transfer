import { offsetLatMeters, offsetLngMeters } from '../utils/geoHelpers'

/** Square cells aligned to meter offsets from site centre (same order as `buildMeterGrid`). */
export function scalarGridToPolygonFc(
  centerLat: number,
  centerLng: number,
  nrows: number,
  ncols: number,
  stepM: number,
  flatValues: number[],
  propsFor: (v: number) => Record<string, unknown>
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  const half = stepM / 2
  let i = 0
  const radiusM = ((Math.max(nrows, ncols) - 1) * stepM) / 2
  for (let row = 0; row < nrows; row += 1) {
    const yM = -radiusM + row * stepM
    for (let col = 0; col < ncols; col += 1) {
      const xM = -radiusM + col * stepM
      const v = flatValues[i++] ?? 0
      const corners: [number, number][] = [
        [xM - half, yM - half],
        [xM + half, yM - half],
        [xM + half, yM + half],
        [xM - half, yM + half],
      ].map(([ex, ny]) => {
        const lat = centerLat + offsetLatMeters(ny)
        const lng = centerLng + offsetLngMeters(centerLat, ex)
        return [lng, lat] as [number, number]
      })
      corners.push([...corners[0]])
      features.push({
        type: 'Feature',
        properties: { ...propsFor(v), v },
        geometry: { type: 'Polygon', coordinates: [corners] },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function solarHoursToColorProps(hours: number): Record<string, unknown> {
  let fill = '#1e3a8a'
  if (hours >= 8) fill = '#dc2626'
  else if (hours >= 6) fill = '#fb923c'
  else if (hours >= 4) fill = '#facc15'
  else if (hours >= 2) fill = '#3b82f6'
  return { fill }
}

export function noiseDbToColorProps(db: number): Record<string, unknown> {
  let fill = '#22c55e'
  if (db > 70) fill = '#dc2626'
  else if (db > 65) fill = '#f97316'
  else if (db > 60) fill = '#fbbf24'
  else if (db > 55) fill = '#eab308'
  return { fill }
}
