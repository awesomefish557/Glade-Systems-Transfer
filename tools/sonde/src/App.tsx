import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SunCalc from 'suncalc'
import { AddressSearch } from './components/AddressSearch'
import { BaseMapModule } from './components/BaseMapModule'
import { ClimateModule } from './components/ClimateModule'
import { ExportModule } from './components/ExportModule'
import { FloodModule } from './components/FloodModule'
import { SolarModule } from './components/SolarModule'
import { StatusDot } from './components/StatusDot'
import { WindModule } from './components/WindModule'
import { useClimateData } from './hooks/useClimateData'
import { useFloodData } from './hooks/useFloodData'
import { useOSMData } from './hooks/useOSMData'
import { useSolarData } from './hooks/useSolarData'
import { useWindData } from './hooks/useWindData'
import { azimuthSouthToNorthDeg } from './utils/sunCalc'
import type { ModuleId, SiteLocation, StatusTone } from './types'

const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'solar', label: 'Solar' },
  { id: 'wind', label: 'Wind' },
  { id: 'climate', label: 'Climate' },
  { id: 'flood', label: 'Flood' },
  { id: 'basemap', label: 'Base map' },
  { id: 'export', label: 'Export' },
]

const SECTION_SOURCE_ID = 'sonde-section-source'
const SECTION_LINE_LAYER_ID = 'sonde-section-line'
const SECTION_POINT_LAYER_ID = 'sonde-section-points'
const TERRAIN_SOURCE_ID = 'sonde-dem'
const OSM_BUILDING_SOURCE_ID = 'sonde-osm-buildings'
const OSM_BUILDING_LAYER_ID = 'sonde-osm-buildings-3d'
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

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const a0 = toRad(a.lat)
  const b0 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a0) * Math.cos(b0) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
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

type SectionPoint = { lng: number; lat: number }
type ElevationSample = { lng: number; lat: number; distanceM: number; elevationM: number }

function toneForModule(
  id: ModuleId,
  site: SiteLocation | null,
  wind: ReturnType<typeof useWindData>,
  climate: ReturnType<typeof useClimateData>,
  flood: ReturnType<typeof useFloodData>,
  osm: ReturnType<typeof useOSMData>
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
    case 'basemap':
      if (osm.status === 'ok') return 'green'
      if (osm.status === 'error') return 'red'
      return 'amber'
    case 'export':
      return 'green'
    default:
      return 'amber'
  }
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
  const [sectionMode, setSectionMode] = useState(false)
  const [sectionPoints, setSectionPoints] = useState<SectionPoint[]>([])
  const [sectionProfile, setSectionProfile] = useState<ElevationSample[] | null>(null)

  const solar = useSolarData(site)
  const wind = useWindData(site)
  const climate = useClimateData(site)
  const flood = useFloodData(site)
  const osm = useOSMData(site, radiusM)

  useEffect(() => {
    if (!mapEl.current || !token) return
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [DEFAULT_SITE.lng, DEFAULT_SITE.lat],
      zoom: 16.5,
      attributionControl: true,
      projection: 'mercator',
    })
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('load', () => {
      map.resize()
      setMapLoaded(true)
      if (!map.getSource(TERRAIN_SOURCE_ID)) {
        map.addSource(TERRAIN_SOURCE_ID, {
          type: 'raster-dem',
          url: 'mapbox://mapbox.terrain-rgb',
          tileSize: 512,
          maxzoom: 14,
        })
      }
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
        tone: toneForModule(m.id, site, wind, climate, flood, osm),
      })),
    [site, wind, climate, flood, osm]
  )

  const toneMap = useMemo(() => Object.fromEntries(tones.map((t) => [t.id, t.tone])), [tones])

  const shadowState = useMemo(() => {
    if (!site) return null
    const year = new Date().getFullYear()
    const baseDate = dayOfYearDate(year, shadowDayIndex)
    const times = SunCalc.getTimes(baseDate, site.lat, site.lng)
    const sunriseMs = times.sunrise.getTime()
    const sunsetMs = times.sunset.getTime()
    const spanMs = Math.max(1, sunsetMs - sunriseMs)
    const tMs = sunriseMs + (shadowDayProgress / 1000) * spanMs
    const current = new Date(tMs)
    const p = SunCalc.getPosition(current, site.lat, site.lng)
    const altitude = toDeg(p.altitude)
    const azimuthFromNorth = azimuthSouthToNorthDeg(p.azimuth)
    return {
      date: baseDate,
      time: current,
      sunrise: times.sunrise,
      sunset: times.sunset,
      altitude,
      azimuthFromNorth,
    }
  }, [site, shadowDayIndex, shadowDayProgress])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !shadowState) return
    map.setLight({
      anchor: 'map',
      color: 'white',
      intensity: 0.8,
      position: [1.5, shadowState.azimuthFromNorth, Math.max(0.1, shadowState.altitude)],
    })
  }, [mapLoaded, shadowState])

  const sectionDistanceM = useMemo(() => {
    if (sectionPoints.length < 2) return 0
    return haversineM(sectionPoints[0], sectionPoints[1])
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
    const source = map.getSource(SECTION_SOURCE_ID) as mapboxgl.GeoJSONSource
    const features: GeoJSON.Feature[] = []
    if (sectionPoints.length >= 2) {
      features.push({
        type: 'Feature',
        properties: { kind: 'line' },
        geometry: {
          type: 'LineString',
          coordinates: sectionPoints.map((pt) => [pt.lng, pt.lat]),
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
  }, [mapLoaded, sectionPoints])

  const rebuildSectionProfile = useCallback(
    (start: SectionPoint, end: SectionPoint) => {
      const map = mapRef.current
      if (!map) return
      const distanceM = Math.max(1, haversineM(start, end))
      const steps = Math.max(2, Math.ceil(distanceM / 5))
      const samples: ElevationSample[] = []
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps
        const lng = start.lng + (end.lng - start.lng) * t
        const lat = start.lat + (end.lat - start.lat) * t
        const elevationM = map.queryTerrainElevation([lng, lat], { exaggerated: false }) ?? 0
        samples.push({ lng, lat, distanceM: t * distanceM, elevationM })
      }
      setSectionProfile(samples)
    },
    []
  )

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    map.getCanvas().style.cursor = sectionMode ? 'crosshair' : ''
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
      map.getCanvas().style.cursor = ''
    }
  }, [mapLoaded, rebuildSectionProfile, sectionMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !site || osm.status !== 'ok') return
    const features: GeoJSON.Feature[] = osm.data.buildings
      .map((b) => {
        const ring = b.rings[0]
        if (!ring || ring.length < 4) return null
        const coordinates = [
          ring.map(([lat, lon]) => [lon, lat]),
        ]
        const levels = b.levels ?? 2
        return {
          type: 'Feature',
          properties: { height: levels * 3 },
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
    if (!is3DView && map.getLayer(OSM_BUILDING_LAYER_ID)) {
      map.removeLayer(OSM_BUILDING_LAYER_ID)
    }
  }, [is3DView, mapLoaded, osm, site])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (is3DView) {
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.05 })
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

  const panel = (() => {
    switch (active) {
      case 'solar':
        return <SolarModule data={solar} />
      case 'wind':
        return <WindModule state={wind} />
      case 'climate':
        return <ClimateModule state={climate} />
      case 'flood':
        return <FloodModule site={site} state={flood} />
      case 'basemap':
        return (
          <BaseMapModule site={site} radiusM={radiusM} onRadius={setRadiusM} state={osm} />
        )
      case 'export':
        return (
          <ExportModule
            site={site}
            solar={solar}
            radiusM={radiusM}
            onRadius={setRadiusM}
            osm={osm}
          />
        )
      default:
        return null
    }
  })()

  const downloadSectionSvg = useCallback(() => {
    const el = document.getElementById('sonde-svg-section')
    if (!el) {
      alert('Section SVG not ready.')
      return
    }
    const blob = new Blob([el.outerHTML], { type: 'image/svg+xml;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'sonde-terrain-section.svg'
    a.click()
    URL.revokeObjectURL(a.href)
  }, [])

  return (
    <div className="sonde-root">
      <header className="sonde-topbar">
        <div className="sonde-wordmark" aria-label="Sonde">
          SONDE
        </div>
        <AddressSearch map={mapInstance} onSite={onSite} />
        <div className="sonde-topbar-meta">
          {site ? (
            <span className="sonde-mono sonde-crumb" title={site.address}>
              {site.name}
            </span>
          ) : (
            <span className="sonde-hint-inline">No site fixed</span>
          )}
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
            <div ref={mapEl} className="sonde-map" role="presentation" />
            {shadowState && site ? (
              <div className="sonde-map-overlay sonde-mono">
                <span>{shadowState.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>alt {shadowState.altitude.toFixed(1)}°</span>
                <span>azi {shadowState.azimuthFromNorth.toFixed(1)}°</span>
              </div>
            ) : null}
          </div>

          <section className="sonde-map-tools">
            <div className="sonde-map-tools-row">
              <button
                type="button"
                className={`sonde-btn ${is3DView ? 'sonde-btn--primary' : ''}`}
                disabled={!mapInstance}
                onClick={() => setIs3DView((v) => !v)}
              >
                {is3DView ? 'Flat View' : '3D View'}
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
            </div>

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
                Solar time
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
            </div>

            {sectionProfile && sectionProfile.length > 1 ? (
              <div className="sonde-section-profile">
                <svg id="sonde-svg-section" viewBox="0 0 820 180" className="sonde-svg" role="img" aria-label="Terrain elevation profile">
                  <rect x="0" y="0" width="820" height="180" fill="#FFFFFF" />
                  {(() => {
                    const left = 52
                    const right = 16
                    const top = 12
                    const bottom = 28
                    const width = 820 - left - right
                    const height = 180 - top - bottom
                    const maxD = sectionProfile[sectionProfile.length - 1].distanceM
                    const minE = sectionStats?.min ?? 0
                    const maxE = sectionStats?.max ?? 1
                    const spanE = Math.max(1, maxE - minE)
                    const xStep = 10
                    const xTicks = Math.floor(maxD / xStep)
                    const yStep = niceTickStep(spanE, 5)
                    const yStart = Math.floor(minE / yStep) * yStep
                    const yEnd = Math.ceil(maxE / yStep) * yStep
                    const yTicks: number[] = []
                    for (let y = yStart; y <= yEnd + 1e-9; y += yStep) yTicks.push(y)
                    const points = sectionProfile.map((s) => {
                      const x = left + (s.distanceM / Math.max(1, maxD)) * width
                      const y = top + (1 - (s.elevationM - minE) / spanE) * height
                      return `${x},${y}`
                    })
                    const start = points[0]
                    const end = points[points.length - 1]
                    return (
                      <>
                        <rect x={left} y={top} width={width} height={height} fill="none" stroke="#111111" strokeWidth="0.9" />
                        {Array.from({ length: xTicks + 1 }, (_, i) => i * xStep).map((d) => {
                          const x = left + (d / Math.max(1, maxD)) * width
                          return (
                            <g key={`xt-${d}`}>
                              <line x1={x} y1={top + height} x2={x} y2={top + height + 6} stroke="#111111" strokeWidth="0.8" />
                              <text x={x} y={top + height + 18} textAnchor="middle" fill="#111111" fontSize="8" className="sonde-svg-text">
                                {d}
                              </text>
                            </g>
                          )
                        })}
                        {yTicks.map((elev) => {
                          const y = top + (1 - (elev - minE) / spanE) * height
                          return (
                            <g key={`yt-${elev}`}>
                              <line x1={left - 6} y1={y} x2={left} y2={y} stroke="#111111" strokeWidth="0.8" />
                              <line x1={left} y1={y} x2={left + width} y2={y} stroke="#111111" strokeWidth="0.35" strokeDasharray="2 3" />
                              <text x={left - 10} y={y + 3} textAnchor="end" fill="#111111" fontSize="8" className="sonde-svg-text">
                                {elev.toFixed(1)}
                              </text>
                            </g>
                          )
                        })}
                        <polyline points={points.join(' ')} fill="none" stroke="#111111" strokeWidth="2.6" />
                        <circle cx={start.split(',')[0]} cy={start.split(',')[1]} r="3.2" fill="#FFFFFF" stroke="#111111" strokeWidth="1" />
                        <circle cx={end.split(',')[0]} cy={end.split(',')[1]} r="3.2" fill="#FFFFFF" stroke="#111111" strokeWidth="1" />
                        <text x={left} y={172} fill="#111111" fontSize="10" className="sonde-svg-text">
                          A
                        </text>
                        <text x={left + width - 8} y={172} fill="#111111" fontSize="10" className="sonde-svg-text">
                          B
                        </text>
                        <text x={left + width / 2} y={176} textAnchor="middle" fill="#111111" fontSize="8.5" className="sonde-svg-text">
                          Distance (m, 10 m markers)
                        </text>
                        <text
                          x={14}
                          y={top + height / 2}
                          transform={`rotate(-90 14 ${top + height / 2})`}
                          textAnchor="middle"
                          fill="#111111"
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
              </div>
            ) : (
              <p className="sonde-hint">
                {sectionMode ? 'Section mode armed: click point A then B on the map.' : 'Use Draw Section to define a terrain cut.'}
              </p>
            )}
          </section>
          <section className="sonde-panel-wrap" aria-live="polite">
            {panel}
          </section>
        </main>
      </div>
    </div>
  )
}
