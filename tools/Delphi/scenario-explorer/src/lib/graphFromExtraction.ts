import type { ExtractionPayload, GraphEdge, GraphNode } from '../types'
import { defaultSizeForKind } from './nodeDefaults'

/** World-space center for the scenario root (first message). */
const ROOT_X = 400
const ROOT_Y = 300

/** Follow-up extractions: horizontal step and row drop before radial placement. */
const STEP_X = 220
const WRAP_AT = 1100
const START_X = 140
const ROW_DROP = 168

function newId(): string {
  return crypto.randomUUID()
}

function createNode(
  kind: GraphNode['kind'],
  x: number,
  y: number,
  text: string,
  certainty?: number | null,
): GraphNode {
  const { width, height } = defaultSizeForKind(kind)
  return {
    id: newId(),
    kind,
    x,
    y,
    text,
    width,
    height,
    certainty: certainty ?? undefined,
  }
}

export interface PlacementCursor {
  x: number
  y: number
}

export interface AppendResult {
  nodes: GraphNode[]
  edges: GraphEdge[]
  newNodeIds: string[]
  tailId: string | null
  cursor: PlacementCursor
  summary: string
}

/**
 * Append extraction chain (assumptions → consequences → questions).
 * Positions are provisional; caller should run `radialLayoutNewNodes` for new ids.
 */
export function appendExtractionToGraph(
  payload: ExtractionPayload,
  existingNodes: GraphNode[],
  existingEdges: GraphEdge[],
  previousTailId: string | null,
  cursor: PlacementCursor,
): AppendResult {
  const nodes = [...existingNodes]
  const edges = [...existingEdges]
  const newNodeIds: string[] = []

  const hasRootAlready = nodes.some((n) => n.kind === 'root')
  const shouldAddRoot = Boolean(payload.root?.trim()) && !hasRootAlready

  if (shouldAddRoot) {
    const rootText = payload.root!.trim()
    const { width, height } = defaultSizeForKind('root')
    const rid = newId()
    nodes.push({ id: rid, kind: 'root', x: ROOT_X, y: ROOT_Y, text: rootText, width, height })
    newNodeIds.push(rid)

    /** Hub-and-spoke: every extracted item links to the root so radial layout can fan 360°. */
    const attachToRoot = (kind: GraphNode['kind'], text: string, certainty?: number | null) => {
      const n = createNode(kind, ROOT_X, ROOT_Y, text, certainty)
      nodes.push(n)
      newNodeIds.push(n.id)
      edges.push({ id: newId(), from: rid, to: n.id })
    }

    for (const a of payload.assumptions) {
      attachToRoot('assumption', a.text, null)
    }
    for (const c of payload.consequences) {
      attachToRoot('consequence', c.text, c.certainty)
    }
    for (const q of payload.questions) {
      attachToRoot('question', q.text, null)
    }

    const tailId = newNodeIds[newNodeIds.length - 1] ?? rid

    const nextCursor: PlacementCursor = { x: ROOT_X + 280, y: ROOT_Y + 200 }

    const parts: string[] = ['root scenario']
    if (payload.assumptions.length)
      parts.push(`${payload.assumptions.length} assumption(s)`)
    if (payload.consequences.length)
      parts.push(`${payload.consequences.length} consequence(s)`)
    if (payload.questions.length) parts.push(`${payload.questions.length} question(s)`)

    const summary =
      newNodeIds.length === 0
        ? 'No structured items found in that message.'
        : `Mapped ${parts.join(', ')} on the canvas.`

    return {
      nodes,
      edges,
      newNodeIds,
      tailId,
      cursor: nextCursor,
      summary,
    }
  }

  let cx = cursor.x
  let cy = cursor.y
  /** Follow-ups: siblings off the previous tail (mind-map branch), not a horizontal chain. */
  const anchor = previousTailId

  const addNode = (kind: GraphNode['kind'], text: string, certainty?: number | null) => {
    const n = createNode(kind, cx, cy, text, certainty)
    nodes.push(n)
    newNodeIds.push(n.id)
    if (anchor) {
      edges.push({ id: newId(), from: anchor, to: n.id })
    }
    cx += STEP_X
    if (cx > WRAP_AT) {
      cx = START_X
      cy += ROW_DROP
    }
  }

  for (const a of payload.assumptions) {
    addNode('assumption', a.text, null)
  }
  for (const c of payload.consequences) {
    addNode('consequence', c.text, c.certainty)
  }
  for (const q of payload.questions) {
    addNode('question', q.text, null)
  }

  const parts: string[] = []
  if (payload.assumptions.length)
    parts.push(`${payload.assumptions.length} assumption(s)`)
  if (payload.consequences.length)
    parts.push(`${payload.consequences.length} consequence(s)`)
  if (payload.questions.length)
    parts.push(`${payload.questions.length} question(s)`)

  const summary =
    newNodeIds.length === 0
      ? 'No structured items found in that message.'
      : `Mapped ${parts.join(', ')} on the canvas.`

  const lastNew =
    newNodeIds.length > 0 ? newNodeIds[newNodeIds.length - 1]! : previousTailId

  return {
    nodes,
    edges,
    newNodeIds,
    tailId: lastNew,
    cursor: { x: cx, y: cy },
    summary,
  }
}
