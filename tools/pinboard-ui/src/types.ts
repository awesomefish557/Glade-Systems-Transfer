export interface GraphNodeType {
  id: string;
  map_id: string;
  name: string;
  color: string;
  sort_order: number;
  node_count?: number;
}

export interface GraphNode {
  id: string;
  /** Type name from this map's node_types (e.g. PRECEDENT, DISH). */
  type: string;
  title: string;
  body: string | null;
  tags: string[];
  x: number;
  y: number;
  metadata: Record<string, unknown>;
  created_at?: number;
  updated_at?: number;
  /** Knowledge map id (multi-map); omitted on older API responses. */
  map_id?: string;
}

export interface PinboardMap {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at?: number;
}

export interface GraphConnection {
  id: string;
  source_id: string;
  target_id: string;
  label: string | null;
  strength: number;
  created_at?: number;
}

export type LoadingBayStatus = "pending" | "processing" | "proposed" | "approved" | "flagged" | "dismissed";

export interface LoadingBayProposedNode {
  type?: string;
  title?: string;
  body?: string;
  tags?: unknown;
  metadata?: unknown;
}

export interface LoadingBayProposedConnection {
  source_title?: string;
  target_title?: string;
  label?: string;
}

export interface LoadingBayItem {
  id: string;
  status: LoadingBayStatus | string;
  raw_content: string | null;
  raw_url: string | null;
  raw_type: string | null;
  /** Target map for processing / approve (defaults to default on API). */
  map_id?: string;
  ai_reasoning: string | null;
  proposed_nodes: LoadingBayProposedNode[] | null;
  proposed_connections: LoadingBayProposedConnection[] | null;
  created_at?: number;
  processed_at?: number | null;
}

export interface AttachmentRow {
  id: string;
  node_id: string;
  r2_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  created_at?: number;
}

export type ExploreRecType = "book" | "talk" | "place" | "person" | "website" | "concept";

export interface ExploreRecommendation {
  type: ExploreRecType | string;
  title: string;
  reason: string;
  url?: string;
}

/** Pre-fill for AddNodeModal (e.g. from Explore Next). */
export type AddNodeDraft = {
  type?: string;
  title?: string;
  body?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
};
