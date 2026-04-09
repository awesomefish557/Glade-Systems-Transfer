import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { useCallback, useState } from 'react'
import type { BuiltEnvironmentData, ClimateData, DemographicsData, EcologyData, FloodData, GroundData, MovementData, OSMPlanData, PlanningData, SiteLocation, SolarSummary, WindData } from '../types'
import { BaseMapModule } from './BaseMapModule'
import { ClimateModule } from './ClimateModule'
import { DemographicsModule } from './DemographicsModule'
import { PlanningPolicyModule } from './PlanningPolicyModule'
import { SolarModule } from './SolarModule'
import { WindModule } from './WindModule'
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

/** White background for print/PDF */
async function svgToCanvasPdf(svg: SVGSVGElement, scale = 2): Promise<HTMLCanvasElement> {
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
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

function safeFilePart(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 56) || 'site'
}

function climateAnnualStats(data: ClimateData | undefined): {
  meanTemp: string
  annualRain: string
  peakSolar: string
} | null {
  if (!data?.months?.length) return null
  const meanT = data.months.reduce((s, m) => s + m.tempMean, 0) / data.months.length
  const rain = data.months.reduce((s, m) => s + m.precipMm, 0)
  let peak = data.months[0]
  for (const m of data.months) {
    if (m.radiationKwhM2 > peak.radiationKwhM2) peak = m
  }
  return {
    meanTemp: `${meanT.toFixed(1)}°C`,
    annualRain: `${rain.toFixed(0)} mm`,
    peakSolar: `${peak.label} (~${peak.radiationKwhM2.toFixed(0)} kWh/m²)`,
  }
}

export function ExportModule({
  site,
  solar,
  wind,
  climate,
  ground,
  planning,
  demographics,
  radiusM,
  onRadius,
  onExportFile,
  osm,
}: {
  site: SiteLocation | null
  solar: SolarSummary | null
  wind: { status: string; data?: WindData; message?: string }
  climate: { status: string; data?: ClimateData; message?: string }
  ground: { status: string; data?: GroundData; message?: string }
  flood: { status: string; data?: FloodData; message?: string }
  planning: { status: string; data?: PlanningData; message?: string }
  demographics: { status: string; data?: DemographicsData; message?: string }
  movement: { status: string; data?: MovementData; message?: string }
  ecology: { status: string; data?: EcologyData; message?: string }
  built: { status: string; data?: BuiltEnvironmentData; message?: string }
  radiusM: number
  onRadius: (m: number) => void
  onExportFile?: (filename: string) => void
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
    onExportFile?.(a.download)
  }, [onExportFile])

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
    onExportFile?.(a.download)
  }, [onExportFile])

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
      onExportFile?.(a.download)
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
        onExportFile?.(a2.download)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }, [site, radiusM, onExportFile])

  const downloadPdf = useCallback(async () => {
    if (!site) {
      alert('Pin a site before exporting.')
      return
    }
    setBusy('pdf')
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a3' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const margin = 16
      const dateStr = new Date().toISOString().slice(0, 10)
      const footerLine = `SONDE · ${site.address} · ${dateStr} · Indicative only, not for planning submission`
      const drawFooter = () => {
        pdf.setFont('courier', 'normal')
        pdf.setFontSize(7)
        pdf.setTextColor(90)
        pdf.text(footerLine, margin, pageH - 8, { maxWidth: pageW - 2 * margin })
        pdf.setTextColor(0)
      }

      const addImageFit = (canvas: HTMLCanvasElement, x: number, y: number, maxW: number, maxH: number) => {
        const ratio = canvas.width / canvas.height
        let w = maxW
        let h = w / ratio
        if (h > maxH) {
          h = maxH
          w = h * ratio
        }
        const data = canvas.toDataURL('image/png')
        pdf.addImage(data, 'PNG', x, y, w, h)
      }

      // Page 1 — Cover
      pdf.setFont('times', 'bold')
      pdf.setFontSize(26)
      pdf.setCharSpace(0.8)
      pdf.text('SONDE SITE ANALYSIS', margin, 48)
      pdf.setCharSpace(0)
      pdf.setFont('times', 'normal')
      pdf.setFontSize(14)
      pdf.text(site.address, margin, 64, { maxWidth: pageW - 2 * margin })
      pdf.setFontSize(11)
      pdf.text(dateStr, margin, 78)
      pdf.text(`${site.lat.toFixed(6)}°, ${site.lng.toFixed(6)}°`, margin, 88)
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(9)
      pdf.setTextColor(232, 98, 26)
      pdf.text('Generated by Sonde · gladesystems.uk', margin, 102)
      pdf.setTextColor(0, 0, 0)
      drawFooter()

      const tryPdfSvg = async (id: string) => {
        const el = document.getElementById(id) as SVGSVGElement | null
        if (!el) return null
        return svgToCanvasPdf(el, 2)
      }

      // Page 2 — Solar
      pdf.addPage()
      pdf.setFont('times', 'bold')
      pdf.setFontSize(14)
      pdf.text('Solar analysis', margin, 20)
      let yImg = 28
      const sunEl = await tryPdfSvg('sonde-svg-solar')
      const availEl = await tryPdfSvg('sonde-svg-solar-availability')
      const rowW = (pageW - 2 * margin - 6) / 2
      if (sunEl) {
        addImageFit(sunEl, margin, yImg, rowW, 75)
      } else {
        pdf.setFont('courier', 'normal')
        pdf.setFontSize(9)
        pdf.text('Sun path diagram not in DOM — open Export tab with solar loaded.', margin, yImg + 10)
      }
      if (availEl) {
        addImageFit(availEl, margin + rowW + 6, yImg, rowW, 75)
      }
      yImg += 82
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(9)
      const solarLines = [
        solar
          ? `Sunrise: ${solar.sunrise.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : 'Solar: —',
        solar
          ? `Sunset: ${solar.sunset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : '',
        solar ? `Daylight: ${solar.daylightHours.toFixed(2)} h` : '',
        solar ? `Solar noon elevation: ${solar.solarNoonElevationDeg.toFixed(1)}°` : '',
      ].filter(Boolean)
      solarLines.forEach((ln, i) => pdf.text(ln, margin, yImg + i * 5))
      drawFooter()

      // Page 3 — Climate + wind
      pdf.addPage()
      pdf.setFont('times', 'bold')
      pdf.setFontSize(14)
      pdf.text('Climate + wind', margin, 20)
      const clim = await tryPdfSvg('sonde-svg-climate')
      yImg = 28
      if (clim) {
        addImageFit(clim, margin, yImg, pageW - 2 * margin, 95)
        yImg += 100
      }
      const windCanvas = await tryPdfSvg('sonde-svg-wind')
      if (windCanvas) {
        addImageFit(windCanvas, margin, yImg, 95, 80)
      }
      const stats = climateAnnualStats(climate.status === 'ok' ? climate.data : undefined)
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(9)
      let tx = margin + 100
      let ty = yImg + 8
      ;[
        stats ? `Mean annual temp (approx): ${stats.meanTemp}` : 'Climate stats: —',
        stats ? `Annual rainfall (sum of monthly): ${stats.annualRain}` : '',
        stats ? `Peak solar month: ${stats.peakSolar}` : '',
        wind.status === 'ok' ? `Prevailing wind: ${wind.data?.prevailingDirDeg.toFixed(0)}°` : '',
      ]
        .filter(Boolean)
        .forEach((ln, i) => pdf.text(ln, tx, ty + i * 5))
      drawFooter()

      // Page 4 — Site context (base map)
      pdf.addPage()
      pdf.setFont('times', 'bold')
      pdf.setFontSize(14)
      pdf.text('Site context', margin, 20)
      const base = await tryPdfSvg('sonde-svg-basemap')
      if (base) {
        addImageFit(base, margin, 28, pageW - 2 * margin, pageH - margin - 48)
      } else {
        pdf.setFont('courier', 'normal')
        pdf.setFontSize(9)
        pdf.text('Base map SVG not in DOM.', margin, 40)
      }
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(8)
      pdf.text('North arrow and scale bar are on the plan graphic.', margin, pageH - 22)
      drawFooter()

      // Page 5 — Planning + demographics
      pdf.addPage()
      pdf.setFont('times', 'bold')
      pdf.setFontSize(14)
      pdf.text('Planning + demographics', margin, 20)
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(8.5)
      let y = 30
      const colW = (pageW - 2 * margin - 8) / 2
      pdf.setFont('times', 'bold')
      pdf.setFontSize(10)
      pdf.text('Planning summary', margin, y)
      pdf.text('Demographics', margin + colW + 8, y)
      y += 8
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(8)
      const planLines = [
        planning.status === 'ok' ? `Zone: ${planning.data?.zone}` : 'Planning: unavailable',
        planning.status === 'ok' ? `Conservation: ${planning.data?.conservationArea}` : '',
        planning.status === 'ok' ? `Portal: ${planning.data?.portalUrl}` : '',
      ].filter(Boolean)
      planLines.forEach((ln, i) => pdf.text(ln, margin, y + i * 4.5))
      const demo = await tryPdfSvg('sonde-svg-demographics')
      if (demo) {
        addImageFit(demo, margin + colW + 8, y - 4, colW, 55)
      } else {
        const dLines = [
          demographics.status === 'ok'
            ? `Population: ${demographics.data?.totalPopulation.toLocaleString()}`
            : 'Demographics chart not in DOM.',
          demographics.status === 'ok' ? `Under 5: ${demographics.data?.under5}` : '',
          demographics.status === 'ok' ? `Under 16: ${demographics.data?.under16}` : '',
        ].filter(Boolean)
        dLines.forEach((ln, i) => pdf.text(ln, margin + colW + 8, y + i * 4.5))
      }
      drawFooter()

      // Page 6 — Ground conditions
      pdf.addPage()
      pdf.setFont('times', 'bold')
      pdf.setFontSize(14)
      pdf.text('Ground conditions', margin, 20)
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(9)
      if (ground.status === 'ok') {
        const g = ground.data
        if (g) {
          const lines = [
            `Terrain: ${g.dtmAodM?.toFixed(1) ?? '—'}m AOD · slope ${g.slopePct50m?.toFixed(1) ?? '—'}%`,
            `Geology: ${g.superficialType} over ${g.bedrockType}`,
            `Bearing: ${g.bearing.classLabel} (~${g.bearing.capacityKpa} kPa)`,
            `Movement: ${Number.isFinite(g.movementMeanMmYr) ? (g.movementMeanMmYr as number).toFixed(2) : 'n/a'} mm/yr (${g.movementClassification})`,
            `Made ground: ${g.madeGroundDetected ? 'possible' : 'not detected'}`,
            '',
            'Design implications:',
            ...(g.designImplications.length ? g.designImplications : ['No advisory bullets returned.']).map((x) => `- ${x}`),
            '',
            'This data is indicative only. Commission ground investigation before detailed design.',
          ]
          lines.forEach((ln, i) => pdf.text(ln, margin, 32 + i * 5, { maxWidth: pageW - 2 * margin }))
        }
      } else {
        pdf.text('Ground tab data unavailable for this export.', margin, 34)
      }
      drawFooter()

      // Page 7 — Precedents
      pdf.addPage()
      pdf.setFont('times', 'bold')
      pdf.setFontSize(14)
      pdf.text('Precedents', margin, 20)
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(9)
      pdf.text(
        'Add programme and constraints in the Precedents tab, then run Find Precedents to generate three project cards for this export.',
        margin,
        32,
        { maxWidth: pageW - 2 * margin }
      )
      drawFooter()

      // Page 8 — Observation templates
      pdf.addPage()
      pdf.setFont('times', 'bold')
      pdf.setFontSize(14)
      pdf.text('Observation templates (printable)', margin, 20)
      pdf.setFont('courier', 'normal')
      pdf.setFontSize(10)
      ;[
        '• Active Frontage Survey',
        '• Desire Line Mapper',
        '• Noise Annotation Map',
        '• Social Observation Sheet',
      ].forEach((ln, i) => pdf.text(ln, margin, 36 + i * 8))
      drawFooter()

      // Optional composite capture (html2canvas)
      const grid = document.getElementById('sonde-export-grid')
      if (grid) {
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        const snap = await html2canvas(grid, {
          backgroundColor: '#ffffff',
          scale: 1.25,
          logging: false,
          useCORS: true,
        })
        pdf.addPage()
        pdf.setFont('times', 'bold')
        pdf.setFontSize(14)
        pdf.text('Live export board snapshot', margin, 20)
        addImageFit(snap, margin, 26, pageW - 2 * margin, pageH - margin - 36)
        drawFooter()
      }

      const fname = `sonde_${safeFilePart(site.address)}_${dateStr}.pdf`
      pdf.save(fname)
      onExportFile?.(fname)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'PDF export failed')
    } finally {
      setBusy(null)
    }
  }, [site, solar, wind, climate, ground, planning, demographics, onExportFile])

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
    onExportFile?.(a.download)
  }, [onExportFile])

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
      onExportFile?.(a.download)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }, [onExportFile])

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
          {busy === 'pdf' ? 'Building PDF…' : 'Download A3 presentation PDF'}
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

      <div id="sonde-export-grid" className="sonde-export-grid">
        <div className="sonde-export-col">
          <SolarModule data={solar} />
        </div>
        <div className="sonde-export-col">
          <BaseMapModule
            site={site}
            radiusM={radiusM}
            onRadius={onRadius}
            historicalYear="modern"
            onHistoricalYear={() => undefined}
            historicalOpacity={0.45}
            onHistoricalOpacity={() => undefined}
            historicalEnabled={false}
            onHistoricalEnabled={() => undefined}
            state={osm}
          />
        </div>
        <div className="sonde-export-col sonde-export-col--full">
          <ClimateModule state={climate} />
        </div>
        <div className="sonde-export-col">
          <WindModule state={wind} />
        </div>
        <div className="sonde-export-col">
          <PlanningPolicyModule site={site} state={planning} />
        </div>
        <div className="sonde-export-col">
          <DemographicsModule site={site} state={demographics} />
        </div>
      </div>
    </div>
  )
}
