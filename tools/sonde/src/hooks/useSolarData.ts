import { useMemo } from 'react'
import type { SiteLocation, SolarSummary } from '../types'
import { buildSolarSummary } from '../utils/sunCalc'

export function useSolarData(site: SiteLocation | null): SolarSummary | null {
  return useMemo(() => {
    if (!site) return null
    return buildSolarSummary(site.lat, site.lng)
  }, [site?.lat, site?.lng])
}
