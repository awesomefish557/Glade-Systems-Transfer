import { useMemo, useState } from 'react'
import type { FloodData, SiteLocation, SolarSummary } from '../types'
import { usePrecedents } from '../hooks/usePrecedents'

function climateDescription(lat: number): string {
  if (lat > 55) return 'cool temperate maritime'
  if (lat > 50) return 'temperate maritime'
  return 'mild maritime'
}

export function PrecedentsModule({
  site,
  solar,
  flood,
  radiusM,
}: {
  site: SiteLocation | null
  solar: SolarSummary | null
  flood: { status: string; data?: FloodData }
  radiusM: number
}) {
  const [programme, setProgramme] = useState('')
  const [constraints, setConstraints] = useState('')
  const [requestKey, setRequestKey] = useState(0)
  const solarSummary = useMemo(() => {
    if (!solar) return 'solar data not loaded'
    return `${solar.daylightHours.toFixed(1)}hrs daylight today`
  }, [solar])
  const prec = usePrecedents({
    site,
    programme,
    constraints,
    solarSummary,
    floodZone: flood.status === 'ok' ? flood.data?.floodZone : undefined,
    radiusM,
    requestKey,
  })
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head"><h2>Precedents</h2><p className="sonde-panel-sub">Claude-powered precedent matching with robust fallback.</p></header>
      {!site ? (
        <div className="sonde-panel sonde-panel--empty"><p>Pin a site to query precedents.</p></div>
      ) : (
        <>
          <div className="sonde-form-grid">
            <label className="sonde-label">
              Programme:
              <input
                className="sonde-input"
                placeholder="e.g. nursery with growing garden"
                value={programme}
                onChange={(e) => setProgramme(e.target.value)}
              />
            </label>
            <label className="sonde-label">
              Constraints + Opportunities:
              <input
                className="sonde-input"
                placeholder="e.g. tight urban site, great south facing aspect, student catchment, Victorian grain context"
                value={constraints}
                onChange={(e) => setConstraints(e.target.value)}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="sonde-btn sonde-btn--primary" onClick={() => setRequestKey((v) => v + 1)}>
                Find Precedents
              </button>
              <button type="button" className="sonde-btn sonde-btn--ghost" onClick={() => setRequestKey((v) => v + 1)}>
                Regenerate
              </button>
            </div>
          </div>
          <p className="sonde-hint">{`Site: ${site.address} · Latitude ${site.lat.toFixed(4)} (${climateDescription(site.lat)})`}</p>
          {prec.status === 'loading' ? <p className="sonde-hint">Finding relevant precedents...</p> : null}
          {prec.status === 'ok' ? (
            <div className="sonde-card-grid">
              {prec.data.map((c) => (
                <article
                  key={`${c.name}-${c.architect}`}
                  className="sonde-card"
                  style={{ borderColor: '#E8621A', background: '#171513' }}
                >
                  <h3 style={{ marginBottom: 4 }}>{c.name}</h3>
                  <p className="sonde-hint">{c.architect} · {c.year} · {c.location}</p>
                  <p><strong>Why relevant:</strong> {c.whyRelevant}</p>
                  <p className="sonde-hint"><strong>Key moves:</strong></p>
                  <ul>{c.keyMoves.map((m) => <li key={m}>{m}</li>)}</ul>
                  <p className="sonde-hint"><strong>Look at:</strong> {c.lookAt}</p>
                  <button
                    type="button"
                    className="sonde-btn sonde-btn--ghost"
                    onClick={() =>
                      window.open(
                        `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(c.searchQuery || `${c.name} ${c.architect}`)}`,
                        '_blank'
                      )
                    }
                  >
                    Search →
                  </button>
                </article>
              ))}
            </div>
          ) : null}
          {prec.status === 'error' ? <p className="sonde-hint">{prec.message}</p> : null}
          {prec.status === 'ok' ? (
            <p className="sonde-hint">
              Source: {prec.source === 'live' ? 'Claude (live)' : 'fallback set'}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
