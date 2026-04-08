import type { OSMPlanData, SiteLocation } from '../types'
import { lngLatToLocalM } from '../utils/geoHelpers'

const VIEW = 560
const PAD = 40

function roadWidth(hw: string): number {
  if (hw === 'motorway' || hw === 'trunk') return 4
  if (hw === 'primary') return 3
  if (hw === 'secondary' || hw === 'tertiary') return 2.2
  if (hw === 'residential' || hw === 'living_street' || hw === 'unclassified') return 1.6
  if (hw === 'service') return 1.2
  if (hw === 'footway' || hw === 'path' || hw === 'cycleway' || hw === 'pedestrian') return 0.9
  return 1.2
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

export function BaseMapModule({
  site,
  radiusM,
  onRadius,
  state,
}: {
  site: SiteLocation | null
  radiusM: number
  onRadius: (m: number) => void
  state: { status: string; data?: OSMPlanData; message?: string }
}) {
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
        <p>Querying OpenStreetMap via Overpass…</p>
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
  const barLen = Math.min(80, VIEW * 0.18)
  const metresPerPx = 1 / scale
  const barM = Math.round(barLen * metresPerPx / 10) * 10 || 10
  const barPx = barM / metresPerPx

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
              const d = r.coords
                .map((pt, j) => {
                  const q = project(pt[0], pt[1])
                  const p = T(q.x, q.y)
                  return `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
                })
                .join(' ')
              return (
                <path
                  key={`rd-${i}`}
                  d={d}
                  fill="none"
                  stroke="#111111"
                  strokeWidth={roadWidth(r.highway)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={1}
                />
              )
            })}
            {data.buildings.map((b, bi) =>
              b.rings.map((ring, ri) => (
                <path
                  key={`b-${bi}-${ri}`}
                  d={ringToPath(ring, (lat, lon) => {
                    const q = project(lat, lon)
                    return T(q.x, q.y)
                  })}
                  fill="#FFFFFF"
                  stroke="#111111"
                  strokeWidth={0.9}
                />
              ))
            )}
          </g>
          <line
            x1={pin.x}
            y1={pin.y}
            x2={pin.x}
            y2={pin.y - 22}
            stroke="#111111"
            strokeWidth={2}
          />
          <polygon
            points={`${pin.x},${pin.y - 28} ${pin.x - 6},${pin.y - 18} ${pin.x + 6},${pin.y - 18}`}
            fill="#111111"
          />
          <circle cx={pin.x} cy={pin.y} r={5} fill="#FFFFFF" stroke="#111111" strokeWidth={1} />

          <g transform={`translate(${VIEW - 120}, ${24})`}>
            <polygon points="12,4 12,40 4,32 20,32" fill="none" stroke="#111111" strokeWidth={1} />
            <text x={26} y={22} fill="#111111" fontSize={10} className="sonde-svg-text">
              N
            </text>
          </g>

          <g transform={`translate(${24}, ${VIEW - 36})`}>
            <rect x={0} y={8} width={barPx} height={4} fill="#111111" />
            <line x1={0} y1={4} x2={0} y2={16} stroke="#111111" strokeWidth={1} />
            <line x1={barPx} y1={4} x2={barPx} y2={16} stroke="#111111" strokeWidth={1} />
            <text x={0} y={26} fill="#111111" fontSize={9} className="sonde-svg-text">
              {barM} m
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
