import type { MovementData, SiteLocation } from '../types'

export function MovementTransportModule({
  site,
  state,
  busStopsEnabled,
  onBusStopsEnabled,
  cycleRoutesEnabled,
  onCycleRoutesEnabled,
  walkIsoEnabled,
  onWalkIsoEnabled,
}: {
  site: SiteLocation | null
  state: { status: string; data?: MovementData; message?: string }
  busStopsEnabled: boolean
  onBusStopsEnabled: (v: boolean) => void
  cycleRoutesEnabled: boolean
  onCycleRoutesEnabled: (v: boolean) => void
  walkIsoEnabled: boolean
  onWalkIsoEnabled: (v: boolean) => void
}) {
  if (!site) return <div className="sonde-panel sonde-panel--empty"><p>Movement data loads after pinning a site.</p></div>
  if (state.status === 'loading') return <div className="sonde-panel sonde-panel--loading"><p>Loading isochrones, bus stops and cycle links…</p></div>
  if (state.status === 'error') return <div className="sonde-panel sonde-panel--error"><p>{state.message ?? 'Movement data unavailable.'}</p></div>
  if (state.status !== 'ok') return <div className="sonde-panel sonde-panel--empty"><p>Waiting for movement data.</p></div>
  const d = state.data!
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head"><h2>Movement + Transport</h2><p className="sonde-panel-sub">Map overlays for walk/cycle access, nearby bus stops, and cycle infrastructure.</p></header>
      <div className="sonde-map-tools-row">
        <button type="button" className={`sonde-btn ${busStopsEnabled ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`} onClick={() => onBusStopsEnabled(!busStopsEnabled)}>
          Bus stops {busStopsEnabled ? 'ON' : 'OFF'}
        </button>
        <button type="button" className={`sonde-btn ${cycleRoutesEnabled ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`} onClick={() => onCycleRoutesEnabled(!cycleRoutesEnabled)}>
          Cycle routes {cycleRoutesEnabled ? 'ON' : 'OFF'}
        </button>
        <button type="button" className={`sonde-btn ${walkIsoEnabled ? 'sonde-btn--primary' : 'sonde-btn--ghost'}`} onClick={() => onWalkIsoEnabled(!walkIsoEnabled)}>
          Walk isochrones {walkIsoEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <ul className="sonde-flood-list">
        <li><span className="sonde-flood-title">Walk isochrones</span><span className="sonde-flood-sub">5/10/15 minute polygons on map</span></li>
        <li><span className="sonde-flood-title">Cycle isochrones</span><span className="sonde-flood-sub">5/10 minute polygons on map</span></li>
        <li><span className="sonde-flood-title">Bus stops</span><span className="sonde-flood-sub">{d.busStops.length} within 500m</span></li>
      </ul>
      <h3 className="sonde-subhead">Key distances</h3>
      <ul className="sonde-flood-list">
        {d.keyDistances.map((k) => (
          <li key={k.label}><span className="sonde-flood-title">{k.label}</span><span className="sonde-flood-sub">{Math.round(k.distanceM)} m{k.note ? ` · ${k.note}` : ''}</span></li>
        ))}
      </ul>
    </div>
  )
}
