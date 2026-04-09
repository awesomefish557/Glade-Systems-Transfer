import type { DemographicsData, SiteLocation } from '../types'

export function DemographicsModule({
  site,
  state,
}: {
  site: SiteLocation | null
  state: { status: string; data?: DemographicsData; message?: string }
}) {
  if (!site) return <div className="sonde-panel sonde-panel--empty"><p>Demographics load after pinning a site.</p></div>
  if (state.status === 'loading') return <div className="sonde-panel sonde-panel--loading"><p>Loading ONS demographics…</p></div>
  if (state.status === 'error') return <div className="sonde-panel sonde-panel--error"><p>{state.message ?? 'Demographics unavailable.'}</p></div>
  if (state.status !== 'ok') return <div className="sonde-panel sonde-panel--empty"><p>Waiting for demographics data.</p></div>
  const d = state.data!
  const max = Math.max(...d.ageBands.map((b) => b.count), 1)
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head"><h2>Demographics + Population</h2><p className="sonde-panel-sub">Census profile with nursery-relevant child age callouts.</p></header>
      <div className="sonde-stat-grid">
        <div className="sonde-stat"><span className="sonde-stat-label">Population</span><span className="sonde-stat-val">{d.totalPopulation.toLocaleString()}</span></div>
        <div className="sonde-stat"><span className="sonde-stat-label">Density</span><span className="sonde-stat-val">{d.densityPerKm2?.toLocaleString() ?? '—'} /km²</span></div>
        <div className="sonde-stat"><span className="sonde-stat-label">Under 5</span><span className="sonde-stat-val">{d.under5.toLocaleString()}</span></div>
        <div className="sonde-stat"><span className="sonde-stat-label">Under 16</span><span className="sonde-stat-val">{d.under16.toLocaleString()}</span></div>
      </div>
      <p className="sonde-hint">Key callout: {d.under5.toLocaleString()} children under 5 within 1km (estimated).</p>
      <figure className="sonde-figure">
        <svg id="sonde-svg-demographics" viewBox="0 0 760 260" className="sonde-svg" role="img" aria-label="Age profile bars">
          <rect width="760" height="260" fill="none" />
          {d.ageBands.map((b, i) => {
            const y = 24 + i * 36
            const w = (b.count / max) * 500
            return (
              <g key={b.label}>
                <text x="16" y={y + 14} fontSize="11" fill="var(--sonde-ink-soft)" className="sonde-svg-text">{b.label}</text>
                <rect x="130" y={y} width={w} height="18" fill="#2b6cb0" />
                <text x={136 + w} y={y + 14} fontSize="10" fill="var(--sonde-ink-soft)" className="sonde-svg-text">{b.count}</text>
              </g>
            )
          })}
        </svg>
      </figure>
      <ul className="sonde-flood-list">
        <li><span className="sonde-flood-title">Households</span><span className="sonde-flood-sub">{d.households}</span></li>
        <li><span className="sonde-flood-title">IMD</span><span className="sonde-flood-sub">{d.imdScore != null ? `${d.imdScore.toFixed(1)} (decile ${d.imdDecile ?? '—'})` : 'Check official IMD source'}</span></li>
        <li><span className="sonde-flood-title">Tenure split</span><span className="sonde-flood-sub">{d.socialRentPct ?? 0}% social rented · {d.ownerOccupiedPct ?? 0}% owner occupied</span></li>
      </ul>
    </div>
  )
}
