import type { ExploreMessage } from '../types'
import { anthropicMessagesUrl } from './anthropicMessagesUrl'

const EXPLORE_SYSTEM = `You're a thinking partner helping map out a complex scenario.
Keep responses SHORT (1–2 sentences max). Be casual, direct, curious.
Ask clarifying questions to understand the scenario better.
Avoid long explanations or bullet points.
Your goal: help the user explore one branch of their "what if" scenario.`

/**
 * Anthropic Messages API: short casual reply from explore thread history.
 */
export async function sendExploreCasualReply(
  history: ExploreMessage[],
  apiKey: string,
  model: string,
): Promise<string> {
  const messages = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  const body = {
    model,
    max_tokens: 180,
    system: EXPLORE_SYSTEM,
    messages,
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
  return text
}
