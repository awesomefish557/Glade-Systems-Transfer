import { ensureNodeDimensions, minSizeForKind } from './nodeDefaults'
import { measureContentHeight } from './nodeTextLayout'
import type { ChatMessage, GraphEdge, GraphNode, ResolvedActionPath, ResolvedStructure, ResolvedVersion } from '../types'

function cloneNode(n: GraphNode): GraphNode {
  return ensureNodeDimensions({ ...n })
}

function assumptionLanguage(text: string): boolean {
  const s = text.toLowerCase()
  return (
    /\bif\b/.test(s) ||
    s.includes('given that') ||
    s.includes('assuming') ||
    s.includes('assume that')
  )
}

function decisionLanguage(text: string): boolean {
  const s = text.toLowerCase()
  return (
    s.includes('should') ||
    s.includes('choice') ||
    s.includes('decision') ||
    s.includes('whether to') ||
    s.includes('which option')
  )
}

function mentionScore(text: string, messages: ChatMessage[]): number {
  const t = text.trim().toLowerCase()
  if (t.length < 4) return 0
  const needle = t.length > 48 ? t.slice(0, 48) : t
  let score = 0
  for (const m of messages) {
    const c = m.content.toLowerCase()
    if (c.includes(needle)) score += 3
    else {
      const words = needle.split(/\s+/).filter((w) => w.length > 3)
      for (const w of words) {
        if (c.includes(w)) score += 1
      }
    }
  }
  return score
}

/** Count nodes reachable along outgoing edges (excluding start). */
function countDownstream(nodeId: string, edges: GraphEdge[]): number {
  const seen = new Set<string>()
  const stack: string[] = []
  for (const e of edges) {
    if (e.from === nodeId) stack.push(e.to)
  }
  while (stack.length) {
    const x = stack.pop()!
    if (seen.has(x)) continue
    seen.add(x)
    for (const e of edges) {
      if (e.from === x) stack.push(e.to)
    }
  }
  return seen.size
}

/**
 * Heuristic restructure: assumptions, root-adjacent primaries, decision branches, orphans.
 * No AI; original nodes/edges in the scenario are not modified (caller stores this as a new version).
 */
export function resolveGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  messages: ChatMessage[],
): ResolvedVersion | null {
  const root = nodes.find((n) => n.kind === 'root')
  if (!root) return null

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const rootId = root.id

  const rootChildIds = edges.filter((e) => e.from === rootId).map((e) => e.to)
  const rootChildren = rootChildIds
    .map((id) => byId.get(id))
    .filter((n): n is GraphNode => Boolean(n))
    .filter((n) => n.kind === 'consequence' || n.kind === 'question')

  const consequences = rootChildren.filter((n) => n.kind === 'consequence')
  const questionsFromRoot = rootChildren.filter((n) => n.kind === 'question')

  consequences.sort((a, b) => (b.certainty ?? 0) - (a.certainty ?? 0))
  questionsFromRoot.sort((a, b) => mentionScore(b.text, messages) - mentionScore(a.text, messages))

  const primaryConsequences: GraphNode[] = [...consequences, ...questionsFromRoot].map(cloneNode)
  const primaryIds = new Set(primaryConsequences.map((n) => n.id))

  const assumptions: GraphNode[] = []
  const assumptionIds = new Set<string>()
  for (const n of nodes) {
    if (n.id === rootId || primaryIds.has(n.id)) continue
    if (n.kind === 'assumption' || assumptionLanguage(n.text)) {
      assumptions.push(cloneNode(n))
      assumptionIds.add(n.id)
    }
  }

  const taken = new Set<string>([rootId, ...assumptionIds, ...primaryIds])

  const decisionCandidates = nodes.filter((n) => {
    if (n.id === rootId || taken.has(n.id)) return false
    if (primaryIds.has(n.id)) return false
    if (n.kind === 'question') return true
    return decisionLanguage(n.text)
  })

  const actionPathsUnsorted: ResolvedActionPath[] = decisionCandidates.map((decision) => {
    const childIds = edges.filter((e) => e.from === decision.id).map((e) => e.to)
    const children = childIds
      .map((id) => byId.get(id))
      .filter((n): n is GraphNode => Boolean(n))
      .map(cloneNode)
    return { decision: cloneNode(decision), children }
  })

  actionPathsUnsorted.sort(
    (a, b) => countDownstream(b.decision.id, edges) - countDownstream(a.decision.id, edges),
  )

  const actionPathDecisionIds = new Set(actionPathsUnsorted.map((p) => p.decision.id))
  const actionPathChildIds = new Set(
    actionPathsUnsorted.flatMap((p) => p.children.map((c) => c.id)),
  )

  const categorizedIds = new Set<string>([
    rootId,
    ...assumptionIds,
    ...primaryIds,
    ...actionPathDecisionIds,
    ...actionPathChildIds,
  ])

  const orphansRaw = nodes.filter((n) => !categorizedIds.has(n.id))
  orphansRaw.sort((a, b) => mentionScore(b.text, messages) - mentionScore(a.text, messages))
  const orphans = orphansRaw.map(cloneNode)
  const orphanIds = new Set(orphans.map((o) => o.id))

  const orphanEdges = edges.filter(
    (e) =>
      (orphanIds.has(e.from) && categorizedIds.has(e.to)) ||
      (categorizedIds.has(e.from) && orphanIds.has(e.to)) ||
      (orphanIds.has(e.from) && orphanIds.has(e.to)),
  )

  const structure: ResolvedStructure = {
    assumptions,
    primaryConsequences,
    actionPaths: actionPathsUnsorted,
    orphans,
  }

  const version: ResolvedVersion = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    rootId,
    root: cloneNode(root),
    structure,
    orphanEdges: orphanEdges.map((e) => ({ ...e })),
  }

  console.log('Resolved structure:', {
    assumptions: assumptions.length,
    primaryConsequences: primaryConsequences.length,
    actionPaths: actionPathsUnsorted.length,
    orphans: orphans.length,
  })
  console.log('Orphan edges:', orphanEdges.length)

  return version
}

const ROW_GAP = 88
/** Multi-flow: causes left, decision center, effects right, tangents bottom. */
const ROOT_POS = { x: 420, y: 300 }
const COL_CAUSES_X = 140
const COL_EFFECTS_X = 720
const PATH_START_X = 900
const PATH_COL_W = 200
const ORPHAN_Y = 700

function synthEdge(_vId: string, from: string, to: string): GraphEdge {
  return { id: `rv-${crypto.randomUUID()}`, from, to }
}

/** Edges shown in resolved view: root → assumptions + primaries, decisions → children, plus orphan-related. */
export function buildResolvedDisplayEdges(v: ResolvedVersion): GraphEdge[] {
  const out: GraphEdge[] = []
  const { rootId, structure } = v

  for (const a of structure.assumptions) {
    out.push(synthEdge(v.id, rootId, a.id))
  }
  for (const p of structure.primaryConsequences) {
    out.push(synthEdge(v.id, rootId, p.id))
  }
  for (const ap of structure.actionPaths) {
    for (const c of ap.children) {
      out.push(synthEdge(v.id, ap.decision.id, c.id))
    }
  }
  for (const e of v.orphanEdges) {
    out.push({ ...e })
  }
  return out
}

/** Multi-flow layout for resolved view: assumptions left, root center, consequences right, paths far right, orphans bottom. */
export function layoutResolvedDisplay(v: ResolvedVersion): GraphNode[] {
  const list: GraphNode[] = []
  const root: GraphNode = {
    ...ensureNodeDimensions({ ...v.root }),
    x: ROOT_POS.x,
    y: ROOT_POS.y,
  }
  const needRootH = measureContentHeight(root)
  const { minH: minRootH } = minSizeForKind('root')
  root.height = Math.max(root.height ?? minRootH, needRootH, minRootH)
  list.push(root)

  let y = 160
  for (const n of v.structure.assumptions) {
    const node = ensureNodeDimensions({ ...n, x: COL_CAUSES_X, y })
    const needH = measureContentHeight(node)
    const { minH } = minSizeForKind(node.kind)
    node.height = Math.max(node.height ?? minH, needH, minH)
    list.push(node)
    y += ROW_GAP + (node.height ?? 70) * 0.12
  }

  y = 160
  for (const n of v.structure.primaryConsequences) {
    const node = ensureNodeDimensions({ ...n, x: COL_EFFECTS_X, y })
    const needH = measureContentHeight(node)
    const { minH } = minSizeForKind(node.kind)
    node.height = Math.max(node.height ?? minH, needH, minH)
    list.push(node)
    y += ROW_GAP + (node.height ?? 70) * 0.12
  }

  let xCol = PATH_START_X
  for (const ap of v.structure.actionPaths) {
    let py = 150
    const d = ensureNodeDimensions({ ...ap.decision, x: xCol, y: py })
    const dNeed = measureContentHeight(d)
    const { minH: dMinH } = minSizeForKind(d.kind)
    d.height = Math.max(d.height ?? dMinH, dNeed, dMinH)
    list.push(d)
    py += ROW_GAP + (d.height ?? 70) * 0.18
    for (const c of ap.children) {
      const node = ensureNodeDimensions({ ...c, x: xCol, y: py })
      const needH = measureContentHeight(node)
      const { minH } = minSizeForKind(node.kind)
      node.height = Math.max(node.height ?? minH, needH, minH)
      list.push(node)
      py += ROW_GAP + (node.height ?? 70) * 0.12
    }
    xCol += PATH_COL_W
  }

  let ox = 80
  let rowY = ORPHAN_Y
  for (const n of v.structure.orphans) {
    const node = ensureNodeDimensions({ ...n, x: ox, y: rowY })
    const needH = measureContentHeight(node)
    const { minH } = minSizeForKind(node.kind)
    node.height = Math.max(node.height ?? minH, needH, minH)
    list.push(node)
    ox += Math.max(200, (node.width ?? 120) + 48)
    if (ox > 1080) {
      ox = 80
      rowY += ROW_GAP + 50
    }
  }

  return list
}

export function orphanIdSet(v: ResolvedVersion): Set<string> {
  return new Set(v.structure.orphans.map((n) => n.id))
}
