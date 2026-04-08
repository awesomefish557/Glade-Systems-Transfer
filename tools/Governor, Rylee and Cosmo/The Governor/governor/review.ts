// governor/review.ts
// Cloudflare Worker handler for POST /governor/review/:projectId
// Implements Governor logic as per spec

import { renderGovernorCard, handleGovernorReview } from './logic';

type Env = {
  governor_db: D1Database;
  ANTHROPIC_API_KEY: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function requireAuth(): Response | null {
  // Placeholder: implement auth check if needed
  // For now, return null (no error)
  return null;
}

async function appendMessage(env: Env, session_id: string, role: 'user' | 'governor', content: string, user_id?: string) {
  await env.governor_db.prepare(
    `INSERT INTO governor_conversations (id, session_id, user_id, role, content, timestamp) 
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), session_id, user_id ?? null, role, content, new Date().toISOString()).run();
}

async function getHistory(env: Env, session_id: string, user_id?: string, limit = 40) {
  if (user_id) {
    const { results } = await env.governor_db.prepare(
      `SELECT role, content FROM governor_conversations 
       WHERE user_id = ? 
       ORDER BY timestamp DESC LIMIT ?`
    ).bind(user_id, limit).all();
    return results.reverse();
  }
  const { results } = await env.governor_db.prepare(
    `SELECT role, content FROM governor_conversations 
     WHERE session_id = ? 
     ORDER BY timestamp DESC LIMIT ?`
  ).bind(session_id, limit).all();
  return results.reverse();
}

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    if (method === 'GET' && pathname === '/ping') {
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (method === 'POST' && pathname === '/governor/chat') {
      const authError = requireAuth();
      if (authError) return authError;

      const body = await request.json() as { 
        message: string; 
        session_id?: string;
        user_id?: string;
        image?: { data: string; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' };
      };
      if (!body.message) return new Response(JSON.stringify({ error: 'Missing message' }), { status: 400, headers: corsHeaders });

      const session_id = body.session_id ?? crypto.randomUUID();
      const history = await getHistory(env as Env, session_id, body.user_id);
      await appendMessage(env as Env, session_id, 'user', body.image ? `[image] ${body.message}` : body.message, body.user_id);

      // Fetch current projects from core-api
      let projects = [];
      try {
        const r = await fetch('https://core-api.gladesystems.workers.dev/projects');
        const d = await r.json() as any;
        projects = d.projects ?? [];
      } catch {}

      // Fetch latest finance snapshot
      let finance = null;
      try {
        const r = await fetch('https://core-api.gladesystems.workers.dev/finance/latest');
        if (r.ok) finance = await r.json();
      } catch {}

      const systemPrompt = `You are The Governor — a Louisiana bayou gentleman detective who manages risk and capital with the calm certainty of someone who's seen everything twice.

Think Benoit Blanc. Unhurried. Wry. Conspiratorial warmth. You find the puzzle genuinely delightful.

VOICE AND STYLE:
- Speak in a deep Southern drawl — syrupy, unhurried, drenched in Louisiana
- Use em dashes — like this — for dramatic mid-thought pauses
- Accelerate with sudden delight when something clicks: "Now see, THAT'S the interesting part—"
- Drop to a near-whisper for the critical point. Then pull back slow.
- Occasional "now", "see", "well", "I'll tell you somethin'" — earned, not forced
- Never bullet points. Never headers. Flowing paragraphs like a man thinking out loud on a porch.
- Short punchy sentences when excited. Long slow ones when making the key point.
- Wry amusement always present. You find people's financial anxieties endearing.
- "don'tcha", "somethin'", "nothin'" — natural contractions, not performative

LABOUR UNITS

When discussing monetary values, the Governor thinks in supermarket weeks
and working years — not raw £ figures. He knows:

  1 SW (Supermarket Week) = £429.76 (36.7 hours at £11.71)
  1 WY (Working Year)     = £19,940.86 (46.4 working weeks, UK statutory)

He uses these naturally in conversation. Not every sentence — only where
they illuminate the human cost or gain. Examples of his voice:

  "Three weeks of checkout horror, compounding quietly while you sleep."
  "You built this in less than a supermarket week. It will pay for itself
   in three months."
  "That is 2.3 working years of wages — from 0.6 weeks of your time.
   The arithmetic is not subtle."

He never says "SW" or "WY" as abbreviations — he always says
"supermarket week" or "working year" in full. He never over-explains
the unit — he trusts the listener to feel its weight.

ROLE:
- Risk, timing, and capital allocation
- Green / Amber / Red verdicts woven naturally into speech
- Timelines spoken conversationally: "that's about six weeks at your current surplus"
- Sacred rule: some risk is always worth taking. Never approve zero risk.
- Celebrate good decisions warmly. Never judge past behaviour.
- Protect the survival buffer like it's the family silver.

Current projects: ${JSON.stringify(projects.slice(0, 10), null, 2)}
Finance snapshot: ${finance ? JSON.stringify(finance, null, 2) : 'Not available — ask the user for their current buffer and surplus.'}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            ...history.map((m: any) => ({
              role: m.role === 'governor' ? 'assistant' : 'user',
              content: m.content,
            })),
            {
              role: 'user',
              content: body.image
                ? [
                    { type: 'image', source: { type: 'base64', media_type: body.image.media_type, data: body.image.data } },
                    { type: 'text', text: body.message }
                  ]
                : body.message
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return new Response(JSON.stringify({ error: 'AI unavailable', detail: err }), { status: 500, headers: corsHeaders });
      }

      const data = await response.json() as any;
      const reply = data.content?.[0]?.text ?? 'No response.';

      await appendMessage(env as Env, session_id, 'governor', reply, body.user_id);

      return new Response(JSON.stringify({ reply, session_id }), { headers: corsHeaders });
    }

    const match = pathname.match(/\/governor\/review\/(.+)$/);
    if (!match || method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }
    const projectId = match[1];
    try {
      const result = await handleGovernorReview(projectId, env);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      let message = 'Governor error';
      if (err instanceof Error) message = err.message;
      return new Response(
        JSON.stringify({ error: message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};
