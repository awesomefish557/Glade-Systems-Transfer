export type NodeKind = 'root' | 'consequence' | 'question' | 'assumption'

export interface GraphNode {
  id: string
  kind: NodeKind
  x: number
  y: number
  text: string
  /**
   * Legacy box layout (classic view). Organic mind-map mode ignores these and
   * sizes labels from text; still persisted for backward compatibility.
   */
  width?: number
  height?: number
  /** Legacy classic view font hint; organic mode derives size from kind. */
  fontSize?: number
  /** 0–100 for consequences; omitted for questions/assumptions */
  certainty?: number | null
  /** Chat extraction turn that created this node (stage lighting). */
  turnId?: string
  /** When this node was created by extraction. */
  extractedAt?: number
}

export interface GraphEdge {
  id: string
  from: string
  to: string
}

export type ChatRole = 'user' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** Present for extraction result bubbles */
  extractionSummary?: string
}

/** Casual “explore branch” thread (not persisted on scenario). */
export interface ExploreMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ExtractionPayload {
  /** Set on the first scenario message: the user’s full “what if” question (central root node). */
  root?: string
  consequences: Array<{ text: string; certainty: number }>
  questions: Array<{ text: string }>
  assumptions: Array<{ text: string }>
}

export interface Viewport {
  tx: number
  ty: number
  scale: number
}

/** One decision node and its direct successors in the resolved map. */
export interface ResolvedActionPath {
  decision: GraphNode
  children: GraphNode[]
}

/** Heuristic buckets for a resolved snapshot (nodes are deep copies at resolve time). */
export interface ResolvedStructure {
  assumptions: GraphNode[]
  primaryConsequences: GraphNode[]
  actionPaths: ResolvedActionPath[]
  orphans: GraphNode[]
}

/** Non-destructive “clean map” snapshot; original graph is unchanged. */
export interface ResolvedVersion {
  id: string
  timestamp: number
  rootId: string
  /** Root node copy at resolve time (for display if graph changes later). */
  root: GraphNode
  structure: ResolvedStructure
  /** Edges that touch orphans so tangents stay visible. */
  orphanEdges: GraphEdge[]
}
