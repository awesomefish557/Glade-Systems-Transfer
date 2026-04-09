import type { PlanningData, SiteLocation } from '../types'

export function PlanningPolicyModule({
  site,
  state,
}: {
  site: SiteLocation | null
  state: { status: string; data?: PlanningData; message?: string }
}) {
  if (!site) return <div className="sonde-panel sonde-panel--empty"><p>Planning data loads after pinning a site.</p></div>
  if (state.status === 'loading') return <div className="sonde-panel sonde-panel--loading"><p>Loading planning and policy context…</p></div>
  if (state.status === 'error') return <div className="sonde-panel sonde-panel--error"><p>{state.message ?? 'Planning sources unavailable.'}</p></div>
  if (state.status !== 'ok') return <div className="sonde-panel sonde-panel--empty"><p>Waiting for planning data.</p></div>
  const d = state.data!
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Planning + Policy</h2>
        <p className="sonde-panel-sub">Local planning context with conservation/listed records and quick links.</p>
      </header>
      <ul className="sonde-flood-list">
        <li><span className="sonde-flood-title">Local Development Plan zone</span><span className="sonde-flood-sub">{d.zone}</span></li>
        <li><span className="sonde-flood-title">Conservation area</span><span className="sonde-flood-sub">{d.conservationArea}</span></li>
        <li><span className="sonde-flood-title">Brownfield register</span><span className="sonde-flood-sub">{d.brownfieldStatus}</span></li>
      </ul>
      <h3 className="sonde-subhead">Listed buildings (500m)</h3>
      <ul className="sonde-flood-list">
        {d.listedBuildings.slice(0, 10).map((b) => (
          <li key={b.id}><span className="sonde-flood-title">{b.name}</span><span className="sonde-flood-sub">Grade {b.grade} · {Math.round(b.distanceM)}m</span></li>
        ))}
      </ul>
      <h3 className="sonde-subhead">Recent planning applications</h3>
      <ul className="sonde-flood-list">
        {d.recentApplications.slice(0, 10).map((a) => (
          <li key={a.id}><span className="sonde-flood-title">{a.description}</span><span className="sonde-flood-sub">{a.date || 'Date unavailable'}</span></li>
        ))}
      </ul>
      <p className="sonde-hint"><a href={d.portalUrl} target="_blank" rel="noreferrer">Open full planning portal</a></p>
    </div>
  )
}
