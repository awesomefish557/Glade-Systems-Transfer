import { useMemo, useState } from 'react'
import { useGroundData } from '../hooks/useGroundData'
import type { GroundData, SiteLocation } from '../types'

function ragLabel(rag: 'green' | 'amber' | 'red'): string {
  return rag === 'green' ? '🟢' : rag === 'amber' ? '🟡' : '🔴'
}

function summaryRows(data: GroundData): string[] {
  return [
    `Terrain: ${data.dtmAodM?.toFixed(1) ?? '—'}m AOD · Slope ${data.slopePct50m?.toFixed(1) ?? '—'}%`,
    `Geology: ${data.superficialType} over ${data.bedrockType}`,
    `Bearing: ${ragLabel(data.bearing.rag)} ${data.bearing.classLabel} (~${data.bearing.capacityKpa} kPa)`,
    `Movement: ${ragLabel(data.movementRag)} ${data.movementMeanMmYr?.toFixed(1) ?? '—'} mm/yr ${data.movementClassification.toLowerCase()}`,
    `Made Ground: ${data.madeGroundDetected ? '⚠ Possible' : 'Not detected'}`,
    'Flood Risk: See flood tab',
  ]
}

function MovementMiniChart({ series }: { series: GroundData['movementSeries'] }) {
  if (!series.length) return <p className="sonde-hint">No EGMS time series returned for this point set.</p>
  const w = 540
  const h = 130
  const m = 22
  const min = Math.min(...series.map((p) => p.displacementMm))
  const max = Math.max(...series.map((p) => p.displacementMm))
  const span = Math.max(1, max - min)
  const path = series
    .map((p, i) => {
      const x = m + (i / Math.max(1, series.length - 1)) * (w - m * 2)
      const y = h - m - ((p.displacementMm - min) / span) * (h - m * 2)
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sonde-svg" role="img" aria-label="Ground movement time series">
      <rect x={m} y={m} width={w - m * 2} height={h - m * 2} fill="none" stroke="#4a4640" />
      <path d={path} fill="none" stroke="#E8621A" strokeWidth="1.8" />
      <text x={8} y={14} className="sonde-svg-text" fontSize="8" fill="#8a8378">
        mm
      </text>
      <text x={m} y={h - 4} className="sonde-svg-text" fontSize="8" fill="#8a8378">
        {series[0]?.label}
      </text>
      <text x={w - m} y={h - 4} textAnchor="end" className="sonde-svg-text" fontSize="8" fill="#8a8378">
        {series[series.length - 1]?.label}
      </text>
    </svg>
  )
}

export function GroundModule({ site }: { site: SiteLocation | null }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const state = useGroundData(site, refreshKey)

  const data = state.status === 'ok' ? state.data : null
  const movementLabel = useMemo(() => {
    if (!data || !Number.isFinite(data.movementMeanMmYr)) return '— mm/year'
    const v = data.movementMeanMmYr as number
    return `${v > 0 ? '+' : ''}${v.toFixed(1)} mm/year`
  }, [data])

  if (!site) {
    return (
      <div className="sonde-panel sonde-panel--empty">
        <p>Ground intelligence loads after pinning a UK site.</p>
      </div>
    )
  }
  if (state.status === 'loading') {
    return (
      <div className="sonde-panel sonde-panel--loading">
        <p>Loading LiDAR, BGS and EGMS ground data…</p>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="sonde-panel sonde-panel--error">
        <p>{state.message}</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="sonde-panel sonde-panel--empty">
        <p>Waiting for ground data.</p>
      </div>
    )
  }

  const ampHigh = Number.isFinite(data.seasonalAmplitudeMm) && (data.seasonalAmplitudeMm as number) > 5
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Ground</h2>
        <p className="sonde-panel-sub">
          Ground data from BGS and EGMS Copernicus service. Indicative only — always commission ground investigation before detailed design or planning.
        </p>
      </header>

      <div className="sonde-map-tools-row" style={{ marginBottom: 10 }}>
        <button type="button" className="sonde-btn sonde-btn--primary" onClick={() => setRefreshKey((k) => k + 1)}>
          Refresh Ground Data
        </button>
      </div>

      <h3 className="sonde-subhead">GROUND CONDITIONS SUMMARY</h3>
      <div className="sonde-risk sonde-risk--med">
        {summaryRows(data).map((line, idx) => (
          <span key={idx} className="sonde-risk-val">{line}</span>
        ))}
      </div>

      <div className="sonde-card-grid">
        <article className="sonde-card">
          <h3>LiDAR Terrain</h3>
          <ul className="sonde-flood-list">
            <li><span className="sonde-flood-title">Ground elevation</span><span className="sonde-flood-sub">{data.dtmAodM?.toFixed(2) ?? '—'} m AOD</span></li>
            <li><span className="sonde-flood-title">DSM-DTM building height</span><span className="sonde-flood-sub">{data.buildingHeightM?.toFixed(2) ?? '—'} m</span></li>
            <li><span className="sonde-flood-title">Terrain slope (50m)</span><span className="sonde-flood-sub">{data.slopePct50m?.toFixed(2) ?? '—'}%</span></li>
            <li><span className="sonde-flood-title">Surveyed</span><span className="sonde-flood-sub">{data.surveyedDate ?? 'unknown'}</span></li>
          </ul>
        </article>

        <article className="sonde-card">
          <h3>Superficial Deposits</h3>
          <ul className="sonde-flood-list">
            <li><span className="sonde-flood-title">Type</span><span className="sonde-flood-sub">{data.superficialType}</span></li>
            <li><span className="sonde-flood-title">Thickness</span><span className="sonde-flood-sub">{data.superficialThickness ?? 'n/a'}</span></li>
            <li><span className="sonde-flood-title">Engineering description</span><span className="sonde-flood-sub">{data.superficialEngineering ?? 'n/a'}</span></li>
          </ul>
        </article>

        <article className="sonde-card">
          <h3>Bedrock Geology</h3>
          <ul className="sonde-flood-list">
            <li><span className="sonde-flood-title">Rock type</span><span className="sonde-flood-sub">{data.bedrockType}</span></li>
            <li><span className="sonde-flood-title">Age / formation</span><span className="sonde-flood-sub">{data.bedrockAge ?? 'n/a'}</span></li>
            <li><span className="sonde-flood-title">Depth to bedrock</span><span className="sonde-flood-sub">{data.depthToBedrock ?? 'n/a'}</span></li>
          </ul>
        </article>
      </div>

      {data.madeGroundDetected ? (
        <div className="sonde-risk sonde-risk--high" style={{ marginTop: 12 }}>
          <span className="sonde-risk-label">⚠ Made Ground Detected</span>
          <span className="sonde-risk-val">This site may contain disturbed or filled material. Contamination screening and ground investigation strongly recommended before design.</span>
        </div>
      ) : null}

      <h3 className="sonde-subhead">Bearing Capacity Estimate</h3>
      <div className={`sonde-risk ${data.bearing.rag === 'green' ? 'sonde-risk--low' : data.bearing.rag === 'amber' ? 'sonde-risk--med' : 'sonde-risk--high'}`}>
        <span className="sonde-risk-label">{ragLabel(data.bearing.rag)} {data.bearing.classLabel}</span>
        <span className="sonde-risk-val">{data.bearing.capacityKpa} kPa</span>
        <span className="sonde-risk-meta">{data.bearing.rationale}</span>
      </div>

      <h3 className="sonde-subhead">Ground Movement</h3>
      <div className={`sonde-risk ${data.movementRag === 'green' ? 'sonde-risk--low' : data.movementRag === 'amber' ? 'sonde-risk--med' : 'sonde-risk--high'}`}>
        <span className="sonde-risk-label">{ragLabel(data.movementRag)} {data.movementClassification}</span>
        <span className="sonde-risk-val">{movementLabel}</span>
        <span className="sonde-risk-meta">Measurement points: {data.movementPoints} · Date range: {data.movementDateRange ?? 'n/a'}</span>
      </div>
      <p className="sonde-hint">Mean subsidence rate uses EGMS nearby points (negative = subsidence, positive = uplift).</p>
      {ampHigh ? (
        <div className="sonde-risk sonde-risk--high" style={{ marginTop: 8 }}>
          <span className="sonde-risk-label">⚠ Significant seasonal movement detected.</span>
          <span className="sonde-risk-val">Likely shrink-swell clay. Foundation depth is critical.</span>
        </div>
      ) : null}
      <MovementMiniChart series={data.movementSeries} />

      <h3 className="sonde-subhead">Borehole Records (500m)</h3>
      <ul className="sonde-flood-list">
        {data.boreholes.length ? data.boreholes.map((b) => (
          <li key={b.id}>
            <span className="sonde-flood-title">{b.id} · {Math.round(b.distanceM)}m away</span>
            <span className="sonde-flood-sub">Depth: {b.depthM?.toFixed(1) ?? 'n/a'}m · Date: {b.date ?? 'n/a'} · <a href={b.url} target="_blank" rel="noreferrer">BGS borehole viewer</a></span>
          </li>
        )) : <li><span className="sonde-flood-sub">No boreholes returned.</span></li>}
      </ul>
      <p className="sonde-hint">Nearby borehole data may indicate ground conditions at this site.</p>

      <h3 className="sonde-subhead">DESIGN IMPLICATIONS</h3>
      <ul className="sonde-flood-list">
        {data.designImplications.length
          ? data.designImplications.map((x, i) => <li key={i}><span className="sonde-flood-sub">- {x}</span></li>)
          : <li><span className="sonde-flood-sub">No Claude advisory bullets returned.</span></li>}
      </ul>
    </div>
  )
}
