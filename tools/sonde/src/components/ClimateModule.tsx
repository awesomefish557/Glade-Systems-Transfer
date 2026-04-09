import type { ClimateData } from '../types'

const CHART_W = 720
const CHART_H = 280
const PAD_L = 48
const PAD_R = 128
const PAD_T = 28
const PAD_B = 52
const RAIN_MIN = 0
const RAIN_MAX = 150
const TEMP_MIN = -5
const TEMP_MAX = 25
const RAD_MIN = 0
const RAD_MAX = 200

type Rag = 'Green' | 'Amber' | 'Red'

type ProjectionRow = {
  horizon: 'Today' | '2030s' | '2050s' | '2080s'
  tempDeltaC: number
  rainfallDeltaPct: number
  overheatingDays: number
  floodReturnPeriod: string
  rag: Rag
}

const CARDIFF_UKCP18: ProjectionRow[] = [
  { horizon: 'Today', tempDeltaC: 0, rainfallDeltaPct: 0, overheatingDays: 6, floodReturnPeriod: '1 in 100y', rag: 'Green' },
  { horizon: '2030s', tempDeltaC: 0.9, rainfallDeltaPct: -4, overheatingDays: 13, floodReturnPeriod: '1 in 85y', rag: 'Amber' },
  { horizon: '2050s', tempDeltaC: 1.8, rainfallDeltaPct: -9, overheatingDays: 24, floodReturnPeriod: '1 in 65y', rag: 'Amber' },
  { horizon: '2080s', tempDeltaC: 3.1, rainfallDeltaPct: -15, overheatingDays: 44, floodReturnPeriod: '1 in 40y', rag: 'Red' },
]

function ragTone(rag: Rag): { bg: string; border: string; text: string } {
  if (rag === 'Green') return { bg: 'rgba(61, 90, 69, 0.12)', border: '#3d5a45', text: '#b7d5bf' }
  if (rag === 'Amber') return { bg: 'rgba(122, 98, 48, 0.15)', border: '#7a6230', text: '#e1c88f' }
  return { bg: 'rgba(122, 53, 48, 0.15)', border: '#7a3530', text: '#e2aaa1' }
}

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

  const xForMonth = (i: number) => PAD_L + (i + 0.5) * (innerW / 12)

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
  const yP = (p: number) =>
    PAD_T + innerH - ((clamp(p, RAIN_MIN, RAIN_MAX) - RAIN_MIN) / (RAIN_MAX - RAIN_MIN)) * innerH
  const yT = (t: number) =>
    PAD_T + innerH - ((clamp(t, TEMP_MIN, TEMP_MAX) - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * innerH
  const yR = (r: number) =>
    PAD_T + innerH - ((clamp(r, RAD_MIN, RAD_MAX) - RAD_MIN) / (RAD_MAX - RAD_MIN)) * innerH

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
          {[0, 20, 40, 60, 80, 100].map((mm) => {
            const y = yP(mm)
            return (
              <line
                key={`grid-${mm}`}
                x1={PAD_L}
                y1={y}
                x2={CHART_W - PAD_R}
                y2={y}
                stroke="var(--sonde-line)"
                strokeWidth={0.8}
                opacity={0.55}
              />
            )
          })}
          {[120, 140].map((mm) => {
            const y = yP(mm)
            return (
              <line
                key={`grid-hi-${mm}`}
                x1={PAD_L}
                y1={y}
                x2={CHART_W - PAD_R}
                y2={y}
                stroke="var(--sonde-line)"
                strokeWidth={0.8}
                opacity={0.55}
              />
            )
          })}
          <line
            x1={PAD_L}
            y1={PAD_T}
            x2={PAD_L}
            y2={PAD_T + innerH}
            stroke="var(--sonde-ink-muted)"
            strokeWidth={1}
          />
          <line
            x1={CHART_W - PAD_R}
            y1={PAD_T}
            x2={CHART_W - PAD_R}
            y2={PAD_T + innerH}
            stroke="var(--sonde-ink-muted)"
            strokeWidth={1}
          />
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
            const rawH = PAD_T + innerH - y
            const h = m.precipMm > 0 ? Math.max(3, rawH) : rawH
            const yAdj = PAD_T + innerH - h
            return (
              <rect
                key={m.month}
                x={x}
                y={yAdj}
                width={barW}
                height={h}
                fill="#5C7F95"
                opacity={0.95}
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
          {[0, 30, 60, 90, 120, 150].map((mm) => (
            <text
              key={`rain-axis-${mm}`}
              x={PAD_L - 8}
              y={yP(mm) + 3}
              textAnchor="end"
              fill="var(--sonde-ink-soft)"
              fontSize={9}
              className="sonde-svg-text"
            >
              {mm}
            </text>
          ))}
          {[-5, 0, 5, 10, 15, 20, 25].map((c) => (
            <text
              key={`temp-axis-${c}`}
              x={CHART_W - PAD_R + 8}
              y={yT(c) + 3}
              textAnchor="start"
              fill="var(--sonde-ink-soft)"
              fontSize={9}
              className="sonde-svg-text"
            >
              {c}
            </text>
          ))}
          {[0, 40, 80, 120, 160, 200].map((r) => (
            <text
              key={`rad-axis-${r}`}
              x={CHART_W - PAD_R + 76}
              y={yR(r) + 3}
              textAnchor="start"
              fill="var(--sonde-ink-muted)"
              fontSize={8}
              className="sonde-svg-text"
            >
              {r}
            </text>
          ))}
          <text
            x={18}
            y={PAD_T + innerH / 2}
            transform={`rotate(-90 18 ${PAD_T + innerH / 2})`}
            textAnchor="middle"
            fill="var(--sonde-ink-muted)"
            fontSize={9}
            className="sonde-svg-text"
          >
            Rain (mm)
          </text>
          <text
            x={CHART_W - PAD_R + 8}
            y={PAD_T + 10}
            textAnchor="start"
            fill="var(--sonde-ink-muted)"
            fontSize={9}
            className="sonde-svg-text"
          >
            Temp (°C)
          </text>
          <text
            x={CHART_W - PAD_R + 56}
            y={PAD_T + 24}
            textAnchor="start"
            fill="var(--sonde-ink-muted)"
            fontSize={8}
            className="sonde-svg-text"
          >
            Rad (kWh/m²)
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

      <section style={{ marginTop: 16 }}>
        <h3 className="sonde-subhead">Climate Projections (UKCP18 · Cardiff)</h3>
        <p className="sonde-hint">
          Time horizons from UKCP18-style planning assumptions for Cardiff. Use as design guidance;
          confirm final values in project-specific climate studies.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
            marginTop: 8,
            marginBottom: 10,
          }}
        >
          {CARDIFF_UKCP18.filter((r) => r.horizon !== 'Today').map((row) => {
            const tone = ragTone(row.rag)
            return (
              <div
                key={row.horizon}
                style={{ border: `1px solid ${tone.border}`, background: tone.bg, padding: '0.55rem 0.6rem' }}
              >
                <div className="sonde-mono" style={{ fontSize: 12, color: 'var(--sonde-ink-soft)' }}>
                  {row.horizon}
                </div>
                <div className="sonde-mono" style={{ fontSize: 12, marginTop: 4 }}>+{row.tempDeltaC.toFixed(1)}°C</div>
                <div className="sonde-mono" style={{ fontSize: 12 }}>{row.rainfallDeltaPct}% rainfall</div>
                <div className="sonde-mono" style={{ fontSize: 12 }}>{row.overheatingDays} overheating d/yr</div>
                <div className="sonde-mono" style={{ fontSize: 12 }}>{row.floodReturnPeriod} flood event</div>
                <div className="sonde-mono" style={{ fontSize: 11, marginTop: 5, color: tone.text }}>
                  {row.rag}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid var(--sonde-edge)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} className="sonde-svg-text">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>
                  Metric
                </th>
                <th style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>
                  Today
                </th>
                <th style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>
                  2050s
                </th>
                <th style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>
                  2080s
                </th>
                <th style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>
                  RAG
                </th>
                <th style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>
                  Design implication
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>Mean temperature change</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>0.0°C</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>+1.8°C</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>+3.1°C</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>Amber → Red</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>
                  Summer overheating → specify external shading to south and west facades.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>Rainfall change</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>0%</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>-9%</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>-15%</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>Amber</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>
                  Drier summers and intense bursts → use blue-green SuDS and rainwater storage.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>Overheating risk days / year</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>6</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>24</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>44</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>Red</td>
                <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--sonde-edge)' }}>
                  Passive cooling first: shading, purge ventilation, thermal mass, and low-g glazing ratios.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '0.45rem' }}>Flood return period change</td>
                <td style={{ padding: '0.45rem' }}>1 in 100y</td>
                <td style={{ padding: '0.45rem' }}>1 in 65y</td>
                <td style={{ padding: '0.45rem' }}>1 in 40y</td>
                <td style={{ padding: '0.45rem' }}>Amber → Red</td>
                <td style={{ padding: '0.45rem' }}>
                  Raise finished floor levels, protect critical plant, and verify exceedance routing.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="sonde-hint" style={{ marginTop: 8 }}>
          Source: UKCP18 projections (CEDA climate data service), Cardiff planning assumptions.
        </p>
      </section>
    </div>
  )
}
