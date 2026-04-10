/**
 * EA LiDAR composite (England & Wales) — WMS GetMap GeoTIFF + Open-Meteo / section helpers.
 */
import type { Map as MapboxMap } from 'mapbox-gl'
import { fromArrayBuffer } from 'geotiff'
import { offsetLatMeters, offsetLngMeters } from './geoHelpers'
import { proxied } from './proxy'

export type LidarElevationGrid = {
  data: Float32Array
  width: number
  height: number
  /** GeoTIFF order: minX, minY, maxX, maxY (WGS84 → west, south, east, north). */
  bbox: [number, number, number, number]
}

export const WMS_DTM =
  'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m-2022/wms'
export const WMS_DSM =
  'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-last-return-dsm-1m-2022/wms'

/**
 * WMS `LAYERS` must match a `<Layer><Name>` from GetCapabilities for this spatialdata endpoint.
 * Using `dataset-{uuid}` (metadata id) as LAYERS returns LayerNotDefined from the server.
 * These elevation layers return single-band GeoTIFF suitable for `parseEaLidarTiff`.
 */
const WMS_LAYERS_DTM = 'Lidar_Composite_Elevation_DTM_1m'
const WMS_LAYERS_DSM = 'Lidar_Composite_Elevation_LZ_DSM_1m'

export const LIDAR_CACHE_MS = 30 * 24 * 60 * 60 * 1000

/** Rough England & Wales extent (not Scotland). */
export function isEwLidarCoverage(lat: number, lng: number): boolean {
  return lat > 49.9 && lat < 55.8 && lng > -5.7 && lng < 1.8
}

/** Debug: call from the app when starting a LiDAR load for a site. */
export function logLidarCoverageCheck(lat: number, lng: number): void {
  console.log('LiDAR: checking coverage for', lat, lng)
  console.log('LiDAR: in coverage?', isEwLidarCoverage(lat, lng))
}

function rad2deg(r: number): number {
  return (r * 180) / Math.PI
}

/** Web Mercator tile bounds in WGS84 (north > south). */
export function tileBoundsWgs84(z: number, tx: number, ty: number): [number, number, number, number] {
  const n = 2 ** z
  const west = (tx / n) * 360 - 180
  const east = ((tx + 1) / n) * 360 - 180
  const north = rad2deg(Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))))
  const south = rad2deg(Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 1)) / n))))
  return [west, south, east, north]
}

export function siteToTileZ14(lat: number, lng: number): { z: number; x: number; y: number } {
  const z = 14
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  )
  return { z, x, y: Math.max(0, Math.min(n - 1, y)) }
}

export function lidarTileCacheKey(kind: 'dtm' | 'dsm', z: number, x: number, y: number): string {
  return `sonde_lidar_${kind}_${z}_${x}_${y}`
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export async function loadCachedTiff(
  cacheKey: string
): Promise<ArrayBuffer | null> {
  try {
    const raw = localStorage.getItem(cacheKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { expiresAt: number; b64: string }
    if (parsed.expiresAt < Date.now() || !parsed.b64) return null
    return base64ToArrayBuffer(parsed.b64)
  } catch {
    return null
  }
}

export function saveCachedTiff(cacheKey: string, buffer: ArrayBuffer): void {
  try {
    const payload = JSON.stringify({
      expiresAt: Date.now() + LIDAR_CACHE_MS,
      b64: arrayBufferToBase64(buffer),
    })
    localStorage.setItem(cacheKey, payload)
  } catch {
    /* quota or private mode */
  }
}

/**
 * EA LiDAR WMS GetMap (1 m DTM/DSM 2022). WMS 1.3.0 + EPSG:4326 uses axis order
 * miny,minx,maxy,maxx → south,west,north,east.
 */
export async function fetchEaLidarWms(
  type: 'dtm' | 'dsm',
  west: number,
  south: number,
  east: number,
  north: number,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const baseWms = type === 'dtm' ? WMS_DTM : WMS_DSM
  const layers = type === 'dtm' ? WMS_LAYERS_DTM : WMS_LAYERS_DSM
  const params =
    '?SERVICE=WMS' +
    '&VERSION=1.3.0' +
    '&REQUEST=GetMap' +
    '&LAYERS=' +
    layers +
    '&STYLES=' +
    '&CRS=EPSG:4326' +
    '&BBOX=' +
    south +
    ',' +
    west +
    ',' +
    north +
    ',' +
    east +
    '&WIDTH=256' +
    '&HEIGHT=256' +
    '&FORMAT=image/geotiff'

  const targetUrl = baseWms + params
  console.log('LiDAR WMS URL:', targetUrl)

  const response = await fetch(proxied(targetUrl, 'always'), { signal })
  const buf = await response.arrayBuffer()
  const ct = (response.headers.get('content-type') ?? '').toLowerCase()
  console.log('WMS status:', response.status)
  console.log('WMS content-type:', ct)

  if (!response.ok) {
    const text = new TextDecoder().decode(new Uint8Array(buf).slice(0, 400))
    console.error('WMS error:', text)
    throw new Error(`WMS ${type} ${response.status}`)
  }

  if (ct.includes('xml') || (ct.includes('text/') && !ct.includes('tiff'))) {
    const text = new TextDecoder().decode(new Uint8Array(buf).slice(0, 400))
    console.error('WMS service exception:', text)
    throw new Error(`WMS ${type} returned ${ct.trim()}`)
  }

  return buf
}

export async function parseEaLidarTiff(buffer: ArrayBuffer): Promise<LidarElevationGrid> {
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage()
  const data = await image.readRasters({ samples: [0] })
  const width = image.getWidth()
  const height = image.getHeight()
  const bbox = image.getBoundingBox() as [number, number, number, number]
  const band = data[0] as ArrayLike<number> & { length: number }
  const arr = new Float32Array(band.length)
  for (let i = 0; i < band.length; i += 1) {
    const v = Number(band[i])
    arr[i] = Number.isFinite(v) ? v : Number.NaN
  }
  return { data: arr, width, height, bbox }
}

/** Bilinear sample; NaN if outside or nodata. */
export function sampleGridLngLat(grid: LidarElevationGrid, lng: number, lat: number): number {
  const [west, south, east, north] = grid.bbox
  if (lng < west || lng > east || lat < south || lat > north) return Number.NaN
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
  if (![v00, v10, v01, v11].every(Number.isFinite)) return Number.NaN
  const a = v00 * (1 - tx) + v10 * tx
  const b = v01 * (1 - tx) + v11 * tx
  return a * (1 - ty) + b * ty
}

/** Open-Meteo elevation (no Mapbox terrain); batched — API is comma-separated coordinate lists. */
export async function sampleOpenMeteoElevations(
  points: Array<{ lat: number; lng: number }>
): Promise<number[]> {
  const chunkSize = 200
  const out: number[] = []
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize)
    const lats = chunk.map((p) => p.lat.toFixed(6)).join(',')
    const lngs = chunk.map((p) => p.lng.toFixed(6)).join(',')
    const res = await fetch(proxied(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`))
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
    const data = (await res.json()) as { elevation?: number[] }
    const part = data.elevation ?? []
    if (part.length !== chunk.length) {
      throw new Error(`Open-Meteo elevation length mismatch (${part.length} vs ${chunk.length})`)
    }
    out.push(...part)
  }
  const elevations = out
  console.log('Open-Meteo response:', elevations)
  return elevations
}

/** Sample Mapbox raster-dem terrain (requires `mapbox-dem` source + setTerrain). Last-resort for section profile. */
export function sampleMapboxTerrainElevations(
  map: MapboxMap,
  points: Array<{ lat: number; lng: number }>
): number[] | null {
  if (!map.isStyleLoaded() || !map.getTerrain()) return null
  try {
    const out: number[] = []
    for (const p of points) {
      const z = map.queryTerrainElevation([p.lng, p.lat])
      if (z == null || !Number.isFinite(z)) return null
      out.push(z)
    }
    return out
  } catch {
    return null
  }
}

export function sectionElevationsFromLidar(
  grid: LidarElevationGrid,
  points: Array<{ lat: number; lng: number }>
): number[] | null {
  const out: number[] = []
  for (const p of points) {
    const z = sampleGridLngLat(grid, p.lng, p.lat)
    if (!Number.isFinite(z)) return null
    out.push(z)
  }
  return out
}

function mean(nums: number[]): number {
  if (!nums.length) return Number.NaN
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0
  const m = mean(nums)
  const v = nums.reduce((s, x) => s + (x - m) ** 2, 0) / nums.length
  return Math.sqrt(v)
}

/** OSM-style ring: [lat, lng][] */
export function pointInRingLatLng(lng: number, lat: number, ringLatLng: [number, number][]): boolean {
  const ringLngLat = ringLatLng.map(([la, ln]) => [ln, la] as [number, number])
  let inside = false
  const x = lng
  const y = lat
  for (let i = 0, j = ringLngLat.length - 1; i < ringLngLat.length; j = i++) {
    const xi = ringLngLat[i][0]
    const yi = ringLngLat[i][1]
    const xj = ringLngLat[j][0]
    const yj = ringLngLat[j][1]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function gridCellsInPolygon(
  grid: LidarElevationGrid,
  ringLatLng: [number, number][]
): Array<{ ix: number; iy: number; lng: number; lat: number }> {
  const [west, south, east, north] = grid.bbox
  let rWest = Infinity
  let rEast = -Infinity
  let rSouth = Infinity
  let rNorth = -Infinity
  for (const [la, ln] of ringLatLng) {
    rWest = Math.min(rWest, ln)
    rEast = Math.max(rEast, ln)
    rSouth = Math.min(rSouth, la)
    rNorth = Math.max(rNorth, la)
  }
  const ix0 = clamp(Math.floor(((rWest - west) / (east - west)) * grid.width), 0, grid.width - 1)
  const ix1 = clamp(Math.ceil(((rEast - west) / (east - west)) * grid.width), 0, grid.width - 1)
  const iy0 = clamp(Math.floor(((north - rNorth) / (north - south)) * grid.height), 0, grid.height - 1)
  const iy1 = clamp(Math.ceil(((north - rSouth) / (north - south)) * grid.height), 0, grid.height - 1)
  const out: Array<{ ix: number; iy: number; lng: number; lat: number }> = []
  for (let iy = iy0; iy <= iy1; iy += 1) {
    for (let ix = ix0; ix <= ix1; ix += 1) {
      const fx = (ix + 0.5) / grid.width
      const fy = (iy + 0.5) / grid.height
      const lng = west + fx * (east - west)
      const lat = north - fy * (north - south)
      if (pointInRingLatLng(lng, lat, ringLatLng)) out.push({ ix, iy, lng, lat })
    }
  }
  return out
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function edgeSamplePoints(ringLatLng: [number, number][], stepM: number): Array<{ lat: number; lng: number }> {
  const pts: Array<{ lat: number; lng: number }> = []
  const R = 6_371_000
  for (let i = 0; i < ringLatLng.length - 1; i += 1) {
    const [lat0, lng0] = ringLatLng[i]
    const [lat1, lng1] = ringLatLng[i + 1]
    const dx = (lng1 - lng0) * Math.cos(((lat0 + lat1) / 2) * (Math.PI / 180)) * (Math.PI / 180) * R
    const dy = (lat1 - lat0) * (Math.PI / 180) * R
    const len = Math.max(1e-6, Math.hypot(dx, dy))
    const n = Math.max(2, Math.ceil(len / stepM))
    for (let k = 0; k <= n; k += 1) {
      const t = k / n
      pts.push({ lat: lat0 + (lat1 - lat0) * t, lng: lng0 + (lng1 - lng0) * t })
    }
  }
  return pts
}

export type LidarBuildingMetrics = {
  heightM: number
  roofType: 'flat' | 'pitched' | 'hipped' | 'complex'
  meanDsmInside: number
  meanDtmEdge: number
}

export function metricsFromLidarGrids(
  dtm: LidarElevationGrid,
  dsm: LidarElevationGrid,
  footprintRingLatLng: [number, number][]
): LidarBuildingMetrics | null {
  const inside = gridCellsInPolygon(dsm, footprintRingLatLng)
  if (inside.length < 2) return null
  const dsmVals: number[] = []
  for (const c of inside) {
    const v = dsm.data[c.iy * dsm.width + c.ix]
    if (Number.isFinite(v)) dsmVals.push(v)
  }
  if (dsmVals.length < 2) return null

  const edgePts = edgeSamplePoints(footprintRingLatLng, 1.5)
  const dtmEdge: number[] = []
  for (const p of edgePts) {
    const v = sampleGridLngLat(dtm, p.lng, p.lat)
    if (Number.isFinite(v)) dtmEdge.push(v)
  }
  if (!dtmEdge.length) return null

  const meanDsmInside = mean(dsmVals)
  const meanDtmEdge = mean(dtmEdge)
  const heightM = Math.max(0, meanDsmInside - meanDtmEdge)
  const s = stdDev(dsmVals)
  let roofType: LidarBuildingMetrics['roofType'] = 'complex'
  if (s < 0.5) roofType = 'flat'
  else {
    const cx = inside.reduce((s2, c) => s2 + c.lng, 0) / inside.length
    const cy = inside.reduce((s2, c) => s2 + c.lat, 0) / inside.length
    let sumC = 0
    let sumE = 0
    let nearCentre = 0
    let nearEdge = 0
    const dists = inside.map((c) => Math.hypot((c.lng - cx) * 85_000, (c.lat - cy) * 111_000))
    const sorted = [...dists].sort((a, b) => a - b)
    const thresh = sorted[Math.floor(sorted.length * 0.35)] ?? sorted[0]
    for (let i = 0; i < inside.length; i += 1) {
      const v = dsm.data[inside[i].iy * dsm.width + inside[i].ix]
      if (!Number.isFinite(v)) continue
      if (dists[i] <= thresh) {
        sumC += v
        nearCentre += 1
      } else {
        sumE += v
        nearEdge += 1
      }
    }
    const centreAvg = nearCentre ? sumC / nearCentre : meanDsmInside
    const edgeAvg = nearEdge ? sumE / nearEdge : meanDsmInside
    if (centreAvg > edgeAvg + 1.5) roofType = 'pitched'
    else if (centreAvg > edgeAvg + 0.6 && s >= 0.5) roofType = 'hipped'
  }

  return { heightM, roofType, meanDsmInside, meanDtmEdge }
}

export type LidarTreeCandidate = {
  lat: number
  lng: number
  heightM: number
  crownDiameterM: number
}

/** Simple blob extraction on canopy height grid (DSM − DTM). */
export function extractLidarTrees(
  dtm: LidarElevationGrid,
  dsm: LidarElevationGrid,
  buildingRings: [number, number][][],
  minCanopyM = 2
): LidarTreeCandidate[] {
  const w = dtm.width
  const h = dtm.height
  const diff = new Float32Array(w * h)
  for (let i = 0; i < w * h; i += 1) {
    const a = dsm.data[i]
    const b = dtm.data[i]
    diff[i] = Number.isFinite(a) && Number.isFinite(b) ? a - b : Number.NaN
  }

  const inBuilding = (lng: number, lat: number) =>
    buildingRings.some((ring) => ring.length >= 3 && pointInRingLatLng(lng, lat, ring))

  const [west, south, east, north] = dtm.bbox
  const visited = new Uint8Array(w * h)
  const trees: LidarTreeCandidate[] = []

  const idx = (ix: number, iy: number) => iy * w + ix
  for (let iy = 0; iy < h; iy += 1) {
    for (let ix = 0; ix < w; ix += 1) {
      const i = idx(ix, iy)
      if (visited[i]) continue
      const can = diff[i]
      if (!Number.isFinite(can) || can < minCanopyM) continue
      const fx = (ix + 0.5) / w
      const fy = (iy + 0.5) / h
      const lng = west + fx * (east - west)
      const lat = north - fy * (north - south)
      if (inBuilding(lng, lat)) continue

      const stack: number[] = [i]
      visited[i] = 1
      let minIx = ix
      let maxIx = ix
      let minIy = iy
      let maxIy = iy
      let sumLng = 0
      let sumLat = 0
      let maxH = can
      let count = 0
      while (stack.length) {
        const cur = stack.pop()!
        const ciy = Math.floor(cur / w)
        const cix = cur - ciy * w
        const fxx = (cix + 0.5) / w
        const fyy = (ciy + 0.5) / h
        const ln = west + fxx * (east - west)
        const la = north - fyy * (north - south)
        sumLng += ln
        sumLat += la
        count += 1
        const dv = diff[cur]
        if (Number.isFinite(dv) && dv > maxH) maxH = dv
        minIx = Math.min(minIx, cix)
        maxIx = Math.max(maxIx, cix)
        minIy = Math.min(minIy, ciy)
        maxIy = Math.max(maxIy, ciy)
        const neigh = [
          [cix + 1, ciy],
          [cix - 1, ciy],
          [cix, ciy + 1],
          [cix, ciy - 1],
        ] as const
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const ni = idx(nx, ny)
          if (visited[ni]) continue
          const d = diff[ni]
          if (!Number.isFinite(d) || d < minCanopyM) continue
          const fnx = (nx + 0.5) / w
          const fny = (ny + 0.5) / h
          const nln = west + fnx * (east - west)
          const nla = north - fny * (north - south)
          if (inBuilding(nln, nla)) continue
          visited[ni] = 1
          stack.push(ni)
        }
      }
      if (count < 3) continue
      const clat = sumLat / count
      const clng = sumLng / count
      const cellW = ((east - west) / w) * 111_000 * Math.cos((clat * Math.PI) / 180)
      const cellH = ((north - south) / h) * 111_000
      const blobW = (maxIx - minIx + 1) * cellW
      const blobH = (maxIy - minIy + 1) * cellH
      const crown = Math.max(2, (blobW + blobH) / 2)
      trees.push({ lat: clat, lng: clng, heightM: Math.min(45, maxH + 1), crownDiameterM: crown })
    }
  }
  return trees
}

type Pt = [number, number]

function pixelToLngLat(grid: LidarElevationGrid, ix: number, iy: number): { lng: number; lat: number } {
  const [west, south, east, north] = grid.bbox
  const fx = ix / Math.max(1, grid.width - 1)
  const fy = iy / Math.max(1, grid.height - 1)
  return {
    lng: west + fx * (east - west),
    lat: north - fy * (north - south),
  }
}

function marchingCell(
  p0: Pt,
  p1: Pt,
  p2: Pt,
  p3: Pt,
  z0: number,
  z1: number,
  z2: number,
  z3: number,
  level: number
): Array<[Pt, Pt]> {
  const cuts: Pt[] = []
  const cross = (a: Pt, b: Pt, za: number, zb: number) => {
    const da = za - level
    const db = zb - level
    if ((da < 0 && db < 0) || (da > 0 && db > 0) || !Number.isFinite(za) || !Number.isFinite(zb)) return
    const t = Math.abs(zb - za) < 1e-9 ? 0.5 : (level - za) / (zb - za)
    if (t >= 0 && t <= 1) cuts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  cross(p0, p1, z0, z1)
  cross(p1, p2, z1, z2)
  cross(p2, p3, z2, z3)
  cross(p3, p0, z3, z0)
  if (cuts.length === 2) return [[cuts[0], cuts[1]]]
  if (cuts.length === 4) return [[cuts[0], cuts[1]], [cuts[2], cuts[3]]]
  return []
}

function stitchSegs(segs: Array<[Pt, Pt]>, tol: number): Pt[][] {
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const out: Pt[][] = []
  for (const [a, b] of segs) {
    let merged = false
    for (const line of out) {
      const first = line[0]
      const last = line[line.length - 1]
      if (d(last, a) <= tol) {
        line.push(b)
        merged = true
        break
      }
      if (d(last, b) <= tol) {
        line.push(a)
        merged = true
        break
      }
      if (d(first, b) <= tol) {
        line.unshift(a)
        merged = true
        break
      }
      if (d(first, a) <= tol) {
        line.unshift(b)
        merged = true
        break
      }
    }
    if (!merged) out.push([a, b])
  }
  return out.filter((l) => l.length > 1)
}

export type LidarContourFeature = {
  type: 'Feature'
  properties: { elevation: number }
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

/** Contours as GeoJSON-ready polylines in WGS84 [lng,lat][]. */
export function contoursFromDtmGrid(grid: LidarElevationGrid, interval: number): LidarContourFeature[] {
  const w = grid.width
  const h = grid.height
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let i = 0; i < grid.data.length; i += 1) {
    const z = grid.data[i]
    if (Number.isFinite(z)) {
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
  }
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) return []
  const start = Math.ceil(minZ / interval) * interval
  const features: LidarContourFeature[] = []
  const tol =
    Math.max(
      (grid.bbox[2] - grid.bbox[0]) / w,
      (grid.bbox[3] - grid.bbox[1]) / h
    ) * 0.8

  for (let level = start; level <= maxZ + 1e-9; level += interval) {
    const segs: Array<[Pt, Pt]> = []
    for (let iy = 0; iy < h - 1; iy += 1) {
      for (let ix = 0; ix < w - 1; ix += 1) {
        const z0 = grid.data[iy * w + ix]
        const z1 = grid.data[iy * w + ix + 1]
        const z2 = grid.data[(iy + 1) * w + ix + 1]
        const z3 = grid.data[(iy + 1) * w + ix]
        if (![z0, z1, z2, z3].every(Number.isFinite)) continue
        const ll0 = pixelToLngLat(grid, ix, iy)
        const ll1 = pixelToLngLat(grid, ix + 1, iy)
        const ll2 = pixelToLngLat(grid, ix + 1, iy + 1)
        const ll3 = pixelToLngLat(grid, ix, iy + 1)
        const p0: Pt = [ll0.lng, ll0.lat]
        const p1: Pt = [ll1.lng, ll1.lat]
        const p2: Pt = [ll2.lng, ll2.lat]
        const p3: Pt = [ll3.lng, ll3.lat]
        segs.push(...marchingCell(p0, p1, p2, p3, z0, z1, z2, z3, level))
      }
    }
    const lines = stitchSegs(segs, tol)
    for (const line of lines) {
      if (line.length < 2) continue
      features.push({
        type: 'Feature',
        properties: { elevation: Number(level.toFixed(2)) },
        geometry: {
          type: 'LineString',
          coordinates: line.map(([lng, lat]) => [lng, lat]),
        },
      })
    }
  }
  return features
}

/** Local metres from site for laser-cut DXF (same convention as LaserCutModule). */
export function contoursLocalMFromGrid(
  siteLat: number,
  siteLng: number,
  grid: LidarElevationGrid,
  radiusM: number,
  interval: number
): Array<{ level: number; lines: Pt[][] }> {
  const half = radiusM
  const step = Math.max(2, Math.min(6, radiusM / 35))
  const n = Math.floor((2 * half) / step) + 1
  const elev: number[][] = Array.from({ length: n }, () => Array(n).fill(Number.NaN))
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let yi = 0; yi < n; yi += 1) {
    for (let xi = 0; xi < n; xi += 1) {
      const xM = -half + xi * step
      const yM = -half + yi * step
      const lat = siteLat + offsetLatMeters(yM)
      const lng = siteLng + offsetLngMeters(siteLat, xM)
      const z = sampleGridLngLat(grid, lng, lat)
      if (Number.isFinite(z)) {
        elev[yi][xi] = z
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
    }
  }
  if (!Number.isFinite(minZ)) return []
  const start = Math.ceil(minZ / interval) * interval
  const out: Array<{ level: number; lines: Pt[][] }> = []
  for (let level = start; level <= maxZ + 1e-9; level += interval) {
    const segs: Array<[Pt, Pt]> = []
    for (let yi = 0; yi < n - 1; yi += 1) {
      for (let xi = 0; xi < n - 1; xi += 1) {
        const p0: Pt = [-half + xi * step, -half + yi * step]
        const p1: Pt = [-half + (xi + 1) * step, -half + yi * step]
        const p2: Pt = [-half + (xi + 1) * step, -half + (yi + 1) * step]
        const p3: Pt = [-half + xi * step, -half + (yi + 1) * step]
        const z0 = elev[yi][xi]
        const z1 = elev[yi][xi + 1]
        const z2 = elev[yi + 1][xi + 1]
        const z3 = elev[yi + 1][xi]
        if (![z0, z1, z2, z3].every(Number.isFinite)) continue
        segs.push(...marchingCell(p0, p1, p2, p3, z0, z1, z2, z3, level))
      }
    }
    const lines = stitchSegs(segs, step * 0.55)
    if (lines.length) out.push({ level: Number(level.toFixed(2)), lines })
  }
  return out
}

/** Indicative Scotland — for coverage messaging only (national LiDAR portals). */
export function isScotlandRough(lat: number, lng: number): boolean {
  return lat >= 54.5 && lat <= 60.9 && lng >= -8.2 && lng <= -0.4
}

export function terrainCellSizeMetersApprox(grid: LidarElevationGrid, refLat: number): number {
  const [west, south, east, north] = grid.bbox
  const w = Math.max(1, grid.width - 1)
  const h = Math.max(1, grid.height - 1)
  const dxM = ((east - west) / w) * 111_320 * Math.cos((refLat * Math.PI) / 180)
  const dyM = ((north - south) / h) * 111_320
  return Math.max(dxM, dyM)
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const a0 = toRad(aLat)
  const b0 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a0) * Math.cos(b0) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function minDistFeatureToSiteM(
  feature: LidarContourFeature,
  siteLat: number,
  siteLng: number
): number {
  let d = Number.POSITIVE_INFINITY
  for (const [lng, lat] of feature.geometry.coordinates) {
    d = Math.min(d, haversineM(siteLat, siteLng, lat, lng))
  }
  return d
}

function isIndexContourElevation(elevation: number): boolean {
  const q = elevation / 5
  return Math.abs(q - Math.round(q)) < 0.08
}

export type OsTerrainContourFeature = LidarContourFeature & {
  properties: { elevation: number; kind: 'index' | 'form' }
}

/**
 * OS-style terrain contours: 0.25 m inside ~200 m of site when grid is fine enough; 1 m beyond.
 * Index contours (every 5 m) tagged for thicker stroke.
 */
export function terrainContoursOsStyle(
  grid: LidarElevationGrid,
  siteLat: number,
  siteLng: number
): OsTerrainContourFeature[] {
  const cellM = terrainCellSizeMetersApprox(grid, siteLat)
  const useFine = cellM <= 3
  const out: OsTerrainContourFeature[] = []
  if (useFine) {
    const fine = contoursFromDtmGrid(grid, 0.25)
    for (const f of fine) {
      if (minDistFeatureToSiteM(f, siteLat, siteLng) > 200) continue
      const k = isIndexContourElevation(f.properties.elevation) ? 'index' : 'form'
      out.push({ ...f, properties: { elevation: f.properties.elevation, kind: k } })
    }
  }
  const coarse = contoursFromDtmGrid(grid, 1)
  for (const f of coarse) {
    if (useFine && minDistFeatureToSiteM(f, siteLat, siteLng) <= 200) continue
    const k = isIndexContourElevation(f.properties.elevation) ? 'index' : 'form'
    out.push({ ...f, properties: { elevation: f.properties.elevation, kind: k } })
  }
  return out
}

export type SlopeBucket = 'flat' | 'gentle' | 'moderate' | 'steep' | 'very'

function slopeBucket(deg: number): SlopeBucket {
  if (deg <= 2) return 'flat'
  if (deg <= 5) return 'gentle'
  if (deg <= 10) return 'moderate'
  if (deg <= 20) return 'steep'
  return 'very'
}

const SLOPE_COLORS: Record<SlopeBucket, string> = {
  flat: 'rgba(255,255,255,0.35)',
  gentle: 'rgba(255,253,200,0.45)',
  moderate: 'rgba(255,200,100,0.5)',
  steep: 'rgba(255,140,60,0.55)',
  very: 'rgba(220,50,40,0.58)',
}

/** Fill quads on DTM with slope (degrees) and bucket for Mapbox fill layer. */
export function slopeGeoJsonFromGrid(
  grid: LidarElevationGrid,
  siteLat: number,
  siteLng: number,
  maxRadiusM: number,
  strideCells: number
): GeoJSON.FeatureCollection {
  const [west, south, east, north] = grid.bbox
  const w = grid.width
  const h = grid.height
  const st = Math.max(1, strideCells)
  const features: GeoJSON.Feature[] = []
  const midLat = siteLat
  const cellXM = ((east - west) / Math.max(1, w - 1)) * 111_320 * Math.cos((midLat * Math.PI) / 180)
  const cellYM = ((north - south) / Math.max(1, h - 1)) * 111_320

  for (let iy = st; iy < h - st; iy += st) {
    for (let ix = st; ix < w - st; ix += st) {
      const ll = pixelToLngLat(grid, ix, iy)
      if (haversineM(siteLat, siteLng, ll.lat, ll.lng) > maxRadiusM) continue
      const zc = grid.data[iy * w + ix]
      const ze = grid.data[iy * w + ix + st]
      const zw = grid.data[iy * w + ix - st]
      const zn = grid.data[(iy - st) * w + ix]
      const zs = grid.data[(iy + st) * w + ix]
      if (![zc, ze, zw, zn, zs].every(Number.isFinite)) continue
      const dzdx = (ze - zw) / (2 * st * cellXM)
      const dzdy = (zs - zn) / (2 * st * cellYM)
      const deg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI
      const bucket = slopeBucket(deg)
      const llNW = pixelToLngLat(grid, ix - st / 2, iy - st / 2)
      const llNE = pixelToLngLat(grid, ix + st / 2, iy - st / 2)
      const llSE = pixelToLngLat(grid, ix + st / 2, iy + st / 2)
      const llSW = pixelToLngLat(grid, ix - st / 2, iy + st / 2)
      const ring: [number, number][] = [
        [llNW.lng, llNW.lat],
        [llNE.lng, llNE.lat],
        [llSE.lng, llSE.lat],
        [llSW.lng, llSW.lat],
        [llNW.lng, llNW.lat],
      ]
      features.push({
        type: 'Feature',
        properties: {
          slope_deg: Number(deg.toFixed(2)),
          bucket,
          color: SLOPE_COLORS[bucket],
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function terrainCoverageSummary(lat: number, lng: number): string {
  if (isEwLidarCoverage(lat, lng)) return 'LiDAR 1m ✓ England/Wales'
  if (isScotlandRough(lat, lng)) return 'LiDAR 0.5m — use Scotland national portal'
  return 'Open-Meteo / Mapbox terrain (no tile DEM)'
}
