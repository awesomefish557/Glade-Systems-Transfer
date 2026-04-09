import { useState } from 'react'
import type { SiteLocation } from '../types'
import { useLocalIntel, type LocalIntelCategory, type LocalIntelDoc } from '../hooks/useLocalIntel'

const CAT_LABEL: Record<LocalIntelCategory, string> = {
  planning: '📋 Planning Policy',
  historical: '🏛️ Historical Context',
  environmental: '🌍 Environmental',
  community: '👥 Community + Demographics',
}

function DocCard({ doc }: { doc: LocalIntelDoc }) {
  return (
    <article
      className="sonde-card"
      style={{ borderColor: 'var(--sonde-edge)', background: '#161411', marginBottom: 10 }}
    >
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem', color: 'var(--sonde-ink)' }}>{doc.title}</h3>
      <p className="sonde-hint" style={{ margin: '0 0 0.35rem' }}>
        {doc.source}
        {doc.date ? ` · ${doc.date}` : ''}
      </p>
      <p style={{ fontSize: '0.82rem', margin: '0 0 0.5rem', color: 'var(--sonde-ink-soft)' }}>
        <strong>Relevant because:</strong> {doc.whyRelevant}
      </p>
      <a href={doc.url} target="_blank" rel="noreferrer" className="sonde-btn sonde-btn--primary">
        Open Document →
      </a>
    </article>
  )
}

export function LocalIntelModule({ site }: { site: SiteLocation | null }) {
  const [programme, setProgramme] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const { state } = useLocalIntel(site, programme, refreshKey)

  if (!site) {
    return (
      <div className="sonde-panel sonde-panel--empty">
        <p>Pin a UK site to load local intelligence.</p>
      </div>
    )
  }

  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Local Intel</h2>
        <p className="sonde-panel-sub">
          Planning policy, historic environment, and AI-suggested documents for your site context.
        </p>
      </header>

      <div className="sonde-form-grid" style={{ marginBottom: 12 }}>
        <label className="sonde-label">
          Programme (optional — refines TAN suggestions)
          <input
            className="sonde-input"
            placeholder="e.g. nursery with growing garden"
            value={programme}
            onChange={(e) => setProgramme(e.target.value)}
          />
        </label>
        <button type="button" className="sonde-btn sonde-btn--primary" onClick={() => setRefreshKey((k) => k + 1)}>
          Refresh intel
        </button>
      </div>

      {state.status === 'loading' ? (
        <p className="sonde-hint" style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>
          {state.phase}
        </p>
      ) : null}

      {state.status === 'ok' ? (
        <>
          {(['planning', 'historical', 'environmental', 'community'] as const).map((cat) => {
            const staticPart = state.staticDocs.filter((d) => d.category === cat)
            const claudePart = cat === 'planning' ? state.claudeDocs : []
            const merged = [...staticPart, ...claudePart]
            if (cat === 'historical' && state.coflein.length) {
              const cofleinDocs: LocalIntelDoc[] = state.coflein.map((c) => ({
                id: `coflein-${c.id}`,
                title: c.title,
                source: 'Coflein (RCAHMW)',
                whyRelevant: 'Historic environment record within 500 m of the site.',
                url: c.url,
                category: 'historical',
              }))
              merged.push(...cofleinDocs)
            }
            if (!merged.length) return null
            return (
              <section key={cat} style={{ marginTop: 20 }}>
                <h3 className="sonde-subhead">{CAT_LABEL[cat]}</h3>
                {merged.map((d) => (
                  <DocCard key={d.id} doc={d} />
                ))}
              </section>
            )
          })}

          {state.coflein.length === 0 ? (
            <p className="sonde-hint" style={{ marginTop: 12 }}>
              No Coflein API hits in-app (CORS or API). Try{' '}
              <a href="https://coflein.gov.uk/en/search/" target="_blank" rel="noreferrer">
                Coflein
              </a>{' '}
              for listed buildings within 500 m.
            </p>
          ) : null}

          {state.claudeDocs.length === 0 ? (
            <p className="sonde-hint" style={{ marginTop: 8 }}>
              Claude suggestions unavailable — static Welsh / Cardiff links still apply.
            </p>
          ) : null}
        </>
      ) : null}

      {state.status === 'error' ? <p className="sonde-panel--error">{state.message}</p> : null}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.5 } }`}</style>
    </div>
  )
}
