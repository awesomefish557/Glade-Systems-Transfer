import type {
  AttachmentRow,
  ExploreRecommendation,
  GraphConnection,
  GraphNode,
  GraphNodeType,
  LoadingBayItem,
  LoadingBayProposedConnection,
  LoadingBayProposedNode,
  PinboardMap,
} from "./types";

/**
 * Set at build time via `VITE_API_BASE` (see root `.env.production`).
 * Empty string when unset → in dev, same-origin `/api/...` uses the Vite proxy (`vite.config.ts`).
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

function normalizeNode(raw: Record<string, unknown>): GraphNode {
  let tags: string[] = [];
  if (Array.isArray(raw.tags)) {
    tags = raw.tags.filter((t): t is string => typeof t === "string");
  } else if (typeof raw.tags === "string") {
    try {
      const p = JSON.parse(raw.tags);
      if (Array.isArray(p)) tags = p.filter((t): t is string => typeof t === "string");
    } catch {
      /* ignore */
    }
  }
  let metadata: Record<string, unknown> = {};
  if (raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)) {
    metadata = raw.metadata as Record<string, unknown>;
  } else if (typeof raw.metadata === "string") {
    try {
      const p = JSON.parse(raw.metadata);
      if (p && typeof p === "object" && !Array.isArray(p)) metadata = p as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {
    id: String(raw.id),
    type: raw.type as GraphNode["type"],
    title: String(raw.title ?? ""),
    body: raw.body == null ? null : String(raw.body),
    tags,
    x: Number(raw.x) || 0,
    y: Number(raw.y) || 0,
    metadata,
    created_at: raw.created_at != null ? Number(raw.created_at) : undefined,
    updated_at: raw.updated_at != null ? Number(raw.updated_at) : undefined,
    map_id: raw.map_id != null ? String(raw.map_id) : undefined,
  };
}

function normalizeMapQuery(mapId: string): string {
  const m = mapId.trim();
  return m.length > 0 ? m : "default";
}

function normalizeNodeTypes(raw: unknown): GraphNodeType[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    const o = x as Record<string, unknown>;
    return {
      id: String(o.id),
      map_id: String(o.map_id ?? ""),
      name: String(o.name ?? ""),
      color: String(o.color ?? "#888888"),
      sort_order: Number(o.sort_order) || 0,
      node_count: o.node_count != null ? Number(o.node_count) : undefined,
    };
  });
}

export async function fetchGraph(mapId = "default"): Promise<{
  nodes: GraphNode[];
  connections: GraphConnection[];
  nodeTypes: GraphNodeType[];
}> {
  const q = encodeURIComponent(normalizeMapQuery(mapId));
  const res = await fetch(`${API_BASE}/api/graph?map_id=${q}`);
  const data = await parseJson<{
    nodes: Record<string, unknown>[];
    connections: GraphConnection[];
    nodeTypes?: unknown;
  }>(res);
  return {
    nodes: (data.nodes ?? []).map(normalizeNode),
    connections: data.connections ?? [],
    nodeTypes: normalizeNodeTypes(data.nodeTypes),
  };
}

function parseProposedNodes(raw: unknown): LoadingBayProposedNode[] | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? (p as LoadingBayProposedNode[]) : null;
    } catch {
      return null;
    }
  }
  return Array.isArray(raw) ? (raw as LoadingBayProposedNode[]) : null;
}

function parseProposedConnections(raw: unknown): LoadingBayProposedConnection[] | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? (p as LoadingBayProposedConnection[]) : null;
    } catch {
      return null;
    }
  }
  return Array.isArray(raw) ? (raw as LoadingBayProposedConnection[]) : null;
}

export function normalizeLoadingBayItem(raw: Record<string, unknown>): LoadingBayItem {
  return {
    id: String(raw.id),
    status: String(raw.status ?? ""),
    raw_content: raw.raw_content == null ? null : String(raw.raw_content),
    raw_url: raw.raw_url == null ? null : String(raw.raw_url),
    raw_type: raw.raw_type == null ? null : String(raw.raw_type),
    ai_reasoning: raw.ai_reasoning == null ? null : String(raw.ai_reasoning),
    proposed_nodes: parseProposedNodes(raw.proposed_nodes),
    proposed_connections: parseProposedConnections(raw.proposed_connections),
    created_at: raw.created_at != null ? Number(raw.created_at) : undefined,
    processed_at: raw.processed_at == null ? null : Number(raw.processed_at),
    map_id: raw.map_id != null ? String(raw.map_id) : undefined,
  };
}

export async function fetchLoadingBay(): Promise<LoadingBayItem[]> {
  const res = await fetch(`${API_BASE}/api/loading-bay`);
  const rows = await parseJson<Record<string, unknown>[]>(res);
  return (rows ?? []).map(normalizeLoadingBayItem);
}

export async function createLoadingBayItem(payload: {
  raw_content?: string | null;
  raw_url?: string | null;
  raw_type: string;
  map_id?: string;
}): Promise<LoadingBayItem> {
  const res = await fetch(`${API_BASE}/api/loading-bay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_content: payload.raw_content ?? null,
      raw_url: payload.raw_url ?? null,
      raw_type: payload.raw_type,
      map_id: normalizeMapQuery(payload.map_id ?? "default"),
    }),
  });
  const raw = await parseJson<Record<string, unknown>>(res);
  return normalizeLoadingBayItem(raw);
}

export async function processLoadingBayItem(id: string): Promise<LoadingBayItem> {
  const res = await fetch(`${API_BASE}/api/loading-bay/${encodeURIComponent(id)}/process`, {
    method: "POST",
  });
  const raw = await parseJson<Record<string, unknown>>(res);
  return normalizeLoadingBayItem(raw);
}

export async function approveLoadingBayItem(
  id: string,
  options?: { map_id?: string },
): Promise<{ ok: boolean; nodes_created: number }> {
  const res = await fetch(`${API_BASE}/api/loading-bay/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ map_id: options?.map_id ?? "default" }),
  });
  return parseJson(res);
}

export async function flagLoadingBayItem(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/loading-bay/${encodeURIComponent(id)}/flag`, {
    method: "POST",
  });
  await parseJson(res);
}

export async function unflagLoadingBayItem(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/loading-bay/${encodeURIComponent(id)}/unflag`, {
    method: "POST",
  });
  await parseJson(res);
}

export async function dismissLoadingBayItem(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/loading-bay/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseJson(res);
}

export async function createNode(payload: {
  type: string;
  title: string;
  body?: string | null;
  tags?: string[];
  x: number;
  y: number;
  metadata?: Record<string, unknown>;
  map_id?: string;
}): Promise<GraphNode> {
  const res = await fetch(`${API_BASE}/api/nodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      tags: payload.tags ?? [],
      x: payload.x,
      y: payload.y,
      metadata: payload.metadata ?? {},
      map_id: normalizeMapQuery(payload.map_id ?? "default"),
    }),
  });
  const raw = await parseJson<Record<string, unknown>>(res);
  return normalizeNode(raw);
}

export async function patchNodePosition(id: string, x: number, y: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/nodes/${id}/position`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x, y }),
  });
  await parseJson(res);
}

export async function updateNode(
  id: string,
  payload: Partial<{
    type: string;
    title: string;
    body: string | null;
    tags: string[];
    metadata: Record<string, unknown>;
  }>,
): Promise<GraphNode> {
  const res = await fetch(`${API_BASE}/api/nodes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await parseJson<Record<string, unknown>>(res);
  return normalizeNode(raw);
}

export async function deleteNode(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/nodes/${id}`, { method: "DELETE" });
  await parseJson(res);
}

export async function createConnection(
  source_id: string,
  target_id: string,
  label: string | null,
  strength = 1,
): Promise<GraphConnection> {
  const res = await fetch(`${API_BASE}/api/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_id, target_id, label: label || null, strength }),
  });
  return parseJson<GraphConnection>(res);
}

export async function updateConnection(
  id: string,
  payload: { label?: string | null; strength?: number },
): Promise<GraphConnection> {
  const res = await fetch(`${API_BASE}/api/connections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<GraphConnection>(res);
}

export async function deleteConnection(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/connections/${id}`, { method: "DELETE" });
  await parseJson<{ ok?: boolean }>(res);
}

export async function fetchNodeDetail(id: string): Promise<{
  node: GraphNode;
  connections: GraphConnection[];
  attachments: AttachmentRow[];
}> {
  const res = await fetch(`${API_BASE}/api/nodes/${id}`);
  const data = await parseJson<{
    node: Record<string, unknown>;
    connections: GraphConnection[];
    attachments: AttachmentRow[];
  }>(res);
  return {
    node: normalizeNode(data.node),
    connections: data.connections ?? [],
    attachments: data.attachments ?? [],
  };
}

export async function tutorScan(mapId = "default"): Promise<{ summary: string; questionsAdded: number }> {
  const q = encodeURIComponent(normalizeMapQuery(mapId));
  const res = await fetch(`${API_BASE}/api/tutor/scan?map_id=${q}`, { method: "POST" });
  return parseJson(res);
}

export async function postResolve(mapId = "default"): Promise<{
  new_connections: GraphConnection[];
  positions: Record<string, { x: number; y: number }>;
}> {
  const res = await fetch(`${API_BASE}/api/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ map_id: normalizeMapQuery(mapId) }),
  });
  return parseJson(res);
}

export async function fetchExploreNext(mapId = "default"): Promise<{ recommendations: ExploreRecommendation[] }> {
  const q = encodeURIComponent(normalizeMapQuery(mapId));
  const res = await fetch(`${API_BASE}/api/explore-next?map_id=${q}`);
  const data = await parseJson<{ recommendations?: unknown }>(res);
  const raw = data.recommendations;
  const list = Array.isArray(raw) ? raw : [];
  const recommendations: ExploreRecommendation[] = list.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      type: String(o.type ?? "concept"),
      title: String(o.title ?? ""),
      reason: String(o.reason ?? ""),
      url: typeof o.url === "string" && o.url ? o.url : undefined,
    };
  });
  return { recommendations };
}

export async function signAttachmentUpload(
  nodeId: string,
  file: File,
): Promise<{ upload_url: string; r2_key: string; attachment_id: string }> {
  const res = await fetch(`${API_BASE}/api/attachments/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      node_id: nodeId,
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    }),
  });
  return parseJson(res);
}

/** PUT file bytes to R2 presigned URL; reports upload % when length is known. */
export function putFileToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number | null) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (ev) => {
      if (!onProgress) return;
      if (ev.lengthComputable && ev.total > 0) {
        onProgress(Math.min(100, Math.round((100 * ev.loaded) / ev.total)));
      } else {
        onProgress(null);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed (network)"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.send(file);
  });
}

export async function confirmAttachment(attachmentId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/attachments/${attachmentId}/confirm`, { method: "POST" });
  await parseJson<{ ok?: boolean }>(res);
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/attachments/${attachmentId}`, { method: "DELETE" });
  await parseJson<{ ok?: boolean }>(res);
}

function normalizePinboardMap(raw: Record<string, unknown>): PinboardMap {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    description: raw.description == null ? null : String(raw.description),
    color: raw.color == null ? null : String(raw.color),
    created_at: raw.created_at != null ? Number(raw.created_at) : undefined,
  };
}

export async function fetchMaps(): Promise<PinboardMap[]> {
  const res = await fetch(`${API_BASE}/api/maps`);
  const rows = await parseJson<Record<string, unknown>[]>(res);
  return (rows ?? []).map(normalizePinboardMap);
}

export async function createMapApi(payload: {
  name: string;
  description?: string;
  color?: string;
}): Promise<PinboardMap> {
  const res = await fetch(`${API_BASE}/api/maps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      description: payload.description,
      color: payload.color,
    }),
  });
  const raw = await parseJson<Record<string, unknown>>(res);
  return normalizePinboardMap(raw);
}

export async function updateMapApi(
  id: string,
  payload: { name?: string; description?: string | null; color?: string },
): Promise<PinboardMap> {
  const res = await fetch(`${API_BASE}/api/maps/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await parseJson<Record<string, unknown>>(res);
  return normalizePinboardMap(raw);
}

export async function deleteMapApi(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/maps/${encodeURIComponent(id)}`, { method: "DELETE" });
  await parseJson<{ ok?: boolean }>(res);
}

function normalizeGraphNodeType(raw: Record<string, unknown>): GraphNodeType {
  return {
    id: String(raw.id),
    map_id: String(raw.map_id ?? ""),
    name: String(raw.name ?? ""),
    color: String(raw.color ?? "#888888"),
    sort_order: Number(raw.sort_order) || 0,
    node_count: raw.node_count != null ? Number(raw.node_count) : undefined,
  };
}

export async function fetchMapNodeTypes(mapId: string): Promise<GraphNodeType[]> {
  const q = encodeURIComponent(normalizeMapQuery(mapId));
  const res = await fetch(`${API_BASE}/api/maps/${q}/types`);
  const rows = await parseJson<Record<string, unknown>[]>(res);
  return (rows ?? []).map(normalizeGraphNodeType);
}

export async function createMapNodeType(
  mapId: string,
  payload: { name: string; color?: string },
): Promise<GraphNodeType> {
  const q = encodeURIComponent(normalizeMapQuery(mapId));
  const res = await fetch(`${API_BASE}/api/maps/${q}/types`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: payload.name, color: payload.color }),
  });
  const raw = await parseJson<Record<string, unknown>>(res);
  return normalizeGraphNodeType(raw);
}

export async function updateMapNodeType(
  mapId: string,
  typeId: string,
  payload: { name?: string; color?: string },
): Promise<GraphNodeType> {
  const mq = encodeURIComponent(normalizeMapQuery(mapId));
  const res = await fetch(`${API_BASE}/api/maps/${mq}/types/${encodeURIComponent(typeId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await parseJson<Record<string, unknown>>(res);
  return normalizeGraphNodeType(raw);
}

export async function deleteMapNodeType(mapId: string, typeId: string): Promise<void> {
  const mq = encodeURIComponent(normalizeMapQuery(mapId));
  const res = await fetch(`${API_BASE}/api/maps/${mq}/types/${encodeURIComponent(typeId)}`, {
    method: "DELETE",
  });
  await parseJson<{ ok?: boolean }>(res);
}
