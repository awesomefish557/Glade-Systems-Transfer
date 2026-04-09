import { useEffect, useState } from 'react'
import type { SiteLocation, WindData, WindRoseBin } from '../types'
import { cacheGet, cacheKey, cacheSet } from '../utils/sessionCache'

const SECTORS = 16

function binIndexFromDeg(directionDeg: number): number {
  const d = ((directionDeg % 360) + 360) % 360
  const idx = Math.floor((d + 360 / SECTORS / 2) / (360 / SECTORS)) % SECTORS
  return idx
}

function aggregate(
  speeds: number[],
  directions: number[]
): { bins: WindRoseBin[]; prevailingDirDeg: number; prevailingAvgSpeed: number } {
  const sums: number[] = Array(SECTORS).fill(0)
  const counts: number[] = Array(SECTORS).fill(0)
  const speedSums: number[] = Array(SECTORS).fill(0)
  const n = Math.min(speeds.length, directions.length)
  for (let i = 0; i < n; i++) {
    const s = speeds[i]
    const dir = directions[i]
    if (s == null || dir == null || Number.isNaN(s) || Number.isNaN(dir)) continue
    const b = binIndexFromDeg(dir)
    counts[b] += 1
    speedSums[b] += s
    sums[b] += 1
  }
  const total = counts.reduce((a, b) => a + b, 0) || 1
  const bins: WindRoseBin[] = []
  for (let i = 0; i < SECTORS; i++) {
    const dirDeg = i * (360 / SECTORS)
    const c = counts[i]
    bins.push({
      sectorIndex: i,
      dirDeg,
      frequency: c / total,
      avgSpeed: c > 0 ? speedSums[i] / c : 0,
      count: c,
    })
  }
  let best = 0
  for (let i = 1; i < SECTORS; i++) {
    if (bins[i].count > bins[best].count) best = i
  }
  return {
    bins,
    prevailingDirDeg: bins[best].dirDeg,
    prevailingAvgSpeed: bins[best].avgSpeed,
  }
}

export type WindFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: WindData }

export function useWindData(site: SiteLocation | null): WindFetchState {
  const [state, setState] = useState<WindFetchState>({ status: 'idle' })

  useEffect(() => {
    if (!site?.lat || site.lat === 0) {
      setState({ status: 'idle' })
      return
    }
    const key = cacheKey('wind', [site.lat.toFixed(4), site.lng.toFixed(4)])
    const cached = cacheGet<WindData>(key)
    if (cached) {
      setState({ status: 'ok', data: cached })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', String(site.lat))
    url.searchParams.set('longitude', String(site.lng))
    url.searchParams.set('hourly', 'windspeed_10m,winddirection_10m')
    url.searchParams.set('past_days', '92')
    url.searchParams.set('forecast_days', '1')
    url.searchParams.set('wind_speed_unit', 'ms')

    fetch(url.toString())
      .then((r) => {
        if (!r.ok) throw new Error(`Wind API ${r.status}`)
        return r.json()
      })
      .then((j) => {
        if (cancelled) return
        const speeds: number[] = j.hourly?.windspeed_10m ?? []
        const directions: number[] = j.hourly?.winddirection_10m ?? []
        const { bins, prevailingDirDeg, prevailingAvgSpeed } = aggregate(speeds, directions)
        const data: WindData = {
          bins,
          prevailingDirDeg,
          prevailingAvgSpeed,
          hourlySpeed: speeds,
          hourlyDir: directions,
        }
        cacheSet(key, data)
        setState({ status: 'ok', data })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: e instanceof Error ? e.message : 'Wind fetch failed',
        })
      })
    return () => {
      cancelled = true
    }
  }, [site?.lat, site?.lng])

  return state
}
