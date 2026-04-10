import { useState } from 'react'
import { useGroundData } from '../hooks/useGroundData'
import type { SiteLocation } from '../types'

function postcodeFromAddress(address: string): string {
  const m = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)
  return m ? m[0].toUpperCase().replace(/\s+/, ' ') : ''
}

export function GroundModule({ site }: { site: SiteLocation | null }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const state = useGroundData(site, refreshKey)

  const data = state.status === 'ok' ? state.data : null

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
        <p>Loading LiDAR and indicative ground context…</p>
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

  const postcode = postcodeFromAddress(site.address)
  const bgsUrl = `https://map.bgs.ac.uk/bgs_views/do_detail.html?lat=${site.lat}&lng=${site.lng}`
  const egmsUrl = `https://egms.land.copernicus.eu/?lat=${site.lat}&lng=${site.lng}`
  const bearingRagClass =
    data.bearing.rag === 'green' ? 'sonde-risk--low' : data.bearing.rag === 'amber' ? 'sonde-risk--med' : 'sonde-risk--high'
  const bearingBadge =
    data.bearing.rag === 'green' ? 'Good' : data.bearing.rag === 'amber' ? 'Moderate' : 'Poor'
  const moveRagClass =
    data.movementRag === 'blue'
      ? 'sonde-risk--low'
      : data.movementRag === 'green'
        ? 'sonde-risk--low'
        : data.movementRag === 'amber'
          ? 'sonde-risk--med'
          : 'sonde-risk--high'
  const moveEmoji =
    data.movementClassification === 'Uplift'
      ? '🔵'
      : data.movementClassification === 'Stable'
        ? '🟢'
        : data.movementClassification === 'Slow movement'
          ? '🟡'
          : '🔴'
  const cum = data.movementCumulativeSeries ?? []
  const chartW = 280
  const chartH = 72
  let chartPath = ''
  let chartMin = 0
  let chartMax = 1
  if (cum.length > 1) {
    const ys = cum.map((c) => c.cumulativeMm)
    chartMin = Math.min(...ys)
    chartMax = Math.max(...ys)
    const pad = Math.max(1, (chartMax - chartMin) * 0.08)
    const y0 = chartMin - pad
    const y1 = chartMax + pad
    const span = y1 - y0 || 1
    chartPath = cum
      .map((c, i) => {
        const x = (i / (cum.length - 1)) * chartW
        const y = chartH - ((c.cumulativeMm - y0) / span) * chartH
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Ground</h2>
        <p className="sonde-panel-sub">
          Browser-safe mode: LiDAR is live, while geology and movement are indicative summaries with direct links to official viewers.
        </p>
      </header>

      <div className="sonde-map-tools-row" style={{ marginBottom: 10 }}>
        <button type="button" className="sonde-btn sonde-btn--primary" onClick={() => setRefreshKey((k) => k + 1)}>
          Refresh Ground Data
        </button>
      </div>

      <h3 className="sonde-subhead">LiDAR elevation (live)</h3>
      <ul className="sonde-flood-list">
        <li><span className="sonde-flood-title">Ground elevation at site (AOD)</span><span className="sonde-flood-sub">{data.dtmAodM?.toFixed(2) ?? '—'} m</span></li>
        <li><span className="sonde-flood-title">Building height (DSM-DTM)</span><span className="sonde-flood-sub">{data.buildingHeightM != null ? `${data.buildingHeightM.toFixed(2)} m` : '—'}</span></li>
        <li><span className="sonde-flood-title">Surveyed date</span><span className="sonde-flood-sub">{data.surveyedDate || 'Unknown'}</span></li>
      </ul>

      <h3 className="sonde-subhead">BGS geology (live when available)</h3>
      <ul className="sonde-flood-list">
        <li><span className="sonde-flood-title">Postcode</span><span className="sonde-flood-sub">{postcode || 'Not detected'}</span></li>
        <li><span className="sonde-flood-title">Superficial deposits</span><span className="sonde-flood-sub">{data.superficialType}</span></li>
        <li><span className="sonde-flood-title">Bedrock</span><span className="sonde-flood-sub">{data.bedrockType}</span></li>
        <li><span className="sonde-flood-title">Area notes</span><span className="sonde-flood-sub">{data.superficialEngineering || 'No notes available'}</span></li>
      </ul>
      <p className="sonde-hint">
        Live BGS values are used when returned; otherwise postcode-level fallback geology is shown.
      </p>
      <p className="sonde-hint">
        <a href={bgsUrl} target="_blank" rel="noreferrer">BGS GeoIndex -&gt;</a>
      </p>

      <h3 className="sonde-subhead">Ground movement (EGMS)</h3>
      <div className={`sonde-risk ${moveRagClass}`} style={{ marginBottom: 12 }}>
        <span className="sonde-risk-label">{moveEmoji} {data.movementClassification}</span>
        <span className="sonde-risk-val" style={{ fontSize: '1.75rem', fontWeight: 700 }}>
          {data.movementMeanMmYr != null ? `${data.movementMeanMmYr.toFixed(1)} mm/year` : '—'}
        </span>
        <span className="sonde-risk-meta">
          Measured by Sentinel-1 (EGMS). Negative = subsidence, positive = uplift. Typical precision ~1–2 mm/yr; dense points near cities.
        </span>
      </div>
      {cum.length > 1 ? (
        <div style={{ marginBottom: 12 }}>
          <p className="sonde-hint" style={{ marginBottom: 6 }}>
            Cumulative displacement (linear model from mean velocity × observation window)
          </p>
          <svg width={chartW} height={chartH} style={{ display: 'block', maxWidth: '100%' }} aria-hidden>
            <rect width={chartW} height={chartH} fill="rgba(0,0,0,0.2)" rx={4} />
            <path d={chartPath} fill="none" stroke="var(--sonde-accent, #E8621A)" strokeWidth={2} />
          </svg>
        </div>
      ) : null}
      <div className="sonde-map-tools-row" style={{ marginBottom: 8 }}>
        <a href={egmsUrl} target="_blank" rel="noreferrer" className="sonde-btn sonde-btn--primary">
          View ground movement at this site -&gt;
        </a>
      </div>
      <iframe
        title="EGMS viewer embed attempt"
        src={egmsUrl}
        style={{ width: '100%', height: 220, border: '1px solid var(--sonde-edge)', background: '#11100e' }}
        loading="lazy"
      />
      <ul className="sonde-flood-list">
        <li><span className="sonde-flood-title">Mean velocity</span><span className="sonde-flood-sub">{data.movementMeanMmYr != null ? `${data.movementMeanMmYr.toFixed(2)} mm/year` : 'Unavailable'}</span></li>
        <li><span className="sonde-flood-title">Seasonal amplitude</span><span className="sonde-flood-sub">{data.seasonalAmplitudeMm != null ? `${data.seasonalAmplitudeMm.toFixed(2)} mm` : 'Unavailable'}</span></li>
        <li>
          <span className="sonde-flood-title">Measurement points</span>
          <span className="sonde-flood-sub">
            {data.movementPoints || 0}
            {data.movementPoints ? ' within ~500 m' : ''}
          </span>
        </li>
        <li><span className="sonde-flood-title">Measurement map</span><span className="sonde-flood-sub"><a href={egmsUrl} target="_blank" rel="noreferrer">Open EGMS map at site</a></span></li>
      </ul>
      <p className="sonde-hint">
        Cardiff typical movement: -0.5 to -2mm/year subsidence. Alluvial areas near Taff: higher movement risk. Check EGMS viewer for site-specific data.
      </p>

      <h3 className="sonde-subhead">Bearing capacity</h3>
      <div className={`sonde-risk ${bearingRagClass}`}>
        <span className="sonde-risk-label">{`${bearingBadge} bearing`}</span>
        <span className="sonde-risk-val">{data.bearing.capacityKpa}</span>
        <span className="sonde-risk-meta">{data.bearing.rationale}</span>
        <span className="sonde-risk-meta">
          {data.bearing.rag === 'green' ? 'Green: rock/dense gravel' : data.bearing.rag === 'amber' ? 'Amber: stiff clay/gravel' : 'Red: soft clay/made ground'}
        </span>
      </div>

      <h3 className="sonde-subhead">Design implications</h3>
      <ul className="sonde-flood-list">
        {data.designImplications.length
          ? data.designImplications.map((x, i) => <li key={i}><span className="sonde-flood-sub">- {x}</span></li>)
          : <li><span className="sonde-flood-sub">No Claude advisory bullets returned.</span></li>}
      </ul>
    </div>
  )
}
