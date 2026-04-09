import { useEffect, useState } from 'react'
import type { PrecedentCard, SiteLocation } from '../types'

export type PrecedentFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: PrecedentCard[]; source: 'live' | 'fallback' }

type Params = {
  site: SiteLocation | null
  programme: string
  constraints: string
  solarSummary: string
  floodZone?: string
  radiusM: number
  requestKey: number
}

function fallbackCards(programme: string): PrecedentCard[] {
  return [
    {
      name: 'Fuji Kindergarten',
      architect: 'Tezuka Architects',
      year: 2007,
      location: 'Tokyo, Japan',
      whyRelevant: `Strong outdoor learning and movement loops align with ${programme || 'education-led'} brief.`,
      keyMoves: ['Continuous circulation ring', 'Flexible indoor-outdoor thresholds', 'Sectional play terrain'],
      lookAt: 'Roof plan, section and playground edges',
      searchQuery: 'Fuji Kindergarten Tezuka Architects plans sections',
    },
    {
      name: 'NUBO Nursery',
      architect: 'HIBINOSEKKEI + Youji no Shiro',
      year: 2018,
      location: 'Kanagawa, Japan',
      whyRelevant: 'Climate-responsive courtyard organization with sheltered play and daylight depth.',
      keyMoves: ['Courtyard zoning', 'Deep eaves', 'Programmed garden pockets'],
      lookAt: 'Ground floor plan and garden relationship',
      searchQuery: 'NUBO Nursery HIBINOSEKKEI plans sections',
    },
    {
      name: 'Maggie’s Cardiff',
      architect: 'Dow Jones Architects',
      year: 2019,
      location: 'Cardiff, UK',
      whyRelevant: 'Urban grain fit with careful threshold design and human-scale material strategy.',
      keyMoves: ['Calm sequence of rooms', 'Garden as therapeutic core', 'Legible low-rise massing'],
      lookAt: 'Site plan and section perspectives',
      searchQuery: 'Maggies Cardiff Dow Jones Architects plans sections',
    },
  ]
}

export function usePrecedents(params: Params): PrecedentFetchState {
  const [state, setState] = useState<PrecedentFetchState>({ status: 'idle' })
  useEffect(() => {
    if (!params.requestKey || !params.site) return
    const site = params.site
    let cancelled = false
    setState({ status: 'loading' })
    ;(async () => {
      const systemPrompt =
        'You are an expert architectural precedent researcher. Given site analysis data and programme, suggest exactly 3 built precedents that are genuinely relevant — not generic famous buildings. Consider climate, urban grain, programme, constraints, and scale. Return ONLY valid JSON, no other text.'
      const climateDesc = site.lat > 55 ? 'cool temperate maritime' : site.lat > 50 ? 'temperate maritime' : 'mild maritime'
      const userPrompt = `Site: ${site.address}
Latitude: ${site.lat} — ${climateDesc}
Urban context: dense Victorian terraced housing, Cardiff Wales
Programme: ${params.programme}
Site area: approx ${params.radiusM}m radius
Solar: south facing, ${params.solarSummary}
Key constraints: ${params.constraints || 'none provided'}

Return this exact JSON structure:
[
  {
    name: string,
    architect: string,
    year: number,
    location: string,
    whyRelevant: string,
    keyMoves: string[],
    lookAt: string,
    searchQuery: string
  }
]`
      const endpoint = '/anthropic-api/v1/messages'
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY ?? ''
      const body = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      })
      console.log('Calling Claude API...')
      console.log('Endpoint:', endpoint)
      console.log('Request body:', body)
      if (!apiKey) {
        console.warn('Precedents: VITE_ANTHROPIC_API_KEY is missing — set it in tools/sonde/.env and restart the dev server.')
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      })
      let data: unknown
      const rawText = await response.text()
      try {
        data = rawText ? JSON.parse(rawText) : null
      } catch {
        data = rawText
      }
      console.log('Response status:', response.status)
      console.log('Response body:', data)
      if (!response.ok) {
        throw new Error(`Precedent API ${response.status}`)
      }
      const json = data as {
        content?: Array<{ type?: string; text?: string }>
      }
      const text = json.content?.find((c) => c.type === 'text')?.text ?? ''
      const arr = JSON.parse(text) as unknown
      if (!Array.isArray(arr) || arr.length < 1) throw new Error('Malformed precedent response')
      const cards = arr.slice(0, 3).map((item) => {
        const r = (item ?? {}) as Record<string, unknown>
        return {
          name: String(r['name'] ?? 'Unnamed project'),
          architect: String(r['architect'] ?? 'Unknown'),
          year: Number(r['year'] ?? 0),
          location: String(r['location'] ?? ''),
          whyRelevant: String(r['whyRelevant'] ?? ''),
          keyMoves: Array.isArray(r['keyMoves']) ? (r['keyMoves'] as string[]).slice(0, 3) : [],
          lookAt: String(r['lookAt'] ?? ''),
          searchQuery: String(r['searchQuery'] ?? ''),
        } as PrecedentCard
      })
      if (!cancelled) setState({ status: 'ok', data: cards, source: 'live' })
    })().catch((err) => {
      console.error('Precedents: request failed, using fallback cards.', err)
      if (!cancelled) setState({ status: 'ok', data: fallbackCards(params.programme), source: 'fallback' })
    })
    return () => {
      cancelled = true
    }
  }, [params.requestKey, params.site?.lat, params.site?.lng, params.programme, params.constraints, params.solarSummary, params.floodZone, params.radiusM])
  return state
}
