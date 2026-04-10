import DxfWriter from 'dxf-writer'
import { useEffect, useMemo, useState } from 'react'
import type { OSMPlanData, SiteLocation } from '../types'
import { lngLatToLocalM, offsetLatMeters, offsetLngMeters } from '../utils/geoHelpers'
import type { LidarElevationGrid } from '../utils/lidarTerrain'
import { contoursLocalMFromGrid, sampleOpenMeteoElevations } from '../utils/lidarTerrain'

type ScalePreset = '1:200' | '1:500' | '1:1000' | 'custom'
type ContourInterval = 0.25 | 0.5 | 1
type Pt = [number, number]

const TERRAIN_LAYER = 'TERRAIN'
const BUILDINGS_LAYER = 'BUILDINGS'

const parseScale = (p: ScalePreset, c: number) =>
  p === '1:200' ? 200 : p === '1:500' ? 500 : p === '1:1000' ? 1000 : Math.max(50, c || 500)
const toMm = (meters: number, scale: number) => (meters * 1000) / scale

function closeRing(points: Pt[]): Pt[] {
  if (!points.length) return points
  const a = points[0]
  const z = points[points.length - 1]
  return Math.abs(a[0] - z[0]) < 1e-9 && Math.abs(a[1] - z[1]) < 1e-9 ? points : [...points, a]
}

function localToLngLat(site: SiteLocation, xM: number, yM: number): { lng: number; lat: number } {
  return { lng: site.lng + offsetLngMeters(site.lat, xM), lat: site.lat + offsetLatMeters(yM) }
}

function marchingSegments(p0: Pt, p1: Pt, p2: Pt, p3: Pt, z0: number, z1: number, z2: number, z3: number, level: number): Array<[Pt, Pt]> {
  const cuts: Pt[] = []
  const cross = (a: Pt, b: Pt, za: number, zb: number) => {
    const da = za - level
    const db = zb - level
    if ((da < 0 && db < 0) || (da > 0 && db > 0) || !Number.isFinite(za) || !Number.isFinite(zb)) return
    const t = Math.abs(zb - za) < 1e-9 ? 0.5 : (level - za) / (zb - za)
    if (t >= 0 && t <= 1) cuts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  cross(p0, p1, z0, z1)
  cross(p1, p2, z1, z2)
  cross(p2, p3, z2, z3)
  cross(p3, p0, z3, z0)
  if (cuts.length === 2) return [[cuts[0], cuts[1]]]
  if (cuts.length === 4) return [[cuts[0], cuts[1]], [cuts[2], cuts[3]]]
  return []
}

function stitchSegments(segs: Array<[Pt, Pt]>, tol: number): Pt[][] {
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const out: Pt[][] = []
  for (const [a, b] of segs) {
    let merged = false
    for (const line of out) {
      const first = line[0]
      const last = line[line.length - 1]
      if (d(last, a) <= tol) { line.push(b); merged = true; break }
      if (d(last, b) <= tol) { line.push(a); merged = true; break }
      if (d(first, b) <= tol) { line.unshift(a); merged = true; break }
      if (d(first, a) <= tol) { line.unshift(b); merged = true; break }
    }
    if (!merged) out.push([a, b])
  }
  return out.filter((l) => l.length > 1)
}

function contoursFromElevationGrid(
  xs: number[],
  ys: number[],
  elev: number[][],
  interval: ContourInterval,
  step: number
): Array<{ level: number; lines: Pt[][] }> {
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let yi = 0; yi < ys.length; yi += 1) {
    for (let xi = 0; xi < xs.length; xi += 1) {
      const z = elev[yi]?.[xi]
      if (!Number.isFinite(z)) continue
      minZ = Math.min(minZ, z as number)
      maxZ = Math.max(maxZ, z as number)
    }
  }
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) return []
  const start = Math.ceil(minZ / interval) * interval
  const end = Math.floor(maxZ / interval) * interval
  const out: Array<{ level: number; lines: Pt[][] }> = []
  for (let level = start; level <= end + 1e-9; level += interval) {
    const segs: Array<[Pt, Pt]> = []
    for (let yi = 0; yi < ys.length - 1; yi += 1) for (let xi = 0; xi < xs.length - 1; xi += 1) {
      const p0: Pt = [xs[xi], ys[yi]]
      const p1: Pt = [xs[xi + 1], ys[yi]]
      const p2: Pt = [xs[xi + 1], ys[yi + 1]]
      const p3: Pt = [xs[xi], ys[yi + 1]]
      const z0 = elev[yi][xi], z1 = elev[yi][xi + 1], z2 = elev[yi + 1][xi + 1], z3 = elev[yi + 1][xi]
      if (![z0, z1, z2, z3].every(Number.isFinite)) continue
      segs.push(...marchingSegments(p0, p1, p2, p3, z0, z1, z2, z3, level))
    }
    const lines = stitchSegments(segs, step * 0.6)
    if (lines.length) out.push({ level: Number(level.toFixed(2)), lines })
  }
  return out
}

async function buildContoursOpenMeteo(
  site: SiteLocation,
  radiusM: number,
  interval: ContourInterval
): Promise<Array<{ level: number; lines: Pt[][] }>> {
  const half = radiusM
  const step = Math.max(3, Math.min(8, radiusM / 20))
  const n = Math.floor((2 * half) / step) + 1
  const xs = Array.from({ length: n }, (_, i) => -half + i * step)
  const ys = Array.from({ length: n }, (_, i) => -half + i * step)
  const points: Array<{ lat: number; lng: number }> = []
  for (let yi = 0; yi < ys.length; yi += 1) {
    for (let xi = 0; xi < xs.length; xi += 1) {
      points.push(localToLngLat(site, xs[xi], ys[yi]))
    }
  }
  let flat: number[]
  try {
    flat = await sampleOpenMeteoElevations(points)
  } catch {
    return []
  }
  if (flat.length !== points.length) return []
  const elev: number[][] = []
  let k = 0
  for (let yi = 0; yi < ys.length; yi += 1) {
    const row: number[] = []
    for (let xi = 0; xi < xs.length; xi += 1) {
      row.push(flat[k++]!)
    }
    elev.push(row)
  }
  return contoursFromElevationGrid(xs, ys, elev, interval, step)
}

function buildingPolys(site: SiteLocation, osm: OSMPlanData, radiusM: number): Pt[][] {
  const out: Pt[][] = []
  for (const b of osm.buildings) {
    const ring = b.rings[0]
    if (!ring || ring.length < 3) continue
    const local = ring.map(([lat, lng]) => {
      const p = lngLatToLocalM(site.lat, site.lng, lat, lng)
      return [p.x, p.y] as Pt
    })
    const c = local.reduce((s, p) => [s[0] + p[0], s[1] + p[1]] as Pt, [0, 0] as Pt)
    const centroid: Pt = [c[0] / local.length, c[1] / local.length]
    if (Math.hypot(centroid[0], centroid[1]) <= radiusM * 1.05) out.push(closeRing(local))
  }
  return out
}

function saveDxf(contoursM: Array<{ level: number; lines: Pt[][] }>, buildingsM: Pt[][], scale: number, fileName: string) {
  const DrawingCtor: any = (DxfWriter as any).default ?? DxfWriter
  const d = new DrawingCtor()
  if (typeof d.addLayer === 'function') {
    d.addLayer(TERRAIN_LAYER, 3, 'CONTINUOUS')
    d.addLayer(BUILDINGS_LAYER, 1, 'CONTINUOUS')
  }
  const contourMm = contoursM.map((c) => c.lines.map((l) => l.map((p) => [toMm(p[0], scale), toMm(p[1], scale)] as Pt)))
  const buildingsMm = buildingsM.map((poly) => poly.map((p) => [toMm(p[0], scale), toMm(p[1], scale)] as Pt))
  const pts = [...contourMm.flat(2), ...buildingsMm.flat(1)]
  if (!pts.length) throw new Error('No geometry to export.')
  const minX = Math.min(...pts.map((p) => p[0]))
  const minY = Math.min(...pts.map((p) => p[1]))
  const tx = 10 - minX
  const ty = 10 - minY
  const x = (p: Pt): Pt => [p[0] + tx, p[1] + ty]
  const drawLines = (poly: Pt[], layer: string) => {
    d.setActiveLayer(layer)
    for (let i = 0; i < poly.length - 1; i += 1) {
      const a = x(poly[i]); const b = x(poly[i + 1])
      d.drawLine(a[0], a[1], b[0], b[1])
    }
  }
  contourMm.forEach((set) => set.forEach((line) => drawLines(line, TERRAIN_LAYER)))
  buildingsMm.forEach((poly) => drawLines(closeRing(poly), BUILDINGS_LAYER))
  const blob = new Blob([d.toDxfString()], { type: 'application/dxf' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.click()
  URL.revokeObjectURL(a.href)
}

export function LaserCutModule({
  site,
  radiusM,
  onRadius,
  osm,
  lidarDtmGrid,
}: {
  site: SiteLocation | null
  radiusM: number
  onRadius: (m: number) => void
  osm: { status: string; data?: OSMPlanData; message?: string }
  /** When set (England/Wales LiDAR tile), terrain contours use 1 m DTM instead of Open-Meteo. */
  lidarDtmGrid?: LidarElevationGrid | null
}) {
  const [scalePreset, setScalePreset] = useState<ScalePreset>('1:500')
  const [customScale, setCustomScale] = useState(500)
  const [contourInterval, setContourInterval] = useState<ContourInterval>(0.5)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [demContours, setDemContours] = useState<Array<{ level: number; lines: Pt[][] }>>([])
  const scale = parseScale(scalePreset, customScale)
  const buildings = useMemo(() => {
    if (!site || osm.status !== 'ok' || !osm.data) return [] as Pt[][]
    return buildingPolys(site, osm.data, radiusM)
  }, [site, osm.status, osm.data, radiusM])
  const lidarContours = useMemo(() => {
    if (!site || !lidarDtmGrid) return [] as Array<{ level: number; lines: Pt[][] }>
    return contoursLocalMFromGrid(site.lat, site.lng, lidarDtmGrid, radiusM, contourInterval)
  }, [site, lidarDtmGrid, radiusM, contourInterval])

  useEffect(() => {
    if (!site || (site.lat === 0 && site.lng === 0)) {
      setDemContours([])
      return
    }
    if (lidarContours.length > 0) {
      setDemContours([])
      return
    }
    let cancelled = false
    void (async () => {
      const next = await buildContoursOpenMeteo(site, radiusM, contourInterval)
      if (!cancelled) setDemContours(next)
    })()
    return () => {
      cancelled = true
    }
  }, [site, radiusM, contourInterval, lidarContours.length])

  const contours = lidarContours.length > 0 ? lidarContours : demContours
  const contourLineCount = useMemo(
    () => contours.reduce((acc, c) => acc + c.lines.length, 0),
    [contours]
  )

  const preview = useMemo(() => {
    const all: Pt[] = [...buildings.flatMap((b) => b), ...contours.flatMap((c) => c.lines.flatMap((l) => l))]
    if (!all.length) return null
    const minX = Math.min(...all.map((p) => p[0]))
    const maxX = Math.max(...all.map((p) => p[0]))
    const minY = Math.min(...all.map((p) => p[1]))
    const maxY = Math.max(...all.map((p) => p[1]))
    const pad = 12
    const w = Math.max(1, maxX - minX)
    const h = Math.max(1, maxY - minY)
    const fit = 320
    const s = Math.min((fit - pad * 2) / w, (fit - pad * 2) / h)
    const tx = (x: number) => (x - minX) * s + pad
    const ty = (y: number) => fit - ((y - minY) * s + pad)
    const contourPaths = contours.flatMap((c) =>
      c.lines.map((line) => line.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p[0])} ${ty(p[1])}`).join(' '))
    )
    const buildingPaths = buildings.map((poly) =>
      closeRing(poly)
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p[0])} ${ty(p[1])}`)
        .join(' ')
    )
    return { size: fit, contourPaths, buildingPaths }
  }, [buildings, contours])

  if (!site) return <div className="sonde-panel sonde-panel--empty"><p>Pin a site to generate DXF geometry.</p></div>
  if (osm.status !== 'ok') return <div className="sonde-panel sonde-panel--loading"><p>Waiting for OSM buildings…</p></div>

  const applyLidlPreset = () => {
    setScalePreset('1:500')
    setCustomScale(500)
    setContourInterval(0.5)
    onRadius(100)
    setNote('Preset applied: Lidl Maindy Road 1:500, radius 100m, contour 0.5m.')
  }

  const onExport = async () => {
    setBusy(true); setNote('')
    try {
      const slug = scalePreset === 'custom' ? `1-${customScale}` : scalePreset.replace(':', '-')
      saveDxf(contours, buildings, scale, `sonde_lasercut_${slug}.dxf`)
      setNote(`DXF exported: ${contours.length} contour levels, ${buildings.length} footprints.`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'DXF export failed.')
    } finally { setBusy(false) }
  }
  return (
    <div className="sonde-panel">
      <header className="sonde-panel-head">
        <h2>Laser Cut Export</h2>
        <p className="sonde-panel-sub">DXF only: terrain contours and closed building footprints.</p>
      </header>
      <div className="sonde-map-tools-row">
        <button type="button" className="sonde-btn sonde-btn--primary" onClick={applyLidlPreset}>
          Lidl Maindy Road 1:500
        </button>
        <label className="sonde-label">Scale
          <select value={scalePreset} onChange={(e) => setScalePreset(e.target.value as ScalePreset)}>
            <option>1:200</option><option>1:500</option><option>1:1000</option><option>custom</option>
          </select>
        </label>
        {scalePreset === 'custom' ? <label className="sonde-label">Custom 1:<input type="number" value={customScale} onChange={(e) => setCustomScale(Number(e.target.value))} /></label> : null}
        <label className="sonde-label">Contour Interval
          <select value={contourInterval} onChange={(e) => setContourInterval(Number(e.target.value) as ContourInterval)}>
            <option value={0.25}>0.25m</option><option value={0.5}>0.5m</option><option value={1}>1.0m</option>
          </select>
        </label>
      </div>
      <ul className="sonde-flood-list">
        <li><span className="sonde-flood-title">DXF Layers</span><span className="sonde-flood-sub">{TERRAIN_LAYER}, {BUILDINGS_LAYER}</span></li>
        <li><span className="sonde-flood-title">Scale</span><span className="sonde-flood-sub">1:{scale}</span></li>
        <li><span className="sonde-flood-title">Geometry</span><span className="sonde-flood-sub">{buildings.length} buildings, {contourLineCount} contour lines</span></li>
      </ul>

      <h3 className="sonde-subhead">DXF Preview</h3>
      {preview ? (
        <figure className="sonde-figure" style={{ maxWidth: 520 }}>
          <svg viewBox="0 0 520 360" className="sonde-svg" role="img" aria-label="Laser cut geometry preview">
            <rect x="0" y="0" width="520" height="360" fill="#fff" stroke="#d4d0ca" />
            <g transform="translate(14 14)">
              <rect x="0" y="0" width="332" height="332" fill="#fff" stroke="#111" strokeWidth="0.7" />
              {preview.contourPaths.map((d, i) => (
                <path key={`ct-${i}`} d={d} fill="none" stroke="#E8621A" strokeWidth="0.8" />
              ))}
              {preview.buildingPaths.map((d, i) => (
                <path key={`bd-${i}`} d={d} fill="none" stroke="#111" strokeWidth="1.1" />
              ))}
              <line x1="22" y1="306" x2="62" y2="306" stroke="#111" strokeWidth="1.4" />
              <line x1="22" y1="303" x2="22" y2="309" stroke="#111" strokeWidth="1" />
              <line x1="62" y1="303" x2="62" y2="309" stroke="#111" strokeWidth="1" />
              <text x="42" y="298" textAnchor="middle" fontSize="8" fill="#111" className="sonde-svg-text">
                20m @ 1:500
              </text>
              <line x1="300" y1="300" x2="300" y2="278" stroke="#111" strokeWidth="1.2" />
              <polygon points="300,272 296,279 304,279" fill="#111" />
              <text x="309" y="282" fontSize="8" fill="#111" className="sonde-svg-text">N</text>
            </g>
            <g transform="translate(362 18)">
              <text x="0" y="0" fontSize="10" fill="#111" className="sonde-svg-text">Sheet preview @ 1:500</text>
              <rect x="0" y="10" width="140" height="99" fill="#faf9f7" stroke="#333" strokeWidth="0.8" />
              {(() => {
                const modelW = toMm(radiusM * 2, 500)
                const modelH = toMm(radiusM * 2, 500)
                const sx = 140 / 420
                const sy = 99 / 297
                const mw = Math.min(140, modelW * sx)
                const mh = Math.min(99, modelH * sy)
                const x = (140 - mw) / 2
                const y = (99 - mh) / 2 + 10
                return <rect x={x} y={y} width={mw} height={mh} fill="rgba(232,98,26,0.1)" stroke="#E8621A" strokeWidth="0.9" />
              })()}
              <text x="0" y="126" fontSize="8" fill="#333" className="sonde-svg-text">A3: 420 x 297 mm</text>
              <text x="0" y="138" fontSize="8" fill="#333" className="sonde-svg-text">{buildings.length} buildings, {contourLineCount} contour lines</text>
            </g>
          </svg>
        </figure>
      ) : (
        <p className="sonde-hint">Preview appears once terrain and building geometry are available.</p>
      )}
      <div className="sonde-map-tools-row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="sonde-btn sonde-btn--primary"
          onClick={onExport}
          disabled={busy || (buildings.length === 0 && contourLineCount === 0)}
        >
          {busy ? 'Exporting DXF…' : 'Download DXF (Terrain + Buildings)'}
        </button>
      </div>
      {note ? <p className="sonde-hint">{note}</p> : null}
    </div>
  )
}
