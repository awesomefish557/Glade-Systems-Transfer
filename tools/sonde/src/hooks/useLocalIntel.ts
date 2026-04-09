import { useEffect, useState } from 'react'
import type { SiteLocation } from '../types'

export type LocalIntelCategory = 'planning' | 'historical' | 'environmental' | 'community'

export type LocalIntelDoc = {
  id: string
  title: string
  source: string
  whyRelevant: string
  url: string
  date?: string
  category: LocalIntelCategory
}

export type CofleinHit = {
  id: string
  title: string
  type?: string
  url: string
}

/** Minimal GeoJSON-like feature from Coflein (avoid relying on @types/geojson). */
type CofleinGeoFeature = {
  id?: string | number
  properties?: Record<string, unknown> | null
}

type State =
  | { status: 'idle' }
  | { status: 'loading'; phase: string }
  | { status: 'ok'; staticDocs: LocalIntelDoc[]; coflein: CofleinHit[]; claudeDocs: LocalIntelDoc[] }
  | { status: 'error'; message: string }

function programmeKey(programme: string): 'education' | 'housing' | 'default' {
  const p = programme.toLowerCase()
  if (/(nursery|school|education|childcare|college|university)/i.test(p)) return 'education'
  if (/(housing|residential|flat|apartment|home)/i.test(p)) return 'housing'
  return 'default'
}

function staticPlanningDocs(programme: string): LocalIntelDoc[] {
  const key = programmeKey(programme)
  const tanEducation: LocalIntelDoc[] = [
    {
      id: 'tan-15',
      title: 'TAN 15 — Development and flood risk',
      source: 'Welsh Government',
      whyRelevant: 'Flood risk and sustainable drainage for any development in Wales.',
      url: 'https://www.gov.wales/tan-15-development-and-flood-risk',
      category: 'planning',
    },
    {
      id: 'tan-16',
      title: 'TAN 16 — Sport, recreation and open space',
      source: 'Welsh Government',
      whyRelevant: 'Outdoor play, recreation provision and open space standards.',
      url: 'https://www.gov.wales/tan-16-sport-recreation-and-open-space',
      category: 'planning',
    },
    {
      id: 'tan-23',
      title: 'TAN 23 — Economic development',
      source: 'Welsh Government',
      whyRelevant: 'Economic development and employment land considerations.',
      url: 'https://www.gov.wales/tan-23-economic-development',
      category: 'planning',
    },
  ]
  const tanDefault: LocalIntelDoc[] = [
    {
      id: 'tan-1',
      title: 'TAN 1 — Joint Housing Land Availability Studies',
      source: 'Welsh Government',
      whyRelevant: 'Core Welsh planning guidance for housing and land supply.',
      url: 'https://www.gov.wales/tan-1-joint-housing-land-availability-studies',
      category: 'planning',
    },
    ...tanEducation.slice(0, 1),
  ]
  const tans = key === 'education' ? tanEducation : tanDefault

  const always: LocalIntelDoc[] = [
    {
      id: 'future-wales',
      title: 'Future Wales — National Plan 2040',
      source: 'Welsh Government',
      whyRelevant: 'National spatial strategy; sets the framework for Cardiff and all Welsh LPAs.',
      url: 'https://www.gov.wales/future-wales-national-plan-2040',
      category: 'planning',
    },
    {
      id: 'cardiff-ldp',
      title: 'Cardiff Local Development Plan',
      source: 'Cardiff Council',
      whyRelevant: 'Adopted policies and allocations for the city.',
      url: 'https://www.cardiff.gov.uk/ENG/resident/Planning/Planning-policy/Local-Development-Plan/',
      category: 'planning',
    },
    {
      id: 'cardiff-spg',
      title: 'Cardiff supplementary planning guidance (list)',
      source: 'Cardiff Council',
      whyRelevant: 'Topic-specific guidance supporting the LDP.',
      url: 'https://www.cardiff.gov.uk/ENG/resident/Planning/Planning-policy/Supplementary-Planning-Guidance/',
      category: 'planning',
    },
    {
      id: 'cardiff-design',
      title: 'Cardiff design and place-making guidance',
      source: 'Cardiff Council',
      whyRelevant: 'Streetscape, materials and urban design expectations.',
      url: 'https://www.cardiff.gov.uk/ENG/resident/Planning/Planning-policy/',
      category: 'planning',
    },
    {
      id: 'cardiff-wellbeing',
      title: 'Cardiff Public Services Board — Well-being Plan',
      source: 'Cardiff Council / PSB',
      whyRelevant: 'Local well-being objectives that can inform community benefit.',
      url: 'https://www.cardiff.gov.uk/ENG/resident/Your-Council/Strategies-and-plans/',
      category: 'community',
    },
    {
      id: 'nrw-flood',
      title: 'NRW — Flooding and your property',
      source: 'Natural Resources Wales',
      whyRelevant: 'Environmental flood risk context for Welsh sites.',
      url: 'https://naturalresources.wales/guidance-and-advice/business-sectors/flooding/',
      category: 'environmental',
    },
  ]

  return [...tans, ...always]
}

async function fetchCoflein(lat: number, lng: number): Promise<CofleinHit[]> {
  try {
    const u = new URL('https://coflein.gov.uk/api/search')
    u.searchParams.set('lat', String(lat))
    u.searchParams.set('lng', String(lng))
    u.searchParams.set('radius', '500')
    const res = await fetch(u.toString())
    if (!res.ok) return []
    const j = (await res.json()) as {
      results?: Array<{ id?: string; title?: string; type?: string; url?: string }>
      features?: CofleinGeoFeature[]
    }
    if (Array.isArray(j.results)) {
      return j.results.slice(0, 12).map((r, i) => ({
        id: String(r.id ?? i),
        title: String(r.title ?? 'Historic record'),
        type: r.type,
        url: r.url ?? `https://coflein.gov.uk/en/site/${r.id}`,
      }))
    }
    if (Array.isArray(j.features)) {
      return j.features.slice(0, 12).map((f, i) => {
        const p = f.properties ?? {}
        const name = p.name
        const title = p.title
        return {
          id: String(f.id ?? i),
          title: String(
            (typeof name === 'string' ? name : null) ??
              (typeof title === 'string' ? title : null) ??
              'Listed / historic feature'
          ),
          type: typeof p.type === 'string' ? p.type : undefined,
          url: typeof p.url === 'string' ? p.url : 'https://coflein.gov.uk/',
        }
      })
    }
    return []
  } catch {
    return []
  }
}

async function fetchClaudeDocs(site: SiteLocation, programme: string): Promise<LocalIntelDoc[]> {
  const system =
    'You are a UK planning research assistant. Return ONLY valid JSON array of exactly 5 objects, no markdown.'
  const user = `Given this site:
Address: ${site.address}
Lat: ${site.lat}, Lng: ${site.lng}
Urban context: Cardiff, Wales — Victorian terraced grain typical of inner Cardiff.
Programme: ${programme || 'not specified'}

Suggest 5 specific planning policy documents, design guides, or official resources an architect should read before designing here.
For each return:
{ "title": string, "publisher": string, "whyRelevant": string, "url": string }

Return JSON array only.`

  const res = await fetch('/anthropic-api/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}`)
  const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
  const text = json.content?.find((c) => c.type === 'text')?.text ?? ''
  const arr = JSON.parse(text) as Array<Record<string, string>>
  if (!Array.isArray(arr)) return []
  return arr.slice(0, 5).map((r, i) => ({
    id: `claude-${i}`,
    title: String(r.title ?? 'Document'),
    source: String(r.publisher ?? 'Various'),
    whyRelevant: String(r.whyRelevant ?? ''),
    url: String(r.url ?? 'https://www.gov.wales/'),
    category: 'planning' as LocalIntelCategory,
  }))
}

export function useLocalIntel(site: SiteLocation | null, programme: string, requestKey: number) {
  const [state, setState] = useState<State>({ status: 'idle' })

  useEffect(() => {
    if (!site) return
    let cancelled = false
    ;(async () => {
      setState({ status: 'loading', phase: 'Planning references…' })
      const staticDocs = staticPlanningDocs(programme)
      if (cancelled) return
      setState({ status: 'loading', phase: 'Coflein historic search…' })
      const coflein = await fetchCoflein(site.lat, site.lng)
      if (cancelled) return
      let claudeDocs: LocalIntelDoc[] = []
      try {
        setState({ status: 'loading', phase: 'Claude policy suggestions…' })
        claudeDocs = await fetchClaudeDocs(site, programme)
      } catch {
        claudeDocs = []
      }
      if (!cancelled) setState({ status: 'ok', staticDocs, coflein, claudeDocs })
    })()
    return () => {
      cancelled = true
    }
  }, [site, programme, requestKey])

  return { state }
}
