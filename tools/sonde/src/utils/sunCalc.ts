import SunCalc from 'suncalc'
import type { SolarDayCurve, SolarSummary } from '../types'

/** SunCalc azimuth: from south, west positive (radians). → bearing from North, clockwise. */
export function azimuthSouthToNorthDeg(azimuthRad: number): number {
  const deg = (azimuthRad * 180) / Math.PI
  return ((deg + 180) % 360 + 360) % 360
}

const SEASONS: {
  key: SolarDayCurve['seasonKey']
  label: string
  month: number
  day: number
  color: string
}[] = [
  { key: 'winter', label: 'Winter solstice', month: 12, day: 21, color: '#5B8FA8' },
  { key: 'spring', label: 'Spring equinox', month: 3, day: 21, color: '#7A9B6B' },
  { key: 'summer', label: 'Summer solstice', month: 6, day: 21, color: '#E8621A' },
  { key: 'autumn', label: 'Autumn equinox', month: 9, day: 21, color: '#C4A574' },
]

function samplesForDate(lat: number, lng: number, year: number, month: number, day: number) {
  const points: { alt: number; azimuthFromNorth: number; t: Date }[] = []
  const base = new Date(year, month - 1, day, 0, 0, 0, 0)
  for (let mins = 0; mins < 24 * 60; mins += 30) {
    const t = new Date(base.getTime() + mins * 60_000)
    const p = SunCalc.getPosition(t, lat, lng)
    const altDeg = (p.altitude * 180) / Math.PI
    if (altDeg > -0.5) {
      points.push({
        alt: altDeg,
        azimuthFromNorth: azimuthSouthToNorthDeg(p.azimuth),
        t,
      })
    }
  }
  return points
}

export function buildSolarSummary(lat: number, lng: number, refDate = new Date()): SolarSummary {
  const year = refDate.getFullYear()
  const curves: SolarDayCurve[] = SEASONS.map((s) => ({
    seasonKey: s.key,
    label: s.label,
    color: s.color,
    points: samplesForDate(lat, lng, year, s.month, s.day),
  }))

  const dayStart = new Date(
    refDate.getFullYear(),
    refDate.getMonth(),
    refDate.getDate(),
    0,
    0,
    0,
    0
  )
  const times = SunCalc.getTimes(dayStart, lat, lng)
  const sunrise = times.sunrise
  const sunset = times.sunset
  const noon = times.solarNoon
  const noonPos = SunCalc.getPosition(noon, lat, lng)
  const solarNoonElevationDeg = (noonPos.altitude * 180) / Math.PI
  const daylightMs = Math.max(0, sunset.getTime() - sunrise.getTime())
  const daylightHours = daylightMs / 3_600_000

  return {
    curves,
    sunrise,
    sunset,
    solarNoonElevationDeg,
    daylightHours,
  }
}
