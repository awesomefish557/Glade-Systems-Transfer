/** Stereographic from nadir onto horizontal plane; zenith at centre, horizon at outer radius R. */
export function stereographicRadius(altitudeDeg: number, R: number): number {
  const z = ((90 - altitudeDeg) * Math.PI) / 360
  const t = Math.tan(z)
  const t0 = Math.tan(Math.PI / 4)
  return R * (t / t0)
}

/** Azimuth from North clockwise (degrees) → SVG coords; North up, East right, SVG y down. */
export function azimuthToXY(
  r: number,
  azimuthFromNorthDeg: number
): { x: number; y: number } {
  const rad = (azimuthFromNorthDeg * Math.PI) / 180
  return { x: r * Math.sin(rad), y: -r * Math.cos(rad) }
}

export function polarLinePath(
  cx: number,
  cy: number,
  r: number,
  azimuthFromNorthDeg: number,
  x2: number,
  y2: number
): string {
  const { x, y } = azimuthToXY(r, azimuthFromNorthDeg)
  return `M ${cx + x} ${cy + y} L ${x2} ${y2}`
}

export function sectorPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  endDeg: number
): string {
  const toRad = (d: number) => (d * Math.PI) / 180
  const x1 = cx + rOuter * Math.sin(toRad(startDeg))
  const y1 = cy - rOuter * Math.cos(toRad(startDeg))
  const x2 = cx + rOuter * Math.sin(toRad(endDeg))
  const y2 = cy - rOuter * Math.cos(toRad(endDeg))
  const x3 = cx + rInner * Math.sin(toRad(endDeg))
  const y3 = cy - rInner * Math.cos(toRad(endDeg))
  const x4 = cx + rInner * Math.sin(toRad(startDeg))
  const y4 = cy - rInner * Math.cos(toRad(startDeg))
  const large = endDeg - startDeg > 180 ? 1 : 0
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

export function formatHourLabel(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}
