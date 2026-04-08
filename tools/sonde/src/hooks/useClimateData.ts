import { useEffect, useState } from 'react'
import type { ClimateData, ClimateMonthPoint, SiteLocation } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'

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

function aggregateMonthly(
  times: string[],
  temp: (number | null)[],
  precip: (number | null)[],
  rad: (number | null)[]
): ClimateMonthPoint[] {
  const accT: number[][] = Array.from({ length: 12 }, () => [])
  const accP: number[][] = Array.from({ length: 12 }, () => [])
  const accR: number[][] = Array.from({ length: 12 }, () => [])

  const n = Math.min(times.length, temp.length, precip.length, rad.length)
  for (let i = 0; i < n; i++) {
    const t = parseClimateTime(times[i])
    if (Number.isNaN(t.getTime())) continue
    const m = t.getUTCMonth()
    if (temp[i] != null && !Number.isNaN(temp[i]!)) accT[m].push(temp[i]!)
    if (precip[i] != null && !Number.isNaN(precip[i]!)) accP[m].push(precip[i]!)
    if (rad[i] != null && !Number.isNaN(rad[i]!)) accR[m].push(rad[i]!)
  }

  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

  return MONTH_LABELS.map((label, month) => ({
    month,
    label,
    tempMean: avg(accT[month]),
    precipMm: avg(accP[month]),
    radiationKwhM2: avg(accR[month]),
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
    if (!site) {
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

    const buildUrl = (withModel: boolean) => {
      const u = new URL('https://climate-api.open-meteo.com/v1/climate')
      u.searchParams.set('latitude', String(site.lat))
      u.searchParams.set('longitude', String(site.lng))
      u.searchParams.set('start_date', '1990-01-01')
      u.searchParams.set('end_date', '2020-12-31')
      u.searchParams.set(
        'monthly',
        'temperature_2m_mean,precipitation_sum,shortwave_radiation_sum'
      )
      if (withModel) u.searchParams.set('models', 'EC_Earth3_Veg')
      return u.toString()
    }

    const parseBody = (j: {
      monthly?: {
        time?: string[]
        temperature_2m_mean?: (number | null)[]
        precipitation_sum?: (number | null)[]
        shortwave_radiation_sum?: (number | null)[]
      }
    }): ClimateData | null => {
      const times = j.monthly?.time ?? []
      const t = j.monthly?.temperature_2m_mean ?? []
      const p = j.monthly?.precipitation_sum ?? []
      const sw = j.monthly?.shortwave_radiation_sum ?? []
      if (!times.length) return null
      return { months: aggregateMonthly(times, t, p, sw) }
    }

    ;(async () => {
      try {
        for (const withModel of [true, false]) {
          if (cancelled) return
          const res = await fetch(buildUrl(withModel))
          if (!res.ok) continue
          const j = (await res.json()) as Parameters<typeof parseBody>[0]
          const data = parseBody(j)
          if (data) {
            cacheSet(key, data)
            if (!cancelled) setState({ status: 'ok', data })
            return
          }
        }
        if (!cancelled) setState({ status: 'error', message: 'No climate monthly data' })
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
