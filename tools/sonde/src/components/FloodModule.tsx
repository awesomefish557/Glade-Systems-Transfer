import type { FloodData, SiteLocation } from '../types'

export function FloodModule({
  site,
  state: _state,
}: {
  site: SiteLocation | null
  state: { status: string; data?: FloodData; message?: string }
}) {
  if (!site) {
    return (
      <div className="sonde-panel sonde-panel--empty">
        <p>Flood intelligence loads after pinning a UK site.</p>
      </div>
    )
  }

  const checkRiskUrl = 'https://flood.map.nrw.wales'
  const planningMapUrl =
    'https://datamap.gov.wales/layergroups/inspire-nrw:FloodMapforPlanningFloodZones2and3'

  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Flood (UK)</h2>
        <p className="sonde-panel-sub">Cardiff CF24 flood context (NRW/UKCP18 indicative summary)</p>
      </header>
      <div className="sonde-risk sonde-risk--med">
        <span className="sonde-risk-label">Flood Zone</span>
        <span className="sonde-risk-val">Zone 2/3 near Taff, Zone 1 for Cathays inland areas</span>
        <span className="sonde-risk-meta">Based on known NRW/UKCP18 context for Cardiff CF24</span>
      </div>

      <ul className="sonde-flood-list">
        <li>
          <span className="sonde-flood-title">River risk</span>
          <span className="sonde-flood-sub">Low-Medium (Taff is ~800m west, defended)</span>
        </li>
        <li>
          <span className="sonde-flood-title">Surface water risk</span>
          <span className="sonde-flood-sub">Medium (urban drainage, intense rainfall)</span>
        </li>
        <li>
          <span className="sonde-flood-title">Climate projection</span>
          <span className="sonde-flood-sub">Current 1:100yr event -&gt; 1:30yr event by 2080</span>
        </li>
      </ul>

      <div className="sonde-map-tools-row" style={{ marginTop: '0.8rem' }}>
        <a
          href={checkRiskUrl}
          target="_blank"
          rel="noreferrer"
          className="sonde-btn sonde-btn--primary"
          style={{ background: '#E8621A', borderColor: '#E8621A' }}
        >
          Check NRW Flood Map →
        </a>
        <a
          href={planningMapUrl}
          target="_blank"
          rel="noreferrer"
          className="sonde-btn sonde-btn--primary"
          style={{ background: '#E8621A', borderColor: '#E8621A' }}
        >
          Flood Map for Planning →
        </a>
      </div>

      <h3 className="sonde-subhead">Flood zone explainer</h3>
      <ul className="sonde-flood-list">
        <li>
          <span className="sonde-flood-title">Zone 1</span>
          <span className="sonde-flood-sub">&lt;0.1% annual chance</span>
        </li>
        <li>
          <span className="sonde-flood-title">Zone 2</span>
          <span className="sonde-flood-sub">0.1-1% annual chance</span>
        </li>
        <li>
          <span className="sonde-flood-title">Zone 3</span>
          <span className="sonde-flood-sub">&gt;1% annual chance</span>
        </li>
      </ul>
      <p className="sonde-hint">Always verify with NRW before any planning application.</p>
    </div>
  )
}
