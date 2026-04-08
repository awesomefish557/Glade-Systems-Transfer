import { AwsClient } from "aws4fetch";
import { Hono } from "hono";

export interface Env {
  PINBOARD_DB: D1Database;
  PINBOARD_R2: R2Bucket;
  ANTHROPIC_API_KEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
}

interface NodeRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  tags: string;
  x: number;
  y: number;
  metadata: string;
  created_at: number;
  updated_at: number;
  map_id?: string | null;
}

interface MapRow {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: number;
}

interface NodeTypeRow {
  id: string;
  map_id: string;
  name: string;
  color: string;
  sort_order: number;
  node_count?: number;
}

const QUESTION_TYPE_NAME = "QUESTION";
const QUESTION_TYPE_COLOR = "#cc4444";

async function mapExists(db: D1Database, mapId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM maps WHERE id = ?`).bind(mapId).first();
  return !!row;
}

async function fetchNodeTypesForMapWithCounts(db: D1Database, mapId: string): Promise<NodeTypeRow[]> {
  const res = await db
    .prepare(
      `SELECT nt.id AS id, nt.map_id AS map_id, nt.name AS name, nt.color AS color, nt.sort_order AS sort_order,
        (SELECT COUNT(*) FROM nodes n WHERE COALESCE(n.map_id, 'default') = nt.map_id AND n.type = nt.name) AS node_count
       FROM node_types nt
       WHERE nt.map_id = ?
       ORDER BY nt.sort_order ASC, nt.name ASC`,
    )
    .bind(mapId)
    .all();
  return ((res.results ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    map_id: String(r.map_id),
    name: String(r.name),
    color: String(r.color),
    sort_order: Number(r.sort_order) || 0,
    node_count: Number(r.node_count) || 0,
  }));
}

async function getTypeNamesPromptLine(db: D1Database, mapId: string): Promise<string> {
  const rows = await fetchNodeTypesForMapWithCounts(db, mapId);
  const names = rows.map((r) => r.name);
  return names.length ? names.join(", ") : QUESTION_TYPE_NAME;
}

async function canonicalTypeNameForMap(db: D1Database, mapId: string, raw: string): Promise<string | null> {
  const t = raw.trim();
  if (!t) return null;
  const row = await db
    .prepare(`SELECT name FROM node_types WHERE map_id = ? AND UPPER(name) = UPPER(?)`)
    .bind(mapId, t)
    .first<{ name: string }>();
  return row?.name ?? null;
}

async function defaultFallbackTypeForMap(db: D1Database, mapId: string): Promise<string> {
  const rows = await fetchNodeTypesForMapWithCounts(db, mapId);
  const nonQ = rows.find((r) => r.name !== QUESTION_TYPE_NAME);
  return nonQ?.name ?? QUESTION_TYPE_NAME;
}

function normalizeMapId(q: string | undefined | null): string {
  const m = typeof q === "string" ? q.trim() : "";
  return m.length > 0 ? m : "default";
}

async function parseJsonBodyOptional(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Personal tool: allow any browser origin (no credentialed cookies on this API). */
const CORS_ORIGIN = "*";

function applyCors(c: { res: Response }): Response {
  const headers = new Headers(c.res.headers);
  headers.set("Access-Control-Allow-Origin", CORS_ORIGIN);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers });
}

function parseJsonFields<T extends { tags?: string; metadata?: string }>(row: T): T & { tags: unknown; metadata: unknown } {
  let tags: unknown = [];
  let metadata: unknown = {};
  try {
    tags = JSON.parse(String(row.tags ?? "[]"));
  } catch {
    tags = [];
  }
  try {
    metadata = JSON.parse(String(row.metadata ?? "{}"));
  } catch {
    metadata = {};
  }
  return { ...row, tags, metadata };
}

async function callAnthropic(env: Env, system: string, user: string): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${t.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const block = data.content?.find((b) => b.type === "text");
  if (!block?.text) {
    throw new Error("Anthropic returned no text content");
  }
  return block.text;
}

/** First balanced `{…}` or `[…]` from text (ignores braces inside strings). Model output often has valid JSON then trailing prose. */
function extractFirstJsonValue(t: string): string {
  const startObj = t.indexOf("{");
  const startArr = t.indexOf("[");
  let start = -1;
  let open = "";
  let close = "";
  if (startObj >= 0 && (startArr < 0 || startObj <= startArr)) {
    start = startObj;
    open = "{";
    close = "}";
  } else if (startArr >= 0) {
    start = startArr;
    open = "[";
    close = "]";
  } else {
    throw new Error("No JSON object or array found in model response");
  }
  const s = t.slice(start);
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  throw new Error("Unbalanced JSON in model response");
}

function parseAnthropicJson(text: string): unknown {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    t = t.trim();
  }
  const jsonStr = extractFirstJsonValue(t);
  return JSON.parse(jsonStr);
}

function findNodeIdByTitle(nodes: NodeRow[], title: string): string | undefined {
  const t = title.trim().toLowerCase();
  const n = nodes.find((x) => x.title.trim().toLowerCase() === t);
  return n?.id;
}

function pairKeyUndirected(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

function buildExistingEdgeSet(
  connections: Array<{ source_id: string; target_id: string }>,
): Set<string> {
  const s = new Set<string>();
  for (const c of connections) {
    if (c.source_id === c.target_id) continue;
    s.add(pairKeyUndirected(c.source_id, c.target_id));
  }
  return s;
}

function finiteOrKeep(x: number, y: number, fallbackX: number, fallbackY: number): { x: number; y: number } {
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  const fx = Number.isFinite(fallbackX) ? fallbackX : 0;
  const fy = Number.isFinite(fallbackY) ? fallbackY : 0;
  return { x: fx, y: fy };
}

/** Same hub / QUESTION-outer ring logic as pinboard-ui resolveGraphLayout; ring radii and per-ring capacity scale with connection label length. */
function computeResolvePositionsMap(
  nodes: NodeRow[],
  connections: Array<{ source_id: string; target_id: string; label: string | null }>,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;

  const maxLabelLength = Math.max(
    connections.length > 0 ? Math.max(...connections.map((c) => c.label?.length ?? 0)) : 0,
    10,
  );
  const labelSpacingFactor = Math.max(1, maxLabelLength / 12);
  const ringRadii = [0, 280, 560, 840, 1120].map((r) => Math.round(r * labelSpacingFactor));
  const minArcDist = maxLabelLength * 7;

  function radiusForRing(ring: number): number {
    if (ring >= 0 && ring < ringRadii.length) return ringRadii[ring];
    const step = Math.round(280 * labelSpacingFactor);
    return ringRadii[ringRadii.length - 1] + (ring - (ringRadii.length - 1)) * step;
  }

  /** Max nodes on this ring while keeping arc spacing >= minArcDist (ring 0 = hub, capacity 1). */
  function arcCapacity(ring: number): number {
    if (ring === 0) return 1;
    const R = radiusForRing(ring);
    if (R < 1e-9) return 1;
    return Math.max(1, Math.floor((2 * Math.PI * R) / minArcDist));
  }

  const deg = new Map(nodes.map((n) => [n.id, 0]));
  for (const c of connections) {
    deg.set(c.source_id, (deg.get(c.source_id) ?? 0) + 1);
    deg.set(c.target_id, (deg.get(c.target_id) ?? 0) + 1);
  }
  const byDeg = (a: NodeRow, b: NodeRow) =>
    ((deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0)) || a.id.localeCompare(b.id);
  const nonQ = nodes.filter((n) => n.type !== "QUESTION").sort(byDeg);
  const qs = nodes.filter((n) => n.type === "QUESTION").sort(byDeg);

  let hubMaxRing = 0;

  const placeList = (list: NodeRow[], startRing: number, startSlot: number, trackHub: boolean) => {
    let ring = startRing;
    let slot = startSlot;
    for (const n of list) {
      let cap = arcCapacity(ring);
      while (slot >= cap) {
        ring += 1;
        slot = 0;
        cap = arcCapacity(ring);
      }
      const rad = radiusForRing(ring);
      const ang = (2 * Math.PI * slot) / cap;
      const x = rad * Math.cos(ang);
      const y = rad * Math.sin(ang);
      out.set(n.id, finiteOrKeep(x, y, n.x, n.y));
      if (trackHub) hubMaxRing = Math.max(hubMaxRing, ring);
      slot += 1;
    }
  };

  if (nonQ.length) placeList(nonQ, 0, 0, true);
  if (qs.length) placeList(qs, nonQ.length === 0 ? 1 : hubMaxRing + 1, 0, false);

  return out;
}

function layoutSeparationOrder(positions: Map<string, { x: number; y: number }>): string[] {
  return [...positions.keys()].sort((a, b) => {
    const pa = positions.get(a)!;
    const pb = positions.get(b)!;
    const aa = Math.atan2(pa.y, pa.x);
    const ab = Math.atan2(pb.y, pb.x);
    if (aa !== ab) return aa - ab;
    const ra = pa.x * pa.x + pa.y * pa.y;
    const rb = pb.x * pb.x + pb.y * pb.y;
    return ra - rb || a.localeCompare(b);
  });
}

/** If any pair is closer than minDist px, nudge the later (in order) node outward by nudgePx along its radial ray. */
function applyRadialSeparationNudge(
  positions: Map<string, { x: number; y: number }>,
  minDist = 120,
  nudgePx = 140,
  maxPasses = 30,
): void {
  const order = layoutSeparationOrder(positions);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const idB = order[j];
        const pa = positions.get(order[i])!;
        const pb = positions.get(idB)!;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        const len = Math.hypot(pb.x, pb.y);
        let ux: number;
        let uy: number;
        if (len > 1e-9) {
          ux = pb.x / len;
          uy = pb.y / len;
        } else {
          const t = (j * 0.618033988749895) % (2 * Math.PI);
          ux = Math.cos(t);
          uy = Math.sin(t);
        }
        const next = { x: pb.x + ux * nudgePx, y: pb.y + uy * nudgePx };
        positions.set(idB, finiteOrKeep(next.x, next.y, pb.x, pb.y));
        changed = true;
      }
    }
    if (!changed) break;
  }
}

async function runResolve(
  env: Env,
  mapId: string,
): Promise<{
  new_connections: Record<string, unknown>[];
  positions: Record<string, { x: number; y: number }>;
}> {
  const nodesRes = await env.PINBOARD_DB.prepare(
    `SELECT * FROM nodes WHERE COALESCE(map_id, 'default') = ?`,
  )
    .bind(mapId)
    .all();
  const connsRes = await env.PINBOARD_DB.prepare(
    `SELECT c.id AS id, c.source_id AS source_id, c.target_id AS target_id, c.label AS label, c.strength AS strength, c.created_at AS created_at
     FROM connections c
     INNER JOIN nodes s ON s.id = c.source_id
     INNER JOIN nodes t ON t.id = c.target_id
     WHERE COALESCE(s.map_id, 'default') = ? AND COALESCE(t.map_id, 'default') = ?`,
  )
    .bind(mapId, mapId)
    .all();
  const nodes = (nodesRes.results ?? []) as unknown as NodeRow[];
  const connections = (connsRes.results ?? []) as Array<{
    id: string;
    source_id: string;
    target_id: string;
    label: string | null;
    strength: number;
    created_at: number;
  }>;

  const idToTitle = new Map(nodes.map((n) => [n.id, n.title]));
  const existingLines: string[] = [];
  for (const c of connections) {
    const st = idToTitle.get(c.source_id) ?? c.source_id;
    const tt = idToTitle.get(c.target_id) ?? c.target_id;
    existingLines.push(`- ${st} → ${tt}${c.label ? ` (${c.label})` : ""}`);
  }

  const nodeLines = nodes.map((n) => {
    const body = n.body ? n.body.slice(0, 240).replace(/\s+/g, " ") : "";
    let meta = "";
    try {
      const o = JSON.parse(String(n.metadata ?? "{}")) as Record<string, unknown>;
      meta = Object.entries(o)
        .filter(([, v]) => v != null && String(v).length > 0)
        .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
        .join("; ");
    } catch {
      meta = "";
    }
    return `- [${n.type}] ${n.title}${body ? ` — ${body}` : ""}${meta ? ` | ${meta}` : ""}`;
  });

  const userPayload = `NODES:\n${nodeLines.join("\n") || "(none)"}\n\nEXISTING CONNECTIONS:\n${existingLines.join("\n") || "(none)"}`;

  const system =
    "You are an architectural knowledge curator. Analyse these nodes and find implicit connections. \n\nPRIORITY — always check these first:\n- Same author/architect (e.g. two books by Christopher Alexander MUST be connected)\n- Same building/project referenced in multiple nodes\n- Direct theoretical influence (e.g. Ruskin → Morris → Arts & Crafts)\n\nAlso check:\n- Same era or movement\n- Contradicting ideas\n- One concept explaining another\n\nFor each connection provide a short label (2-5 words, lowercase).\nReturn ONLY valid JSON, no explanation:\n{ connections: [{ source_title: string, target_title: string, label: string }] }\nMaximum 8 connections. Only return connections that do not already exist.";

  const raw = await callAnthropic(env, system, userPayload);
  const parsed = parseAnthropicJson(raw) as {
    connections?: Array<{ source_title?: string; target_title?: string; label?: string }>;
  };
  const suggested = Array.isArray(parsed.connections) ? parsed.connections.slice(0, 8) : [];
  console.log(`[resolve] AI suggested ${suggested.length} connection(s)`);

  const edgeSet = buildExistingEdgeSet(connections);
  const now = Math.floor(Date.now() / 1000);
  const newConnections: Record<string, unknown>[] = [];
  const stmts: D1PreparedStatement[] = [];

  for (const s of suggested) {
    const st = typeof s.source_title === "string" ? s.source_title : "";
    const tt = typeof s.target_title === "string" ? s.target_title : "";
    const label = typeof s.label === "string" ? s.label : "";
    if (!st.trim() || !tt.trim()) continue;
    const sid = findNodeIdByTitle(nodes, st);
    const tid = findNodeIdByTitle(nodes, tt);
    if (!sid || !tid || sid === tid) continue;
    const pk = pairKeyUndirected(sid, tid);
    if (edgeSet.has(pk)) continue;
    edgeSet.add(pk);
    const cid = crypto.randomUUID();
    stmts.push(
      env.PINBOARD_DB.prepare(
        `INSERT INTO connections (id, source_id, target_id, label, strength, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
      ).bind(cid, sid, tid, label || null, now),
    );
    newConnections.push({
      id: cid,
      source_id: sid,
      target_id: tid,
      label: label || null,
      strength: 1,
      created_at: now,
    });
  }

  if (stmts.length) {
    await env.PINBOARD_DB.batch(stmts);
  }
  console.log(`[resolve] inserted ${stmts.length} new connection(s)`);

  const connsAfter =
    stmts.length > 0
      ? (((await env.PINBOARD_DB.prepare(
          `SELECT c.source_id AS source_id, c.target_id AS target_id, c.label AS label
           FROM connections c
           INNER JOIN nodes s ON s.id = c.source_id
           INNER JOIN nodes t ON t.id = c.target_id
           WHERE COALESCE(s.map_id, 'default') = ? AND COALESCE(t.map_id, 'default') = ?`,
        )
          .bind(mapId, mapId)
          .all()) as D1Result<{ source_id: string; target_id: string; label: string | null }>).results ?? []) as Array<{
          source_id: string;
          target_id: string;
          label: string | null;
        }>
      : connections;

  const posMap = computeResolvePositionsMap(nodes, connsAfter);
  applyRadialSeparationNudge(posMap, 120, 140);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = posMap.get(n.id) ?? finiteOrKeep(n.x, n.y, 0, 0);
    positions[n.id] = p;
  }

  return { new_connections: newConnections, positions };
}

export async function processLoadingBayItem(
  item: {
    id: string;
    raw_content: string | null;
    raw_url: string | null;
    raw_type: string | null;
    map_id?: string | null;
  },
  env: Env
): Promise<void> {
  await env.PINBOARD_DB.prepare(`UPDATE loading_bay SET status = 'processing', ai_reasoning = NULL WHERE id = ?`)
    .bind(item.id)
    .run();
  try {
    let text = item.raw_content ?? "";
    if (item.raw_url) {
      const r = await fetch(item.raw_url, { redirect: "follow" });
      if (!r.ok) {
        throw new Error(`Failed to fetch raw_url: HTTP ${r.status}`);
      }
      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("text/") || ct.includes("json") || ct.includes("xml")) {
        text = `${text}\n\n---\n\n${await r.text()}`.trim();
      } else {
        text = `${text}\n\n[URL fetched; non-text content type: ${ct}]`.trim();
      }
    }
    if (!text) {
      throw new Error("No raw_content or fetchable text from raw_url");
    }
    const mapId = normalizeMapId(item.map_id);
    const typeLine = await getTypeNamesPromptLine(env.PINBOARD_DB, mapId);
    const system = `You are a knowledge curator. Given raw text, URLs, or notes, identify distinct pieces of knowledge and classify each node using exactly one of these types. Available node types for this map: ${typeLine}. Use the type field as one of these exact names (same spelling and casing as listed). Return ONLY valid JSON with no explanation: { nodes: [{ type, title, body, tags[], metadata{} }], connections: [{ source_title, target_title, label }], reasoning: string }`;
    const out = await callAnthropic(env, system, text);
    const parsed = parseAnthropicJson(out) as {
      nodes?: unknown;
      connections?: unknown;
      reasoning?: string;
    };
    const proposedNodes = JSON.stringify(parsed.nodes ?? []);
    const proposedConnections = JSON.stringify(parsed.connections ?? []);
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
    const now = Math.floor(Date.now() / 1000);
    await env.PINBOARD_DB.prepare(
      `UPDATE loading_bay SET proposed_nodes = ?, proposed_connections = ?, ai_reasoning = ?, status = 'proposed', processed_at = ? WHERE id = ?`
    )
      .bind(proposedNodes, proposedConnections, reasoning, now, item.id)
      .run();
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const truncated = errMsg.length > 1800 ? `${errMsg.slice(0, 1800)}…` : errMsg;
    await env.PINBOARD_DB.prepare(
      `UPDATE loading_bay SET status = 'pending', ai_reasoning = ? WHERE id = ?`,
    )
      .bind(`[Processing failed] ${truncated}`, item.id)
      .run();
    throw e;
  }
}

export async function exploreNext(
  graph: { nodes: NodeRow[]; connections: unknown[] },
  env: Env
): Promise<unknown> {
  const compact = graph.nodes
    .map((n) => `- [${n.type}] ${n.title}${n.body ? `: ${n.body.slice(0, 200)}` : ""}`)
    .join("\n");
  const system =
    "You are an architectural tutor reviewing a student's knowledge map. Based on these nodes, identify 5 specific gaps or next steps. For each, provide: type (book|talk|place|person|website|concept), title, reason (why this fills a gap), url (if applicable). Return ONLY valid JSON: { recommendations: [...] }";
  const out = await callAnthropic(env, system, compact || "(empty graph)");
  return parseAnthropicJson(out);
}

export async function tutorScan(
  nodes: NodeRow[],
  env: Env,
  mapId: string,
): Promise<{ summary: string; questionsAdded: number }> {
  const compact = nodes
    .map((n) => `## ${n.title} (${n.type})\n${n.body ?? ""}`)
    .join("\n\n");
  const typeLine = await getTypeNamesPromptLine(env.PINBOARD_DB, mapId);
  const system = `You are a Socratic tutor reviewing this knowledge map. Available node types for this map: ${typeLine}. Identify 3-5 places where: the student's understanding may be shallow, there's a notable contradiction between nodes, or a key connection is missing. For each, generate a challenging question. Return ONLY valid JSON: { questions: [{ title: string (the question), body: string (explain why this matters), connects_to: [node_title, ...] }] }`;
  const out = await callAnthropic(env, system, compact || "(empty graph)");
  const parsed = parseAnthropicJson(out) as {
    questions?: Array<{ title?: string; body?: string; connects_to?: string[] }>;
  };
  const questions = parsed.questions ?? [];
  const scanId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const titleToId = new Map<string, string>();
  for (const n of nodes) {
    if (!titleToId.has(n.title)) {
      titleToId.set(n.title, n.id);
    }
  }

  let added = 0;
  const stmts: D1PreparedStatement[] = [];

  for (const q of questions) {
    const title = typeof q.title === "string" ? q.title : "";
    const body = typeof q.body === "string" ? q.body : "";
    if (!title) continue;
    const nid = crypto.randomUUID();
    stmts.push(
      env.PINBOARD_DB.prepare(
        `INSERT INTO nodes (id, type, title, body, tags, x, y, metadata, created_at, updated_at, map_id) VALUES (?, 'QUESTION', ?, ?, '[]', 0, 0, '{}', ?, ?, ?)`
      ).bind(nid, title, body, now, now, mapId)
    );
    const connects = Array.isArray(q.connects_to) ? q.connects_to : [];
    for (const t of connects) {
      const targetId = titleToId.get(t);
      if (targetId) {
        const cid = crypto.randomUUID();
        stmts.push(
          env.PINBOARD_DB.prepare(
            `INSERT INTO connections (id, source_id, target_id, label, strength, created_at) VALUES (?, ?, ?, ?, 1, ?)`
          ).bind(cid, nid, targetId, "tutor", now)
        );
      }
    }
    added++;
  }

  stmts.push(
    env.PINBOARD_DB.prepare(
      `INSERT INTO tutor_scans (id, triggered_at, nodes_scanned, questions_added, summary) VALUES (?, ?, ?, ?, ?)`
    ).bind(scanId, now, nodes.length, added, `Added ${added} QUESTION node(s)`)
  );

  if (stmts.length) {
    await env.PINBOARD_DB.batch(stmts);
  }

  return { summary: `Scan ${scanId}: added ${added} question(s)`, questionsAdded: added };
}

function safeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 200) || "file";
}

/** Native R2 binding presign (newer runtimes); falls back to S3-compatible signing. */
type R2BucketWithPresign = R2Bucket & {
  createPresignedUrl?(key: string, options: { method: "PUT"; expiresIn: number }): Promise<string>;
};

async function r2PresignedPutUrl(env: Env, bucket: R2Bucket, key: string, expiresIn: number): Promise<string> {
  const presign = (bucket as R2BucketWithPresign).createPresignedUrl;
  if (typeof presign === "function") {
    return presign.call(bucket, key, { method: "PUT", expiresIn });
  }
  return presignedR2ObjectUrl(env, key, "PUT");
}

function attachmentContentDisposition(mimeType: string, filename: string): string {
  const safe = safeFilename(filename);
  if (mimeType.startsWith("image/")) {
    return "inline";
  }
  const escaped = safe.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `attachment; filename="${escaped}"`;
}

async function presignedR2ObjectUrl(env: Env, r2Key: string, method: "GET" | "PUT"): Promise<string> {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ACCOUNT_ID) {
    throw new Error(
      "R2 presign credentials missing: set R2_ACCOUNT_ID (var) and R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (secrets)"
    );
  }
  const bucket = env.R2_BUCKET_NAME || "pinboard-files";
  const encodedKey = r2Key.split("/").map(encodeURIComponent).join("/");
  const base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${encodedKey}`;
  const urlWithExpiry = `${base}?X-Amz-Expires=3600`;
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const signed = await aws.sign(new Request(urlWithExpiry, { method }), { aws: { signQuery: true } });
  return signed.url.toString();
}

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  const msg = err instanceof Error ? err.message : String(err);
  const h = new Headers({ "content-type": "application/json" });
  h.set("Access-Control-Allow-Origin", CORS_ORIGIN);
  h.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
});

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    const h = new Headers();
    h.set("Access-Control-Allow-Origin", CORS_ORIGIN);
    h.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    h.set("Access-Control-Max-Age", "86400");
    return new Response(null, { status: 204, headers: h });
  }
  await next();
  c.res = applyCors({ res: c.res });
});

// --- Maps ---

app.get("/api/maps", async (c) => {
  try {
    const res = await c.env.PINBOARD_DB.prepare(`SELECT * FROM maps ORDER BY name ASC`).all();
    return c.json(res.results ?? []);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/maps", async (c) => {
  try {
    const body = await c.req.json() as { name?: string; description?: string; color?: string };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }
    const description = typeof body.description === "string" ? body.description.trim() || null : null;
    const color =
      typeof body.color === "string" && body.color.trim() ? body.color.trim().slice(0, 32) : "#d4a853";
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await c.env.PINBOARD_DB.prepare(
      `INSERT INTO maps (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, name, description, color, now)
      .run();
    await c.env.PINBOARD_DB.prepare(
      `INSERT INTO node_types (id, map_id, name, color, sort_order) VALUES (?, ?, ?, ?, 999)`,
    )
      .bind(crypto.randomUUID(), id, QUESTION_TYPE_NAME, QUESTION_TYPE_COLOR)
      .run();
    const row = await c.env.PINBOARD_DB.prepare(`SELECT * FROM maps WHERE id = ?`).bind(id).first<MapRow>();
    return c.json(row, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.put("/api/maps/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const existing = await c.env.PINBOARD_DB.prepare(`SELECT * FROM maps WHERE id = ?`).bind(id).first<MapRow>();
    if (!existing) {
      return c.json({ error: "not found" }, 404);
    }
    const body = await c.req.json() as { name?: string; description?: string | null; color?: string };
    const name = typeof body.name === "string" ? body.name.trim() : existing.name;
    if (!name) {
      return c.json({ error: "name cannot be empty" }, 400);
    }
    let description: string | null = existing.description;
    if (body.description !== undefined) {
      description =
        body.description === null
          ? null
          : typeof body.description === "string"
            ? body.description.trim() || null
            : null;
    }
    let color = existing.color ?? "#d4a853";
    if (typeof body.color === "string" && body.color.trim()) {
      color = body.color.trim().slice(0, 32);
    }
    await c.env.PINBOARD_DB.prepare(`UPDATE maps SET name = ?, description = ?, color = ? WHERE id = ?`)
      .bind(name, description, color, id)
      .run();
    const row = await c.env.PINBOARD_DB.prepare(`SELECT * FROM maps WHERE id = ?`).bind(id).first<MapRow>();
    return c.json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.delete("/api/maps/:id", async (c) => {
  try {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ error: "cannot delete the default map" }, 400);
    }
    const existing = await c.env.PINBOARD_DB.prepare(`SELECT id FROM maps WHERE id = ?`).bind(id).first();
    if (!existing) {
      return c.json({ error: "not found" }, 404);
    }
    await c.env.PINBOARD_DB.prepare(`DELETE FROM nodes WHERE COALESCE(map_id, 'default') = ?`).bind(id).run();
    await c.env.PINBOARD_DB.prepare(`DELETE FROM maps WHERE id = ?`).bind(id).run();
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.get("/api/maps/:id/types", async (c) => {
  try {
    const mapId = c.req.param("id");
    if (!(await mapExists(c.env.PINBOARD_DB, mapId))) {
      return c.json({ error: "not found" }, 404);
    }
    const rows = await fetchNodeTypesForMapWithCounts(c.env.PINBOARD_DB, mapId);
    return c.json(rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/maps/:id/types", async (c) => {
  try {
    const mapId = c.req.param("id");
    if (!(await mapExists(c.env.PINBOARD_DB, mapId))) {
      return c.json({ error: "not found" }, 404);
    }
    const body = (await c.req.json()) as { name?: string; color?: string };
    const rawName = typeof body.name === "string" ? body.name.trim().toUpperCase() : "";
    if (!rawName) {
      return c.json({ error: "name is required" }, 400);
    }
    let color =
      typeof body.color === "string" && body.color.trim() ? body.color.trim().slice(0, 32) : "#888888";
    if (rawName === QUESTION_TYPE_NAME) {
      color = QUESTION_TYPE_COLOR;
    }
    const maxRow = await c.env.PINBOARD_DB.prepare(
      `SELECT MAX(sort_order) AS m FROM node_types WHERE map_id = ?`,
    )
      .bind(mapId)
      .first<{ m: number | null }>();
    const sortOrder = (maxRow?.m ?? -1) + 1;
    const tid = crypto.randomUUID();
    await c.env.PINBOARD_DB.prepare(
      `INSERT INTO node_types (id, map_id, name, color, sort_order) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(tid, mapId, rawName, color, sortOrder)
      .run();
    const rows = await fetchNodeTypesForMapWithCounts(c.env.PINBOARD_DB, mapId);
    const row = rows.find((r) => r.id === tid);
    return c.json(row ?? { id: tid, map_id: mapId, name: rawName, color, sort_order: sortOrder, node_count: 0 }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return c.json({ error: "a type with this name already exists for this map" }, 409);
    }
    return c.json({ error: msg }, 500);
  }
});

app.put("/api/maps/:id/types/:tid", async (c) => {
  try {
    const mapId = c.req.param("id");
    const tid = c.req.param("tid");
    if (!(await mapExists(c.env.PINBOARD_DB, mapId))) {
      return c.json({ error: "not found" }, 404);
    }
    const existing = await c.env.PINBOARD_DB.prepare(`SELECT * FROM node_types WHERE id = ? AND map_id = ?`)
      .bind(tid, mapId)
      .first<NodeTypeRow>();
    if (!existing) {
      return c.json({ error: "not found" }, 404);
    }
    const body = (await c.req.json()) as { name?: string; color?: string };
    let name = existing.name;
    if (body.name !== undefined) {
      const next = typeof body.name === "string" ? body.name.trim().toUpperCase() : "";
      if (!next) {
        return c.json({ error: "name cannot be empty" }, 400);
      }
      if (existing.name === QUESTION_TYPE_NAME && next !== QUESTION_TYPE_NAME) {
        return c.json({ error: "cannot rename QUESTION type" }, 400);
      }
      name = next;
    }
    let color = existing.color;
    if (body.color !== undefined && typeof body.color === "string" && body.color.trim()) {
      color = body.color.trim().slice(0, 32);
    }
    if (name === QUESTION_TYPE_NAME || existing.name === QUESTION_TYPE_NAME) {
      color = QUESTION_TYPE_COLOR;
    }
    if (name !== existing.name) {
      const clash = await c.env.PINBOARD_DB.prepare(
        `SELECT 1 FROM node_types WHERE map_id = ? AND name = ? AND id != ?`,
      )
        .bind(mapId, name, tid)
        .first();
      if (clash) {
        return c.json({ error: "a type with this name already exists" }, 409);
      }
      await c.env.PINBOARD_DB.prepare(`UPDATE nodes SET type = ? WHERE COALESCE(map_id, 'default') = ? AND type = ?`)
        .bind(name, mapId, existing.name)
        .run();
    }
    await c.env.PINBOARD_DB.prepare(`UPDATE node_types SET name = ?, color = ? WHERE id = ? AND map_id = ?`)
      .bind(name, color, tid, mapId)
      .run();
    const rows = await fetchNodeTypesForMapWithCounts(c.env.PINBOARD_DB, mapId);
    const row = rows.find((r) => r.id === tid);
    return c.json(row ?? { ...existing, name, color });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.delete("/api/maps/:id/types/:tid", async (c) => {
  try {
    const mapId = c.req.param("id");
    const tid = c.req.param("tid");
    const existing = await c.env.PINBOARD_DB.prepare(`SELECT * FROM node_types WHERE id = ? AND map_id = ?`)
      .bind(tid, mapId)
      .first<NodeTypeRow & { node_count?: number }>();
    if (!existing) {
      return c.json({ error: "not found" }, 404);
    }
    if (existing.name === QUESTION_TYPE_NAME) {
      return c.json({ error: "cannot delete QUESTION type" }, 400);
    }
    const counts = await fetchNodeTypesForMapWithCounts(c.env.PINBOARD_DB, mapId);
    const row = counts.find((r) => r.id === tid);
    if ((row?.node_count ?? 0) > 0) {
      return c.json({ error: "cannot delete type while nodes use it" }, 400);
    }
    await c.env.PINBOARD_DB.prepare(`DELETE FROM node_types WHERE id = ? AND map_id = ?`).bind(tid, mapId).run();
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

// --- Nodes ---

app.get("/api/nodes", async (c) => {
  try {
    const type = c.req.query("type");
    let res: D1Result<NodeRow>;
    if (type) {
      res = await c.env.PINBOARD_DB.prepare(`SELECT * FROM nodes WHERE type = ? ORDER BY updated_at DESC`)
        .bind(type)
        .all();
    } else {
      res = await c.env.PINBOARD_DB.prepare(`SELECT * FROM nodes ORDER BY updated_at DESC`).all();
    }
    const rows = (res.results ?? []).map((r) => parseJsonFields(r as unknown as NodeRow));
    return c.json(rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/nodes", async (c) => {
  try {
    const body = (await c.req.json()) as Partial<NodeRow> & { type?: string; title?: string; map_id?: string };
    if (!body.type || !body.title) {
      return c.json({ error: "type and title are required" }, 400);
    }
    const mapId = normalizeMapId(typeof body.map_id === "string" ? body.map_id : undefined);
    const canon = await canonicalTypeNameForMap(c.env.PINBOARD_DB, mapId, String(body.type));
    if (!canon) {
      return c.json({ error: "unknown node type for this map" }, 400);
    }
    const id = crypto.randomUUID();
    const tags =
      typeof body.tags === "string" ? body.tags : JSON.stringify((body.tags as unknown) ?? []);
    const metadata =
      typeof body.metadata === "string"
        ? body.metadata
        : JSON.stringify(body.metadata ?? {});
    const x = typeof body.x === "number" ? body.x : 0;
    const y = typeof body.y === "number" ? body.y : 0;
    const now = Math.floor(Date.now() / 1000);
    await c.env.PINBOARD_DB.prepare(
      `INSERT INTO nodes (id, type, title, body, tags, x, y, metadata, created_at, updated_at, map_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, canon, body.title, body.body ?? null, tags, x, y, metadata, now, now, mapId)
      .run();
    const row = await c.env.PINBOARD_DB.prepare(`SELECT * FROM nodes WHERE id = ?`).bind(id).first<NodeRow>();
    return c.json(parseJsonFields(row as NodeRow), 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.get("/api/nodes/:id/attachments", async (c) => {
  try {
    const nodeId = c.req.param("id");
    const res = await c.env.PINBOARD_DB.prepare(
      `SELECT * FROM attachments WHERE node_id = ? AND status != 'pending' ORDER BY created_at DESC`,
    )
      .bind(nodeId)
      .all();
    return c.json(res.results ?? []);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.get("/api/nodes/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const node = await c.env.PINBOARD_DB.prepare(`SELECT * FROM nodes WHERE id = ?`).bind(id).first<NodeRow>();
    if (!node) {
      return c.json({ error: "not found" }, 404);
    }
    const conns = await c.env.PINBOARD_DB.prepare(
      `SELECT * FROM connections WHERE source_id = ? OR target_id = ?`
    )
      .bind(id, id)
      .all();
    const atts = await c.env.PINBOARD_DB.prepare(
      `SELECT * FROM attachments WHERE node_id = ? AND status != 'pending'`,
    )
      .bind(id)
      .all();
    return c.json({
      node: parseJsonFields(node as unknown as NodeRow),
      connections: conns.results ?? [],
      attachments: atts.results ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.put("/api/nodes/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const existing = await c.env.PINBOARD_DB.prepare(`SELECT * FROM nodes WHERE id = ?`).bind(id).first<NodeRow>();
    if (!existing) {
      return c.json({ error: "not found" }, 404);
    }
    const body = (await c.req.json()) as Partial<NodeRow>;
    const mapId = normalizeMapId(existing.map_id ?? undefined);
    let type = (body.type ?? existing.type) as string;
    if (body.type !== undefined) {
      const canon = await canonicalTypeNameForMap(c.env.PINBOARD_DB, mapId, String(body.type));
      if (!canon) {
        return c.json({ error: "unknown node type for this map" }, 400);
      }
      type = canon;
    }
    const title = body.title ?? existing.title;
    const nodeBody = body.body !== undefined ? body.body : existing.body;
    let tagsStr = existing.tags;
    if (body.tags !== undefined) {
      tagsStr = JSON.stringify(body.tags);
    }
    let metaStr = existing.metadata;
    if (body.metadata !== undefined) {
      metaStr =
        typeof body.metadata === "string"
          ? body.metadata
          : JSON.stringify(body.metadata ?? {});
    }
    const x = typeof body.x === "number" ? body.x : existing.x;
    const y = typeof body.y === "number" ? body.y : existing.y;
    const now = Math.floor(Date.now() / 1000);
    await c.env.PINBOARD_DB.prepare(
      `UPDATE nodes SET type = ?, title = ?, body = ?, tags = ?, x = ?, y = ?, metadata = ?, updated_at = ? WHERE id = ?`
    )
      .bind(type, title, nodeBody, tagsStr, x, y, metaStr, now, id)
      .run();
    const row = await c.env.PINBOARD_DB.prepare(`SELECT * FROM nodes WHERE id = ?`).bind(id).first<NodeRow>();
    return c.json(parseJsonFields(row as NodeRow));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.delete("/api/nodes/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const r = await c.env.PINBOARD_DB.prepare(`DELETE FROM nodes WHERE id = ?`).bind(id).run();
    if (!r.success || (r.meta?.changes ?? 0) === 0) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.patch("/api/nodes/:id/position", async (c) => {
  try {
    const id = c.req.param("id");
    const body = (await c.req.json()) as { x?: number; y?: number };
    if (typeof body.x !== "number" || typeof body.y !== "number") {
      return c.json({ error: "x and y numbers are required" }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    const r = await c.env.PINBOARD_DB.prepare(
      `UPDATE nodes SET x = ?, y = ?, updated_at = ? WHERE id = ?`
    )
      .bind(body.x, body.y, now, id)
      .run();
    if (!r.success || (r.meta?.changes ?? 0) === 0) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true, x: body.x, y: body.y });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

// --- Connections ---

app.get("/api/connections", async (c) => {
  try {
    const res = await c.env.PINBOARD_DB.prepare(`SELECT * FROM connections ORDER BY created_at DESC`).all();
    return c.json(res.results ?? []);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/connections", async (c) => {
  try {
    const body = (await c.req.json()) as {
      source_id?: string;
      target_id?: string;
      label?: string;
      strength?: number;
    };
    if (!body.source_id || !body.target_id) {
      return c.json({ error: "source_id and target_id are required" }, 400);
    }
    const strength = body.strength ?? 1;
    if (strength < 1 || strength > 3) {
      return c.json({ error: "strength must be 1-3" }, 400);
    }
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await c.env.PINBOARD_DB.prepare(
      `INSERT INTO connections (id, source_id, target_id, label, strength, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(id, body.source_id, body.target_id, body.label ?? null, strength, now)
      .run();
    const row = await c.env.PINBOARD_DB.prepare(`SELECT * FROM connections WHERE id = ?`).bind(id).first();
    return c.json(row, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.patch("/api/connections/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = (await c.req.json()) as {
      label?: string | null;
      strength?: number;
    };
    const existing = await c.env.PINBOARD_DB.prepare(`SELECT * FROM connections WHERE id = ?`).bind(id).first<{
      id: string;
      label: string | null;
      strength: number;
    }>();
    if (!existing) {
      return c.json({ error: "not found" }, 404);
    }
    const label = body.label !== undefined ? body.label : existing.label;
    const strength = body.strength !== undefined ? body.strength : existing.strength;
    if (strength < 1 || strength > 3) {
      return c.json({ error: "strength must be 1-3" }, 400);
    }
    await c.env.PINBOARD_DB.prepare(`UPDATE connections SET label = ?, strength = ? WHERE id = ?`)
      .bind(label ?? null, strength, id)
      .run();
    const row = await c.env.PINBOARD_DB.prepare(`SELECT * FROM connections WHERE id = ?`).bind(id).first();
    return c.json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.delete("/api/connections/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const r = await c.env.PINBOARD_DB.prepare(`DELETE FROM connections WHERE id = ?`).bind(id).run();
    if (!r.success || (r.meta?.changes ?? 0) === 0) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

// --- Graph ---

app.get("/api/graph", async (c) => {
  try {
    const mapId = normalizeMapId(c.req.query("map_id"));
    const nodes = await c.env.PINBOARD_DB.prepare(
      `SELECT * FROM nodes WHERE COALESCE(map_id, 'default') = ? ORDER BY updated_at DESC`,
    )
      .bind(mapId)
      .all();
    const connections = await c.env.PINBOARD_DB.prepare(
      `SELECT c.* FROM connections c
       INNER JOIN nodes s ON s.id = c.source_id
       INNER JOIN nodes t ON t.id = c.target_id
       WHERE COALESCE(s.map_id, 'default') = ? AND COALESCE(t.map_id, 'default') = ?
       ORDER BY c.created_at DESC`,
    )
      .bind(mapId, mapId)
      .all();
    const nodeTypes = (await mapExists(c.env.PINBOARD_DB, mapId))
      ? await fetchNodeTypesForMapWithCounts(c.env.PINBOARD_DB, mapId)
      : [];
    return c.json({
      nodes: (nodes.results ?? []).map((r) => parseJsonFields(r as unknown as NodeRow)),
      connections: connections.results ?? [],
      nodeTypes,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/resolve", async (c) => {
  try {
    const body = await parseJsonBodyOptional(c);
    const mapId = normalizeMapId(typeof body.map_id === "string" ? body.map_id : undefined);
    const out = await runResolve(c.env, mapId);
    return c.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

// --- Loading bay ---

app.post("/api/loading-bay", async (c) => {
  try {
    const body = (await c.req.json()) as {
      raw_content?: string;
      raw_url?: string;
      raw_type?: string;
      map_id?: string;
    };
    const id = crypto.randomUUID();
    const rawType = body.raw_type ?? "text";
    const mapId = normalizeMapId(typeof body.map_id === "string" ? body.map_id : undefined);
    await c.env.PINBOARD_DB.prepare(
      `INSERT INTO loading_bay (id, raw_content, raw_url, raw_type, status, map_id) VALUES (?, ?, ?, ?, 'pending', ?)`
    )
      .bind(id, body.raw_content ?? null, body.raw_url ?? null, rawType, mapId)
      .run();
    const row = await c.env.PINBOARD_DB.prepare(`SELECT * FROM loading_bay WHERE id = ?`).bind(id).first();
    return c.json(row, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.get("/api/loading-bay", async (c) => {
  try {
    const res = await c.env.PINBOARD_DB.prepare(
      `SELECT * FROM loading_bay WHERE status != 'dismissed' AND status != 'approved' ORDER BY created_at DESC`
    ).all();
    return c.json(res.results ?? []);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/loading-bay/:id/process", async (c) => {
  try {
    const id = c.req.param("id");
    const row = await c.env.PINBOARD_DB.prepare(`SELECT * FROM loading_bay WHERE id = ?`).bind(id).first<{
      id: string;
      raw_content: string | null;
      raw_url: string | null;
      raw_type: string | null;
      map_id: string | null;
    }>();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    await processLoadingBayItem(row, c.env);
    const updated = await c.env.PINBOARD_DB.prepare(`SELECT * FROM loading_bay WHERE id = ?`).bind(id).first();
    return c.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/loading-bay/:id/approve", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await parseJsonBodyOptional(c);
    const targetMapId = normalizeMapId(typeof body.map_id === "string" ? body.map_id : undefined);
    const row = await c.env.PINBOARD_DB.prepare(`SELECT * FROM loading_bay WHERE id = ?`).bind(id).first<{
      proposed_nodes: string | null;
      proposed_connections: string | null;
    }>();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    if (!row.proposed_nodes) {
      return c.json({ error: "nothing to approve; process first" }, 400);
    }
    const proposedNodes = JSON.parse(row.proposed_nodes) as Array<{
      type?: string;
      title?: string;
      body?: string;
      tags?: unknown;
      metadata?: unknown;
    }>;
    const proposedConnections = JSON.parse(row.proposed_connections || "[]") as Array<{
      source_title?: string;
      target_title?: string;
      label?: string;
    }>;
    const now = Math.floor(Date.now() / 1000);
    const titleToId = new Map<string, string>();
    const stmts: D1PreparedStatement[] = [];

    const typeRows = await fetchNodeTypesForMapWithCounts(c.env.PINBOARD_DB, targetMapId);
    const fallbackType = (await defaultFallbackTypeForMap(c.env.PINBOARD_DB, targetMapId)) || QUESTION_TYPE_NAME;
    const resolveProposedType = (raw: string): string => {
      const t = raw.trim();
      if (!t) return fallbackType;
      const u = t.toUpperCase();
      for (const r of typeRows) {
        if (r.name.toUpperCase() === u) return r.name;
      }
      return fallbackType;
    };

    for (const n of proposedNodes) {
      const title = typeof n.title === "string" ? n.title : "";
      if (!title) continue;
      if (titleToId.has(title)) continue;
      const typ = resolveProposedType(typeof n.type === "string" ? n.type : "");
      const nid = crypto.randomUUID();
      titleToId.set(title, nid);
      const tags = JSON.stringify(Array.isArray(n.tags) ? n.tags : []);
      const meta = JSON.stringify(n.metadata && typeof n.metadata === "object" ? n.metadata : {});
      stmts.push(
        c.env.PINBOARD_DB.prepare(
          `INSERT INTO nodes (id, type, title, body, tags, x, y, metadata, created_at, updated_at, map_id) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
        ).bind(nid, typ, title, n.body ?? null, tags, meta, now, now, targetMapId)
      );
    }

    for (const conn of proposedConnections) {
      const s = conn.source_title;
      const t = conn.target_title;
      if (!s || !t) continue;
      const sid = titleToId.get(s);
      const tid = titleToId.get(t);
      if (!sid || !tid) continue;
      const cid = crypto.randomUUID();
      stmts.push(
        c.env.PINBOARD_DB.prepare(
          `INSERT INTO connections (id, source_id, target_id, label, strength, created_at) VALUES (?, ?, ?, ?, 1, ?)`
        ).bind(cid, sid, tid, conn.label ?? null, now)
      );
    }

    stmts.push(
      c.env.PINBOARD_DB.prepare(`UPDATE loading_bay SET status = 'approved' WHERE id = ?`).bind(id)
    );

    if (stmts.length) {
      await c.env.PINBOARD_DB.batch(stmts);
    }
    return c.json({ ok: true, nodes_created: titleToId.size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/loading-bay/:id/flag", async (c) => {
  try {
    const id = c.req.param("id");
    const r = await c.env.PINBOARD_DB.prepare(`UPDATE loading_bay SET status = 'flagged' WHERE id = ?`)
      .bind(id)
      .run();
    if (!r.success || (r.meta?.changes ?? 0) === 0) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/loading-bay/:id/unflag", async (c) => {
  try {
    const id = c.req.param("id");
    const r = await c.env.PINBOARD_DB.prepare(
      `UPDATE loading_bay SET status = 'proposed' WHERE id = ? AND status = 'flagged'`,
    )
      .bind(id)
      .run();
    if (!r.success || (r.meta?.changes ?? 0) === 0) {
      return c.json({ error: "not found or not flagged" }, 404);
    }
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.delete("/api/loading-bay/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const r = await c.env.PINBOARD_DB.prepare(`UPDATE loading_bay SET status = 'dismissed' WHERE id = ?`)
      .bind(id)
      .run();
    if (!r.success || (r.meta?.changes ?? 0) === 0) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

// --- Explore / Tutor ---

app.get("/api/explore-next", async (c) => {
  try {
    const mapId = normalizeMapId(c.req.query("map_id"));
    const nodesRes = await c.env.PINBOARD_DB.prepare(
      `SELECT * FROM nodes WHERE COALESCE(map_id, 'default') = ?`,
    )
      .bind(mapId)
      .all();
    const connsRes = await c.env.PINBOARD_DB.prepare(
      `SELECT c.* FROM connections c
       INNER JOIN nodes s ON s.id = c.source_id
       INNER JOIN nodes t ON t.id = c.target_id
       WHERE COALESCE(s.map_id, 'default') = ? AND COALESCE(t.map_id, 'default') = ?`,
    )
      .bind(mapId, mapId)
      .all();
    const nodes = (nodesRes.results ?? []) as unknown as NodeRow[];
    const connections = connsRes.results ?? [];
    const result = await exploreNext({ nodes, connections }, c.env);
    return c.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/tutor/scan", async (c) => {
  try {
    const mapId = normalizeMapId(c.req.query("map_id"));
    const nodesRes = await c.env.PINBOARD_DB.prepare(
      `SELECT * FROM nodes WHERE COALESCE(map_id, 'default') = ?`,
    )
      .bind(mapId)
      .all();
    const nodes = (nodesRes.results ?? []) as unknown as NodeRow[];
    const out = await tutorScan(nodes, c.env, mapId);
    return c.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

// --- Attachments ---

app.post("/api/attachments/sign", async (c) => {
  try {
    const body = (await c.req.json()) as {
      node_id?: string;
      filename?: string;
      mime_type?: string;
      size_bytes?: number;
    };
    if (!body.node_id || !body.filename || !body.mime_type) {
      return c.json({ error: "node_id, filename, and mime_type are required" }, 400);
    }
    const node = await c.env.PINBOARD_DB.prepare(`SELECT id FROM nodes WHERE id = ?`)
      .bind(body.node_id)
      .first();
    if (!node) {
      return c.json({ error: "node not found" }, 404);
    }
    const bucket = c.env.PINBOARD_R2 as R2BucketWithPresign;
    const hasNativePresign = typeof bucket.createPresignedUrl === "function";
    if (
      !hasNativePresign &&
      (!c.env.R2_ACCESS_KEY_ID || !c.env.R2_SECRET_ACCESS_KEY || !c.env.R2_ACCOUNT_ID)
    ) {
      return c.json(
        {
          error:
            "R2 presign unavailable: enable binding createPresignedUrl or set R2_ACCOUNT_ID (var) and R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (secrets)",
        },
        503
      );
    }
    const attachmentId = crypto.randomUUID();
    const fname = safeFilename(body.filename);
    const r2Key = `attachments/${body.node_id}/${Date.now()}_${fname}`;
    const uploadUrl = await r2PresignedPutUrl(c.env, c.env.PINBOARD_R2, r2Key, 3600);
    const now = Math.floor(Date.now() / 1000);
    await c.env.PINBOARD_DB.prepare(
      `INSERT INTO attachments (id, node_id, r2_key, filename, mime_type, size_bytes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(attachmentId, body.node_id, r2Key, body.filename, body.mime_type, body.size_bytes ?? null, now)
      .run();
    return c.json({ upload_url: uploadUrl, r2_key: r2Key, attachment_id: attachmentId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/attachments/:id/confirm", async (c) => {
  try {
    const id = c.req.param("id");
    const row = await c.env.PINBOARD_DB.prepare(`SELECT r2_key FROM attachments WHERE id = ?`)
      .bind(id)
      .first<{ r2_key: string }>();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    const head = await c.env.PINBOARD_R2.head(row.r2_key);
    if (!head) {
      return c.json({ error: "object not found in R2; upload may have failed" }, 400);
    }
    await c.env.PINBOARD_DB.prepare(`UPDATE attachments SET status = 'confirmed' WHERE id = ?`).bind(id).run();
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.get("/api/attachments/:id/download", async (c) => {
  try {
    const id = c.req.param("id");
    const row = await c.env.PINBOARD_DB.prepare(
      `SELECT r2_key, filename, mime_type FROM attachments WHERE id = ?`,
    )
      .bind(id)
      .first<{ r2_key: string; filename: string; mime_type: string }>();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    const obj = await c.env.PINBOARD_R2.get(row.r2_key);
    if (!obj) {
      return c.json({ error: "not found" }, 404);
    }
    const mime = row.mime_type || "application/octet-stream";
    const headers = new Headers();
    headers.set("Content-Type", mime);
    headers.set("Content-Disposition", attachmentContentDisposition(mime, row.filename));
    if (obj.httpEtag) {
      headers.set("ETag", obj.httpEtag);
    }
    if (Number.isFinite(obj.size)) {
      headers.set("Content-Length", String(obj.size));
    }
    return new Response(obj.body, { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.delete("/api/attachments/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const row = await c.env.PINBOARD_DB.prepare(`SELECT r2_key FROM attachments WHERE id = ?`)
      .bind(id)
      .first<{ r2_key: string }>();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    await c.env.PINBOARD_R2.delete(row.r2_key);
    await c.env.PINBOARD_DB.prepare(`DELETE FROM attachments WHERE id = ?`).bind(id).run();
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.get("/", (c) => c.json({ service: "pinboard-api", ok: true }));

export default app;
