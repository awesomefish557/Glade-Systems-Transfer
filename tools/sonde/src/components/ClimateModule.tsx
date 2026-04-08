import type { ClimateData } from '../types'

const CHART_W = 720
const CHART_H = 280
const PAD_L = 48
const PAD_R = 56
const PAD_T = 28
const PAD_B = 52

export function ClimateModule({
  state,
}: {
  state: { status: string; data?: ClimateData; message?: string }
}) {
  if (state.status === 'idle') {
    return (
      <div className="sonde-panel sonde-panel--empty">
        <p>Climate normals load after pinning a site.</p>
      </div>
    )
  }
  if (state.status === 'loading') {
    return (
      <div className="sonde-panel sonde-panel--loading">
        <p>Fetching 1990–2020 monthly climate series…</p>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="sonde-panel sonde-panel--error">
        <p>{state.message ?? 'Climate data unavailable.'}</p>
      </div>
    )
  }

  const months = state.data!.months
  const innerW = CHART_W - PAD_L - PAD_R
  const innerH = CHART_H - PAD_T - PAD_B
  const barW = innerW / 12 - 4
  const maxP = Math.max(...months.map((m) => m.precipMm), 1)
  const temps = months.map((m) => m.tempMean)
  const maxT = Math.max(...temps)
  const minT = Math.min(...temps)
  const tRange = Math.max(maxT - minT, 0.5)
  const maxR = Math.max(...months.map((m) => m.radiationKwhM2), 1)

  const xForMonth = (i: number) => PAD_L + (i + 0.5) * (innerW / 12)

  const yP = (p: number) => PAD_T + innerH - (p / maxP) * innerH * 0.55
  const yT = (t: number) => PAD_T + innerH - ((t - minT) / tRange) * innerH * 0.75
  const yR = (r: number) => PAD_T + innerH - (r / maxR) * innerH * 0.6

  const tempPath = months
    .map((m, i) => `${i === 0 ? 'M' : 'L'} ${xForMonth(i)} ${yT(m.tempMean)}`)
    .join(' ')
  const radPath = months
    .map((m, i) => `${i === 0 ? 'M' : 'L'} ${xForMonth(i)} ${yR(m.radiationKwhM2)}`)
    .join(' ')

  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Climate</h2>
        <p className="sonde-panel-sub">
          Open-Meteo climate API · monthly 1990–2020 · model where provided
        </p>
      </header>

      <figure className="sonde-figure sonde-figure--wide">
        <svg
          id="sonde-svg-climate"
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="sonde-svg"
          role="img"
          aria-label="Monthly climate chart"
        >
          <rect width={CHART_W} height={CHART_H} fill="none" />
          <line
            x1={PAD_L}
            y1={PAD_T + innerH}
            x2={CHART_W - PAD_R}
            y2={PAD_T + innerH}
            stroke="var(--sonde-ink-muted)"
            strokeWidth={1}
          />
          {months.map((m, i) => {
            const x = xForMonth(i) - barW / 2
            const y = yP(m.precipMm)
            const h = PAD_T + innerH - y
            return (
              <rect
                key={m.month}
                x={x}
                y={y}
                width={barW}
                height={h}
                fill="#4A6678"
                opacity={0.85}
              >
                <title>{`${m.label}: rain ${m.precipMm.toFixed(0)} mm`}</title>
              </rect>
            )
          })}
          <path
            d={tempPath}
            fill="none"
            stroke="#E8621A"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path
            d={radPath}
            fill="none"
            stroke="#2B6CB0"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            opacity={0.95}
          />
          {months.map((m, i) => (
            <text
              key={`lbl-${m.month}`}
              x={xForMonth(i)}
              y={CHART_H - 18}
              textAnchor="middle"
              fill="var(--sonde-ink-soft)"
              fontSize={10}
              className="sonde-svg-text"
            >
              {m.label}
            </text>
          ))}
          <text
            x={8}
            y={PAD_T + 12}
            fill="var(--sonde-ink-muted)"
            fontSize={9}
            className="sonde-svg-text"
          >
            mm / °C / kWh·m⁻²
          </text>
        </svg>
        <figcaption className="sonde-figcaption">
          <span className="sonde-legend-item">
            <i className="sonde-swatch sonde-swatch--rain" /> Rainfall (mm)
          </span>
          <span className="sonde-legend-item">
            <i className="sonde-swatch sonde-swatch--temp" /> Mean temperature (°C)
          </span>
          <span className="sonde-legend-item">
            <i className="sonde-swatch sonde-swatch--rad" /> Shortwave sum (kWh/m²)
          </span>
        </figcaption>
      </figure>
    </div>
  )
}
