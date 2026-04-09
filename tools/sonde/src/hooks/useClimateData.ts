import { useEffect, useState } from 'react'
import type { ClimateData, ClimateMonthPoint, SiteLocation } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'
import { proxied } from '../utils/proxy'

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function parseClimateTime(s: string): Date {
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01T00:00:00Z`)
  return new Date(s)
}

function aggregateDailyToMonthly(
  times: string[],
  temp: (number | null)[],
  precip: (number | null)[],
  rad: (number | null)[]
): ClimateMonthPoint[] {
  const accT: number[][] = Array.from({ length: 12 }, () => [])
  const monthlyYearP = new Map<string, number>()
  const monthlyYearR = new Map<string, number>()

  const n = Math.min(times.length, temp.length, precip.length, rad.length)
  for (let i = 0; i < n; i++) {
    const t = parseClimateTime(times[i])
    if (Number.isNaN(t.getTime())) continue
    const year = t.getUTCFullYear()
    const m = t.getUTCMonth()
    const ym = `${year}-${m}`
    if (temp[i] != null && !Number.isNaN(temp[i]!)) accT[m].push(temp[i]!)
    if (precip[i] != null && !Number.isNaN(precip[i]!)) {
      monthlyYearP.set(ym, (monthlyYearP.get(ym) ?? 0) + precip[i]!)
    }
    if (rad[i] != null && !Number.isNaN(rad[i]!)) {
      monthlyYearR.set(ym, (monthlyYearR.get(ym) ?? 0) + rad[i]!)
    }
  }

  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  const avgMonthlyTotals = (monthlyYearTotals: Map<string, number>, month: number): number => {
    const vals: number[] = []
    for (const [ym, total] of monthlyYearTotals) {
      const m = Number(ym.split('-')[1] ?? '-1')
      if (m === month) vals.push(total)
    }
    return avg(vals)
  }

  return MONTH_LABELS.map((label, month) => ({
    month,
    label,
    tempMean: avg(accT[month]),
    precipMm: avgMonthlyTotals(monthlyYearP, month),
    radiationKwhM2: avgMonthlyTotals(monthlyYearR, month),
  }))
}

export type ClimateFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: ClimateData }

export function useClimateData(site: SiteLocation | null): ClimateFetchState {
  const [state, setState] = useState<ClimateFetchState>({ status: 'idle' })

  useEffect(() => {
    if (!site?.lat || site.lat === 0) {
      setState({ status: 'idle' })
      return
    }
    const key = cacheKey('climate', [site.lat.toFixed(3), site.lng.toFixed(3)])
    const cached = cacheGet<ClimateData>(key)
    if (cached) {
      setState({ status: 'ok', data: cached })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })

    const buildUrl = () =>
      `https://archive-api.open-meteo.com/v1/archive?latitude=${site.lat}&longitude=${site.lng}&start_date=2000-01-01&end_date=2020-12-31&daily=temperature_2m_mean,precipitation_sum,shortwave_radiation_sum&timezone=Europe/London`

    const parseBody = (j: {
      daily?: {
        time?: string[]
        temperature_2m_mean?: (number | null)[]
        precipitation_sum?: (number | null)[]
        shortwave_radiation_sum?: (number | null)[]
      }
    }): ClimateData | null => {
      const times = j.daily?.time ?? []
      const t = j.daily?.temperature_2m_mean ?? []
      const p = j.daily?.precipitation_sum ?? []
      const sw = j.daily?.shortwave_radiation_sum ?? []
      if (!times.length) return null
      return { months: aggregateDailyToMonthly(times, t, p, sw) }
    }

    ;(async () => {
      try {
        const res = await fetch(proxied(buildUrl()))
        if (!res.ok) {
          if (!cancelled) setState({ status: 'error', message: `Climate API ${res.status}` })
          return
        }
        const j = (await res.json()) as Parameters<typeof parseBody>[0]
        const data = parseBody(j)
        if (data) {
          cacheSet(key, data)
          if (!cancelled) setState({ status: 'ok', data })
          return
        }
        if (!cancelled) setState({ status: 'error', message: 'No climate daily data' })
      } catch (e: unknown) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: e instanceof Error ? e.message : 'Climate fetch failed',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [site?.lat, site?.lng])

  return state
}
