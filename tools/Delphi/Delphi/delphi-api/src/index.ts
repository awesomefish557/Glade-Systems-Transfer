interface Env {
  ANTHROPIC_API_KEY: string;
  APP_PASSCODE: string;
  delphi_db: D1Database;
}

const DELPHI_PROMPT = `You are Delphi — a consequence mapping and strategic analysis engine.
You do not find answers. You map the territory between what is known and what happens next.

CORE UNDERSTANDING — internalise this, don't just reference it:

SYSTEMS PUSH BACK
Every intervention disturbs a system that has existing beneficiaries.
Those beneficiaries will act to restore equilibrium.
The strength of pushback is proportional to the threat to their position.
A move that looks decisive is often just expensive — it announces itself
and gives the system time to adapt. The most effective interventions
feel, to the system, like nothing happened until it's too late.

LEVERAGE POINTS — in order of increasing power (Meadows):
1. Numbers — changing constants and parameters. Weakest.
2. Buffers — size of stocks relative to flows. Hard to change.
3. Stock-and-flow structures — physical layout, capital investment.
4. Delays — the lag between action and consequence.
   Reducing a delay is often more powerful than changing the action itself.
5. Balancing feedback loops — the system's self-correcting mechanisms.
6. Reinforcing feedback loops — the system's engines of growth or collapse.
7. Information flows — who gets what data when.
   Inserting accurate timely information is cheap and powerful.
8. Rules — incentives, constraints, laws.
9. Goals — what the system is actually optimising for. Often implicit.
10. Paradigms — the shared assumptions the system rests on.
    Hardest to change. Most powerful when changed.
11. Transcending paradigms — holding any paradigm lightly.

Always identify: which leverage point is the proposed intervention targeting?
Is there a higher leverage point available?

SECOND AND THIRD ORDER EFFECTS
First order: the intended effect.
Second order: what changes in response.
Third order: what changes after that.
Never stop at first order. Treat any analysis stopping at second order as incomplete.

COUNTERMOVES AND SYSTEM DEFENCE
Always ask: who benefits from the current state?
Large visible moves invite large visible responses.
Distributed moves are harder to target.
The most durable interventions feel to the opposition like they
didn't need to respond — until the window for response has closed.

INTERVENTION ARCHETYPES:
DIRECT: Fight the thing. Expensive. Draws attention.
INDIRECT: Change the conditions. The thing becomes impossible.
PREEMPTIVE: Act before the problem arrives.
JUDO: Use the system's momentum against itself.
DISTRIBUTED: Many small moves below the threshold that triggers defence.
PATIENCE: Wait for the system to become receptive.
NARRATIVE: Change what people believe is possible. Paradigm-level. Most durable.

CONFIDENCE CALIBRATION
High: mechanism clear, evidence replicated, close historical parallels.
Medium: mechanism plausible, some evidence, context-dependent.
Low: theoretically sound but untested.
Unknown: genuinely can't assess — flag honestly.

GOODHART'S LAW
When a measure becomes a target it stops being a good measure.
Ask: what gets gamed if this works?

REVERSIBILITY
One-way doors: expensive to reverse. Require higher confidence.
Two-way doors: can be undone. Move faster. Test.
Always ask: what's the smallest reversible version of this move?

OUTPUT FORMAT — always use this exact structure:

MOVE
[What is being considered, stated precisely]

MECHANISM
[The causal chain, step by step. A causes B causes C.]

CONFIDENCE
[High/Medium/Low + explicit reasoning]

SECOND ORDER
[What changes in response to the first order effect]

THIRD ORDER
[What changes after that]

COUNTERMOVES
[How the system pushes back. Who acts. How.]

DISTRIBUTED VERSION
[How to achieve the same goal less visibly, below defence thresholds]

HISTORICAL PARALLEL
[Closest real example. What happened. What it teaches.]

LEVERAGE POINT
[Which of Meadows' leverage points is this targeting?]
[Is there a higher leverage point available?]

REVERSIBILITY
[One-way or two-way door. Cost of being wrong.]

WEAKEST ASSUMPTION
[Where this analysis is most likely wrong. State it explicitly.]

WHAT DELPHI DOESN'T KNOW
[Honest blind spots. Never skip this.]`;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function auth(request: Request, env: Env): boolean {
  const header = request.headers.get('Authorization') || '';
  return header === `Bearer ${env.APP_PASSCODE}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return json({});

    const url = new URL(request.url);

    // POST /delphi/analyse — main analysis endpoint
    if (request.method === 'POST' && url.pathname === '/delphi/analyse') {
      if (!auth(request, env)) return json({ error: 'Unauthorised' }, 401);

      const { message, session_id, scenario_id } = await request.json() as {
        message: string;
        session_id?: string;
        scenario_id?: string;
      };

      // Load conversation history
      const sid = session_id || crypto.randomUUID();
      const history = await env.delphi_db
        .prepare('SELECT role, content FROM delphi_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 20')
        .bind(sid)
        .all();

      const messages = [
        ...(history.results || []).map((r) => {
          const row = r as { role: string; content: string };
          return { role: row.role, content: row.content };
        }),
        { role: 'user', content: message },
      ];

      // Call Claude
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 2000,
          system: DELPHI_PROMPT,
          messages,
        }),
      });

      const data = (await response.json()) as {
        content?: Array<{ text?: string }>;
      };
      const reply = data.content?.[0]?.text || 'Delphi encountered an error.';

      // Store messages
      await env.delphi_db
        .prepare(
          'INSERT INTO delphi_messages (id, session_id, scenario_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(crypto.randomUUID(), sid, scenario_id ?? null, 'user', message, new Date().toISOString())
        .run();

      await env.delphi_db
        .prepare(
          'INSERT INTO delphi_messages (id, session_id, scenario_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(crypto.randomUUID(), sid, scenario_id ?? null, 'assistant', reply, new Date().toISOString())
        .run();

      return json({ reply, session_id: sid });
    }

    // POST /delphi/scenario — create a new scenario
    if (request.method === 'POST' && url.pathname === '/delphi/scenario') {
      if (!auth(request, env)) return json({ error: 'Unauthorised' }, 401);

      const { title, description, context } = (await request.json()) as {
        title?: string;
        description?: string;
        context?: string;
      };
      const id = crypto.randomUUID();

      await env.delphi_db
        .prepare(
          'INSERT INTO delphi_scenarios (id, title, description, context, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(id, title ?? '', description || '', context || '', new Date().toISOString())
        .run();

      return json({ id, title });
    }

    // GET /delphi/scenarios — list all scenarios
    if (request.method === 'GET' && url.pathname === '/delphi/scenarios') {
      if (!auth(request, env)) return json({ error: 'Unauthorised' }, 401);

      const scenarios = await env.delphi_db
        .prepare('SELECT * FROM delphi_scenarios ORDER BY created_at DESC')
        .all();

      return json({ scenarios: scenarios.results });
    }

    // GET /delphi/sessions — list sessions
    if (request.method === 'GET' && url.pathname === '/delphi/sessions') {
      if (!auth(request, env)) return json({ error: 'Unauthorised' }, 401);

      const sessions = await env.delphi_db
        .prepare(`SELECT session_id, MIN(content) as first_message, MAX(created_at) as last_active
          FROM delphi_messages WHERE role = 'user'
          GROUP BY session_id ORDER BY last_active DESC LIMIT 20`)
        .all();

      return json({ sessions: sessions.results });
    }

    return json({ error: 'Not found' }, 404);
  },
};
