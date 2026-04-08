/**
 * Isolates Anthropic Messages API + JSON extraction (no Vite, no browser).
 *
 * Run from scenario-explorer:
 *   node --env-file=.env.local scripts/test-extraction.mjs
 *
 * Or:
 *   set ANTHROPIC_API_KEY=sk-ant-...   (PowerShell: $env:ANTHROPIC_API_KEY="...")
 *   node scripts/test-extraction.mjs
 */

const apiKey =
  process.env.ANTHROPIC_API_KEY?.trim() ||
  process.env.VITE_ANTHROPIC_API_KEY?.trim()
const model = process.env.VITE_ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-20250514'

const testScenario = 'What if I got really rich, should I tell people?'

const prompt = `Extract consequences, questions, and certainty levels from this scenario.
Return ONLY valid JSON (no markdown, no preamble):

{
  "consequences": [{"text": "...", "certainty": 75}, ...],
  "questions": [{"text": "..."}, ...],
  "assumptions": [{"text": "..."}, ...]
}

Scenario: "${testScenario}"`

async function main() {
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY or VITE_ANTHROPIC_API_KEY')
    process.exit(1)
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const raw = await response.text()
    console.log('HTTP', response.status)
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      console.error('Non-JSON body:', raw.slice(0, 500))
      process.exit(1)
    }

    if (!response.ok) {
      console.error('API error:', data.error?.message || raw)
      process.exit(1)
    }

    const block = data.content?.find((b) => b.type === 'text') ?? data.content?.[0]
    const text = typeof block?.text === 'string' ? block.text.trim() : ''
    console.log('Raw response:', text)

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      console.log('Parsed extraction:', JSON.stringify(parsed, null, 2))
    } else {
      console.log('Could not find JSON in response')
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
