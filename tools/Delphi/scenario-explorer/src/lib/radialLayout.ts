import type { GraphEdge, GraphNode } from '../types'

function buildChildren(edges: GraphEdge[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const e of edges) {
    if (!m.has(e.from)) m.set(e.from, [])
    m.get(e.from)!.push(e.to)
  }
  return m
}

/** BFS depth from root; unreachable nodes get -1 */
function bfsDepth(rootId: string, children: Map<string, string[]>): Map<string, number> {
  const depth = new Map<string, number>()
  const q: string[] = [rootId]
  depth.set(rootId, 0)
  for (let i = 0; i < q.length; i++) {
    const u = q[i]!
    const d = depth.get(u)! + 1
    for (const v of children.get(u) ?? []) {
      if (!depth.has(v)) {
        depth.set(v, d)
        q.push(v)
      }
    }
  }
  return depth
}

/**
 * For each node (except root), pick parent as incoming edge from the shallowest valid predecessor.
 */
export function computeParents(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
): Map<string, string> {
  const children = buildChildren(edges)
  const depth = bfsDepth(rootId, children)
  const parent = new Map<string, string>()
  const byId = new Set(nodes.map((n) => n.id))

  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    const df = depth.get(e.from)
    const dt = depth.get(e.to)
    if (df === undefined || dt === undefined) continue
    if (df + 1 !== dt) continue
    if (!parent.has(e.to)) parent.set(e.to, e.from)
  }
  return parent
}

/**
 * Position only `newIds` nodes in a radial fan from their parent, without moving existing nodes.
 * Root (if new) is placed at center.
 */
export function radialLayoutNewNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerX: number,
  centerY: number,
  newIds: Set<string>,
): GraphNode[] {
  const root = nodes.find((n) => n.kind === 'root')
  if (!root || newIds.size === 0) return nodes

  const rootId = root.id
  const parents = computeParents(nodes, edges, rootId)
  const byId = new Map(nodes.map((n) => [n.id, { ...n }]))

  if (newIds.has(rootId)) {
    const r = byId.get(rootId)!
    r.x = centerX
    r.y = centerY
  }

  const children = buildChildren(edges)
  const depth = bfsDepth(rootId, children)

  const childrenByParent = new Map<string, string[]>()
  for (const id of newIds) {
    if (id === rootId) continue
    const p = parents.get(id)
    if (p === undefined) continue
    if (!childrenByParent.has(p)) childrenByParent.set(p, [])
    childrenByParent.get(p)!.push(id)
  }

  const parentKeys = [...childrenByParent.keys()].sort(
    (a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0),
  )

  for (const pid of parentKeys) {
    const kids = childrenByParent.get(pid)!
    const parent = byId.get(pid)
    if (!parent) continue

    const dx = parent.x - centerX
    const dy = parent.y - centerY
    const pr = Math.hypot(dx, dy) || 1
    const baseAngle = Math.atan2(dy, dx)

    const k = kids.length

    /** Root’s children: full 360° ring (chain graph used to put atan2(0,0)→0 and collapse to a line). */
    if (pid === rootId) {
      const childR = Math.max(210, pr + 40)
      kids.forEach((kidId, i) => {
        const n = byId.get(kidId)
        if (!n) return
        const angle = k === 1 ? -Math.PI / 2 : (2 * Math.PI * i) / k - Math.PI / 2
        n.x = parent.x + childR * Math.cos(angle)
        n.y = parent.y + childR * Math.sin(angle)
      })
      continue
    }

    const childR = pr + 170
    const spread = k === 1 ? 0 : Math.min((Math.PI * 5) / 6, (Math.PI / 3) * (k > 2 ? 1.2 : 1))
    const step = k === 1 ? 0 : spread / (k - 1)

    kids.forEach((kidId, i) => {
      const angle = baseAngle + (i - (k - 1) / 2) * step
      const n = byId.get(kidId)
      if (!n) return
      n.x = centerX + childR * Math.cos(angle)
      n.y = centerY + childR * Math.sin(angle)
    })
  }

  return nodes.map((n) => byId.get(n.id) ?? n)
}
