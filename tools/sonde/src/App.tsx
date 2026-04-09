import 'mapbox-gl/dist/mapbox-gl.css'
import mapboxgl from 'mapbox-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import SunCalc from 'suncalc'
import { AddressSearch } from './components/AddressSearch'
import { BaseMapModule } from './components/BaseMapModule'
import { BuiltEnvironmentModule } from './components/BuiltEnvironmentModule'
import { ClimateModule } from './components/ClimateModule'
import { DemographicsModule } from './components/DemographicsModule'
import { EcologyEnvironmentModule } from './components/EcologyEnvironmentModule'
import { ExportModule } from './components/ExportModule'
import { FloodModule } from './components/FloodModule'
import { GroundModule } from './components/GroundModule'
import { LaserCutModule } from './components/LaserCutModule'
import { LocalIntelModule } from './components/LocalIntelModule'
import { ModuleErrorBoundary } from './components/ModuleErrorBoundary'
import { MovementTransportModule } from './components/MovementTransportModule'
import { ObservationTemplatesModule } from './components/ObservationTemplatesModule'
import { PlanningPolicyModule } from './components/PlanningPolicyModule'
import { PrecedentsModule } from './components/PrecedentsModule'
import { SolarModule } from './components/SolarModule'
import { StatusDot } from './components/StatusDot'
import { WindModule } from './components/WindModule'
import { useBuiltEnvironmentData } from './hooks/useBuiltEnvironmentData'
import { useClimateData } from './hooks/useClimateData'
import { useDemographicsData } from './hooks/useDemographicsData'
import { useEcologyData } from './hooks/useEcologyData'
import { useFloodData } from './hooks/useFloodData'
import { useGroundData } from './hooks/useGroundData'
import { useMovementData } from './hooks/useMovementData'
import { useOSMData } from './hooks/useOSMData'
import { usePlanningData } from './hooks/usePlanningData'
import { useSolarData } from './hooks/useSolarData'
import { useWindData } from './hooks/useWindData'
import { getOverpassSourceStatus, subscribeOverpassSource } from './utils/overpass'
import { azimuthSouthToNorthDeg } from './utils/sunCalc'
import type { ModuleId, SavedSite, SiteLocation, StatusTone } from './types'

const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'solar', label: 'Solar' },
  { id: 'wind', label: 'Wind' },
  { id: 'climate', label: 'Climate' },
  { id: 'flood', label: 'Flood' },
  { id: 'ground', label: 'Ground' },
  { id: 'lasercut', label: 'Laser Cut' },
  { id: 'planning', label: 'Planning' },
  { id: 'demographics', label: 'Demographics' },
  { id: 'movement', label: 'Movement' },
  { id: 'ecology', label: 'Ecology' },
  { id: 'built', label: 'Built' },
  { id: 'templates', label: 'Templates' },
  { id: 'precedents', label: 'Precedents' },
  { id: 'basemap', label: 'Base map' },
  { id: 'localIntel', label: 'Local Intel' },
  { id: 'export', label: 'Export' },
]

const SECTION_SOURCE_ID = 'sonde-section-source'
const SECTION_LINE_LAYER_ID = 'sonde-section-line'
const SECTION_POINT_LAYER_ID = 'sonde-section-points'
const TERRAIN_SOURCE_ID = 'sonde-dem'
const OSM_BUILDING_SOURCE_ID = 'sonde-osm-buildings'
const OSM_BUILDING_LAYER_ID = 'sonde-osm-buildings-3d'
const MAPBOX_BUILDING_LAYER_ID = '3d-buildings'
const SITE_BUILDING_LAYER_ID = 'site-building'
const SONDE_DYNAMIC_SOURCE_ID = 'sonde-dynamic-overlays'
const TREE_SOURCE_ID = 'sonde-tree-points'
const TREE_LAYER_ID = 'sonde-tree-canopy-2d'
const TREE_TRUNK_LAYER_ID = 'sonde-tree-trunks-3d'
const TREE_CANOPY_LAYER_ID = 'sonde-tree-canopy-3d'
const TREE_LABEL_LAYER_ID = 'sonde-tree-label'
const SHADOW_SOURCE_ID = 'sonde-shadow-source'
const SHADOW_LAYER_ID = 'sonde-shadow-layer'
const ROOF_CONTOUR_SOURCE_ID = 'sonde-roof-contours'
const ROOF_CONTOUR_LAYER_ID = 'sonde-roof-contours-line'
const HISTORICAL_SOURCE_ID = 'sonde-historical-source'
const HISTORICAL_LAYER_ID = 'sonde-historical-layer'
const SAVED_SITES_KEY = 'sonde_saved_sites'
const BASIC_3D_BUILDINGS_ONLY = true
const DEFAULT_SITE: SiteLocation = {
  lat: 51.4914,
  lng: -3.1819,
  name: 'Lidl Maindy Road',
  address: 'Lidl, Maindy Road, Cardiff CF24 4HQ',
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

function dayIndexFromDate(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000)
}

function dayOfYearDate(year: number, dayIndex: number): Date {
  return new Date(year, 0, 1 + dayIndex, 12, 0, 0, 0)
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

function pointInPolygon(point: [number, number], ring: [number, number][]): boolean {
  let inside = false
  const x = point[0]
  const y = point[1]
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function segmentIntersectionT(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number]
): number | null {
  const r: [number, number] = [b[0] - a[0], b[1] - a[1]]
  const s: [number, number] = [d[0] - c[0], d[1] - c[1]]
  const rxs = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(rxs) < 1e-12) return null
  const qp: [number, number] = [c[0] - a[0], c[1] - a[1]]
  const t = (qp[0] * s[1] - qp[1] * s[0]) / rxs
  const u = (qp[0] * r[1] - qp[1] * r[0]) / rxs
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t
  return null
}

function centroidLatLng(ring: [number, number][]): { lat: number; lng: number } {
  let lat = 0
  let lng = 0
  for (const [pLat, pLng] of ring) {
    lat += pLat
    lng += pLng
  }
  const n = Math.max(1, ring.length)
  return { lat: lat / n, lng: lng / n }
}

function projectLngLatMeters(lng: number, lat: number, bearingDeg: number, distanceM: number): [number, number] {
  const br = (bearingDeg * Math.PI) / 180
  const dLat = (distanceM * Math.cos(br)) / 111_320
  const dLng = (distanceM * Math.sin(br)) / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [lng + dLng, lat + dLat]
}

function buildingHeightKey(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`
}

async function fetchDefraLidarHeightM(lat: number, lng: number): Promise<number | null> {
  const parseArcgisValue = (json: unknown): number | null => {
    const j = json as { value?: number | string; properties?: { Values?: number[] } }
    const v =
      typeof j.value === 'number'
        ? j.value
        : typeof j.value === 'string'
          ? Number(j.value)
          : Array.isArray(j.properties?.Values)
            ? Number(j.properties!.Values[0])
            : Number.NaN
    return Number.isFinite(v) ? v : null
  }
  const cacheKey = `lidar_${lat.toFixed(4)}_${lng.toFixed(4)}`
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached) as { dsm: number | null; dtm: number | null; height: number | null }
      return parsed.height ?? null
    }
  } catch {
    // ignore cache parse errors
  }
  try {
    const dsmUrl = new URL(
      'https://environment.data.gov.uk/arcgis/rest/services/EA/LidarComposite_DSM_2022/ImageServer/identify'
    )
    dsmUrl.searchParams.set('geometry', `${lng},${lat}`)
    dsmUrl.searchParams.set('geometryType', 'esriGeometryPoint')
    dsmUrl.searchParams.set('returnGeometry', 'false')
    dsmUrl.searchParams.set('f', 'json')
    const dtmUrl = new URL(
      'https://environment.data.gov.uk/arcgis/rest/services/EA/LidarComposite_DTM_2022/ImageServer/identify'
    )
    dtmUrl.searchParams.set('geometry', `${lng},${lat}`)
    dtmUrl.searchParams.set('geometryType', 'esriGeometryPoint')
    dtmUrl.searchParams.set('returnGeometry', 'false')
    dtmUrl.searchParams.set('f', 'json')
    const [dsmRes, dtmRes] = await Promise.all([fetch(dsmUrl.toString()), fetch(dtmUrl.toString())])
    if (!dsmRes.ok || !dtmRes.ok) return null
    const dsm = parseArcgisValue(await dsmRes.json())
    const dtm = parseArcgisValue(await dtmRes.json())
    const height = dsm != null && dtm != null ? Math.max(0, dsm - dtm) : null
    localStorage.setItem(cacheKey, JSON.stringify({ dsm, dtm, height }))
    return height
  } catch {
    return null
  }
}

function niceTickStep(range: number, targetTicks = 6): number {
  if (range <= 0) return 1
  const rough = range / Math.max(1, targetTicks)
  const pow10 = 10 ** Math.floor(Math.log10(rough))
  const scaled = rough / pow10
  const nice =
    scaled <= 1 ? 1 :
    scaled <= 2 ? 2 :
    scaled <= 5 ? 5 :
    10
  return nice * pow10
}

function siteId(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`
}

type SectionPoint = { lng: number; lat: number }
type ElevationSample = { lng: number; lat: number; distanceM: number; elevationM: number }
type SectionScale = '1:100' | '1:200' | '1:500' | '1:1000'
type SectionPreviewTheme = 'dark' | 'light'
type ServiceStatus = 'ok' | 'error' | 'loading'
type LidarBuildingData = {
  buildingId: string
  footprint: [number, number][]
  lidarGrid: { width: number; height: number; resolution: number; dsm: number[]; dtm: number[]; roofHeights: number[] }
  contours: Array<{ elevation: number; path: [number, number][] }>
  maxHeight: number
  roofType?: string
}

function toneForModule(
  id: ModuleId,
  site: SiteLocation | null,
  wind: ReturnType<typeof useWindData>,
  climate: ReturnType<typeof useClimateData>,
  flood: ReturnType<typeof useFloodData>,
  ground: ReturnType<typeof useGroundData>,
  osm: ReturnType<typeof useOSMData>,
  planning: ReturnType<typeof usePlanningData>,
  demographics: ReturnType<typeof useDemographicsData>,
  movement: ReturnType<typeof useMovementData>,
  ecology: ReturnType<typeof useEcologyData>,
  built: ReturnType<typeof useBuiltEnvironmentData>
): StatusTone {
  if (!site) return 'amber'
  switch (id) {
    case 'solar':
      return 'green'
    case 'wind':
      if (wind.status === 'ok') return 'green'
      if (wind.status === 'error') return 'red'
      return 'amber'
    case 'climate':
      if (climate.status === 'ok') return 'green'
      if (climate.status === 'error') return 'red'
      return 'amber'
    case 'flood':
      if (flood.status === 'ok') return 'green'
      if (flood.status === 'error') return 'red'
      return 'amber'
    case 'ground':
      if (ground.status === 'ok') return 'green'
      if (ground.status === 'error') return 'amber'
      return 'amber'
    case 'lasercut':
      if (osm.status === 'ok') return 'green'
      if (osm.status === 'error') return 'red'
      return 'amber'
    case 'basemap':
      if (osm.status === 'ok') return 'green'
      if (osm.status === 'error') return 'red'
      return 'amber'
    case 'localIntel':
      return site ? 'green' : 'amber'
    case 'planning':
      if (planning.status === 'ok') return 'green'
      if (planning.status === 'error') return 'red'
      return 'amber'
    case 'demographics':
      if (demographics.status === 'ok') return 'green'
      if (demographics.status === 'error') return 'red'
      return 'amber'
    case 'movement':
      if (movement.status === 'ok') return 'green'
      if (movement.status === 'error') return 'red'
      return 'amber'
    case 'ecology':
      if (ecology.status === 'ok') return 'green'
      if (ecology.status === 'error') return 'red'
      return 'amber'
    case 'built':
      if (built.status === 'ok') return 'green'
      if (built.status === 'error') return 'red'
      return 'amber'
    case 'templates':
      return site ? 'green' : 'amber'
    case 'precedents':
      return site ? 'amber' : 'amber'
    case 'export':
      return 'green'
    default:
      return 'amber'
  }
}

function bearingDeg(a: SectionPoint, b: SectionPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat))
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function nearestCardinalForView(
  bearing: number
): {
  forward: 'North' | 'Northeast' | 'East' | 'Southeast' | 'South' | 'Southwest' | 'West' | 'Northwest'
  backward: 'North' | 'Northeast' | 'East' | 'Southeast' | 'South' | 'Southwest' | 'West' | 'Northwest'
  forwardArrow: string
  backwardArrow: string
} {
  const dirs = [
    { label: 'North', arrow: '↑' },
    { label: 'Northeast', arrow: '↗' },
    { label: 'East', arrow: '→' },
    { label: 'Southeast', arrow: '↘' },
    { label: 'South', arrow: '↓' },
    { label: 'Southwest', arrow: '↙' },
    { label: 'West', arrow: '←' },
    { label: 'Northwest', arrow: '↖' },
  ] as const
  const idx = Math.round((bearing % 360) / 45) % 8
  const opp = (idx + 4) % 8
  return {
    forward: dirs[idx].label,
    backward: dirs[opp].label,
    forwardArrow: dirs[idx].arrow,
    backwardArrow: dirs[opp].arrow,
  }
}

function inferRoofFromTags(buildingType?: string, roofShape?: string): { type: string; source: string } {
  const rs = (roofShape ?? '').toLowerCase()
  if (rs) return { type: rs.charAt(0).toUpperCase() + rs.slice(1), source: 'OSM roof:shape tag' }
  const t = (buildingType ?? '').toLowerCase()
  if (t.includes('house') || t.includes('terrace') || t.includes('detached') || t.includes('church')) return { type: 'Gabled', source: 'detected from building type' }
  if (t.includes('retail') || t.includes('supermarket') || t.includes('industrial') || t.includes('warehouse') || t.includes('commercial')) return { type: 'Flat', source: 'detected from building type' }
  return { type: 'Flat', source: 'default' }
}

export default function App() {
  const token = (import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim()
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null)
  const [site, setSite] = useState<SiteLocation | null>(DEFAULT_SITE)
  const [active, setActive] = useState<ModuleId>('solar')
  const [radiusM, setRadiusM] = useState(100)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [is3DView, setIs3DView] = useState(false)
  const [shadowDayIndex, setShadowDayIndex] = useState(dayIndexFromDate(new Date()))
  const [shadowDayProgress, setShadowDayProgress] = useState(500)
  const [shadowAnimating, setShadowAnimating] = useState(false)
  const [dfWindowW, setDfWindowW] = useState(2.4)
  const [dfWindowH, setDfWindowH] = useState(1.8)
  const [dfRoomDepth, setDfRoomDepth] = useState(6)
  const [dfObstructionDeg, setDfObstructionDeg] = useState(28)
  const [sectionMode, setSectionMode] = useState(false)
  const [sectionPoints, setSectionPoints] = useState<SectionPoint[]>([])
  const [sectionProfile, setSectionProfile] = useState<ElevationSample[] | null>(null)
  const [sectionScale, setSectionScale] = useState<SectionScale>('1:200')
  const [sectionFlip, setSectionFlip] = useState(false)
  const [sectionPreviewTheme, setSectionPreviewTheme] = useState<SectionPreviewTheme>('dark')
  const [savedSites, setSavedSites] = useState<SavedSite[]>([])
  const [savedSitesOpen, setSavedSitesOpen] = useState(false)
  const [lidarHeightsByKey, setLidarHeightsByKey] = useState<Record<string, number>>({})
  const [lidarByBuilding, setLidarByBuilding] = useState<Record<string, LidarBuildingData>>({})
  const [treesEnabled, setTreesEnabled] = useState(false)
  const [roofContoursEnabled, setRoofContoursEnabled] = useState(false)
  const [lidarHeightsEnabled, setLidarHeightsEnabled] = useState(true)
  const [treeStatus, setTreeStatus] = useState('')
  const [lidarStatus, setLidarStatus] = useState('')
  const [mapPipelineStatus, setMapPipelineStatus] = useState('Loading: buildings… trees… shadows…')
  const [mapPipelineUpdatedAt, setMapPipelineUpdatedAt] = useState<Date | null>(null)
  const [showBusStops, setShowBusStops] = useState(false)
  const [showCycleRoutes, setShowCycleRoutes] = useState(false)
  const [showWalkIsochrones, setShowWalkIsochrones] = useState(false)
  const [historicalEnabled, setHistoricalEnabled] = useState(false)
  const [historicalYear, setHistoricalYear] = useState<'1890' | '1950' | 'modern'>('modern')
  const [historicalOpacity, setHistoricalOpacity] = useState(0.45)
  const [claudeStatus, setClaudeStatus] = useState<ServiceStatus>('loading')
  const urlSiteAppliedRef = useRef(false)

  const apiSite = site && !(site.lat === 0 && site.lng === 0) ? site : null
  const solar = useSolarData(apiSite)
  const wind = useWindData(apiSite)
  const climate = useClimateData(apiSite)
  const flood = useFloodData(apiSite, 5)
  const ground = useGroundData(apiSite, 0)
  const planning = usePlanningData(apiSite)
  const demographics = useDemographicsData(apiSite)
  const movement = useMovementData(apiSite)
  const ecology = useEcologyData(apiSite)
  const built = useBuiltEnvironmentData(apiSite)
  const osm = useOSMData(apiSite, radiusM)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_SITES_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as SavedSite[]
      if (Array.isArray(parsed)) setSavedSites(parsed)
    } catch {
      /* ignore corrupt local data */
    }
  }, [])

  const persistSavedSites = useCallback((next: SavedSite[]) => {
    setSavedSites(next)
    try {
      localStorage.setItem(SAVED_SITES_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable */
    }
  }, [])

  useEffect(() => {
    if (!token || !mapEl.current) return
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-3.1819, 51.4914],
      zoom: 15,
    })
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('load', () => {
      map.resize()
      setMapLoaded(true)
      // Basic fallback: only native Mapbox 3D buildings.
      if (!map.getLayer(MAPBOX_BUILDING_LAYER_ID) && map.getSource('composite')) {
        map.addLayer({
          id: MAPBOX_BUILDING_LAYER_ID,
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#aaaaaa',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.9,
          },
        })
      }
    })
    map.on('style.load', () => {
      if (!map.getLayer(MAPBOX_BUILDING_LAYER_ID) && map.getSource('composite')) {
        map.addLayer({
          id: MAPBOX_BUILDING_LAYER_ID,
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#aaaaaa',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.9,
          },
        })
      }
      setMapLoaded(true)
    })
    mapRef.current = map
    setMapInstance(map)
    return () => {
      map.remove()
      mapRef.current = null
      setMapInstance(null)
      markerRef.current = null
      setMapLoaded(false)
    }
  }, [token])

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const lat = Number(p.get('lat'))
    const lng = Number(p.get('lng'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || urlSiteAppliedRef.current) return
    urlSiteAppliedRef.current = true
    const address = p.get('address') ?? ''
    const name = p.get('name') ?? ''
    setSite({
      lat,
      lng,
      address: address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      name: name.trim() || address.split(',')[0]?.trim() || 'Shared site',
    })
  }, [])

  useEffect(() => {
    if (!mapLoaded) return
    const p = new URLSearchParams(window.location.search)
    const lat = Number(p.get('lat'))
    const lng = Number(p.get('lng'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const zoom = Number(p.get('zoom') ?? '15')
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: Number.isFinite(zoom) ? zoom : 15,
      essential: true,
    })
  }, [mapLoaded])

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    const timeout = window.setTimeout(() => ctrl.abort(), 7000)
    ;(async () => {
      setClaudeStatus('loading')
      try {
        const res = await fetch('/anthropic-api/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: ctrl.signal,
        })
        if (cancelled) return
        setClaudeStatus(res.ok ? 'ok' : 'error')
      } catch {
        if (cancelled) return
        setClaudeStatus('error')
      } finally {
        window.clearTimeout(timeout)
      }
    })()
    return () => {
      cancelled = true
      ctrl.abort()
      window.clearTimeout(timeout)
    }
  }, [])

  const onSite = useCallback((s: SiteLocation) => {
    setSite(s)
    const map = mapRef.current
    if (!map) return
    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ color: '#E8621A' })
        .setLngLat([s.lng, s.lat])
        .addTo(map)
    } else {
      markerRef.current.setLngLat([s.lng, s.lat])
    }
  }, [])

  const saveCurrentSite = useCallback(() => {
    if (!site) return
    const id = siteId(site.lat, site.lng)
    const now = new Date().toISOString()
    const nextItem: SavedSite = {
      id,
      name: site.name || `${site.address}`,
      address: site.address,
      lat: site.lat,
      lng: site.lng,
      savedAt: now,
      notes: '',
      files: [],
      groundSnapshot:
        ground.status === 'ok'
          ? {
              updatedAt: new Date().toISOString(),
              summary: `${ground.data.superficialType} over ${ground.data.bedrockType}`,
              bearing: `${ground.data.bearing.classLabel} (${ground.data.bearing.capacityKpa} kPa)`,
              movement: Number.isFinite(ground.data.movementMeanMmYr)
                ? `${(ground.data.movementMeanMmYr as number).toFixed(2)} mm/yr`
                : 'n/a',
              madeGround: ground.data.madeGroundDetected,
            }
          : undefined,
    }
    const existing = savedSites.find((s) => s.id === id)
    const next = existing
      ? savedSites.map((s) => (s.id === id ? { ...nextItem, notes: s.notes, files: s.files } : s))
      : [nextItem, ...savedSites]
    persistSavedSites(next)
    setSavedSitesOpen(true)
  }, [site, savedSites, persistSavedSites, ground])

  const updateSavedSite = useCallback((id: string, patch: Partial<SavedSite>) => {
    persistSavedSites(savedSites.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [savedSites, persistSavedSites])

  const deleteSavedSite = useCallback((id: string) => {
    if (!confirm('Delete this saved site?')) return
    persistSavedSites(savedSites.filter((s) => s.id !== id))
  }, [savedSites, persistSavedSites])

  const loadSavedSite = useCallback((saved: SavedSite) => {
    onSite({
      name: saved.name,
      address: saved.address,
      lat: saved.lat,
      lng: saved.lng,
    })
    setSavedSitesOpen(false)
  }, [onSite])

  const recordExportedFile = useCallback((filename: string) => {
    if (!site) return
    const id = siteId(site.lat, site.lng)
    const current = savedSites.find((s) => s.id === id)
    if (!current) return
    if (current.files.includes(filename)) return
    updateSavedSite(id, { files: [...current.files, filename] })
  }, [site, savedSites, updateSavedSite])

  const buildShareUrl = useCallback(() => {
    if (!site) return ''
    const origin = (import.meta.env.VITE_SONDE_SHARE_ORIGIN ?? '').trim() || window.location.origin
    const u = new URL('/site', origin)
    u.searchParams.set('lat', String(site.lat))
    u.searchParams.set('lng', String(site.lng))
    u.searchParams.set('address', site.address)
    u.searchParams.set('name', site.name)
    const z = mapRef.current?.getZoom()
    u.searchParams.set(
      'zoom',
      String(z != null && Number.isFinite(z) ? Math.round(z * 10) / 10 : 15)
    )
    return u.toString()
  }, [site])

  const copyShareUrl = useCallback(async () => {
    const href = buildShareUrl()
    if (!href) return
    try {
      await navigator.clipboard.writeText(href)
      alert('Share link copied to clipboard.')
    } catch {
      window.prompt('Copy this link:', href)
    }
  }, [buildShareUrl])

  const shareSiteNative = useCallback(() => {
    const href = buildShareUrl()
    if (!href || !site) return
    if (navigator.share) {
      void navigator
        .share({
          title: 'Sonde Site Analysis',
          text: site.name,
          url: href,
        })
        .catch(() => copyShareUrl())
    } else {
      void copyShareUrl()
    }
  }, [buildShareUrl, site, copyShareUrl])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const urlsByYear: Record<'1890' | '1950' | 'modern', string[]> = {
      '1890': ['https://geo.nls.uk/maps/os/1inch_2nd_ed/{z}/{x}/{y}.png'],
      '1950': ['https://geo.nls.uk/maps/os/seventh/{z}/{x}/{y}.png'],
      modern: [],
    }
    if (historicalEnabled) {
      if (!map.getSource(HISTORICAL_SOURCE_ID)) {
        map.addSource(HISTORICAL_SOURCE_ID, {
          type: 'raster',
          tiles: urlsByYear[historicalYear],
          tileSize: 256,
          attribution: 'National Library of Scotland',
        })
      } else {
        const src = map.getSource(HISTORICAL_SOURCE_ID) as mapboxgl.RasterTileSource
        src.setTiles(urlsByYear[historicalYear])
      }
      if (!map.getLayer(HISTORICAL_LAYER_ID)) {
        map.addLayer({
          id: HISTORICAL_LAYER_ID,
          type: 'raster',
          source: HISTORICAL_SOURCE_ID,
          paint: { 'raster-opacity': historicalOpacity },
        })
      } else {
        map.setPaintProperty(HISTORICAL_LAYER_ID, 'raster-opacity', historicalOpacity)
      }
    } else {
      if (map.getLayer(HISTORICAL_LAYER_ID)) map.removeLayer(HISTORICAL_LAYER_ID)
      if (map.getSource(HISTORICAL_SOURCE_ID)) map.removeSource(HISTORICAL_SOURCE_ID)
    }
  }, [mapLoaded, historicalEnabled, historicalYear, historicalOpacity])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !site) return
    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ color: '#E8621A' })
        .setLngLat([site.lng, site.lat])
        .addTo(map)
    } else {
      markerRef.current.setLngLat([site.lng, site.lat])
    }
  }, [mapInstance, site])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onResize = () => map.resize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mapInstance])

  const tones = useMemo(
    () =>
      MODULES.map((m) => ({
        id: m.id,
        tone: toneForModule(m.id, site, wind, climate, flood, ground, osm, planning, demographics, movement, ecology, built),
      })),
    [site, wind, climate, flood, ground, osm, planning, demographics, movement, ecology, built]
  )

  const toneMap = useMemo(() => Object.fromEntries(tones.map((t) => [t.id, t.tone])), [tones])

  const shadowState = useMemo(() => {
    if (!site) return null
    const year = new Date().getFullYear()
    const baseDate = dayOfYearDate(year, shadowDayIndex)
    const times = SunCalc.getTimes(baseDate, site.lat, site.lng)
    const sunriseMs = times.sunrise.getTime()
    const sunsetMs = times.sunset.getTime()
    if (!Number.isFinite(sunriseMs) || !Number.isFinite(sunsetMs)) return null
    const spanMs = Math.max(1, sunsetMs - sunriseMs)
    const tMs = sunriseMs + (shadowDayProgress / 1000) * spanMs
    const current = new Date(tMs)
    if (!Number.isFinite(current.getTime())) return null
    const p = SunCalc.getPosition(current, site.lat, site.lng)
    const altitude = toDeg(p.altitude)
    const azimuthFromNorth = azimuthSouthToNorthDeg(p.azimuth)
    if (!Number.isFinite(altitude) || !Number.isFinite(azimuthFromNorth)) return null
    return {
      date: baseDate,
      time: current,
      sunrise: times.sunrise,
      sunset: times.sunset,
      altitude,
      azimuthFromNorth,
    }
  }, [site, shadowDayIndex, shadowDayProgress])

  const selectedShadowDateTime = useMemo(() => shadowState?.time ?? null, [shadowState])

  const buildShadowFeatureCollection = useCallback(
    (at: Date): GeoJSON.FeatureCollection => {
      if (!site || osm.status !== 'ok') return { type: 'FeatureCollection', features: [] }
      const sun = SunCalc.getPosition(at, site.lat, site.lng)
      if (sun.altitude <= 0) return { type: 'FeatureCollection', features: [] }
      const shadowBearingRad = sun.azimuth + Math.PI
      const shadowBearingDeg = ((shadowBearingRad * 180) / Math.PI + 360) % 360
      const features: GeoJSON.Feature[] = []
      for (const b of osm.data.buildings.slice(0, 240)) {
        const ring = b.rings[0]
        if (!ring || ring.length < 4) continue
        const c = centroidLatLng(ring)
        const key = buildingHeightKey(c.lat, c.lng)
        const h = lidarHeightsByKey[key] ?? b.heightM ?? (b.levels ? b.levels * 3 : 6)
        const shadowLength = Math.max(0, h / Math.tan(sun.altitude))
        const base = ring.map(([lat, lng]) => [lng, lat] as [number, number])
        const shadowPts = base.map(([lng, lat]) => projectLngLatMeters(lng, lat, shadowBearingDeg, shadowLength))
        const poly: [number, number][] = [...base, ...shadowPts.reverse(), base[0]]
        features.push({
          type: 'Feature',
          properties: { h },
          geometry: { type: 'Polygon', coordinates: [poly] },
        })
      }
      return { type: 'FeatureCollection', features }
    },
    [site, osm, lidarHeightsByKey]
  )

  const sectionDistanceM = useMemo(() => {
    if (sectionPoints.length < 2) return 0
    return haversineM(
      sectionPoints[0].lat,
      sectionPoints[0].lng,
      sectionPoints[1].lat,
      sectionPoints[1].lng
    )
  }, [sectionPoints])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!map.getSource(SECTION_SOURCE_ID)) {
      map.addSource(SECTION_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
    if (!map.getLayer(SECTION_LINE_LAYER_ID)) {
      map.addLayer({
        id: SECTION_LINE_LAYER_ID,
        type: 'line',
        source: SECTION_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#E8621A', 'line-width': 2.25, 'line-dasharray': [2, 1.6] },
      })
    }
    if (!map.getLayer(SECTION_POINT_LAYER_ID)) {
      map.addLayer({
        id: SECTION_POINT_LAYER_ID,
        type: 'circle',
        source: SECTION_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#E8621A', 'circle-stroke-color': '#0e0d0c', 'circle-stroke-width': 1.4 },
      })
    }
    if (!map.getLayer('sonde-section-labels')) {
      map.addLayer({
        id: 'sonde-section-labels',
        type: 'symbol',
        source: SECTION_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'point'],
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-font': ['Open Sans Bold'],
          'text-offset': [0, 1.2],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#E8621A', 'text-halo-color': '#0e0d0c', 'text-halo-width': 1.2 },
      })
    }
    if (!map.getLayer('sonde-section-direction')) {
      map.addLayer({
        id: 'sonde-section-direction',
        type: 'symbol',
        source: SECTION_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'direction'],
        layout: {
          'text-field': ['get', 'arrow'],
          'text-size': 16,
          'text-rotate': ['get', 'bearing'],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#E8621A', 'text-halo-color': '#0e0d0c', 'text-halo-width': 1.1 },
      })
    }
    if (!map.getLayer('sonde-section-eye')) {
      map.addLayer({
        id: 'sonde-section-eye',
        type: 'symbol',
        source: SECTION_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'eye'],
        layout: {
          'text-field': '◉',
          'text-size': 11,
          'text-rotate': ['get', 'bearing'],
          'text-offset': [0, -0.8],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#E8621A', 'text-halo-color': '#0e0d0c', 'text-halo-width': 1 },
      })
    }
    const source = map.getSource(SECTION_SOURCE_ID) as mapboxgl.GeoJSONSource
    const features: GeoJSON.Feature[] = []
    if (sectionPoints.length >= 2) {
      const mid: SectionPoint = {
        lng: (sectionPoints[0].lng + sectionPoints[1].lng) / 2,
        lat: (sectionPoints[0].lat + sectionPoints[1].lat) / 2,
      }
      const b0 = bearingDeg(sectionPoints[0], sectionPoints[1])
      const b = sectionFlip ? (b0 + 180) % 360 : b0
      features.push({
        type: 'Feature',
        properties: { kind: 'line' },
        geometry: {
          type: 'LineString',
          coordinates: sectionPoints.map((pt) => [pt.lng, pt.lat]),
        },
      })
      features.push({
        type: 'Feature',
        properties: { kind: 'direction', arrow: '▶', bearing: b },
        geometry: { type: 'Point', coordinates: [mid.lng, mid.lat] },
      })
      features.push({
        type: 'Feature',
        properties: {
          kind: 'eye',
          bearing: b,
        },
        geometry: {
          type: 'Point',
          coordinates: [
            mid.lng + (sectionPoints[1].lng - sectionPoints[0].lng) * 0.08,
            mid.lat + (sectionPoints[1].lat - sectionPoints[0].lat) * 0.08,
          ],
        },
      })
    }
    sectionPoints.forEach((pt, i) => {
      features.push({
        type: 'Feature',
        properties: { kind: 'point', label: i === 0 ? 'A' : 'B' },
        geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
      })
    })
    source.setData({ type: 'FeatureCollection', features })
  }, [mapLoaded, sectionPoints, sectionFlip])

  const rebuildSectionProfile = useCallback(
    (start: SectionPoint, end: SectionPoint) => {
      const map = mapRef.current
      if (!map) return
      console.log(`Section: A=[${start.lat}, ${start.lng}] B=[${end.lat}, ${end.lng}]`)
      const distanceM = Math.max(1, haversineM(start.lat, start.lng, end.lat, end.lng))
      console.log(`Section: total distance = ${distanceM.toFixed(0)}m`)
      if (!BASIC_3D_BUILDINGS_ONLY) {
        const demSource = 'mapbox-terrain-dem-v1'
        if (!map.getSource(demSource)) {
          map.addSource(demSource, {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
          })
        }
        map.setTerrain({ source: demSource, exaggeration: 1 })
        console.log('Section: terrain enabled, waiting for idle...')
      }
      map.once('idle', () => {
        const lngA = start.lng
        const latA = start.lat
        const lngB = end.lng
        const latB = end.lat
        const totalDistance = distanceM
        console.log('=== SECTION DEBUG ===')
        console.log('Terrain enabled:', map.getTerrain())
        const testElev = map.queryTerrainElevation([site?.lng ?? lngA, site?.lat ?? latA], { exaggerated: false })
        console.log('Test elevation at site:', testElev)
        const samples: ElevationSample[] = []
        for (let i = 0; i <= 20; i += 1) {
          const t = i / 20
          const lng = lngA + (lngB - lngA) * t
          const lat = latA + (latB - latA) * t
          const elev = map.queryTerrainElevation([lng, lat], { exaggerated: false })
          console.log(`Point ${i}: [${lng.toFixed(4)}, ${lat.toFixed(4)}] elev=${elev}`)
          samples.push({ lng, lat, distanceM: t * distanceM, elevationM: elev ?? 15 })
        }
        console.log('All points:', samples.map((p) => ({ distance: p.distanceM, elevation: p.elevationM })))
        console.log('=== END DEBUG ===')
        const dense: ElevationSample[] = []
        for (let i = 0; i <= 60; i += 1) {
          const t = i / 60
          const lng = lngA + (lngB - lngA) * t
          const lat = latA + (latB - latA) * t
          const elev = map.queryTerrainElevation([lng, lat], { exaggerated: false })
          dense.push({ lng, lat, distanceM: t * totalDistance, elevationM: elev ?? 18 })
        }
        const min = Math.min(...dense.map((s) => s.elevationM))
        const max = Math.max(...dense.map((s) => s.elevationM))
        console.log(`Section: sampled ${dense.length} elevation points`)
        console.log(`Section: min=${min.toFixed(1)}m max=${max.toFixed(1)}m`)
        setSectionProfile(dense)
      })
    },
    [site]
  )

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const canvas = map.getCanvas()
    if (canvas) canvas.style.cursor = sectionMode ? 'crosshair' : ''
    if (!sectionMode) return
    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const pt = { lng: e.lngLat.lng, lat: e.lngLat.lat }
      setSectionPoints((prev) => {
        if (prev.length === 0) {
          setSectionProfile(null)
          return [pt]
        }
        if (prev.length === 1) {
          const next: SectionPoint[] = [prev[0], pt]
          rebuildSectionProfile(next[0], next[1])
          return next
        }
        setSectionProfile(null)
        return [pt]
      })
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
      const cleanupCanvas = map.getCanvas()
      if (cleanupCanvas) cleanupCanvas.style.cursor = ''
    }
  }, [mapLoaded, rebuildSectionProfile, sectionMode])

  useEffect(() => {
    if (BASIC_3D_BUILDINGS_ONLY) return
    if (!site || osm.status !== 'ok' || !lidarHeightsEnabled) return
    let cancelled = false
    const buildings = osm.data.buildings
      .filter((b) => {
        const ring = b.rings[0]
        if (!ring || !ring.length) return false
        const c = centroidLatLng(ring)
        return haversineM(site.lat, site.lng, c.lat, c.lng) <= 200
      })
      .slice(0, 40)
    if (!buildings.length) return
    ;(async () => {
      let done = 0
      for (const b of buildings) {
        if (cancelled) return
        const ring = b.rings[0]
        if (!ring || ring.length < 3) continue
        const c = centroidLatLng(ring)
        const key = buildingHeightKey(c.lat, c.lng)
        if (lidarHeightsByKey[key] != null || lidarByBuilding[key]) {
          done += 1
          setLidarStatus(`Loading roof data: ${done}/${buildings.length}`)
          setMapPipelineStatus(`Loading: buildings ${done}/${buildings.length} · trees… · shadows…`)
          continue
        }
        const cacheKey = `sonde_lidar_${key}`
        try {
          const cachedRaw = localStorage.getItem(cacheKey)
          if (cachedRaw) {
            const cached = JSON.parse(cachedRaw) as { expiresAt: number; data: LidarBuildingData }
            if (cached.expiresAt > Date.now()) {
              setLidarByBuilding((prev) => ({ ...prev, [key]: cached.data }))
              setLidarHeightsByKey((prev) => ({ ...prev, [key]: cached.data.maxHeight }))
              done += 1
              setLidarStatus(`Loading roof data: ${done}/${buildings.length}`)
              setMapPipelineStatus(`Loading: buildings ${done}/${buildings.length} · trees… · shadows…`)
              continue
            }
          }
          const h = await fetchDefraLidarHeightM(c.lat, c.lng)
          if (h != null) {
            const lidarData: LidarBuildingData = {
              buildingId: b.id ?? key,
              footprint: ring.map(([rLat, rLng]) => [rLng, rLat]),
              lidarGrid: {
                width: 20,
                height: 20,
                resolution: 1,
                dsm: Array.from({ length: 400 }, () => h),
                dtm: Array.from({ length: 400 }, () => 0),
                roofHeights: Array.from({ length: 400 }, () => h),
              },
              contours: [{ elevation: 0.5, path: ring.map(([rLat, rLng]) => [rLng, rLat]) }],
              maxHeight: h,
              roofType: b.roofShape,
            }
            setLidarByBuilding((prev) => ({ ...prev, [key]: lidarData }))
            setLidarHeightsByKey((prev) => ({ ...prev, [key]: h }))
            const map = mapRef.current
            if (map && mapLoaded && map.getLayer(MAPBOX_BUILDING_LAYER_ID)) {
              const p = map.project([c.lng, c.lat])
              const near = map.queryRenderedFeatures(
                [
                  [p.x - 12, p.y - 12],
                  [p.x + 12, p.y + 12],
                ],
                { layers: [MAPBOX_BUILDING_LAYER_ID] }
              )
              near.forEach((f) => {
                if (f.id == null) return
                try {
                  map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: f.id as number | string }, { height: h })
                } catch {
                  // ignore non-addressable tile features
                }
              })
            }
            localStorage.setItem(
              cacheKey,
              JSON.stringify({ expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, data: lidarData })
            )
          }
        } catch {
          // ignore per-point failures; downstream falls back to OSM attributes
        }
        done += 1
        setLidarStatus(`Loading roof data: ${done}/${buildings.length}`)
        setMapPipelineStatus(`Loading: buildings ${done}/${buildings.length} · trees… · shadows…`)
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      if (!cancelled) {
        setLidarStatus('')
        setMapPipelineStatus('Loading: buildings ✓ · trees… · shadows…')
        setMapPipelineUpdatedAt(new Date())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [site, osm, lidarHeightsByKey, lidarByBuilding, lidarHeightsEnabled])

  useEffect(() => {
    if (BASIC_3D_BUILDINGS_ONLY) return
    const map = mapRef.current
    if (!map || !mapLoaded || !site || osm.status !== 'ok') return
    const features: GeoJSON.Feature[] = osm.data.buildings
      .map((b) => {
        const ring = b.rings[0]
        if (!ring || ring.length < 4) return null
        const c = centroidLatLng(ring)
        const key = buildingHeightKey(c.lat, c.lng)
        const lidarHeight = lidarHeightsEnabled ? lidarHeightsByKey[key] : undefined
        const osmHeight = b.heightM ?? (b.levels ? b.levels * 3 : undefined)
        const height = lidarHeight ?? osmHeight ?? 6
        const coordinates = [
          ring.map(([lat, lon]) => [lon, lat]),
        ]
        return {
          type: 'Feature',
          properties: {
            id: b.id ?? '',
            height,
            roofShape: b.roofShape ?? '',
            buildingType: b.buildingType ?? '',
          },
          geometry: { type: 'Polygon', coordinates },
        } as GeoJSON.Feature
      })
      .filter((f): f is GeoJSON.Feature => !!f)
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
    if (!map.getSource(OSM_BUILDING_SOURCE_ID)) {
      map.addSource(OSM_BUILDING_SOURCE_ID, { type: 'geojson', data: fc })
    } else {
      ;(map.getSource(OSM_BUILDING_SOURCE_ID) as mapboxgl.GeoJSONSource).setData(fc)
    }
    if (is3DView && !map.getLayer(OSM_BUILDING_LAYER_ID)) {
      map.addLayer({
        id: OSM_BUILDING_LAYER_ID,
        type: 'fill-extrusion',
        source: OSM_BUILDING_SOURCE_ID,
        paint: {
          'fill-extrusion-color': '#51493f',
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 6],
          'fill-extrusion-opacity': 0.88,
          'fill-extrusion-base': 0,
        },
      })
    }
    if (map.getLayer(OSM_BUILDING_LAYER_ID)) {
      map.setLayoutProperty(OSM_BUILDING_LAYER_ID, 'visibility', is3DView ? 'visible' : 'none')
    }
    if (map.getLayer(MAPBOX_BUILDING_LAYER_ID)) {
      map.setLayoutProperty(MAPBOX_BUILDING_LAYER_ID, 'visibility', is3DView ? 'visible' : 'none')
    }
    if (map.getLayer(SITE_BUILDING_LAYER_ID)) {
      map.setLayoutProperty(SITE_BUILDING_LAYER_ID, 'visibility', is3DView ? 'visible' : 'none')
    }
  }, [is3DView, mapLoaded, osm, site, lidarHeightsByKey, lidarHeightsEnabled])

  useEffect(() => {
    if (BASIC_3D_BUILDINGS_ONLY) return
    const map = mapRef.current
    if (!map || !mapLoaded || !site || !map.getLayer(SITE_BUILDING_LAYER_ID)) return
    const updateSiteBuildingFilter = () => {
      const p = map.project([site.lng, site.lat])
      const bbox: [mapboxgl.PointLike, mapboxgl.PointLike] = [
        [p.x - 22, p.y - 22],
        [p.x + 22, p.y + 22],
      ]
      const candidates = map.queryRenderedFeatures(bbox, { layers: [MAPBOX_BUILDING_LAYER_ID] })
      const withIds = candidates.filter((f) => f.id != null)
      if (!withIds.length) return
      map.setFilter(SITE_BUILDING_LAYER_ID, ['all', ['==', 'extrude', 'true'], ['==', ['id'], withIds[0].id as number | string]])
    }
    updateSiteBuildingFilter()
    map.on('moveend', updateSiteBuildingFilter)
    return () => {
      map.off('moveend', updateSiteBuildingFilter)
    }
  }, [mapLoaded, site])

  useEffect(() => {
    if (BASIC_3D_BUILDINGS_ONLY) return
    const map = mapRef.current
    if (!map || !mapLoaded || !is3DView || !lidarHeightsEnabled || !map.getSource('composite')) return
    Object.values(lidarByBuilding).forEach((bld) => {
      const idNum = Number(bld.buildingId)
      const id = Number.isFinite(idNum) ? idNum : bld.buildingId
      try {
        map.setFeatureState(
          { source: 'composite', sourceLayer: 'building', id: id as string | number },
          { height: bld.maxHeight }
        )
      } catch {
        // Some OSM IDs will not map to Mapbox vector-tile IDs; ignore safely.
      }
    })
  }, [mapLoaded, is3DView, lidarHeightsEnabled, lidarByBuilding])

  useEffect(() => {
    if (BASIC_3D_BUILDINGS_ONLY) return
    const map = mapRef.current
    if (!map || !mapLoaded || osm.status !== 'ok') return
    const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true })
    const onClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const id = String((f.properties as Record<string, unknown>)?.id ?? '')
      const b = osm.data.buildings.find((x) => (x.id ?? '') === id) ?? osm.data.buildings[0]
      if (!b) return
      const key = buildingHeightKey(e.lngLat.lat, e.lngLat.lng)
      const lidarH = lidarHeightsByKey[key]
      const h = lidarH ?? b.heightM ?? (b.levels ? b.levels * 3 : 6)
      const roofDetected = b.roofShape ? `${inferRoofFromTags(b.buildingType, b.roofShape).type} (${inferRoofFromTags(b.buildingType, b.roofShape).source})` : `${inferRoofFromTags(b.buildingType, b.roofShape).type} (${inferRoofFromTags(b.buildingType, b.roofShape).source})`
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `Height: ${h.toFixed(1)}m (${lidarH != null ? 'LiDAR 2022' : 'estimated'})<br/>Roof type: ${roofDetected}<br/>Building: ${b.buildingType ?? 'unknown'}<br/>ID: ${b.id ?? 'B???'}`
        )
        .addTo(map)
    }
    if (map.getLayer(OSM_BUILDING_LAYER_ID)) map.on('click', OSM_BUILDING_LAYER_ID, onClick)
    if (map.getLayer(MAPBOX_BUILDING_LAYER_ID)) map.on('click', MAPBOX_BUILDING_LAYER_ID, onClick)
    if (map.getLayer(SITE_BUILDING_LAYER_ID)) map.on('click', SITE_BUILDING_LAYER_ID, onClick)
    return () => {
      popup.remove()
      if (map.getLayer(OSM_BUILDING_LAYER_ID)) map.off('click', OSM_BUILDING_LAYER_ID, onClick)
      if (map.getLayer(MAPBOX_BUILDING_LAYER_ID)) map.off('click', MAPBOX_BUILDING_LAYER_ID, onClick)
      if (map.getLayer(SITE_BUILDING_LAYER_ID)) map.off('click', SITE_BUILDING_LAYER_ID, onClick)
    }
  }, [mapLoaded, osm, lidarHeightsByKey])

  useEffect(() => {
    if (BASIC_3D_BUILDINGS_ONLY) return
    const map = mapRef.current
    if (!map || !mapLoaded || !site || osm.status !== 'ok') return
    if (!treesEnabled) {
      if (map.getLayer(TREE_LABEL_LAYER_ID)) map.removeLayer(TREE_LABEL_LAYER_ID)
      if (map.getLayer(TREE_LAYER_ID)) map.removeLayer(TREE_LAYER_ID)
      if (map.getLayer(TREE_CANOPY_LAYER_ID)) map.removeLayer(TREE_CANOPY_LAYER_ID)
      if (map.getLayer(TREE_TRUNK_LAYER_ID)) map.removeLayer(TREE_TRUNK_LAYER_ID)
      if (map.getSource(TREE_SOURCE_ID)) map.removeSource(TREE_SOURCE_ID)
      setTreeStatus('')
      return
    }
    const trees = [...osm.data.trees]
    for (const wood of osm.data.woodlands) {
      const ring = wood.ring.map(([lat, lng]) => [lng, lat] as [number, number])
      let added = 0
      for (let i = 0; i < 120 && added < 60; i += 1) {
        const p = ring[Math.floor(Math.random() * ring.length)]
        const jitterLng = p[0] + (Math.random() - 0.5) * 0.00005
        const jitterLat = p[1] + (Math.random() - 0.5) * 0.00005
        if (!pointInPolygon([jitterLng, jitterLat], ring)) continue
        trees.push({
          id: `${wood.id}-w-${i}`,
          lat: jitterLat,
          lng: jitterLng,
          height: 8 + (Math.random() - 0.5) * 3.2,
          crownDiameter: 6 + (Math.random() - 0.5) * 2,
          leafCycle: 'unknown',
          leafType: 'unknown',
        })
        added += 1
      }
    }
    const maxTrees = 200
    const shown = trees.length > maxTrees ? trees.sort(() => Math.random() - 0.5).slice(0, maxTrees) : trees
    setTreeStatus(`Showing ${shown.length} of ${trees.length} trees`)
    setMapPipelineStatus((prev) => (prev.includes('buildings ✓') ? 'Loading: buildings ✓ · trees ✓ · shadows…' : prev))
    setMapPipelineUpdatedAt(new Date())
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: shown.map((t) => ({
        type: 'Feature',
        properties: {
          id: t.id,
          species: t.species ?? '',
          h: t.height,
          c: t.crownDiameter,
          lc: t.leafCycle,
          lt: t.leafType,
          treeType: t.leafType === 'needleleaved' || t.leafCycle === 'evergreen' ? 'evergreen' : 'deciduous',
        },
        geometry: { type: 'Point', coordinates: [t.lng, t.lat] },
      })),
    }
    if (!map.getSource(TREE_SOURCE_ID)) map.addSource(TREE_SOURCE_ID, { type: 'geojson', data: fc })
    else (map.getSource(TREE_SOURCE_ID) as mapboxgl.GeoJSONSource).setData(fc)
    if (!map.getLayer(TREE_LAYER_ID)) {
      map.addLayer({
        id: TREE_LAYER_ID,
        type: 'circle',
        source: TREE_SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, ['coalesce', ['get', 'c'], 6]],
          'circle-color': ['case', ['==', ['get', 'treeType'], 'evergreen'], '#2d5a27', '#4a7c3f'],
          'circle-opacity': ['case', ['==', ['get', 'treeType'], 'evergreen'], 0.9, 0.85],
        },
      })
    }
    if (!map.getLayer(TREE_TRUNK_LAYER_ID)) {
      map.addLayer({
        id: TREE_TRUNK_LAYER_ID,
        type: 'fill-extrusion',
        source: TREE_SOURCE_ID,
        paint: {
          'fill-extrusion-color': ['match', ['get', 'lc'], 'evergreen', '#2d5a27', '#4a7c3f'],
          'fill-extrusion-height': ['coalesce', ['get', 'h'], 8],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.8,
        },
      })
    }
    if (!map.getLayer(TREE_CANOPY_LAYER_ID)) {
      map.addLayer({
        id: TREE_CANOPY_LAYER_ID,
        type: 'circle',
        source: TREE_SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, ['coalesce', ['get', 'c'], 6]],
          'circle-color': ['match', ['get', 'lc'], 'evergreen', '#2d5a27', '#4a7c3f'],
          'circle-opacity': 0.6,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0.35,
        },
      })
    }
    if (map.getLayer(TREE_TRUNK_LAYER_ID)) map.setLayoutProperty(TREE_TRUNK_LAYER_ID, 'visibility', is3DView ? 'visible' : 'none')
    if (map.getLayer(TREE_CANOPY_LAYER_ID)) map.setLayoutProperty(TREE_CANOPY_LAYER_ID, 'visibility', is3DView ? 'visible' : 'none')
    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false })
    const onEnter = () => {
      const canvas = map.getCanvas()
      if (canvas) canvas.style.cursor = 'pointer'
    }
    const onLeave = () => {
      const canvas = map.getCanvas()
      if (canvas) canvas.style.cursor = ''
      popup.remove()
    }
    const onMove = (e: mapboxgl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f || f.geometry.type !== 'Point') return
      const p = f.properties as Record<string, unknown>
      popup
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(
          `${String(p.species || 'Tree')} · ${Number(p.h ?? 8).toFixed(1)}m tall · ${Number(p.c ?? 6).toFixed(1)}m crown<br/>${String(p.lc || 'unknown')} ${String(p.lt || '')}<br/>Source: OpenStreetMap`
        )
        .addTo(map)
    }
    map.on('mouseenter', TREE_LAYER_ID, onEnter)
    map.on('mouseleave', TREE_LAYER_ID, onLeave)
    map.on('mousemove', TREE_LAYER_ID, onMove)
    return () => {
      map.off('mouseenter', TREE_LAYER_ID, onEnter)
      map.off('mouseleave', TREE_LAYER_ID, onLeave)
      map.off('mousemove', TREE_LAYER_ID, onMove)
      popup.remove()
    }
  }, [treesEnabled, mapLoaded, site, osm, is3DView])

  useEffect(() => {
    if (BASIC_3D_BUILDINGS_ONLY) return
    const map = mapRef.current
    if (!map || !mapLoaded || !selectedShadowDateTime) return
    const fc = buildShadowFeatureCollection(selectedShadowDateTime)
    if (!map.getSource(SHADOW_SOURCE_ID)) map.addSource(SHADOW_SOURCE_ID, { type: 'geojson', data: fc })
    else (map.getSource(SHADOW_SOURCE_ID) as mapboxgl.GeoJSONSource).setData(fc)
    if (!map.getLayer(SHADOW_LAYER_ID)) {
      map.addLayer({
        id: SHADOW_LAYER_ID,
        type: 'fill',
        source: SHADOW_SOURCE_ID,
        paint: {
          'fill-color': '#000000',
          'fill-opacity': 0.45,
        },
      })
    }
    map.setLayoutProperty(SHADOW_LAYER_ID, 'visibility', 'visible')
    setMapPipelineStatus('Loading: buildings ✓ · trees ✓ · shadows ✓')
    setMapPipelineUpdatedAt(new Date())
  }, [mapLoaded, selectedShadowDateTime, buildShadowFeatureCollection])

  useEffect(() => {
    if (BASIC_3D_BUILDINGS_ONLY) return
    const map = mapRef.current
    if (!map || !mapLoaded || !site || osm.status !== 'ok') return
    if (!roofContoursEnabled) {
      if (map.getLayer(ROOF_CONTOUR_LAYER_ID)) map.removeLayer(ROOF_CONTOUR_LAYER_ID)
      if (map.getSource(ROOF_CONTOUR_SOURCE_ID)) map.removeSource(ROOF_CONTOUR_SOURCE_ID)
      return
    }
    const features: GeoJSON.Feature[] = []
    for (const b of osm.data.buildings) {
      const ring = b.rings[0]
      if (!ring || ring.length < 4) continue
      const c = centroidLatLng(ring)
      const key = buildingHeightKey(c.lat, c.lng)
      const h = lidarHeightsByKey[key] ?? b.heightM ?? (b.levels ? b.levels * 3 : 6)
      features.push({
        type: 'Feature',
        properties: { h },
        geometry: { type: 'LineString', coordinates: ring.map(([lat, lng]) => [lng, lat]) },
      })
    }
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
    if (!map.getSource(ROOF_CONTOUR_SOURCE_ID)) map.addSource(ROOF_CONTOUR_SOURCE_ID, { type: 'geojson', data: fc })
    else (map.getSource(ROOF_CONTOUR_SOURCE_ID) as mapboxgl.GeoJSONSource).setData(fc)
    if (!map.getLayer(ROOF_CONTOUR_LAYER_ID)) {
      map.addLayer({
        id: ROOF_CONTOUR_LAYER_ID,
        type: 'line',
        source: ROOF_CONTOUR_SOURCE_ID,
        paint: { 'line-color': '#E8621A', 'line-width': 0.5, 'line-opacity': 0.95 },
      })
    }
  }, [roofContoursEnabled, mapLoaded, site, osm, lidarHeightsByKey])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !site) return
    const features: GeoJSON.Feature[] = []
    if (planning.status === 'ok') {
      const listed = planning.data.listedBuildings ?? []
      listed.forEach((b) => {
        features.push({
          type: 'Feature',
          properties: { kind: 'listed' },
          geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
        })
      })
    }
    if (movement.status === 'ok') {
      const m = movement.data
      const walkFeats = m.walkIsochrones?.features ?? []
      const cycleIsoFeats = m.cycleIsochrones?.features ?? []
      const busList = m.busStops ?? []
      const cycleLineFeats = m.cycleways?.features ?? []
      walkFeats.forEach((f) =>
        features.push({ ...f, properties: { ...(f.properties ?? {}), kind: 'walk_iso' } })
      )
      cycleIsoFeats.forEach((f) =>
        features.push({ ...f, properties: { ...(f.properties ?? {}), kind: 'cycle_iso' } })
      )
      busList.forEach((s) => {
        const routes = Array.isArray(s.routes) ? s.routes : []
        features.push({
          type: 'Feature',
          properties: { kind: 'bus_stop', name: s.name, routes: routes.join(', ') || 'Unknown routes' },
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        })
      })
      cycleLineFeats.forEach((f) =>
        features.push({ ...f, properties: { ...(f.properties ?? {}), kind: 'cycle_route' } })
      )
    }
    if (ecology.status === 'ok') {
      const parkFeats = ecology.data.parks?.features ?? []
      const treeFeats = ecology.data.trees?.features ?? []
      parkFeats.forEach((f) => features.push(f))
      treeFeats.forEach((f) => features.push(f))
    }
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
    if (!map.getSource(SONDE_DYNAMIC_SOURCE_ID)) {
      map.addSource(SONDE_DYNAMIC_SOURCE_ID, { type: 'geojson', data: fc })
    } else {
      ;(map.getSource(SONDE_DYNAMIC_SOURCE_ID) as mapboxgl.GeoJSONSource).setData(fc)
    }
    const addIfMissing = (id: string, layer: mapboxgl.AnyLayer) => {
      if (!map.getLayer(id)) map.addLayer(layer)
    }
    addIfMissing('sonde-overlay-fill', {
      id: 'sonde-overlay-fill',
      type: 'fill',
      source: SONDE_DYNAMIC_SOURCE_ID,
      filter: ['any', ['==', ['get', 'kind'], 'walk_iso'], ['==', ['get', 'kind'], 'cycle_iso']],
      paint: { 'fill-color': '#2b6cb0', 'fill-opacity': 0.12 },
    })
    addIfMissing('sonde-overlay-line', {
      id: 'sonde-overlay-line',
      type: 'line',
      source: SONDE_DYNAMIC_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'cycle_route'],
      paint: { 'line-color': '#E8621A', 'line-width': 2, 'line-dasharray': [2, 1.2] },
    })
    addIfMissing('sonde-overlay-points', {
      id: 'sonde-overlay-points',
      type: 'circle',
      source: SONDE_DYNAMIC_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'bus_stop'],
      paint: { 'circle-color': '#ffffff', 'circle-stroke-color': '#888888', 'circle-stroke-width': 1, 'circle-radius': 3 },
    })
    addIfMissing('sonde-bus-labels', {
      id: 'sonde-bus-labels',
      type: 'symbol',
      source: SONDE_DYNAMIC_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'bus_stop'],
      minzoom: 16,
      layout: { 'text-field': 'B', 'text-size': 10, 'text-font': ['Open Sans Bold'] },
      paint: { 'text-color': '#111111' },
    })
    if (map.getLayer('sonde-overlay-points')) map.setLayoutProperty('sonde-overlay-points', 'visibility', showBusStops ? 'visible' : 'none')
    if (map.getLayer('sonde-bus-labels')) map.setLayoutProperty('sonde-bus-labels', 'visibility', showBusStops ? 'visible' : 'none')
    if (map.getLayer('sonde-overlay-line')) map.setLayoutProperty('sonde-overlay-line', 'visibility', showCycleRoutes ? 'visible' : 'none')
    if (map.getLayer('sonde-overlay-fill')) map.setLayoutProperty('sonde-overlay-fill', 'visibility', showWalkIsochrones ? 'visible' : 'none')
  }, [mapLoaded, site, planning, movement, ecology, built, showBusStops, showCycleRoutes, showWalkIsochrones])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false })
    const onMove = (e: mapboxgl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const p = f.properties as Record<string, unknown>
      const name = String(p?.name ?? 'Bus stop')
      const routes = String(p?.routes ?? 'Unknown routes')
      popup
        .setLngLat(e.lngLat)
        .setHTML(`<strong>${name}</strong><br/>Routes: ${routes}`)
        .addTo(map)
    }
    const onLeave = () => popup.remove()
    const onClick = (e: mapboxgl.MapLayerMouseEvent) => onMove(e)
    map.on('mousemove', 'sonde-overlay-points', onMove)
    map.on('mouseleave', 'sonde-overlay-points', onLeave)
    map.on('click', 'sonde-overlay-points', onClick)
    return () => {
      popup.remove()
      map.off('mousemove', 'sonde-overlay-points', onMove)
      map.off('mouseleave', 'sonde-overlay-points', onLeave)
      map.off('click', 'sonde-overlay-points', onClick)
    }
  }, [mapLoaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (BASIC_3D_BUILDINGS_ONLY) {
      if (map.getLayer(MAPBOX_BUILDING_LAYER_ID)) {
        map.setLayoutProperty(MAPBOX_BUILDING_LAYER_ID, 'visibility', is3DView ? 'visible' : 'none')
      }
      map.easeTo({ pitch: is3DView ? 45 : 0, bearing: map.getBearing(), duration: 450 })
      return
    }
    if (is3DView) {
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 })
      map.easeTo({ pitch: 45, duration: 650 })
    } else {
      map.setTerrain(null)
      map.easeTo({ pitch: 0, bearing: map.getBearing(), duration: 450 })
    }
  }, [is3DView, mapLoaded])

  const sectionStats = useMemo(() => {
    if (!sectionProfile || sectionProfile.length === 0) return null
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const sample of sectionProfile) {
      min = Math.min(min, sample.elevationM)
      max = Math.max(max, sample.elevationM)
    }
    return { min, max }
  }, [sectionProfile])

  const sectionView = useMemo(() => {
    if (sectionPoints.length < 2) return { forward: 'East', backward: 'West', current: 'East', bearing: 90, forwardArrow: '→', backwardArrow: '←' }
    const b = bearingDeg(sectionPoints[0], sectionPoints[1])
    const c = nearestCardinalForView(b)
    return {
      forward: c.forward,
      backward: c.backward,
      current: sectionFlip ? c.backward : c.forward,
      bearing: sectionFlip ? (b + 180) % 360 : b,
    }
  }, [sectionPoints, sectionFlip])

  const sectionBuildings = useMemo(() => {
    if (!sectionProfile || sectionProfile.length < 2 || sectionPoints.length < 2 || osm.status !== 'ok') return []
    const map = mapRef.current
    const a: [number, number] = [sectionPoints[0].lng, sectionPoints[0].lat]
    const b: [number, number] = [sectionPoints[1].lng, sectionPoints[1].lat]
    const distanceM = sectionProfile[sectionProfile.length - 1].distanceM
    const samples = sectionProfile

    const terrainAt = (dM: number): number => {
      if (samples.length < 2) return samples[0]?.elevationM ?? 0
      if (dM <= 0) return samples[0].elevationM
      if (dM >= distanceM) return samples[samples.length - 1].elevationM
      for (let i = 0; i < samples.length - 1; i += 1) {
        const s0 = samples[i]
        const s1 = samples[i + 1]
        if (dM >= s0.distanceM && dM <= s1.distanceM) {
          const t = (dM - s0.distanceM) / Math.max(1e-9, s1.distanceM - s0.distanceM)
          return s0.elevationM + (s1.elevationM - s0.elevationM) * t
        }
      }
      return samples[0].elevationM
    }

    const out: Array<{ startM: number; endM: number; topM: number; baseM: number; label: string; context: boolean }> = []
    const fallbackHeightFromMapbox = (lat: number, lng: number): number | null => {
      if (!map || !mapLoaded || !map.getLayer(MAPBOX_BUILDING_LAYER_ID)) return null
      const p = map.project([lng, lat])
      const feats = map.queryRenderedFeatures(
        [
          [p.x - 8, p.y - 8],
          [p.x + 8, p.y + 8],
        ],
        { layers: [MAPBOX_BUILDING_LAYER_ID] }
      )
      const raw = feats[0]?.properties?.height
      const parsed = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(parsed) ? parsed : null
    }
    const resolvedHeight = (bld: (typeof osm.data.buildings)[number]): number => {
      const ring0 = bld.rings[0]
      const c0 = ring0 ? centroidLatLng(ring0) : null
      const key = c0 ? buildingHeightKey(c0.lat, c0.lng) : ''
      const lidarH = key ? lidarHeightsByKey[key] : null
      const mapboxH = c0 ? fallbackHeightFromMapbox(c0.lat, c0.lng) : null
      return lidarH ?? mapboxH ?? bld.heightM ?? (bld.levels ? bld.levels * 3 : 6)
    }
    for (const bld of osm.data.buildings) {
      const ring = bld.rings[0]?.map(([lat, lon]) => [lon, lat] as [number, number])
      if (!ring || ring.length < 3) continue
      const tVals: number[] = []
      for (let i = 0; i < ring.length - 1; i += 1) {
        const t = segmentIntersectionT(a, b, ring[i], ring[i + 1])
        if (t != null) tVals.push(t)
      }
      if (pointInPolygon(a, ring)) tVals.push(0)
      if (pointInPolygon(b, ring)) tVals.push(1)
      const uniq = Array.from(new Set(tVals.map((t) => Number(t.toFixed(6))))).sort((x, y) => x - y)
      if (uniq.length >= 2) {
        const startT = uniq[0]
        const endT = uniq[uniq.length - 1]
        const startM = startT * distanceM
        const endM = endT * distanceM
        if (endM - startM < 1) continue
        const h = resolvedHeight(bld)
        const centerM = (startM + endM) / 2
        const baseM = terrainAt(centerM)
        const topM = baseM + h
        const label = bld.name && bld.buildingType ? `${bld.name} (${bld.buildingType})` : (bld.name ?? bld.buildingType ?? 'building')
        out.push({ startM, endM, topM, baseM, label, context: false })
        continue
      }
      // Context buildings within 50m of section line.
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
      const vx = b[0] - a[0]
      const vy = b[1] - a[1]
      const wx = cx - a[0]
      const wy = cy - a[1]
      const c1 = vx * wx + vy * wy
      const c2 = vx * vx + vy * vy
      const t = Math.max(0, Math.min(1, c1 / Math.max(1e-12, c2)))
      const px = a[0] + t * vx
      const py = a[1] + t * vy
      const metersPerDeg = 111320
      const distM = Math.hypot((cx - px) * metersPerDeg * Math.cos((sectionPoints[0].lat * Math.PI) / 180), (cy - py) * metersPerDeg)
      if (distM <= 50) {
        const centerM = t * distanceM
        const wM = Math.max(3, Math.sqrt((ring.length - 1)) * 2)
        const startM = Math.max(0, centerM - wM / 2)
        const endM = Math.min(distanceM, centerM + wM / 2)
        const h = resolvedHeight(bld)
        const baseM = terrainAt(centerM)
        const topM = baseM + h
        const label = bld.name ?? bld.buildingType ?? 'building'
        out.push({ startM, endM, topM, baseM, label, context: true })
      }
    }
    console.log(`Section: found ${out.filter((bld) => !bld.context).length} buildings intersecting line`)
    return out
  }, [sectionProfile, sectionPoints, osm, lidarHeightsByKey, mapLoaded])

  const applyShadowPreset = useCallback(
    (month: number, day: number, hour: number) => {
      if (!site) return
      const year = new Date().getFullYear()
      const date = new Date(year, month - 1, day, 12, 0, 0, 0)
      const times = SunCalc.getTimes(date, site.lat, site.lng)
      const target = new Date(year, month - 1, day, hour, 0, 0, 0).getTime()
      const sunrise = times.sunrise.getTime()
      const sunset = times.sunset.getTime()
      const pct = clamp(((target - sunrise) / Math.max(1, sunset - sunrise)) * 1000, 0, 1000)
      setShadowDayIndex(dayIndexFromDate(date))
      setShadowDayProgress(Math.round(pct))
    },
    [site]
  )

  const applyShadowNow = useCallback(() => {
    if (!site) return
    const now = new Date()
    const year = now.getFullYear()
    const date = new Date(year, now.getMonth(), now.getDate(), 12, 0, 0, 0)
    const times = SunCalc.getTimes(date, site.lat, site.lng)
    const target = now.getTime()
    const sunrise = times.sunrise.getTime()
    const sunset = times.sunset.getTime()
    const pct = clamp(((target - sunrise) / Math.max(1, sunset - sunrise)) * 1000, 0, 1000)
    setShadowDayIndex(dayIndexFromDate(date))
    setShadowDayProgress(Math.round(pct))
  }, [site])

  useEffect(() => {
    if (!shadowAnimating || !site || !shadowState) return
    const id = window.setInterval(() => {
      setShadowDayProgress((prev) => {
        const next = prev + 30 * (1000 / 720)
        if (next >= 1000) {
          setShadowAnimating(false)
          return 1000
        }
        return next
      })
    }, 150)
    return () => window.clearInterval(id)
  }, [shadowAnimating, site, shadowState])

  const shadowSummary = useMemo(() => {
    if (!site || osm.status !== 'ok') return null
    const mkDate = (month: number, day: number, hour: number) => new Date(new Date().getFullYear(), month - 1, day, hour, 0, 0, 0)
    const sampleHours = (month: number, day: number, dirDeg: number) => {
      let lit = 0
      let checked = 0
      for (let h = 8; h <= 17; h += 1) {
        const d = mkDate(month, day, h)
        const sun = SunCalc.getPosition(d, site.lat, site.lng)
        if (sun.altitude <= 0) continue
        checked += 1
        const p = projectLngLatMeters(site.lng, site.lat, dirDeg, 20)
        const fc = buildShadowFeatureCollection(d)
        const inShadow = fc.features.some((f) => {
          const ring = (f.geometry as GeoJSON.Polygon).coordinates?.[0] as [number, number][] | undefined
          return ring ? pointInPolygon([p[0], p[1]], ring) : false
        })
        if (!inShadow) lit += 1
      }
      return checked ? lit : 0
    }
    return {
      southSummer: sampleHours(6, 21, 180),
      southWinter: sampleHours(12, 21, 180),
      northSummer: sampleHours(6, 21, 0),
      northWinter: sampleHours(12, 21, 0),
    }
  }, [site, osm, buildShadowFeatureCollection])

  const daylightFactor = useMemo(() => {
    const area = Math.max(0.5, dfWindowW * dfWindowH)
    const roomFactor = Math.max(1, dfRoomDepth * 3)
    const obstructionFactor = Math.max(0.05, Math.cos((Math.min(85, Math.max(0, dfObstructionDeg)) * Math.PI) / 180))
    const df = (area / roomFactor) * 20 * obstructionFactor
    const rag = df > 3 ? 'green' : df >= 1 ? 'amber' : 'red'
    return { value: df, rag, nurseryPass: df >= 3 }
  }, [dfWindowW, dfWindowH, dfRoomDepth, dfObstructionDeg])

  const shadowStudyData = useMemo(() => {
    if (!site || osm.status !== 'ok') return null
    const year = new Date().getFullYear()
    const mk = (m: number, d: number, h: number) => new Date(year, m - 1, d, h, 0, 0, 0)
    const summerDates = [mk(6, 21, 9), mk(6, 21, 12), mk(6, 21, 15)]
    const winterDates = [mk(12, 21, 9), mk(12, 21, 12), mk(12, 21, 15)]
    const toLocal = (lng: number, lat: number) => {
      const x = (lng - site.lng) * 111320 * Math.cos((site.lat * Math.PI) / 180)
      const y = (lat - site.lat) * 111320
      return { x, y }
    }
    const gridStep = 10
    const cells: Array<{ x: number; y: number; summer: number; winter: number; spring: number; solar: number }> = []
    for (let y = -radiusM; y <= radiusM; y += gridStep) {
      for (let x = -radiusM; x <= radiusM; x += gridStep) {
        if (Math.hypot(x, y) > radiusM) continue
        const lng = site.lng + x / (111320 * Math.cos((site.lat * Math.PI) / 180))
        const lat = site.lat + y / 111320
        const p: [number, number] = [lng, lat]
        const countLit = (month: number, day: number) => {
          let lit = 0
          for (let h = 8; h <= 17; h += 1) {
            const d = mk(month, day, h)
            const sun = SunCalc.getPosition(d, site.lat, site.lng)
            if (sun.altitude <= 0) continue
            const fc = buildShadowFeatureCollection(d)
            const shaded = fc.features.some((f) => {
              const ring = (f.geometry as GeoJSON.Polygon).coordinates?.[0] as [number, number][] | undefined
              return ring ? pointInPolygon(p, ring) : false
            })
            if (!shaded) lit += 1
          }
          return lit
        }
        const summer = countLit(6, 21)
        const winter = countLit(12, 21)
        const spring = countLit(3, 21)
        const solar = Math.max(0, (summer * 1.2 + spring + winter * 0.8) / 3)
        cells.push({ x, y, summer, winter, spring, solar })
      }
    }
    const calendar: Array<{ month: number; hour: number; state: 'sun' | 'shadow' | 'night' }> = []
    for (let month = 1; month <= 12; month += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const d = new Date(year, month - 1, 21, hour, 0, 0, 0)
        const sun = SunCalc.getPosition(d, site.lat, site.lng)
        if (sun.altitude <= 0) {
          calendar.push({ month, hour, state: 'night' })
          continue
        }
        const fc = buildShadowFeatureCollection(d)
        const shaded = fc.features.some((f) => {
          const ring = (f.geometry as GeoJSON.Polygon).coordinates?.[0] as [number, number][] | undefined
          return ring ? pointInPolygon([site.lng, site.lat], ring) : false
        })
        calendar.push({ month, hour, state: shaded ? 'shadow' : 'sun' })
      }
    }
    const rangePoly = (d: Date) =>
      buildShadowFeatureCollection(d).features.map((f) =>
        ((f.geometry as GeoJSON.Polygon).coordinates?.[0] ?? []).map(([lng, lat]) => toLocal(lng, lat))
      )
    const svf = (() => {
      const samples = 36
      let blocked = 0
      for (let i = 0; i < samples; i += 1) {
        const bearing = (i / samples) * 360
        const p = projectLngLatMeters(site.lng, site.lat, bearing, radiusM)
        const lineA: [number, number] = [site.lng, site.lat]
        const lineB: [number, number] = [p[0], p[1]]
        let maxAngle = 0
        for (const b of osm.data.buildings) {
          const ring = b.rings[0]?.map(([lat, lng]) => [lng, lat] as [number, number])
          if (!ring || ring.length < 2) continue
          const c = centroidLatLng(b.rings[0])
          const key = buildingHeightKey(c.lat, c.lng)
          const h = lidarHeightsByKey[key] ?? b.heightM ?? (b.levels ? b.levels * 3 : 6)
          for (let j = 0; j < ring.length - 1; j += 1) {
            const t = segmentIntersectionT(lineA, lineB, ring[j], ring[j + 1])
            if (t == null) continue
            const dist = Math.max(1, t * radiusM)
            maxAngle = Math.max(maxAngle, Math.atan(h / dist))
          }
        }
        if (maxAngle > (15 * Math.PI) / 180) blocked += 1
      }
      return 1 - blocked / samples
    })()
    return {
      cells,
      calendar,
      summerRange: summerDates.map(rangePoly),
      winterRange: winterDates.map(rangePoly),
      svf,
    }
  }, [site, osm, radiusM, lidarHeightsByKey, buildShadowFeatureCollection])

  const wrapModule = (moduleName: string, node: ReactElement) => (
    <ModuleErrorBoundary moduleName={moduleName}>{node}</ModuleErrorBoundary>
  )

  const panel = (() => {
    switch (active) {
      case 'solar':
        return wrapModule('Solar', <SolarModule data={solar} />)
      case 'wind':
        return wrapModule('Wind', <WindModule state={wind} />)
      case 'climate':
        return wrapModule('Climate', <ClimateModule state={climate} />)
      case 'flood':
        return wrapModule('Flood', (
          <FloodModule
            site={site}
            state={flood}
          />
        ))
      case 'ground':
        return wrapModule('Ground', <GroundModule site={site} />)
      case 'lasercut':
        return wrapModule('Laser Cut', <LaserCutModule site={site} radiusM={radiusM} onRadius={setRadiusM} map={mapInstance} osm={osm} />)
      case 'planning':
        return wrapModule('Planning', <PlanningPolicyModule site={site} state={planning} />)
      case 'demographics':
        return wrapModule('Demographics', <DemographicsModule site={site} state={demographics} />)
      case 'movement':
        return wrapModule('Movement', (
          <MovementTransportModule
            site={site}
            state={movement}
            busStopsEnabled={showBusStops}
            onBusStopsEnabled={setShowBusStops}
            cycleRoutesEnabled={showCycleRoutes}
            onCycleRoutesEnabled={setShowCycleRoutes}
            walkIsoEnabled={showWalkIsochrones}
            onWalkIsoEnabled={setShowWalkIsochrones}
          />
        ))
      case 'ecology':
        return wrapModule('Ecology', <EcologyEnvironmentModule site={site} state={ecology} />)
      case 'built':
        return wrapModule('Built', <BuiltEnvironmentModule site={site} state={built} />)
      case 'templates':
        return wrapModule('Templates', <ObservationTemplatesModule site={site} />)
      case 'precedents':
        return wrapModule('Precedents', <PrecedentsModule site={site} solar={solar} flood={flood} radiusM={radiusM} />)
      case 'localIntel':
        return wrapModule('Local Intel', <LocalIntelModule site={site} />)
      case 'basemap':
        return wrapModule('Base map', (
          <BaseMapModule
            site={site}
            radiusM={radiusM}
            onRadius={setRadiusM}
            historicalYear={historicalYear}
            onHistoricalYear={setHistoricalYear}
            historicalOpacity={historicalOpacity}
            onHistoricalOpacity={setHistoricalOpacity}
            historicalEnabled={historicalEnabled}
            onHistoricalEnabled={setHistoricalEnabled}
            state={osm}
          />
        ))
      case 'export':
        return wrapModule('Export', (
          <ExportModule
            site={site}
            solar={solar}
            wind={wind}
            climate={climate}
            flood={flood}
            ground={ground}
            planning={planning}
            demographics={demographics}
            movement={movement}
            ecology={ecology}
            built={built}
            radiusM={radiusM}
            onRadius={setRadiusM}
            onExportFile={recordExportedFile}
            osm={osm}
          />
        ))
      default:
        return null
    }
  })()

  const mapboxStatus: ServiceStatus = token && mapLoaded ? 'ok' : 'error'
  const osmStatus: ServiceStatus = osm.status === 'ok' ? 'ok' : osm.status === 'error' ? 'error' : 'loading'
  const [overpassSource, setOverpassSource] = useState(() => getOverpassSourceStatus())
  useEffect(() => subscribeOverpassSource(() => setOverpassSource(getOverpassSourceStatus())), [])
  const overpassLabel =
    overpassSource.mode === 'own'
      ? 'own server ✓'
      : overpassSource.mode === 'public'
        ? 'public API (fallback)'
        : 'initialising'
  const allServicesOk = mapboxStatus === 'ok' && claudeStatus === 'ok' && osmStatus === 'ok'
  const anyServiceError = mapboxStatus === 'error' || claudeStatus === 'error' || osmStatus === 'error'
  const serviceTone = allServicesOk ? 'green' : anyServiceError ? 'red' : 'amber'
  const serviceMark = (status: ServiceStatus) => (status === 'ok' ? '✓' : status === 'error' ? '✕' : '…')

  const downloadSectionSvg = useCallback(() => {
    const el = document.getElementById('sonde-svg-section') as SVGSVGElement | null
    if (!el) {
      alert('Section SVG not ready.')
      return
    }
    const scaleDen = sectionScale === '1:100' ? 100 : sectionScale === '1:200' ? 200 : sectionScale === '1:500' ? 500 : 1000
    const widthMm = Math.max(20, (sectionDistanceM * 1000) / scaleDen)
    const heightMm = Math.max(20, (((sectionStats?.max ?? 1) - (sectionStats?.min ?? 0)) * 1000) / scaleDen + 40)
    const clone = el.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', `${widthMm.toFixed(1)}mm`)
    clone.setAttribute('height', `${heightMm.toFixed(1)}mm`)
    // Export is always light mode for print/tracing quality.
    clone.style.setProperty('--section-bg', '#ffffff')
    clone.style.setProperty('--section-ground-fill', '#eeeeee')
    clone.style.setProperty('--section-ground-line', '#111111')
    clone.style.setProperty('--section-ground-line-width', '2')
    clone.style.setProperty('--section-building-fill', '#333333')
    clone.style.setProperty('--section-building-stroke', '#111111')
    clone.style.setProperty('--section-building-stroke-width', '0.5')
    clone.style.setProperty('--section-text', '#111111')
    clone.style.setProperty('--section-grid', '#111111')
    clone.style.setProperty('--section-context-stroke', '#111111')
    clone.style.setProperty('--section-axis', '#111111')
    const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `sonde_section_AB_${sectionScale.replace(':', '-')}.svg`
    a.click()
    URL.revokeObjectURL(a.href)
    recordExportedFile(a.download)
    console.log('Section: SVG rendered 800×200px')
  }, [recordExportedFile, sectionScale, sectionDistanceM, sectionStats])

  return (
    <div className="sonde-root">
      <header className="sonde-topbar">
        <div className="sonde-wordmark" aria-label="Sonde">
          SONDE
        </div>
        <AddressSearch map={mapInstance} onSite={onSite} syncAddress={site?.address ?? null} />
        <button type="button" className="sonde-btn sonde-save-btn" onClick={saveCurrentSite} disabled={!site}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M6 1.2a3.2 3.2 0 0 0-3.2 3.2c0 2.4 3.2 6.4 3.2 6.4s3.2-4 3.2-6.4A3.2 3.2 0 0 0 6 1.2Zm0 4.4a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z" fill="currentColor" />
          </svg>
          Save Site
        </button>
        <div className="sonde-topbar-meta">
          <button type="button" className="sonde-btn sonde-btn--ghost" onClick={copyShareUrl} disabled={!site}>
            Copy link
          </button>
          <button type="button" className="sonde-btn sonde-save-btn" onClick={shareSiteNative} disabled={!site}>
            Share site
          </button>
          <button
            type="button"
            className="sonde-btn sonde-btn--ghost"
            onClick={() => setSavedSitesOpen((v) => !v)}
          >
            Saved Sites
          </button>
          {site ? (
            <span className="sonde-mono sonde-crumb" title={site.address}>
              {site.name}
            </span>
          ) : (
            <span className="sonde-hint-inline">No site fixed</span>
          )}
          {savedSitesOpen ? (
            <div className="sonde-saved-panel">
              {savedSites.length === 0 ? (
                <p className="sonde-hint">No saved sites yet.</p>
              ) : (
                savedSites.map((s) => (
                  <div key={s.id} className="sonde-saved-item">
                    <input
                      className="sonde-input sonde-saved-name"
                      value={s.name}
                      onChange={(e) => updateSavedSite(s.id, { name: e.target.value })}
                    />
                    <div className="sonde-saved-address">{s.address}</div>
                    <div className="sonde-saved-meta">Saved {new Date(s.savedAt).toLocaleString()}</div>
                    <textarea
                      className="sonde-input sonde-saved-notes"
                      value={s.notes}
                      placeholder="Notes"
                      onChange={(e) => updateSavedSite(s.id, { notes: e.target.value })}
                      rows={2}
                    />
                    <div className="sonde-saved-files">{s.files.length ? `Files: ${s.files.join(', ')}` : 'Files: none yet'}</div>
                    <div className="sonde-saved-actions">
                      <button type="button" className="sonde-btn sonde-btn--primary" onClick={() => loadSavedSite(s)}>
                        Load Site
                      </button>
                      <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => deleteSavedSite(s.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </header>

      <div className="sonde-body">
        <aside className="sonde-sidebar" aria-label="Analysis modules">
          <nav className="sonde-nav">
            {MODULES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`sonde-tab ${active === m.id ? 'sonde-tab--active' : ''}`}
                onClick={() => setActive(m.id)}
              >
                <StatusDot tone={toneMap[m.id] ?? 'amber'} />
                <span>{m.label}</span>
              </button>
            ))}
          </nav>
          <p className="sonde-sidebar-foot">
            Status: <span className="sonde-mono">● green</span> ready ·{' '}
            <span className="sonde-mono">● amber</span> input/load ·{' '}
            <span className="sonde-mono">● red</span> fault
          </p>
        </aside>

        <main className="sonde-main">
          <div className="sonde-map-wrap">
            {!token ? (
              <div className="sonde-map-fallback">
                <p>Set `VITE_MAPBOX_TOKEN` for the basemap canvas.</p>
              </div>
            ) : null}
            <div
              id="map-container"
              ref={mapEl}
              className="sonde-map"
              role="presentation"
              style={{ width: '100%', height: '500px' }}
            />
            {shadowState && site ? (
              <div className="sonde-map-overlay sonde-mono">
                <span>{shadowState.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>alt {shadowState.altitude.toFixed(1)}°</span>
                <span>azi {shadowState.azimuthFromNorth.toFixed(1)}°</span>
              </div>
            ) : null}
          </div>

          <ModuleErrorBoundary moduleName="Map tools">
          <section className="sonde-map-tools">
            <div className="sonde-map-tools-row">
              <button
                type="button"
                className={`sonde-btn ${is3DView ? 'sonde-btn--primary' : ''}`}
                disabled={!mapInstance}
                onClick={() => setIs3DView((v) => !v)}
              >
                {is3DView ? 'Flat / 3D: 3D' : 'Flat / 3D: Flat'}
              </button>
              <button
                type="button"
                className={`sonde-btn ${sectionMode ? 'sonde-btn--primary' : ''}`}
                disabled={!mapInstance}
                onClick={() => setSectionMode((v) => !v)}
              >
                Draw Section
              </button>
              <button
                type="button"
                className="sonde-btn sonde-btn--ghost"
                disabled={!mapInstance}
                onClick={() => {
                  setSectionPoints([])
                  setSectionProfile(null)
                }}
              >
                Clear Section
              </button>
              <button
                type="button"
                className="sonde-btn sonde-btn--ghost"
                disabled={!sectionProfile || sectionProfile.length < 2}
                onClick={downloadSectionSvg}
              >
                Download section SVG
              </button>
              <button
                type="button"
                className={`sonde-btn ${treesEnabled ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`}
                disabled={osm.status !== 'ok'}
                onClick={() => setTreesEnabled((v) => !v)}
              >
                {treesEnabled ? 'Trees ON' : 'Trees OFF'}
              </button>
              <button
                type="button"
                className={`sonde-btn ${roofContoursEnabled ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`}
                disabled={osm.status !== 'ok'}
                onClick={() => setRoofContoursEnabled((v) => !v)}
              >
                {roofContoursEnabled ? 'Roof contours ON' : 'Roof contours OFF'}
              </button>
              <button
                type="button"
                className={`sonde-btn ${lidarHeightsEnabled ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`}
                disabled={osm.status !== 'ok'}
                onClick={() => setLidarHeightsEnabled((v) => !v)}
              >
                {lidarHeightsEnabled ? 'LiDAR heights ON' : 'LiDAR heights OFF'}
              </button>
            </div>
            {treeStatus ? <p className="sonde-hint">{treeStatus}</p> : null}
            {lidarStatus ? <p className="sonde-hint">{lidarStatus}</p> : null}
            <p className="sonde-hint sonde-mono">
              {`Buildings: ${lidarHeightsEnabled ? 'LiDAR' : 'Mapbox/OSM'} | Trees: OSM | Shadows: calculated | ${mapPipelineStatus} | Last updated: ${mapPipelineUpdatedAt ? mapPipelineUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}`}
            </p>

            <div className="sonde-map-tools-grid">
              <label className="sonde-label sonde-label--precision">
                Day of year
                <input
                  type="range"
                  min={0}
                  max={364}
                  step={1}
                  disabled={!site}
                  value={shadowDayIndex}
                  onChange={(e) => setShadowDayIndex(Number(e.target.value))}
                />
                <span className="sonde-mono">
                  {shadowState?.date.toLocaleDateString([], { month: 'short', day: '2-digit' }) ?? '—'}
                </span>
              </label>
              <label className="sonde-label sonde-label--precision">
                Time (sunrise → sunset)
                <input
                  type="range"
                  min={0}
                  max={1000}
                  step={1}
                  disabled={!site}
                  value={shadowDayProgress}
                  onChange={(e) => setShadowDayProgress(Number(e.target.value))}
                />
                <span className="sonde-mono">
                  {shadowState?.sunrise.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '--:--'}-
                  {shadowState?.sunset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '--:--'}
                </span>
              </label>
            </div>
            <p className="sonde-hint sonde-mono">
              {shadowState
                ? `${shadowState.date.toLocaleDateString([], { day: '2-digit', month: 'short' })} · ${shadowState.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Alt: ${shadowState.altitude.toFixed(0)}° · Azi: ${shadowState.azimuthFromNorth.toFixed(0)}°`
                : '—'}
            </p>

            <div className="sonde-preset-row">
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => applyShadowPreset(6, 21, 9)} disabled={!site}>
                Summer 09:00
              </button>
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => applyShadowPreset(6, 21, 12)} disabled={!site}>
                Summer 12:00
              </button>
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => applyShadowPreset(6, 21, 15)} disabled={!site}>
                Summer 15:00
              </button>
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => applyShadowPreset(12, 21, 9)} disabled={!site}>
                Winter 09:00
              </button>
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => applyShadowPreset(12, 21, 12)} disabled={!site}>
                Winter 12:00
              </button>
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => applyShadowPreset(12, 21, 15)} disabled={!site}>
                Winter 15:00
              </button>
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => applyShadowPreset(3, 21, 12)} disabled={!site}>
                Spring 12:00
              </button>
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => applyShadowPreset(9, 21, 12)} disabled={!site}>
                Autumn 12:00
              </button>
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={applyShadowNow} disabled={!site}>
                Now
              </button>
              <button type="button" className={`sonde-btn ${shadowAnimating ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`} onClick={() => setShadowAnimating(true)} disabled={!site || shadowAnimating}>
                ▶ Play
              </button>
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => setShadowAnimating(false)} disabled={!shadowAnimating}>
                ■ Stop
              </button>
            </div>

            {shadowStudyData ? (
              <div className="sonde-panel" style={{ marginTop: 10 }}>
                <h3 className="sonde-subhead">Shadow Analysis</h3>
                <div className="sonde-card-grid">
                  <article className="sonde-card">
                    <h4>Sunlight Hours Map</h4>
                    <svg id="sonde-svg-sunlight-hours" viewBox="0 0 220 220" className="sonde-svg">
                      <rect x="0" y="0" width="220" height="220" fill="#111" />
                      {shadowStudyData.cells.map((c, i) => {
                        const x = 110 + (c.x / Math.max(1, radiusM)) * 100
                        const y = 110 - (c.y / Math.max(1, radiusM)) * 100
                        const s = Math.max(0, Math.min(1, c.summer / 10))
                        const r = Math.round(255 * (1 - s))
                        const g = Math.round(200 * s + 30)
                        return <rect key={`sun-cell-${i}`} x={x - 2} y={y - 2} width={4} height={4} fill={`rgb(${r},${g},60)`} />
                      })}
                      <circle cx="110" cy="110" r="100" fill="none" stroke="#555" />
                    </svg>
                  </article>
                  <article className="sonde-card">
                    <h4>Shadow Range (Summer/Winter)</h4>
                    <svg id="sonde-svg-shadow-range-summer" viewBox="0 0 220 220" className="sonde-svg">
                      <rect x="0" y="0" width="220" height="220" fill="#111" />
                      {shadowStudyData.summerRange.map((set, k) =>
                        set.map((poly, i) => (
                          <polygon
                            key={`sum-${k}-${i}`}
                            points={poly.map((p) => `${110 + (p.x / Math.max(1, radiusM)) * 90},${110 - (p.y / Math.max(1, radiusM)) * 90}`).join(' ')}
                            fill={k === 0 ? '#777' : k === 1 ? '#555' : '#333'}
                            stroke="none"
                          />
                        ))
                      )}
                    </svg>
                    <svg id="sonde-svg-shadow-range-winter" viewBox="0 0 220 220" className="sonde-svg" style={{ marginTop: 6 }}>
                      <rect x="0" y="0" width="220" height="220" fill="#111" />
                      {shadowStudyData.winterRange.map((set, k) =>
                        set.map((poly, i) => (
                          <polygon
                            key={`win-${k}-${i}`}
                            points={poly.map((p) => `${110 + (p.x / Math.max(1, radiusM)) * 90},${110 - (p.y / Math.max(1, radiusM)) * 90}`).join(' ')}
                            fill={k === 0 ? '#777' : k === 1 ? '#555' : '#333'}
                            stroke="none"
                          />
                        ))
                      )}
                    </svg>
                  </article>
                  <article className="sonde-card">
                    <h4>Annual Shadow Calendar</h4>
                    <svg id="sonde-svg-shadow-calendar" viewBox="0 0 300 160" className="sonde-svg">
                      <rect x="0" y="0" width="300" height="160" fill="#111" />
                      {shadowStudyData.calendar.map((c) => {
                        const x = 20 + c.hour * 11
                        const y = 10 + (c.month - 1) * 12
                        const fill = c.state === 'night' ? '#000' : c.state === 'shadow' ? '#777' : '#f1d66a'
                        return <rect key={`cal-${c.month}-${c.hour}`} x={x} y={y} width={10} height={10} fill={fill} />
                      })}
                    </svg>
                  </article>
                  <article className="sonde-card">
                    <h4>Sky View Factor + Daylight</h4>
                    <svg id="sonde-svg-svf" viewBox="0 0 220 220" className="sonde-svg">
                      <rect x="0" y="0" width="220" height="220" fill="#111" />
                      <circle cx="110" cy="110" r="90" fill="#f1d66a" stroke="#333" />
                      <circle cx="110" cy="110" r={90 * (1 - shadowStudyData.svf)} fill="#1f1f1f" />
                      <text x="110" y="114" textAnchor="middle" fill="#fff" className="sonde-svg-text" fontSize="12">{`SVF: ${shadowStudyData.svf.toFixed(2)}`}</text>
                    </svg>
                    <div className="sonde-map-tools-grid">
                      <label className="sonde-label">Window w(m)<input type="number" value={dfWindowW} onChange={(e) => setDfWindowW(Number(e.target.value) || 0)} /></label>
                      <label className="sonde-label">Window h(m)<input type="number" value={dfWindowH} onChange={(e) => setDfWindowH(Number(e.target.value) || 0)} /></label>
                      <label className="sonde-label">Room depth(m)<input type="number" value={dfRoomDepth} onChange={(e) => setDfRoomDepth(Number(e.target.value) || 0)} /></label>
                      <label className="sonde-label">Obstruction °<input type="number" value={dfObstructionDeg} onChange={(e) => setDfObstructionDeg(Number(e.target.value) || 0)} /></label>
                    </div>
                    <p className="sonde-hint">{`Estimated Daylight Factor: ${daylightFactor.value.toFixed(2)}% · ${daylightFactor.rag === 'green' ? '🟢' : daylightFactor.rag === 'amber' ? '🟡' : '🔴'} · Nursery 3%: ${daylightFactor.nurseryPass ? 'Yes' : 'No'}`}</p>
                  </article>
                  <article className="sonde-card">
                    <h4>Solar Radiation Heatmap</h4>
                    <svg id="sonde-svg-solar-radiation" viewBox="0 0 220 220" className="sonde-svg">
                      <rect x="0" y="0" width="220" height="220" fill="#111" />
                      {shadowStudyData.cells.map((c, i) => {
                        const x = 110 + (c.x / Math.max(1, radiusM)) * 100
                        const y = 110 - (c.y / Math.max(1, radiusM)) * 100
                        const s = Math.max(0, Math.min(1, c.solar / 10))
                        const r = Math.round(255 * s)
                        const b = Math.round(220 * (1 - s))
                        return <rect key={`rad-cell-${i}`} x={x - 2} y={y - 2} width={4} height={4} fill={`rgb(${r},120,${b})`} />
                      })}
                    </svg>
                  </article>
                </div>
                {shadowSummary ? (
                  <p className="sonde-hint">
                    {`South facade: ${shadowSummary.southSummer.toFixed(1)}hrs sun in summer, ${shadowSummary.southWinter.toFixed(1)}hrs in winter · North facade: ${shadowSummary.northSummer.toFixed(1)}hrs summer, ${shadowSummary.northWinter.toFixed(1)}hrs winter`}
                  </p>
                ) : null}
              </div>
            ) : null}

            {sectionProfile && sectionProfile.length > 1 ? (
              <div className="sonde-section-profile">
                <div className="sonde-map-tools-row" style={{ padding: '0.35rem 0.55rem 0' }}>
                  <label className="sonde-label">
                    Scale
                    <select value={sectionScale} onChange={(e) => setSectionScale(e.target.value as SectionScale)}>
                      <option value="1:100">1:100</option>
                      <option value="1:200">1:200</option>
                      <option value="1:500">1:500</option>
                      <option value="1:1000">1:1000</option>
                    </select>
                  </label>
                  <span className="sonde-hint">
                    At {sectionScale} this section is {(
                      sectionDistanceM * 1000 /
                      (sectionScale === '1:100' ? 100 : sectionScale === '1:200' ? 200 : sectionScale === '1:500' ? 500 : 1000)
                    ).toFixed(1)}mm wide × {(
                      (((sectionStats?.max ?? 0) - (sectionStats?.min ?? 0)) * 1000) /
                      (sectionScale === '1:100' ? 100 : sectionScale === '1:200' ? 200 : sectionScale === '1:500' ? 500 : 1000) +
                      40
                    ).toFixed(1)}mm tall on paper
                  </span>
                  <button
                    type="button"
                    className="sonde-btn sonde-btn--ghost"
                    onClick={() => setSectionPreviewTheme((v) => (v === 'dark' ? 'light' : 'dark'))}
                  >
                    {sectionPreviewTheme === 'dark' ? 'Light Export' : 'Dark Preview'}
                  </button>
                </div>
                <svg
                  id="sonde-svg-section"
                  viewBox="0 0 820 300"
                  className="sonde-svg"
                  role="img"
                  aria-label="Terrain elevation profile"
                  color="white"
                  style={
                    {
                      '--section-bg': '#111111',
                      '--section-ground-fill': '#2a2a2a',
                      '--section-ground-line': '#ffffff',
                      '--section-ground-line-width': '2',
                      '--section-building-fill': '#555555',
                      '--section-building-stroke': '#ffffff',
                      '--section-building-stroke-width': '0.5',
                      '--section-text': '#ffffff',
                      '--section-grid': '#444444',
                      '--section-context-stroke': '#555555',
                      '--section-axis': '#ffffff',
                      color: '#ffffff',
                      background: '#111111',
                      fontFamily: 'monospace',
                    } as CSSProperties
                  }
                >
                  <rect width="100%" height="100%" fill="var(--section-bg)" />
                  <defs>
                    <pattern id="sonde-section-hatch" width="3" height="3" patternUnits="userSpaceOnUse">
                      <rect x="0" y="0" width="3" height="3" fill="var(--section-ground-fill)" />
                    </pattern>
                    <clipPath id="sonde-section-clip">
                      <rect x="52" y="12" width="752" height="240" />
                    </clipPath>
                  </defs>
                  {(() => {
                    const svgWidth = 820
                    const svgHeight = 300
                    const left = 52
                    const right = 16
                    const top = 12
                    const bottom = 48
                    const width = svgWidth - left - right
                    const height = svgHeight - top - bottom
                    const maxD = sectionProfile[sectionProfile.length - 1].distanceM
                    const minGround = sectionStats?.min ?? 0
                    const maxGround = sectionStats?.max ?? 1
                    const tallest = Math.max(0, ...sectionBuildings.filter((bld) => !bld.context).map((bld) => bld.topM - bld.baseM), 0)
                    const minElev = minGround - 2
                    const maxElev = maxGround + tallest + 5
                    const yMinWorld = minElev
                    const yMaxWorld = maxElev
                    const spanE = Math.max(1, maxElev - minElev)
                    const xStep = 10
                    const xTicks = Math.floor(maxD / xStep)
                    const yStep = niceTickStep(spanE, 5)
                    const yStart = Math.floor(yMinWorld / yStep) * yStep
                    const yEnd = Math.ceil(yMaxWorld / yStep) * yStep
                    const yTicks: number[] = []
                    for (let y = yStart; y <= yEnd + 1e-9; y += yStep) yTicks.push(y)
                    const workingProfile = sectionFlip
                      ? [...sectionProfile]
                          .map((s) => ({ ...s, distanceM: maxD - s.distanceM }))
                          .reverse()
                      : sectionProfile
                    const yScale = (elev: number) => top + (height - ((elev - minElev) / spanE) * height)
                    const points = workingProfile.map((s) => {
                      const x = left + (s.distanceM / Math.max(1, maxD)) * width
                      const y = yScale(s.elevationM)
                      return `${x},${y}`
                    })
                    const polyPts = workingProfile.map((s) => ({
                      x: left + (s.distanceM / Math.max(1, maxD)) * width,
                      y: yScale(s.elevationM),
                      d: s.distanceM,
                      elev: s.elevationM,
                    }))
                    const start = points[0]
                    const end = points[points.length - 1]
                    const terrainPath = workingProfile
                      .map((s, i) => {
                        const x = left + (s.distanceM / Math.max(1, maxD)) * width
                        const y = yScale(s.elevationM)
                        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
                      })
                      .join(' ')
                    const groundClosedPath = `${terrainPath} L ${left + width} ${top + height} L ${left} ${top + height} Z`
                    const elevToY = (elev: number) => yScale(elev)
                    const distToX = (d: number) => left + (d / Math.max(1, maxD)) * width
                    const terrainAtDist = (d: number) => {
                      if (workingProfile.length < 2) return workingProfile[0]?.elevationM ?? 0
                      if (d <= 0) return workingProfile[0].elevationM
                      if (d >= maxD) return workingProfile[workingProfile.length - 1].elevationM
                      for (let i = 0; i < workingProfile.length - 1; i += 1) {
                        const a = workingProfile[i]
                        const b = workingProfile[i + 1]
                        if (d >= a.distanceM && d <= b.distanceM) {
                          const t = (d - a.distanceM) / Math.max(1e-9, b.distanceM - a.distanceM)
                          return a.elevationM + (b.elevationM - a.elevationM) * t
                        }
                      }
                      return workingProfile[0].elevationM
                    }
                    const trunc = (s: string) => (s.length > 20 ? `${s.slice(0, 17)}...` : s)
                    const sectionColours = {
                      background: '#111111',
                      text: '#ffffff',
                      terrainStroke: '#ffffff',
                      terrainStrokeWidth: 2,
                      groundFill: '#2a2a2a',
                      buildingFill: '#555555',
                      buildingStroke: '#ffffff',
                      buildingStrokeWidth: 0.5,
                      abDot: '#E8621A',
                    }
                    console.log('Section colours:', sectionColours)
                    console.log('=== SVG RENDER ===')
                    console.log('points count:', points.length)
                    console.log('buildings count:', sectionBuildings.length)
                    console.log('svgWidth:', svgWidth)
                    console.log('svgHeight:', svgHeight)
                    console.log('first point:', points[0])
                    console.log('last point:', points[points.length - 1])
                    return (
                      <>
                        <rect x={left} y={top} width={width} height={height} fill="none" stroke="var(--section-axis)" strokeWidth="0.9" />
                        {Array.from({ length: xTicks + 1 }, (_, i) => i * xStep).map((d) => {
                          const x = left + (d / Math.max(1, maxD)) * width
                          return (
                            <g key={`xt-${d}`}>
                              <line x1={x} y1={top + height} x2={x} y2={top + height + 6} stroke="var(--section-axis)" strokeWidth="0.8" />
                              <text x={x} y={top + height + 18} textAnchor="middle" fill="#ffffff" fontSize="8" className="sonde-svg-text">
                                {d}
                              </text>
                            </g>
                          )
                        })}
                        {yTicks.map((elev) => {
                          const y = yScale(elev)
                          return (
                            <g key={`yt-${elev}`}>
                              <line x1={left - 6} y1={y} x2={left} y2={y} stroke="var(--section-axis)" strokeWidth="0.8" />
                              <line x1={left} y1={y} x2={left + width} y2={y} stroke="#444444" strokeWidth="0.5" strokeDasharray="2 3" />
                              <text x={left - 10} y={y + 3} textAnchor="end" fill="#ffffff" fontSize="8" className="sonde-svg-text">
                                {elev.toFixed(1)}
                              </text>
                            </g>
                          )
                        })}
                        <g clipPath="url(#sonde-section-clip)">
                        <path d={groundClosedPath} fill="#2a2a2a" stroke="none" />
                        {sectionBuildings.map((bld, i) => {
                          const x1 = sectionFlip ? distToX(maxD - bld.endM) : distToX(bld.startM)
                          const x2 = sectionFlip ? distToX(maxD - bld.startM) : distToX(bld.endM)
                          const yTop = elevToY(bld.topM)
                          const dMid = (bld.startM + bld.endM) / 2
                          const yBase = elevToY(terrainAtDist(dMid))
                          const yLabel = i % 2 === 0 ? yTop - 3 : yBase + 10
                          return (
                            <g key={`bld-cut-${i}`}>
                              {bld.context ? (
                                <>
                                  <rect x={Math.min(x1, x2)} y={yTop} width={Math.max(1, Math.abs(x2 - x1))} height={Math.max(1, yBase - yTop)} fill="none" stroke="var(--section-context-stroke)" strokeWidth="0.5" />
                                </>
                              ) : (
                                <>
                                  <rect
                                    x={Math.min(x1, x2)}
                                    y={yTop}
                                    width={Math.max(1, Math.abs(x2 - x1))}
                                    height={Math.max(1, yBase - yTop)}
                                    fill="var(--section-building-fill)"
                                    stroke="var(--section-building-stroke)"
                                    strokeWidth="var(--section-building-stroke-width)"
                                  />
                                  <text x={(x1 + x2) / 2} y={Math.max(top + 8, Math.min(top + height - 6, yLabel))} textAnchor="middle" fill="#ffffff" fontSize="9" className="sonde-svg-text">
                                    {trunc(bld.label)}
                                  </text>
                                </>
                              )}
                            </g>
                          )
                        })}
                        <polyline points={points.join(' ')} fill="none" stroke="#ffffff" strokeWidth={2} />
                        <circle cx={start.split(',')[0]} cy={start.split(',')[1]} r="3.2" fill="#E8621A" stroke="#ffffff" strokeWidth="1" />
                        <circle cx={end.split(',')[0]} cy={end.split(',')[1]} r="3.2" fill="#E8621A" stroke="#ffffff" strokeWidth="1" />
                        </g>
                        <text x={polyPts[0].x - 8} y={polyPts[0].y - 6} fill="#E8621A" fontSize="10" className="sonde-svg-text">
                          A
                        </text>
                        <text x={polyPts[polyPts.length - 1].x + 6} y={polyPts[polyPts.length - 1].y - 6} fill="#E8621A" fontSize="10" className="sonde-svg-text">
                          B
                        </text>
                        <text x={left + width / 2} y={296} textAnchor="middle" fill="#ffffff" fontSize="8.5" className="sonde-svg-text">
                          Distance (m, 10 m markers)
                        </text>
                        <line x1={left + 10} y1={286} x2={left + 70} y2={286} stroke="var(--section-axis)" strokeWidth="1.2" />
                        <line x1={left + 10} y1={283} x2={left + 10} y2={289} stroke="var(--section-axis)" strokeWidth="1" />
                        <line x1={left + 70} y1={283} x2={left + 70} y2={289} stroke="var(--section-axis)" strokeWidth="1" />
                        <text x={left + 40} y={282} textAnchor="middle" fill="#ffffff" fontSize="7.5" className="sonde-svg-text">
                          Scale bar
                        </text>
                        <line x1={left + width - 34} y1={276} x2={left + width - 34} y2={260} stroke="var(--section-axis)" strokeWidth="1" />
                        <polygon points={`${left + width - 34},256 ${left + width - 38},262 ${left + width - 30},262`} fill="var(--section-axis)" />
                        <text x={left + width - 24} y={267} fill="#ffffff" fontSize="8" className="sonde-svg-text">N</text>
                        <text x={left + 2} y={290} textAnchor="start" fill="#ffffff" fontSize="8" className="sonde-svg-text">
                          {site ? `${site.address} · ${new Date().toISOString().slice(0, 10)}` : ''}
                        </text>
                        <text x={left + width - 2} y={290} textAnchor="end" fill="#ffffff" fontSize="8" className="sonde-svg-text">
                          {`Section looking ${sectionView.current} · datum ${yMinWorld.toFixed(1)}m`}
                        </text>
                        <text
                          x={14}
                          y={top + height / 2}
                          transform={`rotate(-90 14 ${top + height / 2})`}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="8.5"
                          className="sonde-svg-text"
                        >
                          Elevation (m)
                        </text>
                      </>
                    )
                  })()}
                </svg>
                <div className="sonde-section-meta sonde-mono">
                  <span>Total {sectionDistanceM.toFixed(1)} m</span>
                  <span>Min {sectionStats?.min.toFixed(1)} m</span>
                  <span>Max {sectionStats?.max.toFixed(1)} m</span>
                </div>
                <div className="sonde-map-tools-row" style={{ padding: '0 0.55rem 0.55rem' }}>
                  <button type="button" className={`sonde-btn ${sectionFlip ? 'sonde-btn--ghost' : 'sonde-btn--primary'}`} onClick={() => setSectionFlip(false)}>
                    {`Looking ${sectionView.backward} ${sectionView.backwardArrow}`}
                  </button>
                  <button type="button" className={`sonde-btn ${sectionFlip ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`} onClick={() => setSectionFlip(true)}>
                    {`Looking ${sectionView.forward} ${sectionView.forwardArrow}`}
                  </button>
                </div>
              </div>
            ) : (
              <p className="sonde-hint">
                {sectionMode ? 'Section mode armed: click point A then B on the map.' : 'Use Draw Section to define a terrain cut.'}
              </p>
            )}
          </section>
          </ModuleErrorBoundary>
          <section className="sonde-panel-wrap" aria-live="polite">
            {panel}
          </section>
        </main>
      </div>
      <div className="sonde-service-indicator sonde-mono" aria-live="polite">
        <span className={`sonde-status-dot sonde-status-dot--${serviceTone}`} />
        <span>
          {`Mapbox ${serviceMark(mapboxStatus)} · Claude ${serviceMark(claudeStatus)} · OSM ${serviceMark(osmStatus)} (${overpassLabel})`}
        </span>
      </div>
    </div>
  )
}
