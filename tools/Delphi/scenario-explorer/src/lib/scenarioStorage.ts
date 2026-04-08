import type {
  ChatMessage,
  GraphEdge,
  GraphNode,
  ResolvedActionPath,
  ResolvedStructure,
  ResolvedVersion,
  Viewport,
} from '../types'
import { ensureNodeDimensions } from './nodeDefaults'
import type { PlacementCursor } from './graphFromExtraction'

export const SCENARIOS_STORAGE_KEY = 'delphi-scenarios-v1'
export const LEGACY_STORAGE_KEY = 'delphi-scenario-explorer-v1'

export interface ScenarioGraphState {
  nodes: GraphNode[]
  edges: GraphEdge[]
  tailId: string | null
  cursor: PlacementCursor
  viewport: Viewport
}

/** One extraction / chat turn that added nodes to the canvas. */
export interface ScenarioExtraction {
  id: string
  timestamp: number
  messageIndex: number
  nodeIds: string[]
  label?: string
}

export interface Scenario {
  id: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
  graph: ScenarioGraphState
  /** Snapshots from “Resolve” (original graph untouched). */
  resolvedVersions?: ResolvedVersion[]
  /** When set, UI shows this resolved snapshot instead of the live graph. */
  currentResolvedVersionId?: string | null
  /** History of extractions (turn id matches `GraphNode.turnId`). */
  extractions?: ScenarioExtraction[]
  /** Highlight nodes from this turn; null/undefined = show all at full opacity. */
  activeTurnId?: string | null
}

export interface ScenariosVault {
  currentId: string
  conversations: Record<string, Scenario>
}

interface LegacyPersisted {
  messages: ChatMessage[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  tailId: string | null
  cursor: PlacementCursor
  viewport: Viewport
}

const TITLE_MAX = 56

export function excerpt(text: string, max = TITLE_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')
  return first ? excerpt(first.content, TITLE_MAX) : 'New scenario'
}

function normalizeGraphNode(raw: unknown): GraphNode | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Record<string, unknown>
  const id = typeof n.id === 'string' ? n.id : null
  const kind = n.kind as GraphNode['kind']
  if (!id || !['root', 'consequence', 'question', 'assumption'].includes(kind)) return null
  return ensureNodeDimensions({
    id,
    kind,
    x: Number(n.x) || 0,
    y: Number(n.y) || 0,
    text: typeof n.text === 'string' ? n.text : '',
    width: typeof n.width === 'number' ? n.width : undefined,
    height: typeof n.height === 'number' ? n.height : undefined,
    fontSize: typeof n.fontSize === 'number' ? n.fontSize : undefined,
    certainty: typeof n.certainty === 'number' ? n.certainty : n.certainty === null ? null : undefined,
    turnId: typeof n.turnId === 'string' ? n.turnId : undefined,
    extractedAt: typeof n.extractedAt === 'number' ? n.extractedAt : undefined,
  })
}

function normalizeResolvedStructure(raw: unknown): ResolvedStructure | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const assumptions = Array.isArray(o.assumptions)
    ? (o.assumptions as unknown[]).map(normalizeGraphNode).filter((x): x is GraphNode => x != null)
    : []
  const primaryConsequences = Array.isArray(o.primaryConsequences)
    ? (o.primaryConsequences as unknown[]).map(normalizeGraphNode).filter((x): x is GraphNode => x != null)
    : []
  const orphans = Array.isArray(o.orphans)
    ? (o.orphans as unknown[]).map(normalizeGraphNode).filter((x): x is GraphNode => x != null)
    : []
  const pathsRaw = Array.isArray(o.actionPaths) ? o.actionPaths : []
  const actionPaths: ResolvedActionPath[] = []
  for (const p of pathsRaw) {
    if (!p || typeof p !== 'object') continue
    const pr = p as Record<string, unknown>
    const decision = normalizeGraphNode(pr.decision)
    const children = Array.isArray(pr.children)
      ? (pr.children as unknown[]).map(normalizeGraphNode).filter((x): x is GraphNode => x != null)
      : []
    if (decision) actionPaths.push({ decision, children })
  }
  return {
    assumptions,
    primaryConsequences,
    actionPaths,
    orphans,
  }
}

function normalizeResolvedVersion(raw: unknown): ResolvedVersion | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : null
  const rootId = typeof o.rootId === 'string' ? o.rootId : null
  const timestamp = typeof o.timestamp === 'number' ? o.timestamp : Date.now()
  const root = normalizeGraphNode(o.root)
  const structure = normalizeResolvedStructure(o.structure)
  if (!id || !rootId || !root || !structure) return null
  const orphanEdges = Array.isArray(o.orphanEdges)
    ? (o.orphanEdges as GraphEdge[]).filter(
        (e) => e && typeof e.id === 'string' && typeof e.from === 'string' && typeof e.to === 'string',
      )
    : []
  return { id, timestamp, rootId, root, structure, orphanEdges }
}

function normalizeExtraction(raw: unknown): ScenarioExtraction | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : null
  if (!id) return null
  const timestamp = typeof o.timestamp === 'number' ? o.timestamp : Date.now()
  const messageIndex = typeof o.messageIndex === 'number' ? o.messageIndex : 0
  const nodeIds = Array.isArray(o.nodeIds)
    ? (o.nodeIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  const label = typeof o.label === 'string' ? o.label : undefined
  return { id, timestamp, messageIndex, nodeIds, label }
}

export function createEmptyScenario(id: string): Scenario {
  return {
    id,
    title: 'New scenario',
    updatedAt: Date.now(),
    messages: [],
    graph: {
      nodes: [],
      edges: [],
      tailId: null,
      cursor: { x: 120, y: 180 },
      viewport: { tx: 48, ty: 40, scale: 1 },
    },
    resolvedVersions: [],
    currentResolvedVersionId: null,
    extractions: [],
    activeTurnId: null,
  }
}

function normalizeScenario(raw: unknown): Scenario | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : null
  if (!id) return null
  const messages = Array.isArray(o.messages) ? (o.messages as ChatMessage[]) : []
  const g = o.graph as Record<string, unknown> | undefined
  if (!g || typeof g !== 'object') return null
  const nodes = Array.isArray(g.nodes)
    ? (g.nodes as GraphNode[]).map((n) => ensureNodeDimensions(n))
    : []
  const edges = Array.isArray(g.edges) ? (g.edges as GraphEdge[]) : []
  const tailId = typeof g.tailId === 'string' || g.tailId === null ? (g.tailId as string | null) : null
  const cursor =
    g.cursor && typeof g.cursor === 'object' && 'x' in g.cursor && 'y' in g.cursor
      ? { x: Number((g.cursor as { x: unknown }).x), y: Number((g.cursor as { y: unknown }).y) }
      : { x: 120, y: 180 }
  const vp = g.viewport as Record<string, unknown> | undefined
  const viewport: Viewport =
    vp && typeof vp.tx === 'number' && typeof vp.ty === 'number' && typeof vp.scale === 'number'
      ? { tx: vp.tx, ty: vp.ty, scale: vp.scale }
      : { tx: 48, ty: 40, scale: 1 }
  const rvRaw = o.resolvedVersions
  const resolvedVersions = Array.isArray(rvRaw)
    ? (rvRaw as unknown[]).map(normalizeResolvedVersion).filter(Boolean)
    : []
  const cr =
    typeof o.currentResolvedVersionId === 'string'
      ? o.currentResolvedVersionId
      : o.currentResolvedVersionId === null
        ? null
        : undefined

  const extRaw = o.extractions
  const extractions = Array.isArray(extRaw)
    ? (extRaw as unknown[]).map(normalizeExtraction).filter((x): x is ScenarioExtraction => x != null)
    : []
  const at =
    typeof o.activeTurnId === 'string'
      ? o.activeTurnId
      : o.activeTurnId === null || o.activeTurnId === undefined
        ? null
        : undefined

  return {
    id,
    title: typeof o.title === 'string' ? o.title : titleFromMessages(messages),
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
    messages,
    graph: { nodes, edges, tailId, cursor, viewport },
    resolvedVersions: resolvedVersions as ResolvedVersion[],
    currentResolvedVersionId: cr,
    extractions,
    activeTurnId: at === undefined ? null : at,
  }
}

function normalizeVault(raw: unknown): ScenariosVault | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const currentId = typeof o.currentId === 'string' ? o.currentId : null
  const conv = o.conversations
  if (!currentId || !conv || typeof conv !== 'object') return null
  const conversations: Record<string, Scenario> = {}
  for (const [k, v] of Object.entries(conv as Record<string, unknown>)) {
    const s = normalizeScenario(v)
    if (s) conversations[k] = s
  }
  if (!conversations[currentId]) return null
  return { currentId, conversations }
}

function migrateFromLegacy(): ScenariosVault | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as LegacyPersisted
    if (!p || !Array.isArray(p.nodes)) return null
    const id = crypto.randomUUID()
    const messages = Array.isArray(p.messages) ? p.messages : []
    const scenario: Scenario = {
      id,
      title: titleFromMessages(messages),
      updatedAt: Date.now(),
      messages,
      graph: {
        nodes: p.nodes.map((n) => ensureNodeDimensions(n as GraphNode)),
        edges: Array.isArray(p.edges) ? p.edges : [],
        tailId: p.tailId ?? null,
        cursor: p.cursor ?? { x: 120, y: 180 },
        viewport: p.viewport ?? { tx: 48, ty: 40, scale: 1 },
      },
      resolvedVersions: [],
      currentResolvedVersionId: null,
      extractions: [],
      activeTurnId: null,
    }
    return { currentId: id, conversations: { [id]: scenario } }
  } catch {
    return null
  }
}

export function loadScenariosVault(): ScenariosVault {
  try {
    const raw = localStorage.getItem(SCENARIOS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      const v = normalizeVault(parsed)
      if (v) return v
    }
  } catch {
    /* ignore */
  }
  const migrated = migrateFromLegacy()
  if (migrated) {
    persistScenariosVault(migrated)
    return migrated
  }
  const id = crypto.randomUUID()
  const s = createEmptyScenario(id)
  const fresh: ScenariosVault = { currentId: id, conversations: { [id]: s } }
  persistScenariosVault(fresh)
  return fresh
}

export function persistScenariosVault(v: ScenariosVault): void {
  try {
    localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(v))
  } catch {
    /* quota */
  }
}

export interface ScenarioDraft {
  messages: ChatMessage[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  tailId: string | null
  cursor: PlacementCursor
  viewport: Viewport
  resolvedVersions: ResolvedVersion[]
  currentResolvedVersionId: string | null
  extractions: ScenarioExtraction[]
  activeTurnId: string | null
}

export function upsertCurrentScenario(v: ScenariosVault, draft: ScenarioDraft): ScenariosVault {
  const curId = v.currentId
  const existing = v.conversations[curId]
  if (!existing) return v
  const scenario: Scenario = {
    ...existing,
    title: titleFromMessages(draft.messages),
    updatedAt: Date.now(),
    messages: draft.messages,
    graph: {
      nodes: draft.nodes,
      edges: draft.edges,
      tailId: draft.tailId,
      cursor: draft.cursor,
      viewport: draft.viewport,
    },
    resolvedVersions: draft.resolvedVersions,
    currentResolvedVersionId: draft.currentResolvedVersionId,
    extractions: draft.extractions,
    activeTurnId: draft.activeTurnId,
  }
  return {
    ...v,
    conversations: { ...v.conversations, [curId]: scenario },
  }
}

export function sortedScenarioList(vault: ScenariosVault): Scenario[] {
  return Object.values(vault.conversations).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function pickMostRecentId(conversations: Record<string, Scenario>): string {
  const list = Object.values(conversations)
  if (list.length === 0) return ''
  return list.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b)).id
}
