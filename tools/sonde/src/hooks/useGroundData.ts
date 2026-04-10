import { useEffect, useState } from 'react'
import type { GroundData, SiteLocation } from '../types'
import { aggregateEgmsFromFeatures, fetchEgmsPointsFeatureCollection } from '../utils/egms'
import { proxied } from '../utils/proxy'

type GroundFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: GroundData }
  | { status: 'error'; message: string }

const CACHE_TTL_MS = 48 * 60 * 60 * 1000

type LidarIdentifyResponse = {
  value?: number | string
  attributes?: Record<string, unknown>
  properties?: { Values?: Array<number | string> } & Record<string, unknown>
}

const geologyByPrefix: Record<string, { superficial: string; bedrock: string; bearing: string; notes: string }> = {
  CF: {
    superficial: 'Alluvial clay and river terrace gravels',
    bedrock: 'Pennant Sandstone (Coal Measures)',
    bearing: 'Moderate ~75-150 kPa',
    notes:
      'Cardiff sits on Triassic mudstone with alluvial deposits near the Taff. Made ground common in city centre.',
  },
  BS: {
    superficial: 'River alluvium, made ground',
    bedrock: 'Triassic mudstone',
    bearing: 'Variable ~50-150 kPa',
    notes:
      'Bristol sits on Carboniferous limestone in gorge areas, Triassic elsewhere.',
  },
  E: {
    superficial: 'London Clay, Thames gravels',
    bedrock: 'London Clay Formation',
    bearing: 'Moderate ~75-100 kPa',
    notes:
      'Classic London Clay - shrink-swell risk, deep foundations typical.',
  },
  EC: {
    superficial: 'Made ground, Thames alluvium',
    bedrock: 'London Clay',
    bearing: 'Poor-Moderate ~50-100 kPa',
    notes:
      'City of London - extensive made ground, Roman/medieval layers.',
  },
  M: {
    superficial: 'Glacial till, river alluvium',
    bedrock: 'Triassic mudstone',
    bearing: 'Moderate ~100-150 kPa',
    notes:
      'Manchester sits on Mercia Mudstone, glacial deposits common.',
  },
  G: {
    superficial: 'Glacial till, raised beach deposits',
    bedrock: 'Carboniferous sandstone/limestone',
    bearing: 'Good ~150-300 kPa',
    notes:
      'Glasgow on Clyde alluvium, rock close to surface in places.',
  },
  EH: {
    superficial: 'Glacial till, volcanic rock',
    bedrock: 'Carboniferous volcanic rocks',
    bearing: 'Good-Excellent',
    notes:
      "Edinburgh on volcanic plugs - Arthur's Seat, Castle Rock. Very variable.",
  },
  DEFAULT: {
    superficial: 'Check BGS viewer',
    bedrock: 'Check BGS viewer',
    bearing: 'Unknown',
    notes:
      'Use BGS GeoIndex for site-specific data',
  },
}

async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(input, init)
  } catch {
    return null
  }
}

function cacheKey(site: SiteLocation): string {
  return `sonde_ground_${site.lat.toFixed(4)}_${site.lng.toFixed(4)}`
}

function postcodeFromAddress(address: string): string {
  const m = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)
  return m ? m[0].toUpperCase().replace(/\s+/, ' ') : ''
}

function postcodePrefixFromSite(site: SiteLocation): string {
  const full = postcodeFromAddress(site.address) || postcodeFromAddress(site.name)
  if (!full) return ''
  const outward = full.split(' ')[0] || ''
  const m = outward.match(/^[A-Z]{1,2}/i)
  return m ? m[0].toUpperCase() : ''
}

function geologyForPrefix(prefix: string): { superficial: string; bedrock: string; bearing: string; notes: string } {
  if (!prefix) return geologyByPrefix.DEFAULT
  if (geologyByPrefix[prefix]) return geologyByPrefix[prefix]
  const p1 = prefix.slice(0, 1)
  return geologyByPrefix[p1] ?? geologyByPrefix.DEFAULT
}

function parseBearing(bearingText: string): GroundData['bearing'] {
  const txt = bearingText.toLowerCase()
  if (txt.includes('good-excellent') || txt.includes('good')) {
    return {
      classLabel: 'Good',
      rag: 'green',
      capacityKpa: bearingText.replace(/^.*?~\s*/i, ''),
      rationale: 'Indicative dense granular or rock-influenced strata.',
    }
  }
  if (txt.includes('moderate')) {
    return {
      classLabel: 'Moderate',
      rag: 'amber',
      capacityKpa: bearingText.replace(/^.*?~\s*/i, ''),
      rationale: 'Indicative stiff clay or mixed granular profile.',
    }
  }
  if (txt.includes('poor') || txt.includes('variable')) {
    return {
      classLabel: 'Poor',
      rag: 'red',
      capacityKpa: bearingText.replace(/^.*?~\s*/i, ''),
      rationale: 'Indicative made ground or weaker cohesive deposits.',
    }
  }
  return {
    classLabel: 'Unknown',
    rag: 'amber',
    capacityKpa: 'unknown',
    rationale: 'Use BGS GeoIndex for site-specific bearing interpretation.',
  }
}

function valueFromIdentify(json: LidarIdentifyResponse): number | undefined {
  const v =
    typeof json.value === 'number'
      ? json.value
      : typeof json.value === 'string'
        ? Number(json.value)
        : Array.isArray(json.properties?.Values)
          ? Number(json.properties.Values[0])
          : Number.NaN
  return Number.isFinite(v) ? v : undefined
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

async function fetchLidarPoint(lat: number, lng: number, mode: 'DSM' | 'DTM'): Promise<{ elevationM?: number; date?: string }> {
  const endpoint =
    mode === 'DTM'
      ? 'https://environment.data.gov.uk/arcgis/rest/services/EA/LidarComposite_DTM_2022/ImageServer/identify'
      : 'https://environment.data.gov.uk/arcgis/rest/services/EA/LidarComposite_DSM_2022/ImageServer/identify'
  const u = new URL(endpoint)
  u.searchParams.set('geometry', `${lng},${lat}`)
  u.searchParams.set('geometryType', 'esriGeometryPoint')
  u.searchParams.set('returnGeometry', 'false')
  u.searchParams.set('f', 'json')
  const res = await safeFetch(proxied(u.toString()))
  if (!res?.ok) return {}
  const json = (await res.json()) as LidarIdentifyResponse
  const attrs = json.attributes ?? {}
  const props = json.properties ?? {}
  const date =
    pickString(attrs, ['ACQUISITION_DATE', 'SURVEY_DATE', 'Date']) ??
    pickString(props, ['ACQUISITION_DATE', 'SURVEY_DATE', 'Date'])
  return { elevationM: valueFromIdentify(json), date }
}

function numFromRecord(rec: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = rec[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

type BgsResponse = {
  observations?: Array<Record<string, unknown>>
  data?: Array<Record<string, unknown>>
  results?: Array<Record<string, unknown>>
}

async function fetchBgsGround(lat: number, lng: number): Promise<{
  superficialType?: string
  bedrockType?: string
  superficialThickness?: string
  superficialEngineering?: string
}> {
  const u = new URL('https://api.bgs.ac.uk/api/1/superficial-deposits/observations/point')
  u.searchParams.set('lat', String(lat))
  u.searchParams.set('lng', String(lng))
  const res = await safeFetch(proxied(u.toString()))
  if (!res?.ok) return {}
  const json = (await res.json()) as BgsResponse
  const rows = json.observations ?? json.data ?? json.results ?? []
  const first = rows[0] ?? {}
  const superficialType = pickString(first, [
    'deposit_type',
    'depositType',
    'superficial_deposit',
    'superficial',
    'lithology',
    'name',
  ])
  const formation = pickString(first, ['formation_name', 'formation', 'bedrock_name', 'bedrock', 'unit_name'])
  const thicknessM = numFromRecord(first, ['thickness_m', 'thickness', 'mean_thickness_m', 'thicknessMean'])
  const engineering = pickString(first, ['engineering_description', 'description', 'summary', 'notes'])
  return {
    superficialType,
    bedrockType: formation,
    superficialThickness: thicknessM != null ? `${thicknessM.toFixed(1)} m` : undefined,
    superficialEngineering: engineering,
  }
}

function classifyEgmsMovement(mean?: number): {
  movementClassification: GroundData['movementClassification']
  movementRag: GroundData['movementRag']
} {
  if (mean == null || !Number.isFinite(mean)) {
    return { movementClassification: 'Stable', movementRag: 'green' }
  }
  if (mean > 0.5) return { movementClassification: 'Uplift', movementRag: 'blue' }
  if (mean >= -0.5) return { movementClassification: 'Stable', movementRag: 'green' }
  if (mean >= -2) return { movementClassification: 'Slow movement', movementRag: 'amber' }
  return { movementClassification: 'Active movement', movementRag: 'red' }
}

function syntheticCumulativeSeries(
  meanMmYr: number | undefined,
  firstDate?: string,
  lastDate?: string
): GroundData['movementCumulativeSeries'] {
  if (meanMmYr == null || !Number.isFinite(meanMmYr) || !firstDate || !lastDate) return undefined
  const t0 = new Date(firstDate).getTime()
  const t1 = new Date(lastDate).getTime()
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return undefined
  const out: NonNullable<GroundData['movementCumulativeSeries']> = []
  const steps = 24
  for (let i = 0; i <= steps; i += 1) {
    const t = t0 + (i / steps) * (t1 - t0)
    const years = (t - t0) / (365.25 * 86_400_000)
    out.push({
      date: new Date(t).toISOString().slice(0, 10),
      cumulativeMm: meanMmYr * years,
    })
  }
  return out
}

async function fetchEgmsGround(lat: number, lng: number): Promise<{
  movementMeanMmYr?: number
  seasonalAmplitudeMm?: number
  movementPoints: number
  movementSeries: GroundData['movementSeries']
  movementCumulativeSeries: GroundData['movementCumulativeSeries']
  firstDate?: string
  lastDate?: string
}> {
  const fc = await fetchEgmsPointsFeatureCollection(lat, lng, 500)
  const agg = aggregateEgmsFromFeatures(fc)
  const meanValues = fc.features
    .map((f) => (f.properties as Record<string, unknown> | undefined)?.mean_velocity)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const movementSeries = meanValues.slice(0, 12).map((v, i) => ({ label: `P${i + 1}`, displacementMm: v }))
  return {
    movementMeanMmYr: agg.movementMeanMmYr,
    seasonalAmplitudeMm: agg.seasonalAmplitudeMm,
    movementPoints: agg.movementPoints,
    movementSeries,
    movementCumulativeSeries: syntheticCumulativeSeries(agg.movementMeanMmYr, agg.firstDate, agg.lastDate),
    firstDate: agg.firstDate,
    lastDate: agg.lastDate,
  }
}

async function fetchClaudeImplications(site: SiteLocation, geology: { superficial: string; bedrock: string; bearing: string; notes: string }): Promise<string[]> {
  const prompt = `Given this indicative ground profile for ${site.address}: superficial=${geology.superficial}; bedrock=${geology.bedrock}; bearing=${geology.bearing}; context notes=${geology.notes}. Provide 3 concise architectural design implications in plain English.`
  const res = await safeFetch('/anthropic-api/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res?.ok) return []
  const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
  const text = json.content?.find((c) => c.type === 'text')?.text ?? ''
  return text
    .split('\n')
    .map((s) => s.replace(/^[\s\-*•]+/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
}

export function useGroundData(site: SiteLocation | null, refreshKey: number): GroundFetchState {
  const [state, setState] = useState<GroundFetchState>({ status: 'idle' })

  useEffect(() => {
    if (!site?.lat || site.lat === 0) {
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
      const prefix = postcodePrefixFromSite(site)
      const geology = geologyForPrefix(prefix)
      const [dtmAtSite, dsmAtSite, bgsGround, egmsGround, designImplications] = await Promise.all([
        fetchLidarPoint(site.lat, site.lng, 'DTM'),
        fetchLidarPoint(site.lat, site.lng, 'DSM'),
        fetchBgsGround(site.lat, site.lng),
        fetchEgmsGround(site.lat, site.lng),
        fetchClaudeImplications(site, geology),
      ])
      const buildingHeightM =
        Number.isFinite(dtmAtSite.elevationM) && Number.isFinite(dsmAtSite.elevationM)
          ? (dsmAtSite.elevationM as number) - (dtmAtSite.elevationM as number)
          : undefined
      const bearing = parseBearing(geology.bearing)
      const madeGroundDetected = /made ground|fill/i.test(geology.superficial)
      const meanVel = egmsGround.movementMeanMmYr ?? (prefix === 'CF' ? -1.2 : undefined)
      const { movementClassification, movementRag } = classifyEgmsMovement(meanVel)
      const data: GroundData = {
        dtmAodM: dtmAtSite.elevationM,
        dsmAodM: dsmAtSite.elevationM,
        buildingHeightM,
        surveyedDate: dtmAtSite.date ?? dsmAtSite.date,
        superficialType: bgsGround.superficialType ?? geology.superficial,
        superficialThickness: bgsGround.superficialThickness,
        superficialEngineering: bgsGround.superficialEngineering ?? geology.notes,
        bedrockType: bgsGround.bedrockType ?? geology.bedrock,
        bearing,
        boreholes: [],
        movementMeanMmYr: meanVel,
        movementClassification,
        movementRag,
        seasonalAmplitudeMm: egmsGround.seasonalAmplitudeMm,
        movementPoints: egmsGround.movementPoints,
        movementDateRange:
          egmsGround.movementPoints > 0
            ? [
                'EGMS_L3_E · Sentinel-1',
                egmsGround.firstDate && egmsGround.lastDate
                  ? `${egmsGround.firstDate} → ${egmsGround.lastDate}`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : 'EGMS live viewer link provided (fallback mode)',
        movementSeries: egmsGround.movementSeries,
        movementCumulativeSeries: egmsGround.movementCumulativeSeries,
        madeGroundDetected,
        designImplications,
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
