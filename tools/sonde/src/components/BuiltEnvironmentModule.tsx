import type { BuiltEnvironmentData, SiteLocation } from '../types'

export function BuiltEnvironmentModule({
  site,
  state,
}: {
  site: SiteLocation | null
  state: { status: string; data?: BuiltEnvironmentData; message?: string }
}) {
  if (!site) return <div className="sonde-panel sonde-panel--empty"><p>Built environment data loads after pinning a site.</p></div>
  if (state.status === 'loading') return <div className="sonde-panel sonde-panel--loading"><p>Loading building age/height and EPC context…</p></div>
  if (state.status === 'error') return <div className="sonde-panel sonde-panel--error"><p>{state.message ?? 'Built environment unavailable.'}</p></div>
  if (state.status !== 'ok') return <div className="sonde-panel sonde-panel--empty"><p>Waiting for built environment data.</p></div>
  const d = state.data!
  const postcode = site.address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)?.[0]?.toUpperCase().replace(/\s+/, ' ')
  const epcUrl = postcode
    ? `https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode=${encodeURIComponent(postcode)}`
    : 'https://find-energy-certificate.service.gov.uk'
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head"><h2>Built Environment</h2><p className="sonde-panel-sub">Building period, massing and EPC profile.</p></header>
      <ul className="sonde-flood-list">
        <li><span className="sonde-flood-title">Building count</span><span className="sonde-flood-sub">{d.buildingCount}</span></li>
        <li><span className="sonde-flood-title">Average height</span><span className="sonde-flood-sub">{d.avgHeightM != null ? `${d.avgHeightM.toFixed(1)} m` : 'Unavailable'}</span></li>
        <li><span className="sonde-flood-title">EPC summary</span><span className="sonde-flood-sub">{d.epcSummary}</span></li>
      </ul>
      <h3 className="sonde-subhead">Age distribution</h3>
      <ul className="sonde-flood-list">
        {d.ageBuckets.map((b) => (
          <li key={b.label}><span className="sonde-flood-title">{b.label}</span><span className="sonde-flood-sub">{b.count}</span></li>
        ))}
      </ul>
      <p className="sonde-hint">{d.periodSummary}</p>
      <p className="sonde-hint"><a href={epcUrl} target="_blank" rel="noreferrer">Check EPC ratings →</a></p>
    </div>
  )
}
