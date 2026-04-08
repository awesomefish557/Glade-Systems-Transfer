import type { FloodData, SiteLocation } from '../types'

function riskTone(count: number): { label: string; className: string } {
  if (count === 0)
    return { label: 'No mapped flood areas within 1 km', className: 'sonde-risk sonde-risk--low' }
  if (count <= 2)
    return { label: 'Limited mapped flood extents nearby', className: 'sonde-risk sonde-risk--med' }
  return { label: 'Multiple mapped flood extents nearby', className: 'sonde-risk sonde-risk--high' }
}

export function FloodModule({
  site,
  state,
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

  if (state.status === 'loading') {
    return (
      <div className="sonde-panel sonde-panel--loading">
        <p>Querying Environment Agency flood areas…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="sonde-panel sonde-panel--error">
        <p>
          {state.message ?? 'Flood API unreachable.'} CORS or network may block this endpoint outside
          the UK data plane.
        </p>
      </div>
    )
  }

  const data = state.data!
  const tone = riskTone(data.areas.length)

  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Flood (UK)</h2>
        <p className="sonde-panel-sub">
          Environment Agency flood-monitoring · 1 km search · indicative only
        </p>
      </header>

      <div className={tone.className}>
        <span className="sonde-risk-label">Classification</span>
        <span className="sonde-risk-val">{tone.label}</span>
        <span className="sonde-mono sonde-risk-meta">{data.rawCount} record(s)</span>
      </div>

      {data.areas.length > 0 ? (
        <ul className="sonde-flood-list">
          {data.areas.slice(0, 12).map((a) => (
            <li key={a.id || a.label}>
              <span className="sonde-flood-title">{a.label}</span>
              {a.riverOrSea ? (
                <span className="sonde-flood-sub">{a.riverOrSea}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sonde-hint">No polygons returned — verify coordinates fall within Great Britain.</p>
      )}
    </div>
  )
}
