import type { ExtractionPayload } from '../types'

function stripCodeFences(raw: string): string {
  let s = raw.trim()
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im
  const m = s.match(fence)
  if (m) s = m[1].trim()
  return s
}

/** Best-effort: find outermost `{ ... }` for JSON object */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function normalizeItem(
  x: unknown,
): { text: string; certainty?: number } | null {
  if (x == null) return null
  if (typeof x === 'string') {
    const t = x.trim()
    return t ? { text: t } : null
  }
  if (typeof x === 'object' && 'text' in x) {
    const o = x as { text?: unknown; certainty?: unknown }
    const text = typeof o.text === 'string' ? o.text.trim() : ''
    if (!text) return null
    let certainty: number | undefined
    if (typeof o.certainty === 'number' && Number.isFinite(o.certainty)) {
      certainty = Math.max(0, Math.min(100, Math.round(o.certainty)))
    }
    return certainty !== undefined ? { text, certainty } : { text }
  }
  return null
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/**
 * Parse Claude output into structured extraction. Never throws; returns partial/empty on failure.
 */
export function parseExtractionResponse(raw: string): ExtractionPayload {
  const cleaned = stripCodeFences(raw)
  let jsonStr = cleaned
  try {
    JSON.parse(cleaned)
  } catch {
    const extracted = extractJsonObject(cleaned)
    jsonStr = extracted ?? cleaned
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return { consequences: [], questions: [], assumptions: [], root: undefined }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { consequences: [], questions: [], assumptions: [], root: undefined }
  }

  const o = parsed as Record<string, unknown>
  let root: string | undefined
  if (typeof o.root === 'string' && o.root.trim()) {
    root = o.root.trim().slice(0, 2000)
  }
  const consequences: ExtractionPayload['consequences'] = []
  const questions: ExtractionPayload['questions'] = []
  const assumptions: ExtractionPayload['assumptions'] = []

  for (const item of asArray(o.consequences)) {
    const n = normalizeItem(item)
    if (n) {
      consequences.push({
        text: n.text.slice(0, 500),
        certainty:
          typeof n.certainty === 'number' ? n.certainty : 50,
      })
    }
  }

  for (const item of asArray(o.questions)) {
    const n = normalizeItem(item)
    if (n) questions.push({ text: n.text.slice(0, 500) })
  }

  for (const item of asArray(o.assumptions)) {
    const n = normalizeItem(item)
    if (n) assumptions.push({ text: n.text.slice(0, 500) })
  }

  return { root, consequences, questions, assumptions }
}
