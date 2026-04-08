import { parseExtractionResponse } from './parseExtraction'
import type { ExtractionPayload } from '../types'
import { anthropicMessagesUrl } from './anthropicMessagesUrl'

const EXTRACTION_INSTRUCTION_BASE = `Extract consequences, questions, and certainty levels from this scenario description.
Return ONLY valid JSON (no markdown, no preamble):

{
  "consequences": [{"text": "...", "certainty": 75}, ...],
  "questions": [{"text": "..."}, ...],
  "assumptions": [{"text": "..."}, ...]
}

Focus on meaningful knock-on effects. Certainty is 0-100, your best estimate.
Keep text concise (max ~60 chars per item).

Scenario:`

const FIRST_MESSAGE_ROOT = `

This is the user's FIRST message in a new scenario. Include a "root" field with their exact scenario question (verbatim), in addition to the arrays above. Example shape:

{
  "root": "What if I took a sabbatical in Berlin?",
  "consequences": [...],
  "questions": [...],
  "assumptions": [...]
}
`

export async function extractScenario(
  userMessage: string,
  apiKey: string,
  model: string,
  isFirstMessageInScenario = false,
): Promise<ExtractionPayload> {
  const instruction =
    EXTRACTION_INSTRUCTION_BASE + (isFirstMessageInScenario ? FIRST_MESSAGE_ROOT : '')
  const body = {
    model,
    max_tokens: 2048,
    messages: [
      {
        role: 'user' as const,
        content: `${instruction}\n\n"${userMessage}"`,
      },
    ],
  }

  const res = await fetch(anthropicMessagesUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })

  const raw = await res.text()
  let data: {
    error?: { message?: string }
    content?: Array<{ type?: string; text?: string }>
  }
  try {
    data = JSON.parse(raw) as typeof data
  } catch {
    throw new Error(
      `Anthropic returned non-JSON (${res.status}): ${raw.slice(0, 240)}${raw.length > 240 ? '…' : ''}`,
    )
  }

  if (!res.ok) {
    const msg = data.error?.message || res.statusText || 'Request failed'
    throw new Error(msg)
  }

  const block = data.content?.find((b) => b.type === 'text') ?? data.content?.[0]
  const text = block?.text?.trim() ?? ''
  if (!text) {
    throw new Error('Empty response from model')
  }

  const parsed = parseExtractionResponse(text)
  if (isFirstMessageInScenario) {
    const r = parsed.root?.trim() || userMessage.trim()
    return { ...parsed, root: r.slice(0, 2000) }
  }
  const { root: _drop, ...rest } = parsed
  return rest
}
