import { proxied } from './proxy'

function numFrom(rec: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = rec[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return undefined
}

function rowToProps(row: Record<string, unknown>): Record<string, unknown> {
  const nested = row.properties
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...row, ...(nested as Record<string, unknown>) }
  }
  return row
}

function normaliseRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== 'object') return []
  const o = json as Record<string, unknown>
  const feats = o.features
  if (Array.isArray(feats)) {
    return feats
      .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : null))
      .filter((x): x is Record<string, unknown> => !!x)
  }
  const pts = o.points ?? o.data ?? o.results
  if (Array.isArray(pts)) {
    return pts.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
  }
  return []
}

export function egmsRowsToFeatureCollection(rows: Record<string, unknown>[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const row of rows) {
    const p = rowToProps(row)
    let lng = numFrom(p, ['lng', 'lon', 'longitude', 'x'])
    let lat = numFrom(p, ['lat', 'latitude', 'y'])
    const geom = row.geometry
    if ((lng == null || lat == null) && geom && typeof geom === 'object') {
      const g = geom as { type?: string; coordinates?: unknown }
      if (g.type === 'Point' && Array.isArray(g.coordinates)) {
        const c = g.coordinates as number[]
        lng = c[0]
        lat = c[1]
      }
    }
    if (lng == null || lat == null) continue
    const meanVelocity = numFrom(p, ['mean_velocity', 'velocity_mm_yr', 'velocity', 'v_mean', 'mean'])
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        mean_velocity: meanVelocity ?? 0,
        acceleration: numFrom(p, ['acceleration']),
        rmse: numFrom(p, ['rmse']),
        height: numFrom(p, ['height']),
        first_date: typeof p.first_date === 'string' ? p.first_date : undefined,
        last_date: typeof p.last_date === 'string' ? p.last_date : undefined,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

export async function fetchEgmsPointsFeatureCollection(
  lat: number,
  lng: number,
  radiusM = 500,
  signal?: AbortSignal
): Promise<GeoJSON.FeatureCollection> {
  const pad = radiusM / 111_000
  const w = lng - pad
  const s = lat - pad
  const e = lng + pad
  const n = lat + pad
  const urls = [
    `https://egms.land.copernicus.eu/egms-api/v1/points?aoi=${w},${s},${e},${n}&dataset=EGMS_L3_E&format=json`,
    `https://egms.land.copernicus.eu/egms-api/v1/points?bbox=${w},${s},${e},${n}&dataset=EGMS_L3_E&format=json`,
    `https://egms.land.copernicus.eu/egms-api/v1/points?lat=${lat}&lng=${lng}&radius=${radiusM}&dataset=EGMS_L3_E&format=json`,
  ]
  for (const url of urls) {
    try {
      const res = await fetch(proxied(url, 'always'), { signal })
      if (!res.ok) continue
      const json = (await res.json()) as unknown
      const rows = normaliseRows(json)
      const fc = egmsRowsToFeatureCollection(rows)
      if (fc.features.length) return fc
    } catch {
      continue
    }
  }
  return { type: 'FeatureCollection', features: [] }
}

export type EgmsAggregate = {
  movementMeanMmYr?: number
  seasonalAmplitudeMm?: number
  movementPoints: number
  firstDate?: string
  lastDate?: string
}

export function aggregateEgmsFromFeatures(fc: GeoJSON.FeatureCollection): EgmsAggregate {
  const means: number[] = []
  const amps: number[] = []
  let firstDate: string | undefined
  let lastDate: string | undefined
  for (const f of fc.features) {
    const pr = f.properties as Record<string, unknown> | null
    if (!pr) continue
    const mv = numFrom(pr, ['mean_velocity'])
    if (mv != null) means.push(mv)
    const amp = numFrom(pr, ['seasonal_amplitude', 'amplitude'])
    if (amp != null) amps.push(amp)
    const fd = pr.first_date
    const ld = pr.last_date
    if (typeof fd === 'string' && (!firstDate || fd < firstDate)) firstDate = fd
    if (typeof ld === 'string' && (!lastDate || ld > lastDate)) lastDate = ld
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined)
  return {
    movementMeanMmYr: avg(means),
    seasonalAmplitudeMm: avg(amps),
    movementPoints: fc.features.length,
    firstDate,
    lastDate,
  }
}
