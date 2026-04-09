import type { SolarSummary } from '../types'
import { azimuthToXY, formatHourLabel, sectorPath, stereographicRadius } from '../utils/svgHelpers'

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function pathForCurve(
  cx: number,
  cy: number,
  R: number,
  curve: SolarSummary['curves'][0]
): string {
  if (!curve.points.length) return ''
  const parts: string[] = []
  curve.points.forEach((pt, i) => {
    const r = stereographicRadius(pt.alt, R)
    const { x, y } = azimuthToXY(r, pt.azimuthFromNorth)
    const px = cx + x
    const py = cy + y
    parts.push(i === 0 ? `M ${px} ${py}` : `L ${px} ${py}`)
  })
  return parts.join(' ')
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Infer the daylight-bearing interval as the complement of the largest circular gap. */
function daylightBearingInterval(points: { azimuthFromNorth: number }[]): { start: number; end: number } | null {
  if (!points.length) return null
  const az = points.map((p) => normalizeDeg(p.azimuthFromNorth)).sort((a, b) => a - b)
  if (az.length === 1) return { start: az[0], end: az[0] }

  let maxGap = -1
  let gapStart = az[0]
  let gapEnd = az[0]
  for (let i = 0; i < az.length; i++) {
    const a = az[i]
    const b = i === az.length - 1 ? az[0] + 360 : az[i + 1]
    const g = b - a
    if (g > maxGap) {
      maxGap = g
      gapStart = a
      gapEnd = normalizeDeg(b)
    }
  }

  const start = gapEnd
  const end = gapStart
  return { start, end }
}

function isBearingInArc(bearingDeg: number, startDeg: number, endDeg: number): boolean {
  const b = normalizeDeg(bearingDeg)
  const s = normalizeDeg(startDeg)
  const e = normalizeDeg(endDeg)
  if (s <= e) return b >= s && b <= e
  return b >= s || b <= e
}

export function SolarModule({ data }: { data: SolarSummary | null }) {
  const cx = 260
  const cy = 260
  const R = 220

  if (!data) {
    return (
      <div className="sonde-panel sonde-panel--empty">
        <p>Drop a site pin to compute solar geometry.</p>
      </div>
    )
  }

  const alts = [0, 30, 60]
  const cardinals = [
    { label: 'N', deg: 0 },
    { label: 'E', deg: 90 },
    { label: 'S', deg: 180 },
    { label: 'W', deg: 270 },
  ]
  const ringCenter = 260
  const ringOuter = 185
  const ringBand = 26
  const ringGap = 8
  const seasonOrder: SolarSummary['curves'] = [
    ...data.curves.filter((c) => c.seasonKey === 'summer'),
    ...data.curves.filter((c) => c.seasonKey === 'autumn'),
    ...data.curves.filter((c) => c.seasonKey === 'spring'),
    ...data.curves.filter((c) => c.seasonKey === 'winter'),
  ]
  const angleStep = 2
  const angleBuckets = Array.from({ length: Math.floor(360 / angleStep) }, (_, i) => i * angleStep)

  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Solar</h2>
        <p className="sonde-panel-sub">
          Stereographic sun paths · equinoxes & solstices · local solar time axis
        </p>
      </header>

      <div className="sonde-solar-grid">
        <div className="sonde-solar-stats">
          <div className="sonde-stat">
            <span className="sonde-stat-label">Sunrise (today)</span>
            <span className="sonde-stat-val">{fmtTime(data.sunrise)}</span>
          </div>
          <div className="sonde-stat">
            <span className="sonde-stat-label">Sunset (today)</span>
            <span className="sonde-stat-val">{fmtTime(data.sunset)}</span>
          </div>
          <div className="sonde-stat">
            <span className="sonde-stat-label">Solar noon elevation</span>
            <span className="sonde-stat-val">{data.solarNoonElevationDeg.toFixed(1)}°</span>
          </div>
          <div className="sonde-stat">
            <span className="sonde-stat-label">Daylight (today)</span>
            <span className="sonde-stat-val">{data.daylightHours.toFixed(2)} h</span>
          </div>
        </div>

        <div className="sonde-solar-visuals">
          <figure className="sonde-figure">
            <svg
              id="sonde-svg-solar"
              viewBox="0 0 520 520"
              className="sonde-svg"
              role="img"
              aria-label="Stereographic sun path diagram"
            >
            <rect width="520" height="520" fill="none" />
            <g opacity={0.35}>
              {alts.map((a) => (
                <circle
                  key={a}
                  cx={cx}
                  cy={cy}
                  r={stereographicRadius(a, R)}
                  fill="none"
                  stroke="var(--sonde-ink-muted)"
                  strokeWidth={a === 0 ? 1.25 : 0.75}
                  strokeDasharray={a === 0 ? '0' : '4 6'}
                />
              ))}
              <circle cx={cx} cy={cy} r={3} fill="var(--sonde-accent-orange)" />
            </g>

            {cardinals.map((c) => {
              const outer = azimuthToXY(R + 18, c.deg)
              const inner = azimuthToXY(R, c.deg)
              return (
                <g key={c.label}>
                  <line
                    x1={cx + inner.x}
                    y1={cy + inner.y}
                    x2={cx + outer.x}
                    y2={cy + outer.y}
                    stroke="var(--sonde-ink-faint)"
                    strokeWidth={0.75}
                  />
                  <text
                    x={cx + outer.x}
                    y={cy + outer.y}
                    fill="var(--sonde-ink-soft)"
                    fontSize={11}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="sonde-svg-text"
                  >
                    {c.label}
                  </text>
                </g>
              )
            })}

            <text
              x={cx}
              y={24}
              textAnchor="middle"
              fill="var(--sonde-ink-muted)"
              fontSize={10}
              className="sonde-svg-text"
            >
              Altitude rings: 0° · 30° · 60° (zenith at centre)
            </text>

            {data.curves.map((curve) => (
              <g key={curve.seasonKey}>
                <path
                  d={pathForCurve(cx, cy, R, curve)}
                  fill="none"
                  stroke={curve.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {curve.points
                  .filter((p) => p.t.getMinutes() === 0 && p.t.getHours() % 2 === 0)
                  .map((p) => {
                    const r = stereographicRadius(p.alt, R)
                    const { x, y } = azimuthToXY(r, p.azimuthFromNorth)
                    return (
                      <g key={p.t.toISOString()}>
                        <circle
                          cx={cx + x}
                          cy={cy + y}
                          r={2.2}
                          fill={curve.color}
                          stroke="var(--sonde-canvas)"
                          strokeWidth={0.5}
                        />
                        <title>{`${curve.label} ${formatHourLabel(p.t)} local`}</title>
                      </g>
                    )
                  })}
              </g>
            ))}
            </svg>
            <figcaption className="sonde-figcaption">
              <span className="sonde-legend-item">
                <i style={{ background: '#5B8FA8' }} /> Winter solstice
              </span>
              <span className="sonde-legend-item">
                <i style={{ background: '#7A9B6B' }} /> Spring equinox
              </span>
              <span className="sonde-legend-item">
                <i style={{ background: '#E8621A' }} /> Summer solstice
              </span>
              <span className="sonde-legend-item">
                <i style={{ background: '#C4A574' }} /> Autumn equinox
              </span>
            </figcaption>
          </figure>

          <figure className="sonde-figure">
            <svg
              id="sonde-svg-solar-availability"
              viewBox="0 0 600 650"
              className="sonde-svg"
              role="img"
              aria-label="Solar availability ring by compass bearing"
            >
              <rect width="600" height="650" fill="none" />
              {seasonOrder.map((curve, idx) => {
                const rOuter = ringOuter - idx * (ringBand + ringGap)
                const rInner = rOuter - ringBand
                const interval = daylightBearingInterval(curve.points)
                return (
                  <g key={`ring-${curve.seasonKey}`}>
                    {angleBuckets.map((start) => {
                      const mid = start + angleStep / 2
                      const isLit =
                        interval !== null && isBearingInArc(mid, interval.start, interval.end)
                      const segStart = start + 0.25
                      const segEnd = start + angleStep - 0.25
                      return (
                        <path
                          key={`${curve.seasonKey}-${start}`}
                          d={sectorPath(ringCenter, ringCenter, rInner, rOuter, segStart, segEnd)}
                          fill={isLit ? '#d4a853' : '#555555'}
                          fillOpacity={1}
                          stroke="none"
                        />
                      )
                    })}
                  </g>
                )
              })}

              {cardinals.map((c) => {
                const outer = azimuthToXY(ringOuter + 16, c.deg)
                const inner = azimuthToXY(ringOuter - 4, c.deg)
                return (
                  <g key={`avail-${c.label}`}>
                    <line
                      x1={ringCenter + inner.x}
                      y1={ringCenter + inner.y}
                      x2={ringCenter + outer.x}
                      y2={ringCenter + outer.y}
                      stroke="var(--sonde-ink-soft)"
                      strokeWidth={1}
                    />
                    {c.label === 'N' ? (
                      <text
                        x={ringCenter + outer.x}
                        y={ringCenter + outer.y - 8}
                        fill="var(--sonde-ink)"
                        fontSize={13}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="sonde-svg-text"
                      >
                        N
                      </text>
                    ) : null}
                  </g>
                )
              })}

              <text
                x={ringCenter}
                y={36}
                textAnchor="middle"
                fill="var(--sonde-ink-muted)"
                fontSize={10}
                className="sonde-svg-text"
              >
                Solar availability ring (yellow = sun present at bearing)
              </text>

            </svg>
            <figcaption className="sonde-figcaption">
              <span className="sonde-legend-item">
                <i style={{ background: '#d4a853' }} /> Bearing reached by sun
              </span>
              <span className="sonde-legend-item">
                <i style={{ background: '#555555' }} /> No direct solar bearing
              </span>
              <span className="sonde-legend-item">
                Outermost ring: Summer solstice
              </span>
              <span className="sonde-legend-item">
                Second ring: Vernal equinox
              </span>
              <span className="sonde-legend-item">
                Third ring: Autumnal equinox
              </span>
              <span className="sonde-legend-item">
                Innermost ring: Winter solstice
              </span>
            </figcaption>
          </figure>
        </div>
      </div>
    </div>
  )
}
