import { useEffect, useState } from 'react'
import type { GroundBearingEstimate, GroundData, GroundMovementSeriesPoint, SiteLocation } from '../types'

type GroundFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: GroundData }
  | { status: 'error'; message: string }

type LidarIdentifyResponse = {
  value?: number | string
  attributes?: Record<string, unknown>
  properties?: { Values?: Array<number | string> } & Record<string, unknown>
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function cacheKey(site: SiteLocation): string {
  return `sonde_ground_${site.lat.toFixed(4)}_${site.lng.toFixed(4)}`
}

function pickString(obj: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const key of candidates) {
    const val = obj[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  return undefined
}

function pickNumber(obj: Record<string, unknown>, candidates: string[]): number | undefined {
  for (const key of candidates) {
    const raw = obj[key]
    const v = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
    if (Number.isFinite(v)) return v
  }
  return undefined
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
  if (!Number.isFinite(v)) return undefined
  return v
}

async function fetchLidarPoint(lat: number, lng: number, mode: 'DSM' | 'DTM'): Promise<{ elevationM?: number; date?: string }> {
  const path =
    mode === 'DTM'
      ? 'https://environment.data.gov.uk/arcgis/rest/services/EA/LidarComposite_DTM_2022/ImageServer/identify'
      : 'https://environment.data.gov.uk/arcgis/rest/services/EA/LidarComposite_DSM_2022/ImageServer/identify'
  const u = new URL(path)
  u.searchParams.set('geometry', `${lng},${lat}`)
  u.searchParams.set('geometryType', 'esriGeometryPoint')
  u.searchParams.set('returnGeometry', 'false')
  u.searchParams.set('f', 'json')
  const res = await fetch(u.toString())
  if (!res.ok) return {}
  const json = (await res.json()) as LidarIdentifyResponse
  const attrs = json.attributes ?? {}
  const props = json.properties ?? {}
  const date =
    pickString(attrs, ['ACQUISITION_DATE', 'SURVEY_DATE', 'Date']) ??
    pickString(props, ['ACQUISITION_DATE', 'SURVEY_DATE', 'Date'])
  return {
    elevationM: valueFromIdentify(json),
    date,
  }
}

function offsetLatLng(lat: number, lng: number, meters: number, bearingDeg: number): { lat: number; lng: number } {
  const br = (bearingDeg * Math.PI) / 180
  const dLat = (meters * Math.cos(br)) / 111_320
  const dLng = (meters * Math.sin(br)) / (111_320 * Math.cos((lat * Math.PI) / 180))
  return { lat: lat + dLat, lng: lng + dLng }
}

async function terrainSlopePct50m(lat: number, lng: number, centerDtm?: number): Promise<number | undefined> {
  const base = centerDtm ?? (await fetchLidarPoint(lat, lng, 'DTM')).elevationM
  if (!Number.isFinite(base)) return undefined
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315]
  let maxGrade = 0
  for (const b of bearings) {
    const p = offsetLatLng(lat, lng, 50, b)
    const r = await fetchLidarPoint(p.lat, p.lng, 'DTM')
    if (!Number.isFinite(r.elevationM)) continue
    const grade = (Math.abs((r.elevationM as number) - (base as number)) / 50) * 100
    maxGrade = Math.max(maxGrade, grade)
  }
  return maxGrade || 0
}

function toRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

function bearingFromDeposit(superficial: string, bedrock: string): GroundBearingEstimate {
  const txt = `${superficial} ${bedrock}`.toLowerCase()
  if (/(made ground|fill)/i.test(txt)) {
    return {
      classLabel: 'Unknown',
      rag: 'red',
      capacityKpa: 'unknown',
      rationale: 'Made ground / fill indicates highly variable support conditions.',
    }
  }
  if (/(rock|mudstone|sandstone|limestone|granite|basalt)/i.test(txt)) {
    return {
      classLabel: 'Excellent',
      rag: 'green',
      capacityKpa: '>600',
      rationale: 'Rock-like strata usually provide high bearing resistance.',
    }
  }
  if (/(gravel|dense sand|till)/i.test(txt)) {
    return {
      classLabel: 'Good',
      rag: 'green',
      capacityKpa: '200-600',
      rationale: 'Dense granular strata often provide reliable shallow bearing.',
    }
  }
  if (/(stiff clay|alluvium|clay)/i.test(txt)) {
    return {
      classLabel: 'Moderate',
      rag: 'amber',
      capacityKpa: '75-150',
      rationale: 'Clay soils can carry load but may settle and move seasonally.',
    }
  }
  if (/(soft clay|peat|silt)/i.test(txt)) {
    return {
      classLabel: 'Poor',
      rag: 'red',
      capacityKpa: '<75',
      rationale: 'Weak cohesive soils usually require specialist foundation strategy.',
    }
  }
  return {
    classLabel: 'Unknown',
    rag: 'red',
    capacityKpa: 'unknown',
    rationale: 'Insufficient geotechnical certainty from public datasets.',
  }
}

function movementClass(meanMmYr: number | undefined): { c: GroundData['movementClassification']; rag: GroundData['movementRag'] } {
  if (!Number.isFinite(meanMmYr)) return { c: 'Stable', rag: 'green' }
  const v = Math.abs(meanMmYr as number)
  if (v <= 0.5) return { c: 'Stable', rag: 'green' }
  if (v <= 2) return { c: 'Slow movement', rag: 'amber' }
  return { c: 'Active movement', rag: 'red' }
}

async function fetchBgs(site: SiteLocation): Promise<{
  superficialType: string
  superficialThickness?: string
  superficialEngineering?: string
  madeGroundDetected: boolean
  bedrockType: string
  bedrockAge?: string
  depthToBedrock?: string
  boreholes: GroundData['boreholes']
}> {
  const p = new URLSearchParams({ lat: String(site.lat), lng: String(site.lng) })
  const [supRes, bedRes, boreRes] = await Promise.all([
    fetch(`https://api.bgs.ac.uk/api/1/superficial-deposits/observations/point?${p.toString()}`),
    fetch(`https://api.bgs.ac.uk/api/1/bedrock-geology/observations/point?${p.toString()}`),
    fetch(`https://api.bgs.ac.uk/api/1/boreholes?lat=${site.lat}&lng=${site.lng}&radius=500&count=5`),
  ])
  const supJson = supRes.ok ? (await supRes.json()) : {}
  const bedJson = bedRes.ok ? (await bedRes.json()) : {}
  const boreJson = boreRes.ok ? (await boreRes.json()) : {}

  const supObj = toRecord((toRecord(supJson).observation ?? toRecord(supJson).result ?? supJson) as unknown)
  const bedObj = toRecord((toRecord(bedJson).observation ?? toRecord(bedJson).result ?? bedJson) as unknown)

  const superficialType =
    pickString(supObj, ['deposit', 'name', 'unit_name', 'lithology', 'description']) ?? 'Unknown superficial deposit'
  const superficialThickness =
    pickString(supObj, ['thickness', 'thickness_estimate', 'thickness_range']) ??
    (pickNumber(supObj, ['thickness_m']) != null ? `${pickNumber(supObj, ['thickness_m'])} m` : undefined)
  const superficialEngineering =
    pickString(supObj, ['engineering_description', 'engineering', 'description']) ?? undefined
  const madeGroundDetected = /made ground|artificial|fill|landfill/i.test(superficialType)

  const bedrockType =
    pickString(bedObj, ['rock_type', 'name', 'formation', 'lithology', 'description']) ?? 'Unknown bedrock'
  const bedrockAge = pickString(bedObj, ['age', 'age_name', 'chronostratigraphy'])
  const depthToBedrock =
    pickString(bedObj, ['depth_to_bedrock', 'depth']) ??
    (pickNumber(bedObj, ['depth_m']) != null ? `${pickNumber(bedObj, ['depth_m'])} m` : undefined)

  const boreCandidates =
    (Array.isArray((boreJson as Record<string, unknown>).boreholes)
      ? (boreJson as Record<string, unknown>).boreholes
      : Array.isArray((boreJson as Record<string, unknown>).results)
        ? (boreJson as Record<string, unknown>).results
        : []) as unknown[]
  const boreholes = boreCandidates.slice(0, 5).map((raw, idx) => {
    const b = toRecord(raw)
    const id = String(b.id ?? b.borehole_id ?? `BH-${idx + 1}`)
    const distanceM = pickNumber(b, ['distance_m', 'distance']) ?? 0
    const depthM = pickNumber(b, ['depth_m', 'depth_drilled', 'depth'])
    const date = pickString(b, ['date', 'drilled_date', 'year'])
    const viewer = `https://www.bgs.ac.uk/map-viewers/geoindex-onshore/`
    return { id, distanceM, depthM, date, url: viewer }
  })

  return {
    superficialType,
    superficialThickness,
    superficialEngineering,
    madeGroundDetected,
    bedrockType,
    bedrockAge,
    depthToBedrock,
    boreholes,
  }
}

async function fetchEgms(site: SiteLocation): Promise<{
  movementMeanMmYr?: number
  seasonalAmplitudeMm?: number
  movementPoints: number
  movementDateRange?: string
  movementSeries: GroundMovementSeriesPoint[]
}> {
  const u = new URL('https://egms.land.copernicus.eu/egms-api/v1/points')
  u.searchParams.set('lat', String(site.lat))
  u.searchParams.set('lng', String(site.lng))
  u.searchParams.set('radius', '100')
  u.searchParams.set('dataset', 'EGMS_L3_E')
  const res = await fetch(u.toString())
  if (!res.ok) return { movementPoints: 0, movementSeries: [] }
  const json = (await res.json()) as Record<string, unknown>
  const points = (Array.isArray(json.points) ? json.points : Array.isArray(json.results) ? json.results : []) as unknown[]
  let sum = 0
  let count = 0
  let seasonal = Number.NaN
  let start = ''
  let end = ''
  const series: GroundMovementSeriesPoint[] = []
  for (const p0 of points) {
    const p = toRecord(p0)
    const v = pickNumber(p, ['mean_velocity', 'velocity_mm_year', 'velocity', 'v'])
    if (Number.isFinite(v)) {
      sum += v as number
      count += 1
    }
    if (!Number.isFinite(seasonal)) seasonal = pickNumber(p, ['seasonal_amplitude', 'amplitude_mm', 'amp']) ?? Number.NaN
    if (!start) start = pickString(p, ['date_start', 'start_date']) ?? ''
    if (!end) end = pickString(p, ['date_end', 'end_date']) ?? ''
    const ts = (Array.isArray(p.timeseries) ? p.timeseries : Array.isArray(p.displacement) ? p.displacement : []) as unknown[]
    for (const item of ts) {
      const r = toRecord(item)
      const label = pickString(r, ['year', 'date', 'label']) ?? ''
      const disp = pickNumber(r, ['cumulative_mm', 'displacement_mm', 'value'])
      if (label && Number.isFinite(disp)) {
        series.push({ label, displacementMm: disp as number })
      }
    }
  }
  const movementDateRange = start || end ? `${start || 'unknown'} to ${end || 'unknown'}` : undefined
  return {
    movementMeanMmYr: count ? sum / count : undefined,
    seasonalAmplitudeMm: Number.isFinite(seasonal) ? seasonal : undefined,
    movementPoints: points.length,
    movementDateRange,
    movementSeries: series.slice(0, 32),
  }
}

async function fetchClaudeImplications(site: SiteLocation, ground: {
  geology: string
  bearing: string
  movement: string
  madeGround: string
}): Promise<string[]> {
  const prompt = `Given these ground conditions at ${site.address}: geology=${ground.geology}, bearing capacity=${ground.bearing}, movement=${ground.movement}mm/yr, made ground=${ground.madeGround}, what should an architect know before designing here? Reply in 3 bullet points, plain English, focused on design implications.`
  const res = await fetch('/anthropic-api/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) return []
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
    if (!site) return
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
      try {
        const [dtmAtSite, dsmAtSite, bgs, egms] = await Promise.all([
          fetchLidarPoint(site.lat, site.lng, 'DTM'),
          fetchLidarPoint(site.lat, site.lng, 'DSM'),
          fetchBgs(site),
          fetchEgms(site),
        ])
        const slopePct50m = await terrainSlopePct50m(site.lat, site.lng, dtmAtSite.elevationM)
        const buildingHeightM =
          Number.isFinite(dsmAtSite.elevationM) && Number.isFinite(dtmAtSite.elevationM)
            ? (dsmAtSite.elevationM as number) - (dtmAtSite.elevationM as number)
            : undefined
        const bearing = bearingFromDeposit(bgs.superficialType, bgs.bedrockType)
        const mClass = movementClass(egms.movementMeanMmYr)

        const implications = await fetchClaudeImplications(site, {
          geology: `${bgs.superficialType} over ${bgs.bedrockType}`,
          bearing: `${bearing.classLabel} (${bearing.capacityKpa} kPa)`,
          movement: Number.isFinite(egms.movementMeanMmYr) ? (egms.movementMeanMmYr as number).toFixed(2) : 'unknown',
          madeGround: bgs.madeGroundDetected ? 'possible' : 'not detected',
        })

        const data: GroundData = {
          dtmAodM: dtmAtSite.elevationM,
          dsmAodM: dsmAtSite.elevationM,
          buildingHeightM,
          slopePct50m,
          surveyedDate: dtmAtSite.date ?? dsmAtSite.date,
          superficialType: bgs.superficialType,
          superficialThickness: bgs.superficialThickness,
          superficialEngineering: bgs.superficialEngineering,
          madeGroundDetected: bgs.madeGroundDetected,
          bedrockType: bgs.bedrockType,
          bedrockAge: bgs.bedrockAge,
          depthToBedrock: bgs.depthToBedrock,
          bearing,
          boreholes: bgs.boreholes,
          movementMeanMmYr: egms.movementMeanMmYr,
          movementClassification: mClass.c,
          movementRag: mClass.rag,
          seasonalAmplitudeMm: egms.seasonalAmplitudeMm,
          movementPoints: egms.movementPoints,
          movementDateRange: egms.movementDateRange,
          movementSeries: egms.movementSeries,
          designImplications: implications,
        }
        if (cancelled) return
        setState({ status: 'ok', data })
        localStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, data }))
      } catch (e) {
        if (cancelled) return
        setState({ status: 'error', message: e instanceof Error ? e.message : 'Ground data unavailable' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [site, refreshKey])

  return state
}
