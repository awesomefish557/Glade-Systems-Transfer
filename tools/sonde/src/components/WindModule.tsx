import type { WindData } from '../types'
import { sectorPath } from '../utils/svgHelpers'

function windColorMs(ms: number): string {
  if (ms < 2.5) return '#3D7A5C'
  if (ms < 5) return '#7A9B4A'
  if (ms < 7.5) return '#C4A03A'
  if (ms < 10) return '#C4843D'
  return '#A83C32'
}

function compass16(deg: number): string {
  const names = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ]
  const i = Math.round(deg / 22.5) % 16
  return names[(i + 16) % 16]
}

export function WindModule({
  state,
}: {
  state: { status: string; data?: WindData; message?: string }
}) {
  if (state.status === 'idle') {
    return (
      <div className="sonde-panel sonde-panel--empty">
        <p>Wind rose loads once a site is pinned.</p>
      </div>
    )
  }
  if (state.status === 'loading') {
    return (
      <div className="sonde-panel sonde-panel--loading">
        <p>Fetching wind history (92 days)…</p>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="sonde-panel sonde-panel--error">
        <p>{state.message ?? 'Wind data unavailable.'}</p>
      </div>
    )
  }

  const data = state.data!
  const cx = 220
  const cy = 220
  const R = 160
  const maxF = Math.max(...data.bins.map((b) => b.frequency), 1e-6)
  const rings = [0.25, 0.5, 0.75, 1].map((t) => t * maxF)

  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Wind</h2>
        <p className="sonde-panel-sub">
          Open-Meteo hourly · past 92 days · 10 m · bar length = frequency, colour = mean speed
        </p>
      </header>

      <div className="sonde-wind-summary">
        <div className="sonde-stat">
          <span className="sonde-stat-label">Prevailing</span>
          <span className="sonde-stat-val">
            {compass16(data.prevailingDirDeg)} · {data.prevailingAvgSpeed.toFixed(1)} m/s
          </span>
        </div>
      </div>

      <figure className="sonde-figure">
        <svg
          id="sonde-svg-wind"
          viewBox="0 0 440 440"
          className="sonde-svg"
          role="img"
          aria-label="Wind rose"
        >
          <rect width="440" height="440" fill="none" />
          {rings.map((rf, i) => {
            const rr = (rf / maxF) * R
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={rr}
                fill="none"
                stroke="var(--sonde-ink-faint)"
                strokeWidth={0.5}
                strokeDasharray="3 5"
              />
            )
          })}
          <line
            x1={cx}
            y1={cy - R - 8}
            x2={cx}
            y2={cy + R + 8}
            stroke="var(--sonde-ink-muted)"
            strokeWidth={0.5}
          />
          <line
            x1={cx - R - 8}
            y1={cy}
            x2={cx + R + 8}
            y2={cy}
            stroke="var(--sonde-ink-muted)"
            strokeWidth={0.5}
          />
          <text
            x={cx}
            y={cy - R - 18}
            textAnchor="middle"
            fill="var(--sonde-ink-soft)"
            fontSize={11}
            className="sonde-svg-text"
          >
            N
          </text>

          {data.bins.map((b) => {
            const start = b.dirDeg - 360 / 32
            const end = b.dirDeg + 360 / 32
            const len = (b.frequency / maxF) * R
            const d = sectorPath(cx, cy, 8, 8 + len, start, end)
            return (
              <path
                key={b.sectorIndex}
                d={d}
                fill={windColorMs(b.avgSpeed)}
                stroke="var(--sonde-canvas)"
                strokeWidth={0.4}
                opacity={0.92}
              >
                <title>{`${compass16(b.dirDeg)} · ${(b.frequency * 100).toFixed(1)}% · ${b.avgSpeed.toFixed(1)} m/s`}</title>
              </path>
            )
          })}
          <circle cx={cx} cy={cy} r={6} fill="var(--sonde-canvas-elevated)" stroke="var(--sonde-accent-blue)" strokeWidth={1} />
        </svg>
        <figcaption className="sonde-figcaption">
          Ring spacing maps to frequency share of the strongest sector. Colour ramp: calm → gale tendency.
        </figcaption>
      </figure>
    </div>
  )
}
