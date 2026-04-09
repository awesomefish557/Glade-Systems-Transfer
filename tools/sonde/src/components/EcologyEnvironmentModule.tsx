import type { EcologyData, SiteLocation } from '../types'

export function EcologyEnvironmentModule({
  site,
  state,
}: {
  site: SiteLocation | null
  state: { status: string; data?: EcologyData; message?: string }
}) {
  if (!site) return <div className="sonde-panel sonde-panel--empty"><p>Ecology data loads after pinning a site.</p></div>
  if (state.status === 'loading') return <div className="sonde-panel sonde-panel--loading"><p>Loading air quality and green infrastructure…</p></div>
  if (state.status === 'error') return <div className="sonde-panel sonde-panel--error"><p>{state.message ?? 'Ecology data unavailable.'}</p></div>
  if (state.status !== 'ok') return <div className="sonde-panel sonde-panel--empty"><p>Waiting for ecology data.</p></div>
  const d = state.data!
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head"><h2>Ecology + Environment</h2><p className="sonde-panel-sub">Air quality, trees and green-space coverage around site.</p></header>
      <div className={`sonde-risk ${d.rag === 'Good' ? 'sonde-risk--low' : d.rag === 'Moderate' ? 'sonde-risk--med' : 'sonde-risk--high'}`}>
        <span className="sonde-risk-label">Green infrastructure status</span>
        <span className="sonde-risk-val">{d.rag}</span>
        <span className="sonde-risk-meta">{d.greenInfraPct}% green infrastructure within 500m</span>
      </div>
      <ul className="sonde-flood-list">
        <li><span className="sonde-flood-title">Nearest air quality station</span><span className="sonde-flood-sub">{d.nearestStation ?? 'Unavailable'}</span></li>
        <li><span className="sonde-flood-title">Annual mean NO2</span><span className="sonde-flood-sub">{d.no2Annual != null ? `${d.no2Annual} µg/m³` : 'Unavailable'}</span></li>
        <li><span className="sonde-flood-title">Annual mean PM2.5</span><span className="sonde-flood-sub">{d.pm25Annual != null ? `${d.pm25Annual} µg/m³` : 'Unavailable'}</span></li>
        <li><span className="sonde-flood-title">Mapped trees</span><span className="sonde-flood-sub">{d.treesCount}</span></li>
      </ul>
      <p className="sonde-hint">
        <a href="https://uk-air.defra.gov.uk/interactive-map" target="_blank" rel="noreferrer">Open DEFRA UK-AIR interactive map →</a>
      </p>
    </div>
  )
}
