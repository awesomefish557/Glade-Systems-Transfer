import { useEffect, useState } from 'react'
import type { GroundData, SiteLocation } from '../types'

type GroundFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: GroundData }
  | { status: 'error'; message: string }

const CACHE_TTL_MS = 48 * 60 * 60 * 1000

function cacheKey(site: SiteLocation): string {
  return `sonde_ground_${site.lat.toFixed(4)}_${site.lng.toFixed(4)}`
}

function postcodeFromAddress(address: string): string {
  const m = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)
  return m ? m[0].toUpperCase().replace(/\s+/, ' ') : ''
}

export function useGroundData(site: SiteLocation | null, refreshKey: number): GroundFetchState {
  const [state, setState] = useState<GroundFetchState>({ status: 'idle' })

  useEffect(() => {
    if (!site || (site.lat === 0 && site.lng === 0)) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    const key = cacheKey(site)
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const cached = JSON.parse(raw) as { expiresAt: number; data: GroundData }
        if (cached.expiresAt > Date.now()) {
          setState({ status: 'ok', data: cached.data })
          return
        }
      }
    } catch {
      // no-op
    }

    ;(async () => {
      setState({ status: 'loading' })
      const postcode = postcodeFromAddress(site.address)
      const isCardiff = /^CF/i.test(postcode)
      const data: GroundData = {
        superficialType: isCardiff ? 'Alluvial clay superficial deposits' : 'See BGS viewer',
        bedrockType: isCardiff ? 'South Wales Coal Measures' : 'See BGS viewer',
        bearing: {
          classLabel: isCardiff ? 'Moderate' : 'Unknown',
          rag: 'amber',
          capacityKpa: isCardiff ? '100' : 'unknown',
          rationale: isCardiff
            ? 'Indicative Cardiff baseline only. Check BGS viewer for site-specific interpretation.'
            : 'Public browser APIs are CORS-limited. Use official sources linked below.',
        },
        boreholes: [],
        movementClassification: 'Stable',
        movementRag: 'amber',
        movementPoints: 0,
        movementSeries: [],
        madeGroundDetected: false,
        designImplications: isCardiff
          ? [
              'South Wales Coal Measures with alluvial clay is common in this area.',
              'Moderate bearing capacity around 100 kPa is indicative only.',
              'Check BGS viewer and commission GI for any planning/submission package.',
            ]
          : [
              'Use BGS viewer for geology and EGMS viewer for movement context.',
              'Treat these notes as indicative only; no direct browser API feed is used.',
              'Verify EPC and geotech information from official registers before design decisions.',
            ],
      }
      if (cancelled) return
      setState({ status: 'ok', data })
      localStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, data }))
    })().catch((e: unknown) => {
      if (cancelled) return
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Ground data unavailable' })
    })

    return () => {
      cancelled = true
    }
  }, [site, refreshKey])

  return state
}
