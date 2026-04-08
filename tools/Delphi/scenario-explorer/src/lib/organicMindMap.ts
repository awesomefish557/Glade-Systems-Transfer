import type { GraphEdge, GraphNode } from '../types'

const CHAR_PX = 0.55

/** Wrap label for organic nodes (no box width from data model). */
export function wrapOrganicLabel(text: string, maxWidthPx: number, fontSize: number): string[] {
  const charPx = fontSize * CHAR_PX
  const maxChars = Math.max(6, Math.floor(maxWidthPx / charPx))
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let cur = ''
  for (const word of words) {
    const trial = cur ? `${cur} ${word}` : word
    if (trial.length <= maxChars) {
      cur = trial
    } else {
      if (cur) lines.push(cur)
      cur = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

export function labelMaxWidth(kind: GraphNode['kind']): number {
  switch (kind) {
    case 'root':
      return 300
    case 'consequence':
    case 'question':
      return 240
    default:
      return 220
  }
}

export function labelFontSize(kind: GraphNode['kind']): number {
  switch (kind) {
    case 'root':
      return 13
    default:
      return 11.5
  }
}

const LINE_HEIGHT_EM = 1.28

export function estimateOrganicExtents(n: GraphNode): { hw: number; hh: number } {
  const fs = labelFontSize(n.kind)
  const maxW = labelMaxWidth(n.kind)
  const lines = wrapOrganicLabel(n.text, maxW, fs)
  const lh = fs * LINE_HEIGHT_EM
  let w = 40
  for (const ln of lines) {
    w = Math.max(w, Math.min(maxW, ln.length * fs * CHAR_PX + 16))
  }
  const h = lines.length * lh + (n.kind === 'consequence' && n.certainty != null ? 14 : 0) + 20
  return { hw: w / 2, hh: h / 2 }
}

/** Cubic bezier from (x1,y1) to (x2,y2); `side` alternates curve direction. */
export function organicCubicPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  side: 1 | -1,
  strength = 0.2,
  obstacleBias?: { bx: number; by: number },
): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  let nx = (-dy / len) * len * strength * side
  let ny = (dx / len) * len * strength * side
  if (obstacleBias) {
    nx += obstacleBias.bx
    ny += obstacleBias.by
  }
  const c1x = x1 + dx * 0.28 + nx
  const c1y = y1 + dy * 0.28 + ny
  const c2x = x1 + dx * 0.72 + nx * 0.9
  const c2y = y1 + dy * 0.72 + ny * 0.9
  return `M ${x1} ${y1} C ${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}`
}

export function organicEdgeAnchors(
  from: GraphNode,
  to: GraphNode,
  fromExt = estimateOrganicExtents(from),
  toExt = estimateOrganicExtents(to),
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return {
    x1: from.x + ux * fromExt.hw,
    y1: from.y + uy * fromExt.hh,
    x2: to.x - ux * toExt.hw,
    y2: to.y - uy * toExt.hh,
  }
}

function stableSide(id: string, salt: number): 1 | -1 {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return h % 2 === 0 ? 1 : -1
}

/** Per parent, assign side ±1 to each outgoing edge for visual separation. */
export function edgeOrganicSide(
  e: GraphEdge,
  edges: GraphEdge[],
): 1 | -1 {
  const siblings = edges.filter((x) => x.from === e.from).sort((a, b) => a.to.localeCompare(b.to))
  const idx = siblings.findIndex((x) => x.id === e.id)
  const base = idx >= 0 ? (idx % 2 === 0 ? 1 : -1) : 1
  return (base * stableSide(e.id, idx + 1)) as 1 | -1
}

export function findRootId(nodes: GraphNode[]): string | null {
  return nodes.find((n) => n.kind === 'root')?.id ?? null
}

/** Edge ids on directed path root → target (first shortest by BFS). */
export function edgesOnPathFromRoot(
  targetId: string,
  rootId: string,
  edges: GraphEdge[],
): Set<string> {
  const out = new Set<string>()
  if (!rootId || targetId === rootId) return out
  const byFrom = new Map<string, GraphEdge[]>()
  for (const e of edges) {
    if (!byFrom.has(e.from)) byFrom.set(e.from, [])
    byFrom.get(e.from)!.push(e)
  }
  const q: string[] = [rootId]
  const prev = new Map<string, { via: string; edgeId: string }>()
  const seen = new Set<string>([rootId])
  for (let i = 0; i < q.length; i++) {
    const u = q[i]!
    if (u === targetId) break
    for (const e of byFrom.get(u) ?? []) {
      if (seen.has(e.to)) continue
      seen.add(e.to)
      prev.set(e.to, { via: u, edgeId: e.id })
      q.push(e.to)
    }
  }
  if (!prev.has(targetId)) return out
  let cur = targetId
  while (cur !== rootId) {
    const p = prev.get(cur)
    if (!p) break
    out.add(p.edgeId)
    cur = p.via
  }
  return out
}

/** Label center offset from node anchor (n.x, n.y), perpendicular to incoming branch. */
export function organicLabelPlacement(
  n: GraphNode,
  edges: GraphEdge[],
  nodeMap: Map<string, GraphNode>,
): { ox: number; oy: number; lines: string[]; fs: number; lh: number } {
  const fs = labelFontSize(n.kind)
  const maxW = labelMaxWidth(n.kind)
  const lines = wrapOrganicLabel(n.text, maxW, fs)
  const lh = fs * LINE_HEIGHT_EM
  const inc = edges.filter((e) => e.to === n.id)
  if (inc.length === 0) {
    return { ox: 0, oy: -fs - 6, lines, fs, lh }
  }
  const p = nodeMap.get(inc[0]!.from)
  if (!p) {
    return { ox: 0, oy: -fs - 6, lines, fs, lh }
  }
  const dx = n.x - p.x
  const dy = n.y - p.y
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len
  const py = dx / len
  const side = stableSide(n.id, inc.length) as 1 | -1
  const gap = n.kind === 'root' ? 0 : 26 * side
  return { ox: px * gap, oy: py * gap - (n.kind === 'root' ? 8 : 0), lines, fs, lh }
}
