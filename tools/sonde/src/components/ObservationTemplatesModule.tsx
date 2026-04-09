import { useMemo } from 'react'
import type { ObservationTemplateInfo, SiteLocation } from '../types'
import { fmtDateISO } from '../utils/moduleHelpers'

const TEMPLATES: ObservationTemplateInfo[] = [
  { id: 'active-frontage', title: 'Active Frontage Survey', description: 'Edge-by-edge frontage activity survey sheet.' },
  { id: 'desire-lines', title: 'Desire Line Mapper', description: '1:500 base with blank grid for movement traces.' },
  { id: 'noise-map', title: 'Noise Annotation Map', description: 'Concentric rings with sound-source legend and dB cues.' },
  { id: 'social-observation', title: 'Social Observation Sheet', description: 'Timed occupancy and movement observations by user group.' },
]

function templateSvg(site: SiteLocation, title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1123" height="794" viewBox="0 0 1123 794">
<rect x="0" y="0" width="1123" height="794" fill="white"/>
<rect x="28" y="28" width="1067" height="738" fill="none" stroke="#111"/>
<text x="40" y="56" font-size="16" font-family="monospace">SONDE SITE OBSERVATION TEMPLATE</text>
<text x="40" y="80" font-size="12" font-family="monospace">${title}</text>
<text x="40" y="104" font-size="10" font-family="monospace">${site.address}</text>
<text x="40" y="122" font-size="10" font-family="monospace">Date: ${fmtDateISO()}</text>
<text x="40" y="740" font-size="10" font-family="monospace">Return to Sonde to layer with digital data</text>
<line x1="1040" y1="110" x2="1040" y2="150" stroke="#111"/>
<polygon points="1040,96 1032,110 1048,110" fill="#111"/>
<text x="1052" y="108" font-size="11" font-family="monospace">N</text>
<rect x="40" y="690" width="220" height="8" fill="#111"/>
<text x="40" y="685" font-size="10" font-family="monospace">Scale bar</text>
</svg>`
}

export function ObservationTemplatesModule({ site }: { site: SiteLocation | null }) {
  const can = !!site
  const list = useMemo(() => TEMPLATES, [])
  const download = (t: ObservationTemplateInfo) => {
    if (!site) return
    const blob = new Blob([templateSvg(site, t.title)], { type: 'image/svg+xml;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `sonde-template-${t.id}.svg`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head"><h2>Site Observation Templates</h2><p className="sonde-panel-sub">Printable blank field sheets (A4/A3 compatible SVG exports).</p></header>
      {!can ? <p className="sonde-hint">Pin a site to include address/date metadata in templates.</p> : null}
      <ul className="sonde-flood-list">
        {list.map((t) => (
          <li key={t.id}>
            <span className="sonde-flood-title">{t.title}</span>
            <span className="sonde-flood-sub">{t.description}</span>
            <button type="button" className="sonde-btn sonde-btn--ghost" disabled={!can} onClick={() => download(t)}>Download SVG template</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
