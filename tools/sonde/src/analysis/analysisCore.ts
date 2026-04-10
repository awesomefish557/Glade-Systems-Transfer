/**
 * Pure analysis math — safe for Web Workers (no DOM / Mapbox / React).
 */
import { haversineM, M_PER_DEG_LAT, metersPerDegreeLng, offsetLatMeters, offsetLngMeters } from '../utils/geoHelpers'

export type BuildingObstacle = {
  lat: number
  lng: number
  heightM: number
  radiusM: number
}

export type TerrainGridSerialized = {
  width: number
  height: number
  bbox: [number, number, number, number]
  /** Copy for worker (not transferred) */
  data: Float32Array
}

export function sampleTerrainM(grid: TerrainGridSerialized, lng: number, lat: number): number {
  const [west, south, east, north] = grid.bbox
  if (lng < west || lng > east || lat < south || lat > north) return 0
  const fx = ((lng - west) / (east - west)) * (grid.width - 1)
  const fy = ((north - lat) / (north - south)) * (grid.height - 1)
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(grid.width - 1, x0 + 1)
  const y1 = Math.min(grid.height - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0
  const i = (yy: number, xx: number) => grid.data[yy * grid.width + xx]
  const v00 = i(y0, x0)
  const v10 = i(y0, x1)
  const v01 = i(y1, x0)
  const v11 = i(y1, x1)
  if (![v00, v10, v01, v11].every(Number.isFinite)) return 0
  const a = v00 * (1 - tx) + v10 * tx
  const b = v01 * (1 - tx) + v11 * tx
  return a * (1 - ty) + b * ty
}

export function bearingDegFromNorth(lat0: number, lng0: number, lat1: number, lng1: number): number {
  const φ1 = (lat0 * Math.PI) / 180
  const φ2 = (lat1 * Math.PI) / 180
  const Δλ = ((lng1 - lng0) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  let θ = (Math.atan2(y, x) * 180) / Math.PI
  θ = (θ + 360) % 360
  return θ
}

export function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

/** Eye level ~1.6 m above ground at point. */
export function isSunBlocked(
  pointLat: number,
  pointLng: number,
  groundElevM: number,
  sunAltDeg: number,
  sunAzFromNorthDeg: number,
  obstacles: BuildingObstacle[],
  horizConeDeg = 38
): boolean {
  if (sunAltDeg <= 0.2) return true
  for (const o of obstacles) {
    const dist = haversineM(pointLat, pointLng, o.lat, o.lng)
    if (dist < 1 || dist > 900) continue
    const brg = bearingDegFromNorth(pointLat, pointLng, o.lat, o.lng)
    if (angularDiffDeg(brg, sunAzFromNorthDeg) > horizConeDeg) continue
    const relTopM = Math.max(0.3, o.heightM - 1.6)
    const targetElevAngle = Math.atan2(relTopM, dist) * (180 / Math.PI)
    if (targetElevAngle >= sunAltDeg - 0.35) return true
  }
  return false
}

export type SunSample = { altDeg: number; azFromNorthDeg: number }

/** Approximate hour-weighted count: each sample = equal time slice of daylight. */
export function sunlightHoursWeighted(
  lat: number,
  lng: number,
  groundElevM: number,
  samples: SunSample[],
  obstacles: BuildingObstacle[],
  daylightHours: number
): number {
  if (!samples.length) return 0
  let clear = 0
  for (const s of samples) {
    if (!isSunBlocked(lat, lng, groundElevM, s.altDeg, s.azFromNorthDeg, obstacles)) clear += 1
  }
  return (clear / samples.length) * daylightHours
}

export function buildMeterGrid(
  centerLat: number,
  centerLng: number,
  radiusM: number,
  stepM: number
): Array<{ lat: number; lng: number; row: number; col: number }> {
  const out: Array<{ lat: number; lng: number; row: number; col: number }> = []
  let row = 0
  for (let y = -radiusM; y <= radiusM + 1e-6; y += stepM) {
    let col = 0
    for (let x = -radiusM; x <= radiusM + 1e-6; x += stepM) {
      out.push({
        lat: centerLat + offsetLatMeters(y),
        lng: centerLng + offsetLngMeters(centerLat, x),
        row,
        col,
      })
      col += 1
    }
    row += 1
  }
  return out
}

export function gridCols(points: Array<{ row: number; col: number }>): number {
  if (!points.length) return 0
  return Math.max(...points.map((p) => p.col)) + 1
}

export function gridRows(points: Array<{ row: number; col: number }>): number {
  if (!points.length) return 0
  return Math.max(...points.map((p) => p.row)) + 1
}

// --- Noise (simplified CRTN-style) ---

const ROAD_BASE: Record<string, number> = {
  motorway: 75,
  trunk: 72,
  primary: 68,
  secondary: 65,
  tertiary: 62,
  unclassified: 58,
  residential: 55,
  living_street: 53,
  service: 50,
  footway: 42,
  path: 40,
  cycleway: 44,
}

export function roadNoiseDbAtDistance(highway: string, distM: number): number {
  const base = ROAD_BASE[highway] ?? 55
  if (distM < 1) distM = 1
  const attenuation = 20 * Math.log10(distM / 10)
  return Math.max(30, base - attenuation)
}

export function railNoiseDbAtDistance(railway: string, distM: number): number {
  const base = railway === 'tram' || railway === 'light_rail' ? 62 : 70
  if (distM < 1) distM = 1
  return Math.max(30, base - 20 * Math.log10(distM / 10))
}

export function dbCombine(levels: number[]): number {
  if (!levels.length) return 30
  let sum = 0
  for (const l of levels) {
    sum += 10 ** (l / 10)
  }
  return 10 * Math.log10(sum)
}

export type RoadSeg = { lat0: number; lng0: number; lat1: number; lng1: number; highway: string }
export type RailSeg = { lat0: number; lng0: number; lat1: number; lng1: number; railway: string }

function distPointToSegmentM(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const ab2 = abx * abx + aby * aby
  let t = ab2 < 1e-12 ? 0 : (apx * abx + apy * aby) / ab2
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * abx
  const qy = ay + t * aby
  const dx = px - qx
  const dy = py - qy
  return Math.hypot(dx, dy)
}

export function noiseDbAtPoint(
  lat: number,
  lng: number,
  roads: RoadSeg[],
  rails: RailSeg[],
  roadRadiusM: number,
  railRadiusM: number
): number {
  const mLng = metersPerDegreeLng(lat)
  const originLng = lng
  const originLat = lat
  const roadContrib: number[] = []
  for (const r of roads) {
    const ax = (r.lng0 - originLng) * mLng
    const ay = (r.lat0 - originLat) * M_PER_DEG_LAT
    const bx = (r.lng1 - originLng) * mLng
    const by = (r.lat1 - originLat) * M_PER_DEG_LAT
    const d = distPointToSegmentM(0, 0, ax, ay, bx, by)
    if (d <= roadRadiusM) {
      roadContrib.push(roadNoiseDbAtDistance(r.highway, d))
    }
  }
  const railContrib: number[] = []
  for (const r of rails) {
    const ax = (r.lng0 - originLng) * mLng
    const ay = (r.lat0 - originLat) * M_PER_DEG_LAT
    const bx = (r.lng1 - originLng) * mLng
    const by = (r.lat1 - originLat) * M_PER_DEG_LAT
    const d = distPointToSegmentM(0, 0, ax, ay, bx, by)
    if (d <= railRadiusM) {
      railContrib.push(railNoiseDbAtDistance(r.railway, d))
    }
  }
  const parts: number[] = []
  if (roadContrib.length) parts.push(dbCombine(roadContrib))
  if (railContrib.length) parts.push(dbCombine(railContrib))
  if (!parts.length) return 32
  return dbCombine(parts)
}

export function roadsToSegments(
  coordsList: Array<{ coords: [number, number][]; highway: string }>
): RoadSeg[] {
  const out: RoadSeg[] = []
  for (const { coords, highway } of coordsList) {
    for (let i = 0; i < coords.length - 1; i += 1) {
      const a = coords[i]
      const b = coords[i + 1]
      out.push({ lat0: a[0], lng0: a[1], lat1: b[0], lng1: b[1], highway })
    }
  }
  return out
}

export function railsToSegments(coordsList: Array<{ coords: [number, number][]; railway: string }>): RailSeg[] {
  const out: RailSeg[] = []
  for (const { coords, railway } of coordsList) {
    for (let i = 0; i < coords.length - 1; i += 1) {
      const a = coords[i]
      const b = coords[i + 1]
      out.push({ lat0: a[0], lng0: a[1], lat1: b[0], lng1: b[1], railway })
    }
  }
  return out
}

// --- Viewshed ---

export function elevationAtPointWithBuildings(
  lat: number,
  lng: number,
  terrain: TerrainGridSerialized | null,
  obstacles: BuildingObstacle[]
): { groundM: number; totalM: number } {
  const groundM = terrain ? sampleTerrainM(terrain, lng, lat) : 0
  let extra = 0
  for (const o of obstacles) {
    const d = haversineM(lat, lng, o.lat, o.lng)
    if (d <= o.radiusM * 1.1) {
      extra = Math.max(extra, o.heightM)
    }
  }
  return { groundM, totalM: groundM + extra }
}

export function castRayVisibleDistance(
  fromLat: number,
  fromLng: number,
  fromHeightM: number,
  bearingFromNorthDeg: number,
  maxDistM: number,
  stepM: number,
  terrain: TerrainGridSerialized | null,
  obstacles: BuildingObstacle[]
): number {
  const br = (bearingFromNorthDeg * Math.PI) / 180
  let maxAngleSeen = -90
  let visibleDist = 0
  for (let d = stepM; d <= maxDistM; d += stepM) {
    const lat = fromLat + (Math.cos(br) * d) / M_PER_DEG_LAT
    const lng = fromLng + (Math.sin(br) * d) / metersPerDegreeLng(fromLat)
    const { totalM } = elevationAtPointWithBuildings(lat, lng, terrain, obstacles)
    const angle = Math.atan2(totalM - fromHeightM, d) * (180 / Math.PI)
    if (angle > maxAngleSeen) {
      maxAngleSeen = angle
      visibleDist = d
    } else {
      break
    }
  }
  return visibleDist
}

export function viewshedRingCoordinates(
  fromLat: number,
  fromLng: number,
  fromHeightM: number,
  maxDistM: number,
  stepM: number,
  terrain: TerrainGridSerialized | null,
  obstacles: BuildingObstacle[],
  bearingStepDeg = 1
): [number, number][] {
  const ring: [number, number][] = []
  for (let deg = 0; deg < 360; deg += bearingStepDeg) {
    const dist = castRayVisibleDistance(fromLat, fromLng, fromHeightM, deg, maxDistM, stepM, terrain, obstacles)
    const br = (deg * Math.PI) / 180
    const lat = fromLat + (Math.cos(br) * dist) / M_PER_DEG_LAT
    const lng = fromLng + (Math.sin(br) * dist) / metersPerDegreeLng(fromLat)
    ring.push([lng, lat])
  }
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push([...ring[0]])
  }
  return ring
}

// --- Accessibility segment score ---

export function accessibilityScoreForSegment(
  slopePct: number,
  surface: string | undefined,
  widthM: number | undefined
): number {
  let score = 100
  if (slopePct > 8) score -= 50
  else if (slopePct > 5) score -= 25
  else if (slopePct > 2) score -= 10
  const s = (surface ?? '').toLowerCase()
  if (s.includes('cobble')) score -= 30
  if (s.includes('gravel') || s.includes('fine_gravel')) score -= 20
  if (s.includes('grass') || s.includes('ground')) score -= 40
  if (s.includes('asphalt') || s.includes('concrete') || s.includes('paving')) score -= 0
  const w = widthM ?? 2
  if (w < 1.2) score -= 40
  else if (w < 1.5) score -= 20
  return Math.max(0, score)
}

export function lineToneForScore(score: number): 'green' | 'amber' | 'red' {
  if (score >= 70) return 'green'
  if (score >= 40) return 'amber'
  return 'red'
}

// --- VSC (simplified) ---

export function isSkyDirectionBlocked(
  originLat: number,
  originLng: number,
  originHeightM: number,
  azFromNorthDeg: number,
  altDeg: number,
  obstacles: BuildingObstacle[],
  maxCastM = 400
): boolean {
  if (altDeg <= 0) return true
  const horizM = Math.cos((altDeg * Math.PI) / 180) * maxCastM
  const vertM = Math.sin((altDeg * Math.PI) / 180) * maxCastM
  const br = (azFromNorthDeg * Math.PI) / 180
  const latT = originLat + (Math.cos(br) * horizM) / M_PER_DEG_LAT
  const lngT = originLng + (Math.sin(br) * horizM) / metersPerDegreeLng(originLat)
  const targetElev = originHeightM + vertM
  for (const o of obstacles) {
    const dH = haversineM(originLat, originLng, o.lat, o.lng)
    if (dH > maxCastM) continue
    const brO = bearingDegFromNorth(originLat, originLng, o.lat, o.lng)
    if (angularDiffDeg(brO, azFromNorthDeg) > 40) continue
    const top = o.heightM + 2
    const ang = Math.atan2(top - originHeightM, dH) * (180 / Math.PI)
    if (ang >= altDeg - 1) return true
  }
  return false
}

export function computeVscRatio(
  windowLat: number,
  windowLng: number,
  windowHeightM: number,
  facingAzFromNorthDeg: number,
  obstacles: BuildingObstacle[],
  azHalfWidth = 90,
  azStep = 6,
  altStep = 6
): number {
  let visible = 0
  let total = 0
  for (let az = facingAzFromNorthDeg - azHalfWidth; az <= facingAzFromNorthDeg + azHalfWidth; az += azStep) {
    for (let alt = altStep; alt <= 90; alt += altStep) {
      total += 1
      if (!isSkyDirectionBlocked(windowLat, windowLng, windowHeightM, az, alt, obstacles)) {
        visible += 1
      }
    }
  }
  return total ? visible / total : 0
}
