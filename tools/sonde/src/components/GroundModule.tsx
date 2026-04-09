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
        <p>Loading LiDAR, BGS and EGMS ground data…</p>
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
  const isCardiff = /^CF/i.test(postcode)
  const bgsUrl = `https://map.bgs.ac.uk/bgs_views/do_detail.html?lat=${site.lat}&lng=${site.lng}`
  const epcUrl = postcode
    ? `https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode=${encodeURIComponent(postcode)}`
    : 'https://find-energy-certificate.service.gov.uk'
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Ground</h2>
        <p className="sonde-panel-sub">
          Browser-safe fallback mode: direct BGS/EGMS/EPC APIs are CORS-restricted, so this module provides links and indicative notes.
        </p>
      </header>

      <div className="sonde-map-tools-row" style={{ marginBottom: 10 }}>
        <button type="button" className="sonde-btn sonde-btn--primary" onClick={() => setRefreshKey((k) => k + 1)}>
          Refresh Ground Data
        </button>
      </div>

      <h3 className="sonde-subhead">Ground data links</h3>
      <ul className="sonde-flood-list">
        <li><span className="sonde-flood-title">BGS geology viewer</span><span className="sonde-flood-sub"><a href={bgsUrl} target="_blank" rel="noreferrer">{bgsUrl}</a></span></li>
        <li><span className="sonde-flood-title">EGMS viewer</span><span className="sonde-flood-sub"><a href="https://egms.land.copernicus.eu" target="_blank" rel="noreferrer">https://egms.land.copernicus.eu</a></span></li>
        <li><span className="sonde-flood-title">EPC register</span><span className="sonde-flood-sub"><a href={epcUrl} target="_blank" rel="noreferrer">{epcUrl}</a></span></li>
      </ul>
      {isCardiff ? (
        <div className="sonde-risk sonde-risk--med" style={{ marginTop: 12 }}>
          <span className="sonde-risk-label">Cardiff baseline (indicative)</span>
          <span className="sonde-risk-val">South Wales Coal Measures</span>
          <span className="sonde-risk-val">Alluvial clay superficial deposits</span>
          <span className="sonde-risk-val">Moderate bearing capacity ~100 kPa</span>
          <span className="sonde-risk-meta">Check BGS viewer for site-specific data.</span>
        </div>
      ) : (
        <p className="sonde-hint">Generic UK mode active. Use the links above for authoritative, site-specific ground and EPC information.</p>
      )}
      <h3 className="sonde-subhead">Design implications</h3>
      <ul className="sonde-flood-list">
        {data.designImplications.length
          ? data.designImplications.map((x, i) => <li key={i}><span className="sonde-flood-sub">- {x}</span></li>)
          : <li><span className="sonde-flood-sub">No Claude advisory bullets returned.</span></li>}
      </ul>
    </div>
  )
}
