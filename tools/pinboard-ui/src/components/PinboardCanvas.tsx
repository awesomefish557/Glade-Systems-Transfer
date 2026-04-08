import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { GraphConnection, GraphNode } from "../types";
import { WobblyPanel } from "./WobblyPanel";

const NODE_BASE_R = 28;

/** Below this scale, skip labels, badges, non-selected rings, entrance animation; only circles + selected chrome. */
const LOW_ZOOM_DETAIL = 0.25;

export const CANVAS_ZOOM_MIN = 0.04;
export const CANVAS_ZOOM_MAX = 8;

export function nodeRadiusFromConnectionCount(count: number): number {
  const sizeScale = Math.min(1 + count * 0.08, 1.6);
  return Math.round(NODE_BASE_R * sizeScale);
}

/** scale < 0.20: circles only; 0.20–0.45: selected title only; > 0.45: all titles. Below LOW_ZOOM_DETAIL, titles only for selected. */
function titleVisibleForNode(scale: number, selectedId: string | null, nodeId: string): boolean {
  if (scale < LOW_ZOOM_DETAIL) return selectedId === nodeId;
  if (scale < 0.2) return false;
  if (scale <= 0.45) return selectedId === nodeId;
  return true;
}

function showHoverTooltip(scale: number): boolean {
  return scale >= 0.2;
}

const EDGE_LABEL_PROXIMITY = 80;
/** Screen-space edge length (px) and zoom below which connection labels stay hidden. */
const EDGE_LABEL_MIN_SCREEN_DIST = 120;
const EDGE_LABEL_MIN_SCALE = 0.35;

const VIEW_PAD_SCREEN = 200;

const NEBULA_MERGE_DIST = 400;
const NEBULA_RADIUS_PAD = 80;
const NEBULA_FADE_MAX_SCALE = 0.45;
const NEBULA_FADE_DIM_SCALE = 0.2;
const NEBULA_LABEL_MAX_SCALE = 0.25;

type NebulaCluster = {
  nodeIds: string[];
  centroid: { x: number; y: number };
  radius: number;
};

function centroidForNodeIds(nodeIds: readonly string[], byId: Map<string, GraphNode>): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let c = 0;
  for (const id of nodeIds) {
    const n = byId.get(id);
    if (!n || n.x > 50000 || n.y > 50000 || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    sx += n.x;
    sy += n.y;
    c++;
  }
  if (c === 0) return { x: 0, y: 0 };
  return { x: sx / c, y: sy / c };
}

function radiusForCluster(nodeIds: readonly string[], centroid: { x: number; y: number }, byId: Map<string, GraphNode>): number {
  let maxD = 0;
  for (const id of nodeIds) {
    const n = byId.get(id);
    if (!n || n.x > 50000 || n.y > 50000) continue;
    const d = Math.hypot(n.x - centroid.x, n.y - centroid.y);
    maxD = Math.max(maxD, d);
  }
  return maxD + NEBULA_RADIUS_PAD;
}

function connectionComponents(nodes: GraphNode[], connections: GraphConnection[]): string[][] {
  const nodeIds = new Set(nodes.filter((n) => n.x <= 50000 && n.y <= 50000).map((n) => n.id));
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const c of connections) {
    if (!nodeIds.has(c.source_id) || !nodeIds.has(c.target_id)) continue;
    adj.get(c.source_id)!.push(c.target_id);
    adj.get(c.target_id)!.push(c.source_id);
  }
  const seen = new Set<string>();
  const comps: string[][] = [];
  for (const id of nodeIds) {
    if (seen.has(id)) continue;
    const q = [id];
    seen.add(id);
    const comp: string[] = [];
    while (q.length) {
      const u = q.shift()!;
      comp.push(u);
      for (const v of adj.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          q.push(v);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function distCentroids(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Connection components, then merge clusters whose centroids are within NEBULA_MERGE_DIST; keep only size >= 2. */
function computeNebulaClusters(nodes: GraphNode[], connections: GraphConnection[]): NebulaCluster[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let groups = connectionComponents(nodes, connections).map((nodeIds) => ({
    nodeIds: [...nodeIds],
    centroid: centroidForNodeIds(nodeIds, byId),
  }));

  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (distCentroids(groups[i]!.centroid, groups[j]!.centroid) <= NEBULA_MERGE_DIST) {
          const nodeIds = [...new Set([...groups[i]!.nodeIds, ...groups[j]!.nodeIds])];
          const centroid = centroidForNodeIds(nodeIds, byId);
          const next = groups.filter((_, k) => k !== i && k !== j);
          next.push({ nodeIds, centroid });
          groups = next;
          merged = true;
          break outer;
        }
      }
    }
  }

  const out: NebulaCluster[] = [];
  for (const g of groups) {
    if (g.nodeIds.length < 2) continue;
    const centroid = centroidForNodeIds(g.nodeIds, byId);
    const radius = radiusForCluster(g.nodeIds, centroid, byId);
    out.push({ nodeIds: [...g.nodeIds], centroid, radius });
  }
  return out;
}

function nebulaDominantTypeAndLabel(
  cluster: NebulaCluster,
  byId: Map<string, GraphNode>,
): { dominantType: string | null; labelText: string } {
  const types: string[] = [];
  for (const id of cluster.nodeIds) {
    const t = byId.get(id)?.type;
    if (t) types.push(t);
  }
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (types.length === 0) {
    return { dominantType: null, labelText: `${cluster.nodeIds.length} nodes` };
  }
  if (counts.size === types.length) {
    return { dominantType: null, labelText: `${types.length} nodes` };
  }
  let bestT = "";
  let bestC = 0;
  for (const [t, c] of counts) {
    if (c > bestC || (c === bestC && (bestT === "" || t.localeCompare(bestT) < 0))) {
      bestC = c;
      bestT = t;
    }
  }
  return { dominantType: bestT, labelText: bestT };
}

function nebulaGroupOpacity(scale: number): number {
  if (scale >= NEBULA_FADE_MAX_SCALE) return 0;
  if (scale < NEBULA_FADE_DIM_SCALE) return 0.85;
  return 1;
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** When false, QUESTION edges stay hidden unless that QUESTION node is selected. */
function connectionShouldRender(
  c: GraphConnection,
  byId: Map<string, GraphNode>,
  connectionCounts: ReadonlyMap<string, number>,
  selectedId: string | null,
  focusNodeId: string | null,
  focusNeighborSet: Set<string> | null,
  orbitActive: boolean,
  connectionsVisible: boolean,
): boolean {
  const a = byId.get(c.source_id);
  const b = byId.get(c.target_id);
  if (!a || !b) return false;

  if (a.type === "QUESTION" && selectedId === a.id) {
    /* continue to context rules */
  } else if (b.type === "QUESTION" && selectedId === b.id) {
    /* continue */
  } else if (a.type === "QUESTION" || b.type === "QUESTION") {
    return false;
  }

  const touchesSelected = selectedId != null && (c.source_id === selectedId || c.target_id === selectedId);

  if (orbitActive) return true;
  if (connectionsVisible) return true;
  if (touchesSelected) return true;
  if (focusNodeId != null && focusNeighborSet != null) {
    return focusNeighborSet.has(c.source_id) || focusNeighborSet.has(c.target_id);
  }

  if (c.strength === 3) return true;
  const ds = connectionCounts.get(c.source_id) ?? 0;
  const dt = connectionCounts.get(c.target_id) ?? 0;
  if (ds === 1 || dt === 1) return true;
  return false;
}

export type Viewport = { scale: number; tx: number; ty: number };

type WorldBounds = { minX: number; maxX: number; minY: number; maxY: number };

function worldBoundsForViewport(tx: number, ty: number, scale: number, cw: number, ch: number): WorldBounds {
  const pad = VIEW_PAD_SCREEN / scale;
  return {
    minX: -tx / scale - pad,
    maxX: (cw - tx) / scale + pad,
    minY: -ty / scale - pad,
    maxY: (ch - ty) / scale + pad,
  };
}

function nodeCircleIntersectsBounds(nx: number, ny: number, r: number, b: WorldBounds): boolean {
  return nx + r >= b.minX && nx - r <= b.maxX && ny + r >= b.minY && ny - r <= b.maxY;
}

function pointOutsideBounds(x: number, y: number, b: WorldBounds): boolean {
  return x < b.minX || x > b.maxX || y < b.minY || y > b.maxY;
}

function nebulaIntersectsViewport(cluster: NebulaCluster, b: WorldBounds): boolean {
  const rx = cluster.radius * 1.1;
  const ry = cluster.radius * 0.9;
  const { x: cx, y: cy } = cluster.centroid;
  return cx + rx >= b.minX && cx - rx <= b.maxX && cy + ry >= b.minY && cy - ry <= b.maxY;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function buildFocusNeighborSet(focusId: string, connections: GraphConnection[]): Set<string> {
  const s = new Set<string>([focusId]);
  for (const c of connections) {
    if (c.source_id === focusId) s.add(c.target_id);
    if (c.target_id === focusId) s.add(c.source_id);
  }
  return s;
}

function hitTestNode(
  wx: number,
  wy: number,
  nodes: GraphNode[],
  counts: ReadonlyMap<string, number>,
  dragPos: { id: string; x: number; y: number } | null,
): GraphNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const px = dragPos && dragPos.id === n.id ? dragPos.x : n.x;
    const py = dragPos && dragPos.id === n.id ? dragPos.y : n.y;
    if (px > 50000 || py > 50000) continue;
    const r = nodeRadiusFromConnectionCount(counts.get(n.id) ?? 0);
    const dx = wx - px;
    const dy = wy - py;
    if (dx * dx + dy * dy <= r * r) return n;
  }
  return null;
}

type CanvasMapConnectionProps = {
  cid: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  lineOn: boolean;
  op: number;
  stroke: string;
  strokeW: number;
  midX: number;
  midY: number;
  displayAngle: number;
  scale: number;
  hasLabel: boolean;
  labelText: string;
  labelOpaque: boolean;
  skipLabelGraphics: boolean;
};

const CanvasMapConnection = memo(function CanvasMapConnection({
  cid,
  ax,
  ay,
  bx,
  by,
  lineOn,
  op,
  stroke,
  strokeW,
  midX,
  midY,
  displayAngle,
  scale,
  hasLabel,
  labelText,
  labelOpaque,
  skipLabelGraphics,
}: CanvasMapConnectionProps) {
  const su = 1 / scale;
  const pillH = 16 * su;
  const pillPad = 12 * su;
  const charW = 6 * su;
  const pillW = Math.max(labelText.length * charW, 8 * su) + pillPad;
  const pillRx = 3 * su;
  const labelFontPx = 10 * su;
  return (
    <g
      style={{
        opacity: lineOn ? op : 0,
        transition: "opacity 0.25s ease",
        pointerEvents: "none",
      }}
    >
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke={stroke}
        strokeWidth={strokeW}
        vectorEffect="non-scaling-stroke"
      />
      {!skipLabelGraphics && hasLabel ? (
        <g
          transform={`translate(${midX},${midY}) rotate(${displayAngle})`}
          style={{ opacity: labelOpaque ? 1 : 0, transition: "opacity 0.12s ease" }}
          pointerEvents="none"
        >
          <rect
            x={-pillW / 2}
            y={-14 - pillH / 2}
            width={pillW}
            height={pillH}
            rx={pillRx}
            ry={pillRx}
            fill="rgba(5,13,6,0.85)"
          />
          <text
            x={0}
            y={-6}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#d4a853"
            fontSize={labelFontPx}
            fontFamily="Arial, sans-serif"
          >
            {labelText}
          </text>
        </g>
      ) : null}
    </g>
  );
});

type CanvasMapNodeProps = {
  nodeId: string;
  tx: number;
  ty: number;
  title: string;
  typeName: string;
  isQ: boolean;
  col: string;
  fill: string;
  nodeRadius: number;
  nodeOpacity: number;
  sel: boolean;
  showBadge: boolean;
  showTitle: boolean;
  showQGlyph: boolean;
  showEntranceAnim: boolean;
  isFocused: boolean;
  showSelRing: boolean;
  scale: number;
  shiftHeld: boolean;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerEnter: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerLeave: () => void;
};

const CanvasMapNode = memo(function CanvasMapNode({
  nodeId,
  tx,
  ty,
  title,
  typeName,
  isQ,
  col,
  fill,
  nodeRadius,
  nodeOpacity,
  sel,
  showBadge,
  showTitle,
  showQGlyph,
  showEntranceAnim,
  isFocused,
  showSelRing,
  scale,
  shiftHeld,
  onPointerDown,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
}: CanvasMapNodeProps) {
  return (
    <g
      data-node-id={nodeId}
      transform={`translate(${tx},${ty})`}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <g
        className={showEntranceAnim ? "pinboard-node-enter" : undefined}
        style={{
          opacity: nodeOpacity,
          cursor: shiftHeld ? "crosshair" : "grab",
        }}
      >
        <title>{title}</title>
        {showBadge ? (
          <text
            y={-(nodeRadius + 14)}
            textAnchor="middle"
            fill={col}
            fontSize={8 / scale}
            fontWeight={600}
            letterSpacing="0.08em"
            className="pinboard-ui-label"
            style={{ textTransform: "uppercase" }}
            pointerEvents="none"
          >
            {typeName}
          </text>
        ) : null}
        <circle
          r={nodeRadius}
          fill={fill}
          stroke={isQ ? "#cc4444" : "#fff"}
          strokeWidth={isQ ? 2 : 1.5}
          strokeDasharray={isQ ? "6 4" : undefined}
          className={isQ ? "pinboard-node-question" : undefined}
          vectorEffect="non-scaling-stroke"
        />
        {isFocused ? (
          <circle
            className="pinboard-node-focus-pulse"
            r={nodeRadius + 6}
            fill="none"
            stroke="#d4a853"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            opacity={0.85}
          />
        ) : null}
        {showQGlyph ? (
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={16 / scale}
            pointerEvents="none"
          >
            ❓
          </text>
        ) : null}
        {showSelRing ? (
          <circle
            r={nodeRadius + 4}
            fill="none"
            stroke="#d4a853"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ) : null}
        {showTitle ? (
          <text
            y={nodeRadius + 16}
            textAnchor="middle"
            fill="#cce8c0"
            fontSize={11 / scale}
            fontFamily="Georgia, serif"
            pointerEvents="none"
          >
            {truncate(title, 18)}
          </text>
        ) : null}
      </g>
    </g>
  );
});

type Props = {
  typeColor: (typeName: string) => string;
  nodes: GraphNode[];
  connections: GraphConnection[];
  connectionCounts: ReadonlyMap<string, number>;
  viewport: Viewport;
  onViewportChange: (v: Viewport) => void;
  selectedId: string | null;
  focusNodeId: string | null;
  onSelect: (id: string | null) => void;
  onOpenDetail: (id: string) => void;
  onCloseDetailPanel?: () => void;
  onNodeMove: (id: string, x: number, y: number) => void;
  onNodeDragEnd: (id: string, finalX?: number, finalY?: number) => void;
  fixSimNode?: (id: string, x: number, y: number) => void;
  releaseSimNode?: (id: string) => void;
  visibleNodeIds: Set<string> | null;
  entranceNodeIds: Set<string>;
  onRequestConnection: (sourceId: string, targetId: string, clientX: number, clientY: number) => void;
  connectionsVisible: boolean;
  /** Orbit mode: draw every connection (after culling). */
  orbitActive: boolean;
  typesHeld: boolean;
};

export function PinboardCanvas({
  typeColor,
  nodes,
  connections,
  connectionCounts,
  viewport,
  onViewportChange,
  selectedId,
  focusNodeId,
  onSelect,
  onOpenDetail,
  onCloseDetailPanel,
  onNodeMove,
  onNodeDragEnd,
  fixSimNode,
  releaseSimNode,
  visibleNodeIds,
  entranceNodeIds,
  onRequestConnection,
  connectionsVisible,
  orbitActive,
  typesHeld,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const vpRef = useRef(viewport);
  vpRef.current = viewport;

  const panRef = useRef<{ sx: number; sy: number; tx: number; ty: number; scale: number } | null>(null);
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const linkRef = useRef<{ fromId: string } | null>(null);
  const lastWorldRef = useRef({ x: 0, y: 0 });
  const lastClientRef = useRef({ x: 0, y: 0 });
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const connectionCountsRef = useRef(connectionCounts);
  connectionCountsRef.current = connectionCounts;

  /** Live drag position for rendering + hit-test; avoids parent setState every pointermove. */
  const dragPaintRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const [, bumpDragPaint] = useReducer((x: number) => x + 1, 0);

  const scheduleDragPaint = useCallback(() => {
    if (dragRafRef.current != null) return;
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      bumpDragPaint();
    });
  }, []);

  const [svgSize, setSvgSize] = useState({ w: typeof window !== "undefined" ? window.innerWidth : 800, h: 600 });

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      setSvgSize({ w: r.width || window.innerWidth, h: r.height || window.innerHeight });
    });
    ro.observe(svg);
    const r = svg.getBoundingClientRect();
    setSvgSize({ w: r.width || window.innerWidth, h: r.height || window.innerHeight });
    return () => ro.disconnect();
  }, []);

  const worldBounds = useMemo(
    () => worldBoundsForViewport(viewport.tx, viewport.ty, viewport.scale, svgSize.w, svgSize.h),
    [viewport.tx, viewport.ty, viewport.scale, svgSize.w, svgSize.h],
  );

  const focusNeighborSet = useMemo(
    () => (focusNodeId ? buildFocusNeighborSet(focusNodeId, connections) : null),
    [focusNodeId, connections],
  );

  const nebulaClusters = useMemo(() => computeNebulaClusters(nodes, connections), [nodes, connections]);
  const nebulaIdPrefix = useId().replace(/:/g, "");

  const [linkPointer, setLinkPointer] = useState<{ wx: number; wy: number } | null>(null);
  const pendingDragRelease = useRef<string | null>(null);

  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  /** Pointer position in graph (world) coordinates; null when pointer not over the SVG. */
  const [pointerWorld, setPointerWorld] = useState<{ x: number; y: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; title: string; body: string } | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  const downClientRef = useRef({ x: 0, y: 0 });
  const tapRef = useRef<{ id: string; t: number } | null>(null);

  const reducedConnectionView = !orbitActive && !connectionsVisible && focusNodeId == null;
  const [connHintShow, setConnHintShow] = useState(false);
  const [connHintOpacity, setConnHintOpacity] = useState(1);
  const connHintDoneRef = useRef(false);

  useEffect(() => {
    if (!reducedConnectionView || connHintDoneRef.current) return;
    setConnHintShow(true);
    setConnHintOpacity(1);
    let cancelled = false;
    const tFade = window.setTimeout(() => {
      if (!cancelled) setConnHintOpacity(0);
    }, 4000);
    const tHide = window.setTimeout(() => {
      if (!cancelled) {
        setConnHintShow(false);
        connHintDoneRef.current = true;
      }
    }, 4500);
    return () => {
      cancelled = true;
      window.clearTimeout(tFade);
      window.clearTimeout(tHide);
    };
  }, [reducedConnectionView]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setShiftHeld(e.shiftKey);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  useEffect(() => {
    if (!showHoverTooltip(viewport.scale)) {
      setTooltip(null);
    }
  }, [viewport.scale]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const mx = clientX - r.left;
    const my = clientY - r.top;
    const v = vpRef.current;
    return { x: (mx - v.tx) / v.scale, y: (my - v.ty) / v.scale };
  }, []);

  const nodeMap = useRef(new Map<string, GraphNode>());
  nodeMap.current = new Map(nodes.map((n) => [n.id, n]));

  const isDimmed = (id: string) => visibleNodeIds != null && !visibleNodeIds.has(id);

  function effPos(n: GraphNode): { x: number; y: number } {
    const d = dragPaintRef.current;
    if (d && d.id === n.id) return { x: d.x, y: d.y };
    return { x: n.x, y: n.y };
  }

  const endInteractions = useCallback(() => {
    const lk = linkRef.current;
    const dragId = pendingDragRelease.current;
    const dragSnap = dragRef.current;
    let finalDragWorld: { id: string; x: number; y: number } | null = null;
    if (dragSnap) {
      const w = lastWorldRef.current;
      finalDragWorld = { id: dragSnap.id, x: w.x - dragSnap.ox, y: w.y - dragSnap.oy };
    }
    pendingDragRelease.current = null;
    panRef.current = null;
    dragRef.current = null;
    dragPaintRef.current = null;
    if (dragRafRef.current != null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }

    if (lk) {
      const t = hitTestNode(
        lastWorldRef.current.x,
        lastWorldRef.current.y,
        nodesRef.current,
        connectionCountsRef.current,
        null,
      );
      if (t && t.id !== lk.fromId) {
        onRequestConnection(lk.fromId, t.id, lastClientRef.current.x, lastClientRef.current.y);
      }
      linkRef.current = null;
      setLinkPointer(null);
    } else {
      linkRef.current = null;
      setLinkPointer(null);
    }

    if (dragId) {
      const dx = lastClientRef.current.x - downClientRef.current.x;
      const dy = lastClientRef.current.y - downClientRef.current.y;
      if (dx * dx + dy * dy <= 100) {
        const now = Date.now();
        const tr = tapRef.current;
        if (tr && tr.id === dragId && now - tr.t < 500) {
          onOpenDetail(dragId);
          tapRef.current = null;
        } else {
          tapRef.current = { id: dragId, t: now };
        }
      } else {
        tapRef.current = null;
      }
      if (finalDragWorld && finalDragWorld.id === dragId) {
        onNodeMove(dragId, finalDragWorld.x, finalDragWorld.y);
        releaseSimNode?.(dragId);
        onNodeDragEnd(dragId, finalDragWorld.x, finalDragWorld.y);
      } else {
        onNodeDragEnd(dragId);
      }
      bumpDragPaint();
    }
  }, [onNodeDragEnd, onOpenDetail, onRequestConnection, onNodeMove, releaseSimNode]);

  useEffect(() => {
    window.addEventListener("pointerup", endInteractions);
    window.addEventListener("pointercancel", endInteractions);
    return () => {
      window.removeEventListener("pointerup", endInteractions);
      window.removeEventListener("pointercancel", endInteractions);
    };
  }, [endInteractions]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = vpRef.current;
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const wx = (mx - v.tx) / v.scale;
      const wy = (my - v.ty) / v.scale;
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      const nextScale = Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, v.scale * factor));
      onViewportChange({ scale: nextScale, tx: mx - wx * nextScale, ty: my - wy * nextScale });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [onViewportChange]);

  const trackPointer = (clientX: number, clientY: number) => {
    lastClientRef.current = { x: clientX, y: clientY };
    const w = toWorld(clientX, clientY);
    lastWorldRef.current = w;
    setPointerWorld(w);
  };

  const onPointerMoveSvg = (e: React.PointerEvent) => {
    trackPointer(e.clientX, e.clientY);
    if (panRef.current) {
      const p = panRef.current;
      const dx = e.clientX - p.sx;
      const dy = e.clientY - p.sy;
      onViewportChange({ scale: p.scale, tx: p.tx + dx, ty: p.ty + dy });
      return;
    }
    if (linkRef.current) {
      const w = toWorld(e.clientX, e.clientY);
      setLinkPointer({ wx: w.x, wy: w.y });
      return;
    }
    const d = dragRef.current;
    if (d) {
      const w = toWorld(e.clientX, e.clientY);
      const x = w.x - d.ox;
      const y = w.y - d.oy;
      dragPaintRef.current = { id: d.id, x, y };
      fixSimNode?.(d.id, x, y);
      scheduleDragPaint();
    }
  };

  const onPointerDownBg = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    trackPointer(e.clientX, e.clientY);
    onCloseDetailPanel?.();
    onSelect(null);
    panRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      tx: viewport.tx,
      ty: viewport.ty,
      scale: viewport.scale,
    };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent<SVGGElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const id = e.currentTarget.getAttribute("data-node-id");
      if (!id) return;
      const n = nodeMap.current.get(id);
      if (!n) return;
      trackPointer(e.clientX, e.clientY);
      downClientRef.current = { x: e.clientX, y: e.clientY };
      if (e.shiftKey) {
        linkRef.current = { fromId: n.id };
        setLinkPointer({ wx: n.x, wy: n.y });
        onSelect(n.id);
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      const w = toWorld(e.clientX, e.clientY);
      pendingDragRelease.current = n.id;
      dragRef.current = { id: n.id, ox: w.x - n.x, oy: w.y - n.y };
      dragPaintRef.current = { id: n.id, x: n.x, y: n.y };
      fixSimNode?.(n.id, n.x, n.y);
      bumpDragPaint();
      onSelect(n.id);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [onSelect, toWorld, fixSimNode],
  );

  const handleNodePointerEnter = useCallback((e: React.PointerEvent<SVGGElement>) => {
    const id = e.currentTarget.getAttribute("data-node-id");
    if (!id) return;
    const n = nodeMap.current.get(id);
    if (!n) return;
    setHoverNodeId(id);
    if (!showHoverTooltip(vpRef.current.scale)) {
      setTooltip(null);
      return;
    }
    const body = (n.body ?? "").slice(0, 80);
    setTooltip({
      x: e.clientX + 12,
      y: e.clientY + 12,
      title: n.title,
      body: body + ((n.body?.length ?? 0) > 80 ? "…" : ""),
    });
  }, []);

  const handleNodePointerMove = useCallback((e: React.PointerEvent<SVGGElement>) => {
    const id = e.currentTarget.getAttribute("data-node-id");
    if (!id || hoverNodeId !== id) return;
    setTooltip((t) => (t ? { ...t, x: e.clientX + 12, y: e.clientY + 12 } : t));
  }, [hoverNodeId]);

  const handleNodePointerLeave = useCallback(() => {
    setHoverNodeId(null);
    setTooltip(null);
  }, []);

  const tf = `translate(${viewport.tx},${viewport.ty}) scale(${viewport.scale})`;
  const scale = viewport.scale;
  const linkFromId = linkRef.current?.fromId;
  const linkSource = linkFromId ? nodeMap.current.get(linkFromId) : undefined;
  const lowZoom = scale < LOW_ZOOM_DETAIL;
  const skipEdgeLabelGraphics = lowZoom;

  const handleNodePointerMoveWrapper = useCallback(
    (e: React.PointerEvent<SVGGElement>) => {
      handleNodePointerMove(e);
    },
    [handleNodePointerMove],
  );

  return (
    <div className="pinboard-canvas-wrap">
      <svg
        ref={svgRef}
        role="application"
        aria-label="Pinboard map"
        onPointerMove={onPointerMoveSvg}
        onPointerLeave={() => {
          setPointerWorld(null);
          if (!dragRef.current && !panRef.current && !linkRef.current) {
            setHoverNodeId(null);
            setTooltip(null);
          }
        }}
      >
        <rect x={-1e6} y={-1e6} width={2e6} height={2e6} fill="transparent" onPointerDown={onPointerDownBg} />
        <g transform={tf}>
          <g>
            {connections.map((c) => {
              const sourceNode = nodeMap.current.get(c.source_id);
              const targetNode = nodeMap.current.get(c.target_id);
              if (!sourceNode || !targetNode) return null;
              const p1 = effPos(sourceNode);
              const p2 = effPos(targetNode);
              if (p1.x > 50000 || p1.y > 50000) return null;
              if (p2.x > 50000 || p2.y > 50000) return null;
              if (pointOutsideBounds(p1.x, p1.y, worldBounds) && pointOutsideBounds(p2.x, p2.y, worldBounds)) {
                return null;
              }
              const lineOn = connectionShouldRender(
                c,
                nodeMap.current,
                connectionCounts,
                selectedId,
                focusNodeId,
                focusNeighborSet,
                orbitActive,
                connectionsVisible,
              );
              if (!lineOn) return null;
              const dim = isDimmed(sourceNode.id) || isDimmed(targetNode.id);
              const s3 = c.strength === 3;
              const strokeW = s3 ? 2.5 : 1.5;
              const stroke = s3 ? "#5c8a5c" : "#4a6a4a";
              const op = dim ? 0.12 : s3 ? 0.55 : 0.5;
              const ax = Number.isFinite(p1.x) ? p1.x : 0;
              const ay = Number.isFinite(p1.y) ? p1.y : 0;
              const bx = Number.isFinite(p2.x) ? p2.x : 0;
              const by = Number.isFinite(p2.y) ? p2.y : 0;
              const midX = (ax + bx) / 2;
              const midY = (ay + by) / 2;
              const dx = bx - ax;
              const dy = by - ay;
              const screenDist = Math.hypot(dx, dy) * viewport.scale;
              const labelFitsZoom =
                !lowZoom && screenDist > EDGE_LABEL_MIN_SCREEN_DIST && viewport.scale > EDGE_LABEL_MIN_SCALE;
              const angle = Math.atan2(dy, dx) * (180 / Math.PI);
              const displayAngle = angle > 90 || angle < -90 ? angle + 180 : angle;
              const labelText = (c.label ?? "").trim();
              const hasLabel = labelText.length > 0;
              const nearMid =
                pointerWorld != null &&
                distSq(pointerWorld.x, pointerWorld.y, midX, midY) < EDGE_LABEL_PROXIMITY * EDGE_LABEL_PROXIMITY;
              const touchesSelected =
                (selectedId != null && (c.source_id === selectedId || c.target_id === selectedId)) ||
                (focusNodeId != null && (c.source_id === focusNodeId || c.target_id === focusNodeId));
              const labelProximity = nearMid || touchesSelected;
              const labelOpaque = lineOn && hasLabel && labelFitsZoom && labelProximity;
              return (
                <CanvasMapConnection
                  key={c.id}
                  cid={c.id}
                  ax={ax}
                  ay={ay}
                  bx={bx}
                  by={by}
                  lineOn
                  op={op}
                  stroke={stroke}
                  strokeW={strokeW}
                  midX={midX}
                  midY={midY}
                  displayAngle={displayAngle}
                  scale={viewport.scale}
                  hasLabel={hasLabel}
                  labelText={labelText}
                  labelOpaque={labelOpaque}
                  skipLabelGraphics={skipEdgeLabelGraphics}
                />
              );
            })}
          </g>

          <g style={{ opacity: nebulaGroupOpacity(scale), transition: "opacity 0.5s ease" }}>
            <defs>
              {nebulaClusters.map((cluster, i) => {
                const { dominantType } = nebulaDominantTypeAndLabel(cluster, nodeMap.current);
                const chromaHex = dominantType ? typeColor(dominantType) : "#6a8a6a";
                return (
                  <radialGradient
                    key={`${nebulaIdPrefix}-neb-def-${cluster.nodeIds.slice().sort().join("\0")}`}
                    id={`${nebulaIdPrefix}-neb-${i}`}
                    gradientUnits="userSpaceOnUse"
                    cx={cluster.centroid.x}
                    cy={cluster.centroid.y}
                    r={cluster.radius}
                  >
                    <stop offset="0%" stopColor={chromaHex} stopOpacity={0.12} />
                    <stop offset="50%" stopColor={chromaHex} stopOpacity={0.06} />
                    <stop offset="100%" stopColor={chromaHex} stopOpacity={0} />
                  </radialGradient>
                );
              })}
            </defs>
            {nebulaClusters.map((cluster, i) => {
              if (!nebulaIntersectsViewport(cluster, worldBounds)) return null;
              const { dominantType, labelText } = nebulaDominantTypeAndLabel(cluster, nodeMap.current);
              const chromaHex = dominantType ? typeColor(dominantType) : "#6a8a6a";
              const cx = cluster.centroid.x;
              const cy = cluster.centroid.y;
              const rx = cluster.radius * 1.1;
              const ry = cluster.radius * 0.9;
              const labelFont = Math.min(14 / scale, 60);
              return (
                <g
                  key={`${nebulaIdPrefix}-neb-blob-${cluster.nodeIds.slice().sort().join("\0")}`}
                  pointerEvents="none"
                >
                  <ellipse
                    cx={cx}
                    cy={cy}
                    rx={rx}
                    ry={ry}
                    fill={`url(#${nebulaIdPrefix}-neb-${i})`}
                    pointerEvents="none"
                  />
                  <ellipse
                    cx={cx}
                    cy={cy}
                    rx={rx}
                    ry={ry}
                    fill="none"
                    stroke={hexToRgba(chromaHex, 0.08)}
                    strokeWidth={1 / scale}
                    strokeDasharray="4 8"
                    pointerEvents="none"
                  />
                  {scale < NEBULA_LABEL_MAX_SCALE ? (
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="rgba(200,220,190,0.2)"
                      fontSize={labelFont}
                      fontFamily='Georgia, "Times New Roman", serif'
                      fontStyle="italic"
                      pointerEvents="none"
                    >
                      {labelText}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>

          {linkSource && linkPointer ? (
            <line
              x1={effPos(linkSource).x}
              y1={effPos(linkSource).y}
              x2={linkPointer.wx}
              y2={linkPointer.wy}
              stroke="#d4a853"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              opacity={0.75}
              pointerEvents="none"
            />
          ) : null}

          <g>
            {nodes.map((n) => {
              if (n.x > 50000 || n.y > 50000) return null;
              const { x: tx, y: ty } = effPos(n);
              const connCount = connectionCounts.get(n.id) ?? 0;
              const nodeRadius = nodeRadiusFromConnectionCount(connCount);
              const forceDraw = dragPaintRef.current?.id === n.id || linkFromId === n.id;
              if (!forceDraw && !nodeCircleIntersectsBounds(tx, ty, nodeRadius, worldBounds)) {
                return null;
              }
              const col = typeColor(n.type);
              const fill = hexToRgba(col, 0.7);
              const dim = isDimmed(n.id);
              const isQ = n.type === "QUESTION";
              const sel = selectedId === n.id;
              const enter = !lowZoom && entranceNodeIds.has(n.id);
              const showBadge = !lowZoom && (typesHeld || sel);
              const showTitle = titleVisibleForNode(scale, selectedId, n.id);
              const showQGlyph = !lowZoom && isQ && scale >= 0.2 && (scale > 0.45 || sel);
              const inCluster = focusNeighborSet?.has(n.id) ?? true;
              let nodeOpacity = 1;
              if (focusNodeId) {
                nodeOpacity = inCluster ? 1 : 0.06;
              } else if (dim) {
                nodeOpacity = 0.2;
              }
              const isFocused = focusNodeId === n.id;
              const showSelRing = sel;
              return (
                <CanvasMapNode
                  key={n.id}
                  nodeId={n.id}
                  tx={tx}
                  ty={ty}
                  title={n.title}
                  typeName={n.type}
                  isQ={isQ}
                  col={col}
                  fill={fill}
                  nodeRadius={nodeRadius}
                  nodeOpacity={nodeOpacity}
                  sel={sel}
                  showBadge={showBadge}
                  showTitle={showTitle}
                  showQGlyph={showQGlyph}
                  showEntranceAnim={enter}
                  isFocused={isFocused}
                  showSelRing={showSelRing}
                  scale={scale}
                  shiftHeld={shiftHeld}
                  onPointerDown={handleNodePointerDown}
                  onPointerEnter={handleNodePointerEnter}
                  onPointerMove={handleNodePointerMoveWrapper}
                  onPointerLeave={handleNodePointerLeave}
                />
              );
            })}
          </g>
        </g>
      </svg>

      {connHintShow ? (
        <div
          className="pinboard-ui-label"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 56,
            transform: "translateX(-50%)",
            zIndex: 79,
            pointerEvents: "none",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 10,
            color: "rgba(200,220,190,0.25)",
            opacity: connHintOpacity,
            transition: "opacity 0.5s ease",
            textAlign: "center",
            maxWidth: "min(420px, 90vw)",
            lineHeight: 1.35,
          }}
        >
          Showing key connections — select a node or press O for full view
        </div>
      ) : null}

      {tooltip && showHoverTooltip(viewport.scale) ? (
        <WobblyPanel
          padding="8px 10px"
          minHeight={0}
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
            zIndex: 250,
            maxWidth: 300,
            pointerEvents: "none",
          }}
        >
          <p style={{ fontFamily: "Georgia, serif", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{tooltip.title}</p>
          {tooltip.body ? (
            <p style={{ fontSize: 12, color: "#a8c8a0", lineHeight: 1.35 }}>{tooltip.body}</p>
          ) : null}
        </WobblyPanel>
      ) : null}
    </div>
  );
}
