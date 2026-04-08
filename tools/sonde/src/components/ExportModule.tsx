import { jsPDF } from 'jspdf'
import { useCallback, useState } from 'react'
import type { OSMPlanData, SiteLocation, SolarSummary } from '../types'
import { BaseMapModule } from './BaseMapModule'
import { SolarModule } from './SolarModule'
import { bboxAroundPoint } from '../utils/geoHelpers'

async function svgToCanvas(svg: SVGSVGElement, scale = 2): Promise<HTMLCanvasElement> {
  const vb = svg.viewBox.baseVal
  const w = vb.width || 800
  const h = vb.height || 600
  const xml = new XMLSerializer().serializeToString(svg)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('SVG raster failed'))
    img.src = url
  })
  URL.revokeObjectURL(url)
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.fillStyle = '#121210'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function ExportModule({
  site,
  solar,
  radiusM,
  onRadius,
  osm,
}: {
  site: SiteLocation | null
  solar: SolarSummary | null
  radiusM: number
  onRadius: (m: number) => void
  osm: { status: string; data?: OSMPlanData; message?: string }
}) {
  const [busy, setBusy] = useState<string | null>(null)

  const downloadSunSvg = useCallback(() => {
    const el = document.getElementById('sonde-svg-solar')
    if (!el) {
      alert('Solar diagram not in DOM — open the Solar tab first.')
      return
    }
    const blob = new Blob([el.outerHTML], { type: 'image/svg+xml;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'sonde-sun-path.svg'
    a.click()
    URL.revokeObjectURL(a.href)
  }, [])

  const downloadSolarAvailabilitySvg = useCallback(() => {
    const el = document.getElementById('sonde-svg-solar-availability')
    if (!el) {
      alert('Solar availability ring not in DOM — open the Solar tab first.')
      return
    }
    const blob = new Blob([el.outerHTML], { type: 'image/svg+xml;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'sonde-solar-availability-ring.svg'
    a.click()
    URL.revokeObjectURL(a.href)
  }, [])

  const downloadBasemapPng = useCallback(async () => {
    const el = document.getElementById('sonde-svg-basemap') as SVGSVGElement | null
    if (!el) {
      alert('Base map not in DOM — open Base Map after it loads.')
      return
    }
    setBusy('png')
    try {
      const canvas = await svgToCanvas(el, 3)
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
      if (!blob) throw new Error('PNG encode failed')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'sonde-basemap.png'
      a.click()
      URL.revokeObjectURL(a.href)
      if (site) {
        const bbox = bboxAroundPoint(site.lat, site.lng, radiusM)
        const meta = {
          crs: 'EPSG:4326',
          description: 'Approximate bounding box for site radius (WGS84).',
          center: { lat: site.lat, lng: site.lng },
          radiusM,
          bounds: bbox,
        }
        const mj = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
        const a2 = document.createElement('a')
        a2.href = URL.createObjectURL(mj)
        a2.download = 'sonde-basemap-bounds.json'
        a2.click()
        URL.revokeObjectURL(a2.href)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }, [site, radiusM])

  const downloadPdf = useCallback(async () => {
    if (!site) {
      alert('Pin a site before exporting.')
      return
    }
    setBusy('pdf')
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const margin = 14
      let y = margin

      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(16)
      pdf.text('SONDE — site analysis', margin, y)
      y += 8
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(9)
      const lines = [
        site.address,
        `Lat ${site.lat.toFixed(6)}  Lng ${site.lng.toFixed(6)}`,
        `Generated ${new Date().toISOString().slice(0, 10)}`,
        solar
          ? `Daylight today: ${solar.daylightHours.toFixed(2)} h · Noon elev: ${solar.solarNoonElevationDeg.toFixed(1)}°`
          : null,
      ].filter(Boolean) as string[]
      lines.forEach((ln) => {
        pdf.text(ln, margin, y)
        y += 4.5
      })
      y += 6

      const ids = ['sonde-svg-solar', 'sonde-svg-solar-availability', 'sonde-svg-basemap']
      const maxW = pageW - margin * 2
      let yCursor = y

      for (const id of ids) {
        const node = document.getElementById(id) as SVGSVGElement | null
        if (!node) continue
        const c = await svgToCanvas(node, 1.25)
        const imgData = c.toDataURL('image/png')
        const drawW = maxW
        const drawH = drawW * (c.height / c.width)
        if (yCursor + drawH > pageH - margin) {
          pdf.addPage()
          yCursor = margin
        }
        pdf.addImage(imgData, 'PNG', margin, yCursor, drawW, drawH)
        yCursor += drawH + 8
      }

      pdf.setDrawColor(200)
      pdf.line(pageW - margin - 20, margin, pageW - margin - 20, margin + 32)
      pdf.line(pageW - margin - 20, margin, pageW - margin - 10, margin + 10)
      pdf.line(pageW - margin - 20, margin, pageW - margin - 30, margin + 10)
      pdf.setFontSize(8)
      pdf.text('N', pageW - margin - 14, margin + 40)

      pdf.save('sonde-site-analysis.pdf')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'PDF export failed')
    } finally {
      setBusy(null)
    }
  }, [site, solar])

  const downloadBasemapSvg = useCallback(() => {
    const el = document.getElementById('sonde-svg-basemap')
    if (!el) {
      alert('Base map SVG not ready.')
      return
    }
    const blob = new Blob([el.outerHTML], { type: 'image/svg+xml;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'sonde-basemap.svg'
    a.click()
    URL.revokeObjectURL(a.href)
  }, [])

  const downloadSolarPng = useCallback(async () => {
    const el = document.getElementById('sonde-svg-solar') as SVGSVGElement | null
    if (!el) {
      alert('Solar diagram SVG not ready.')
      return
    }
    setBusy('solar-png')
    try {
      const canvas = await svgToCanvas(el, 3)
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
      if (!blob) throw new Error('PNG encode failed')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'sonde-sun-path.png'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }, [])

  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Export</h2>
        <p className="sonde-panel-sub">
          Live analysis board: solar + base map visible together for direct SVG/PNG export.
        </p>
      </header>

      <div className="sonde-export-actions">
        <button type="button" className="sonde-btn sonde-btn--primary" disabled={!!busy} onClick={downloadPdf}>
          {busy === 'pdf' ? 'Building PDF…' : 'Download solar + base map PDF'}
        </button>
        <button type="button" className="sonde-btn" disabled={!!busy} onClick={downloadBasemapPng}>
          {busy === 'png' ? 'Rendering…' : 'Download base map PNG + bounds JSON'}
        </button>
        <button type="button" className="sonde-btn" disabled={!!busy} onClick={downloadBasemapSvg}>
          Download base map SVG
        </button>
        <button type="button" className="sonde-btn" disabled={!!busy} onClick={downloadSunSvg}>
          Download sun path SVG
        </button>
        <button type="button" className="sonde-btn" disabled={!!busy} onClick={downloadSolarAvailabilitySvg}>
          Download solar availability ring SVG
        </button>
        <button type="button" className="sonde-btn" disabled={!!busy} onClick={downloadSolarPng}>
          {busy === 'solar-png' ? 'Rendering…' : 'Download sun path PNG'}
        </button>
      </div>

      <div className="sonde-export-grid">
        <div className="sonde-export-col">
          <SolarModule data={solar} />
        </div>
        <div className="sonde-export-col">
          <BaseMapModule site={site} radiusM={radiusM} onRadius={onRadius} state={osm} />
        </div>
      </div>
    </div>
  )
}
