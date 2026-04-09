import { useMemo, useState } from 'react'
import type { OSMPlanData, SiteLocation } from '../types'
import { lngLatToLocalM } from '../utils/geoHelpers'

const VIEW = 560
const PAD = 40

function roadClass(hw: string): 'primary' | 'secondary' | 'footpath' {
  if (hw === 'motorway' || hw === 'trunk' || hw === 'primary') return 'primary'
  if (hw === 'footway' || hw === 'path' || hw === 'cycleway' || hw === 'pedestrian') return 'footpath'
  return 'secondary'
}

function roadWidthForZone(hw: string, zone: 'inner' | 'outer'): number {
  const cls = roadClass(hw)
  if (zone === 'inner') {
    if (cls === 'primary') return 0.6
    if (cls === 'secondary') return 0.6
    return 0.3
  }
  if (cls === 'primary') return 0.4
  if (cls === 'secondary') return 0.4
  return 0.3
}

function roadColorForZone(hw: string, zone: 'inner' | 'outer'): string {
  const cls = roadClass(hw)
  if (zone === 'inner') return '#111111'
  if (cls === 'primary' || cls === 'secondary') return '#aaaaaa'
  return '#aaaaaa'
}

function roadEdgeOffsetM(hw: string): number {
  if (hw === 'motorway' || hw === 'trunk' || hw === 'primary') return 8
  if (hw === 'footway' || hw === 'path' || hw === 'cycleway' || hw === 'pedestrian') return 1.5
  return 5
}

function ringToPath(ring: [number, number][], project: (lat: number, lon: number) => { x: number; y: number }) {
  if (!ring.length) return ''
  const [f] = ring
  const rest = ring.slice(1)
  const p0 = project(f[0], f[1])
  const segs = [`M ${p0.x} ${p0.y}`]
  for (const pt of rest) {
    const p = project(pt[0], pt[1])
    segs.push(`L ${p.x} ${p.y}`)
  }
  segs.push('Z')
  return segs.join(' ')
}

function offsetPolyline(points: { x: number; y: number }[], offsetM: number): { x: number; y: number }[] {
  if (points.length < 2 || offsetM === 0) return points
  const normals: { x: number; y: number }[] = Array.from({ length: points.length }, () => ({ x: 0, y: 0 }))
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const nx = -dy / len
    const ny = dx / len
    normals[i].x += nx
    normals[i].y += ny
    normals[i + 1].x += nx
    normals[i + 1].y += ny
  }
  return points.map((p, i) => {
    const n = normals[i]
    const len = Math.hypot(n.x, n.y)
    if (len < 1e-6) return p
    return {
      x: p.x + (n.x / len) * offsetM,
      y: p.y + (n.y / len) * offsetM,
    }
  })
}

function linePathFromPoints(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

export function BaseMapModule({
  site,
  radiusM,
  onRadius,
  historicalYear,
  onHistoricalYear,
  historicalOpacity,
  onHistoricalOpacity,
  historicalEnabled,
  onHistoricalEnabled,
  state,
}: {
  site: SiteLocation | null
  radiusM: number
  onRadius: (m: number) => void
  historicalYear: '1890' | '1950' | 'modern'
  onHistoricalYear: (y: '1890' | '1950' | 'modern') => void
  historicalOpacity: number
  onHistoricalOpacity: (n: number) => void
  historicalEnabled: boolean
  onHistoricalEnabled: (v: boolean) => void
  state: { status: string; data?: OSMPlanData; message?: string }
}) {
  const [showLandUse, setShowLandUse] = useState(false)
  const [showBuildingAges, setShowBuildingAges] = useState(false)
  const [showRoadEdges, setShowRoadEdges] = useState(false)
  const [importedGeoJson, setImportedGeoJson] = useState<GeoJSON.FeatureCollection | null>(null)

  if (!site) {
    return (
      <div className="sonde-panel sonde-panel--empty">
        <p>Base map needs a pinned site.</p>
      </div>
    )
  }

  if (state.status === 'loading') {
    return (
      <div className="sonde-panel sonde-panel--loading">
        <p>{state.message ?? 'Loading map data... (may take a moment)'}</p>
        <div className="sonde-radius-row">
          <label className="sonde-label">
            Radius (m)
            <input
              type="range"
              min={50}
              max={500}
              step={50}
              value={radiusM}
              onChange={(e) => onRadius(Number(e.target.value))}
            />
            <span className="sonde-mono">{radiusM} m</span>
          </label>
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="sonde-panel sonde-panel--error">
        <p>{state.message ?? 'OSM request failed.'}</p>
        <div className="sonde-radius-row">
          <label className="sonde-label">
            Radius (m)
            <input
              type="range"
              min={50}
              max={500}
              step={50}
              value={radiusM}
              onChange={(e) => onRadius(Number(e.target.value))}
            />
            <span className="sonde-mono">{radiusM} m</span>
          </label>
        </div>
      </div>
    )
  }

  const data = state.data!
  const originLat = site.lat
  const originLng = site.lng

  const project = (lat: number, lon: number) => {
    const { x, y } = lngLatToLocalM(originLat, originLng, lat, lon)
    return { x, y: -y }
  }

  const origin = project(originLat, originLng)
  let minX = -radiusM
  let maxX = radiusM
  let minY = -radiusM
  let maxY = radiusM

  const consider = (x: number, y: number) => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  consider(origin.x, origin.y)
  for (const b of data.buildings) {
    for (const ring of b.rings) {
      for (const pt of ring) {
        const p = project(pt[0], pt[1])
        consider(p.x, p.y)
      }
    }
  }
  for (const r of data.roads) {
    for (const pt of r.coords) {
      const p = project(pt[0], pt[1])
      consider(p.x, p.y)
    }
  }

  const pad = 24
  minX -= pad
  maxX += pad
  minY -= pad
  maxY += pad

  const w = maxX - minX || 1
  const h = maxY - minY || 1
  const scale = (VIEW - PAD * 2) / Math.max(w, h)
  const tx = PAD + (VIEW - PAD * 2 - w * scale) / 2
  const ty = PAD + (VIEW - PAD * 2 - h * scale) / 2

  const T = (x: number, y: number) => ({
    x: (x - minX) * scale + tx,
    y: (y - minY) * scale + ty,
  })

  const pin = T(origin.x, origin.y)
  const barPx = 120
  const addressLabel = 'Lidl, Maindy Road, Cardiff CF24 4HQ'
  const distToOrigin = (x: number, y: number) => Math.hypot(x - origin.x, y - origin.y)
  const zoneForDist = (d: number): 'inner' | 'outer' => (d <= 200 ? 'inner' : 'outer')

  const buildingScreen = data.buildings.map((b, bi) => {
    const rings = b.rings.map((ring) =>
      ring.map((pt) => {
        const p = project(pt[0], pt[1])
        return { ...p, s: T(p.x, p.y) }
      })
    )
    const first = rings[0]?.[0]
    const dist = first ? distToOrigin(first.x, first.y) : 9999
    return { b, bi, rings, dist, zone: zoneForDist(dist) }
  })
  const siteBuildingIndex = buildingScreen.reduce(
    (best, cur) => (cur.dist < best.dist ? { idx: cur.bi, dist: cur.dist } : best),
    { idx: -1, dist: Number.POSITIVE_INFINITY }
  ).idx

  const importedFeatures = useMemo(() => {
    if (!importedGeoJson) return []
    const out: Array<{ d: string; stroke: string; fill: string; width: number }> = []
    const toScreen = (lat: number, lon: number) => {
      const p = project(lat, lon)
      return T(p.x, p.y)
    }
    for (const f of importedGeoJson.features) {
      if (!f.geometry) continue
      if (f.geometry.type === 'Point') {
        const [lon, lat] = f.geometry.coordinates as [number, number]
        const p = toScreen(lat, lon)
        out.push({
          d: `M ${p.x - 2} ${p.y} L ${p.x + 2} ${p.y} M ${p.x} ${p.y - 2} L ${p.x} ${p.y + 2}`,
          stroke: '#E8621A',
          fill: 'none',
          width: 0.8,
        })
      }
      if (f.geometry.type === 'LineString') {
        const pts = (f.geometry.coordinates as [number, number][]).map(([lon, lat]) => toScreen(lat, lon))
        const d = linePathFromPoints(pts)
        if (d) out.push({ d, stroke: '#E8621A', fill: 'none', width: 0.8 })
      }
      if (f.geometry.type === 'Polygon') {
        const ring = (f.geometry.coordinates?.[0] as [number, number][]) ?? []
        if (!ring.length) continue
        const pts = ring.map(([lon, lat]) => toScreen(lat, lon))
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
        out.push({ d, stroke: '#E8621A', fill: 'rgba(232,98,26,0.08)', width: 0.8 })
      }
    }
    return out
  }, [importedGeoJson, originLat, originLng, minX, minY, scale, tx, ty])

  const osKey = import.meta.env.VITE_OS_API_KEY

  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Base map</h2>
        <p className="sonde-panel-sub">
          OSM buildings + roads/paths · Overpass · {radiusM} m radius · {data.buildings.length}{' '}
          buildings · {data.roads.length} segments
        </p>
      </header>

      <div className="sonde-radius-row">
        <label className="sonde-label">
          Capture radius
          <input
            type="range"
            min={50}
            max={500}
            step={50}
            value={radiusM}
            onChange={(e) => onRadius(Number(e.target.value))}
          />
          <span className="sonde-mono">{radiusM} m</span>
        </label>
        {osKey ? (
          <p className="sonde-hint">
            OS Data Hub key present — browser CORS may still block direct NGD calls; OSM remains primary.
          </p>
        ) : null}
        <button
          type="button"
          className="sonde-btn sonde-btn--ghost"
          onClick={() => setShowRoadEdges((v) => !v)}
        >
          {showRoadEdges ? 'Road edges: ON' : 'Road edges: OFF'}
        </button>
        <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => setShowLandUse((v) => !v)}>
          {showLandUse ? 'Land use colours: ON' : 'Land use colours: OFF'}
        </button>
        <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => setShowBuildingAges((v) => !v)}>
          {showBuildingAges ? 'Building ages: ON' : 'Building ages: OFF'}
        </button>
        <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => onHistoricalEnabled(!historicalEnabled)}>
          {historicalEnabled ? 'History: ON' : 'History: OFF'}
        </button>
        <div className="sonde-map-tools-row">
          <button
            type="button"
            className={`sonde-btn ${historicalEnabled && historicalYear === '1890' ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`}
            onClick={() => {
              onHistoricalEnabled(true)
              onHistoricalYear('1890')
            }}
          >
            1890s
          </button>
          <button
            type="button"
            className={`sonde-btn ${historicalEnabled && historicalYear === '1950' ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`}
            onClick={() => {
              onHistoricalEnabled(true)
              onHistoricalYear('1950')
            }}
          >
            1950s
          </button>
          <button
            type="button"
            className={`sonde-btn ${!historicalEnabled || historicalYear === 'modern' ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`}
            onClick={() => {
              onHistoricalYear('modern')
              onHistoricalEnabled(false)
            }}
          >
            Modern
          </button>
        </div>
        <label className="sonde-label">
          Opacity
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(historicalOpacity * 100)}
            disabled={!historicalEnabled}
            onChange={(e) => onHistoricalOpacity(Number(e.target.value) / 100)}
          />
          <span className="sonde-mono">{Math.round(historicalOpacity * 100)}%</span>
        </label>
        {historicalEnabled ? (
          <p className="sonde-hint">
            Viewing {historicalYear === '1890' ? '1890s' : '1950s'} OS map · National Library of Scotland
          </p>
        ) : null}
        <label className="sonde-btn sonde-btn--ghost" style={{ cursor: 'pointer' }}>
          GeoJSON import
          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              try {
                const txt = await f.text()
                const j = JSON.parse(txt) as GeoJSON.FeatureCollection
                if (j?.type === 'FeatureCollection' && Array.isArray(j.features)) setImportedGeoJson(j)
              } catch {
                alert('Invalid GeoJSON file.')
              }
            }}
          />
        </label>
      </div>

      <figure className="sonde-figure">
        <svg
          id="sonde-svg-basemap"
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="sonde-svg"
          role="img"
          aria-label="Site plan from OSM"
        >
          <rect width={VIEW} height={VIEW} fill="#FFFFFF" />
          <g opacity={0.9}>
            {data.roads.map((r, i) => {
              if (r.coords.length < 2) return null
              const localPts = r.coords.map((pt) => project(pt[0], pt[1]))
              const screenPts = localPts.map((p) => T(p.x, p.y))
              const zone = zoneForDist(distToOrigin(localPts[0].x, localPts[0].y))
              const d = linePathFromPoints(screenPts)
              if (!d) return null
              if (showRoadEdges) {
                const offsetM = roadEdgeOffsetM(r.highway)
                const edgeA = linePathFromPoints(offsetPolyline(screenPts, offsetM * scale))
                const edgeB = linePathFromPoints(offsetPolyline(screenPts, -offsetM * scale))
                return (
                  <g key={`rd-edge-${i}`}>
                    {edgeA ? (
                      <path
                        d={edgeA}
                        fill="none"
                        stroke={roadColorForZone(r.highway, zone)}
                        strokeWidth={roadWidthForZone(r.highway, zone)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={1}
                      />
                    ) : null}
                    {edgeB ? (
                      <path
                        d={edgeB}
                        fill="none"
                        stroke={roadColorForZone(r.highway, zone)}
                        strokeWidth={roadWidthForZone(r.highway, zone)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={1}
                      />
                    ) : null}
                  </g>
                )
              }
              return (
                <path
                  key={`rd-${i}`}
                  d={d}
                  fill="none"
                  stroke={roadColorForZone(r.highway, zone)}
                  strokeWidth={roadWidthForZone(r.highway, zone)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={1}
                />
              )
            })}
            {buildingScreen.map(({ b, bi, zone }) =>
              b.rings.map((ring, ri) => (
                <path
                  key={`b-${bi}-${ri}`}
                  d={ringToPath(ring, (lat, lon) => {
                    const q = project(lat, lon)
                    return T(q.x, q.y)
                  })}
                  fill={
                    bi === siteBuildingIndex
                      ? '#E8621A'
                      : showLandUse
                        ? zone === 'inner'
                          ? '#e9e7d8'
                          : '#f3f3f3'
                        : '#FFFFFF'
                  }
                  stroke={zone === 'inner' ? '#111111' : '#cccccc'}
                  strokeWidth={zone === 'inner' ? 0.4 : 0.3}
                  opacity={showBuildingAges ? (bi % 3 === 0 ? 1 : 0.8) : 1}
                />
              ))
            )}
            {importedFeatures.map((f, i) => (
              <path key={`imp-${i}`} d={f.d} fill={f.fill} stroke={f.stroke} strokeWidth={f.width} />
            ))}
          </g>
          <line x1={pin.x} y1={pin.y} x2={pin.x} y2={pin.y - 28} stroke="#111111" strokeWidth={0.6} />
          <polygon
            points={`${pin.x},${pin.y - 36} ${pin.x - 8},${pin.y - 24} ${pin.x + 8},${pin.y - 24}`}
            fill="#111111"
          />
          <circle cx={pin.x} cy={pin.y} r={8} fill="#FFFFFF" stroke="#111111" strokeWidth={0.6} />
          <line x1={pin.x - 12} y1={pin.y} x2={pin.x + 12} y2={pin.y} stroke="#111111" strokeWidth={0.6} />
          <line x1={pin.x} y1={pin.y - 12} x2={pin.x} y2={pin.y + 12} stroke="#111111" strokeWidth={0.6} />

          <g transform={`translate(${VIEW - 84}, ${16})`}>
            <polygon points="12,4 12,40 4,32 20,32" fill="none" stroke="#111111" strokeWidth={1} />
            <text x={26} y={22} fill="#111111" fontSize={10} className="sonde-svg-text">
              N
            </text>
          </g>

          <g transform={`translate(${24}, ${VIEW - 42})`}>
            <rect x={0} y={10} width={barPx / 2} height={6} fill="#111111" />
            <rect x={barPx / 2} y={10} width={barPx / 2} height={6} fill="#FFFFFF" stroke="#111111" strokeWidth={0.9} />
            <line x1={0} y1={7} x2={0} y2={20} stroke="#111111" strokeWidth={1} />
            <line x1={barPx / 2} y1={7} x2={barPx / 2} y2={20} stroke="#111111" strokeWidth={1} />
            <line x1={barPx} y1={7} x2={barPx} y2={20} stroke="#111111" strokeWidth={1} />
            <text x={0} y={30} fill="#111111" fontSize={10} className="sonde-svg-text">
              0
            </text>
            <text x={barPx / 2} y={30} textAnchor="middle" fill="#111111" fontSize={10} className="sonde-svg-text">
              250
            </text>
            <text x={barPx} y={30} textAnchor="end" fill="#111111" fontSize={10} className="sonde-svg-text">
              500m
            </text>
          </g>

          <g transform={`translate(${VIEW - 16}, ${VIEW - 12})`}>
            <text x={0} y={0} textAnchor="end" fill="#111111" fontSize={10} className="sonde-svg-text">
              {addressLabel}
            </text>
          </g>
        </svg>
        <figcaption className="sonde-figcaption">
          Clean black/white trace plan with north arrow and scale bar (local tangent-plane drawing, not a legal survey).
        </figcaption>
      </figure>
    </div>
  )
}
