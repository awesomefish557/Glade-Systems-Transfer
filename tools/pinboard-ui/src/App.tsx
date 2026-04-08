import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForceSimulation } from "./hooks/useForceSimulation";
import { useLocation, useNavigate } from "react-router-dom";
import {
  API_BASE,
  createConnection,
  createNode,
  fetchGraph,
  fetchLoadingBay,
  patchNodePosition,
  postResolve,
  tutorScan,
} from "./api";
import type { AddNodeDraft, GraphConnection, GraphNode, GraphNodeType } from "./types";
import { AddNodeModal } from "./components/AddNodeModal";
import { AmbientBackground } from "./components/AmbientBackground";
import { ConnectionPopover } from "./components/ConnectionPopover";
import { ExploreNextView } from "./components/ExploreNextView";
import { GrassFooter } from "./components/GrassFooter";
import { HotkeyLegend } from "./components/HotkeyLegend";
import { ListView } from "./components/ListView";
import { LoadingBayOverlay } from "./components/LoadingBayOverlay";
import { NodeDetailPanel } from "./components/NodeDetailPanel";
import {
  PinboardCanvas,
  type Viewport,
  CANVAS_ZOOM_MAX,
  CANVAS_ZOOM_MIN,
  nodeRadiusFromConnectionCount,
} from "./components/PinboardCanvas";
import type { MainTab } from "./components/PinboardNav";
import { PinboardNav } from "./components/PinboardNav";
import { SearchOverlay } from "./components/SearchOverlay";
import { SvgRoughDefs } from "./components/SvgRoughDefs";
import { MapSelector } from "./components/MapSelector";
import { Toolbar } from "./components/Toolbar";
import { GRAPH_REFRESH_EVENT } from "./graphRefresh";

function screenCenterWorld(vp: Viewport): { x: number; y: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    x: (w / 2 - vp.tx) / vp.scale,
    y: (h / 2 - vp.ty) / vp.scale,
  };
}

function centerViewportOnNode(n: GraphNode, vp: Viewport): Viewport {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    scale: vp.scale,
    tx: w / 2 - n.x * vp.scale,
    ty: h / 2 - n.y * vp.scale,
  };
}

function uniqueNeighbors(centerId: string, conns: GraphConnection[]): string[] {
  const s = new Set<string>();
  for (const c of conns) {
    if (c.source_id === centerId) s.add(c.target_id);
    if (c.target_id === centerId) s.add(c.source_id);
  }
  return [...s];
}

function buildConnectionCountsMap(nodes: GraphNode[], connections: GraphConnection[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of nodes) m.set(n.id, 0);
  for (const c of connections) {
    m.set(c.source_id, (m.get(c.source_id) ?? 0) + 1);
    m.set(c.target_id, (m.get(c.target_id) ?? 0) + 1);
  }
  return m;
}

function fitViewportToCluster(
  clusterNodeIds: Set<string>,
  positioned: GraphNode[],
  counts: ReadonlyMap<string, number>,
  fallback: Viewport,
): Viewport {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of positioned) {
    if (!clusterNodeIds.has(n.id)) continue;
    const r = nodeRadiusFromConnectionCount(counts.get(n.id) ?? 0);
    minX = Math.min(minX, n.x - r);
    maxX = Math.max(maxX, n.x + r);
    minY = Math.min(minY, n.y - r);
    maxY = Math.max(maxY, n.y + r);
  }
  if (!Number.isFinite(minX)) return fallback;
  const pad = 80;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const bw = maxX - minX + 2 * pad;
  const bh = maxY - minY + 2 * pad;
  const scale = Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, Math.min(w / bw, h / bh)));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { scale, tx: w / 2 - cx * scale, ty: h / 2 - cy * scale };
}

function buildVisibleNodeIds(nodes: GraphNode[], filter: string | "ALL", search: string): Set<string> | null {
  const q = search.trim().toLowerCase();
  if (filter === "ALL" && !q) return null;
  return new Set(
    nodes
      .filter((n) => {
        if (filter !== "ALL" && n.type !== filter) return false;
        if (!q) return true;
        return n.title.toLowerCase().includes(q) || (n.body?.toLowerCase().includes(q) ?? false);
      })
      .map((n) => n.id),
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const loadingBayRoute = location.pathname === "/loading-bay";

  const [mainTab, setMainTab] = useState<MainTab>("map");
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [connections, setConnections] = useState<GraphConnection[]>([]);
  const [nodeTypes, setNodeTypes] = useState<GraphNodeType[]>([]);
  const [viewport, setViewport] = useState<Viewport>(() => ({
    scale: 1,
    tx: typeof window !== "undefined" ? window.innerWidth / 2 : 400,
    ty: typeof window !== "undefined" ? window.innerHeight / 2 : 300,
  }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailPanelNodeId, setDetailPanelNodeId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | "ALL">("ALL");
  const [searchOpen, setSearchOpen] = useState(false);
  /** Draft text while the search overlay is open. */
  const [searchQuery, setSearchQuery] = useState("");
  /** Committed search string when the overlay is closed (visual filter persists on the canvas). */
  const [lockedSearchQuery, setLockedSearchQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addPrefill, setAddPrefill] = useState<AddNodeDraft | null>(null);
  const [addModalKey, setAddModalKey] = useState(0);
  const [loadingBayCount, setLoadingBayCount] = useState(0);
  const [tutorLoading, setTutorLoading] = useState(false);
  const [connectionPopover, setConnectionPopover] = useState<{
    sourceId: string;
    targetId: string;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [entranceIds, setEntranceIds] = useState<Set<string>>(new Set());
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [connectionsVisible, setConnectionsVisible] = useState(false);
  const [typesHeld, setTypesHeld] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [orbitActive, setOrbitActive] = useState(false);
  const [mapId, setMapId] = useState("default");
  const [simPositions, setSimPositions] = useState<Map<string, { x: number; y: number }>>(() => new Map());
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const initiallyUnplacedRef = useRef<Set<string>>(new Set());

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const focusNodeIdRef = useRef(focusNodeId);
  focusNodeIdRef.current = focusNodeId;
  const orbitActiveRef = useRef(false);
  const orbitSnapshotRef = useRef<{
    pos: Map<string, { x: number; y: number }>;
    viewport: Viewport;
  } | null>(null);

  const patchTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const onSimTick = useCallback((positions: Map<string, { x: number; y: number }>) => {
    setSimPositions(positions);
  }, []);

  const onSimSettle = useCallback(async (positions: Map<string, { x: number; y: number }>) => {
    const toSave = [...initiallyUnplacedRef.current];
    if (toSave.length > 0) {
      await Promise.all(
        toSave.map((id) => {
          const p = positions.get(id);
          if (!p) return Promise.resolve();
          return patchNodePosition(id, p.x, p.y);
        }),
      );
      initiallyUnplacedRef.current.clear();
    }
    setNodes((prev) =>
      prev.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, x: p.x, y: p.y } : n;
      }),
    );
    setSimPositions(new Map(positions));
  }, []);

  const { fixNode, releaseNode } = useForceSimulation(
    nodes,
    connections,
    orbitActive,
    layoutEpoch,
    onSimTick,
    onSimSettle,
  );

  const loadGraph = useCallback(async () => {
    setLoadErr(null);
    try {
      const g = await fetchGraph(mapId);
      setNodes(g.nodes);
      setConnections(g.connections);
      setNodeTypes(g.nodeTypes ?? []);
      initiallyUnplacedRef.current = new Set(
        g.nodes.filter((n) => n.x === 0 && n.y === 0).map((n) => n.id),
      );
      setSimPositions(new Map());
      setLayoutEpoch((e) => e + 1);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [mapId]);

  useEffect(() => {
    orbitSnapshotRef.current = null;
    orbitActiveRef.current = false;
    setOrbitActive(false);
    setSelectedId(null);
    setFocusNodeId(null);
    setDetailPanelNodeId(null);
    setFilterType("ALL");
  }, [mapId]);

  const typeColor = useCallback(
    (typeName: string) => {
      const t = nodeTypes.find((x) => x.name === typeName);
      return t?.color ?? "#888888";
    },
    [nodeTypes],
  );

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const refreshLoadingBayCount = useCallback(() => {
    fetchLoadingBay()
      .then((rows) => setLoadingBayCount(rows.length))
      .catch(() => setLoadingBayCount(0));
  }, []);

  useEffect(() => {
    refreshLoadingBayCount();
    const id = setInterval(refreshLoadingBayCount, 30_000);
    return () => clearInterval(id);
  }, [refreshLoadingBayCount]);

  useEffect(() => {
    const onRefresh = () => void loadGraph();
    window.addEventListener(GRAPH_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(GRAPH_REFRESH_EVENT, onRefresh);
  }, [loadGraph]);

  const effectiveSearch = searchOpen ? searchQuery : lockedSearchQuery;

  const displayNodes = useMemo(() => {
    if (orbitActive) return nodes;
    return nodes.map((n) => {
      const pos = simPositions.get(n.id);
      return pos ? { ...n, x: pos.x, y: pos.y } : n;
    });
  }, [nodes, simPositions, orbitActive]);

  const displayNodesRef = useRef(displayNodes);
  displayNodesRef.current = displayNodes;

  const visibleNodeIds = useMemo(
    () => buildVisibleNodeIds(displayNodes, filterType, effectiveSearch),
    [displayNodes, filterType, effectiveSearch],
  );

  const connectionCounts = useMemo(
    () => buildConnectionCountsMap(displayNodes, connections),
    [displayNodes, connections],
  );

  const exitOrbit = useCallback(() => {
    const snap = orbitSnapshotRef.current;
    orbitSnapshotRef.current = null;
    orbitActiveRef.current = false;
    setOrbitActive(false);
    if (!snap) return;
    setNodes((prev) =>
      prev.map((n) => {
        const p = snap.pos.get(n.id);
        return p ? { ...n, x: p.x, y: p.y } : n;
      }),
    );
    setViewport(snap.viewport);
  }, []);

  const enterOrbit = useCallback(() => {
    if (orbitActiveRef.current) return;
    const centerId = selectedIdRef.current ?? focusNodeIdRef.current;
    if (!centerId) return;

    const curNodes = displayNodesRef.current;
    const curVp = viewportRef.current;
    const curConns = connectionsRef.current;

    const center = curNodes.find((n) => n.id === centerId);
    if (!center) return;

    const neighborIds = uniqueNeighbors(centerId, curConns);
    const nCount = Math.max(neighborIds.length, 1);
    const angleStep = (2 * Math.PI) / nCount;

    const neighborPos = new Map<string, { x: number; y: number }>();
    neighborIds.forEach((nid, i) => {
      const ang = angleStep * i - Math.PI / 2;
      neighborPos.set(nid, {
        x: center.x + Math.cos(ang) * 260,
        y: center.y + Math.sin(ang) * 260,
      });
    });

    orbitSnapshotRef.current = {
      pos: new Map(curNodes.map((n) => [n.id, { x: n.x, y: n.y }])),
      viewport: { ...curVp },
    };

    const newNodes = curNodes.map((n) => {
      if (n.id === centerId) return n;
      const np = neighborPos.get(n.id);
      if (np) return { ...n, ...np };
      return { ...n, x: 99999, y: 99999 };
    });

    const counts = buildConnectionCountsMap(nodesRef.current, curConns);
    const clusterIds = new Set([centerId, ...neighborIds]);

    const vpCentered = centerViewportOnNode(center, curVp);
    const vpFit = fitViewportToCluster(clusterIds, newNodes, counts, vpCentered);

    orbitActiveRef.current = true;
    setOrbitActive(true);
    setNodes(newNodes);
    setViewport(vpFit);
  }, []);

  const handleCanvasSelect = useCallback((id: string | null) => {
    if (id === null) {
      setFocusNodeId(null);
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev === id) {
        setFocusNodeId(id);
      } else {
        setFocusNodeId(null);
      }
      return id;
    });
  }, []);

  useEffect(() => {
    if (mainTab !== "map") return;
    const typingTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (typingTarget(e.target)) return;
      if (e.key === "Escape") {
        if (orbitActiveRef.current) {
          e.preventDefault();
          exitOrbit();
        }
        return;
      }
      if (e.key === "f" || e.key === "F") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (orbitActiveRef.current) return;
        e.preventDefault();
        const sid = selectedIdRef.current;
        if (!sid) return;
        setFocusNodeId((prev) => (prev === sid ? null : sid));
        return;
      }
      if (e.key === "o" || e.key === "O") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        if (orbitActiveRef.current) {
          exitOrbit();
          return;
        }
        const cid = selectedIdRef.current ?? focusNodeIdRef.current;
        if (cid) enterOrbit();
        return;
      }
      if (e.key === "c" || e.key === "C") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        setConnectionsVisible((v) => !v);
      }
      if (e.key === "t" || e.key === "T") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!e.repeat) setTypesHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "t" || e.key === "T") setTypesHeld(false);
    };
    const onBlur = () => setTypesHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [mainTab, enterOrbit, exitOrbit]);

  useEffect(() => {
    if (mainTab !== "map") exitOrbit();
  }, [mainTab, exitOrbit]);

  const commitSearchAndClose = useCallback(() => {
    setLockedSearchQuery(searchQuery.trim());
    setSearchOpen(false);
  }, [searchQuery]);

  const clearSearchFilter = useCallback(() => {
    setLockedSearchQuery("");
    setSearchQuery("");
  }, []);

  const onSearchButton = useCallback(() => {
    if (searchOpen) {
      commitSearchAndClose();
      return;
    }
    if (lockedSearchQuery.trim()) {
      clearSearchFilter();
      return;
    }
    setSearchOpen(true);
    setSearchQuery(lockedSearchQuery);
  }, [searchOpen, lockedSearchQuery, commitSearchAndClose, clearSearchFilter]);

  const nodeIndex = useMemo(() => new Map(displayNodes.map((n) => [n.id, n])), [displayNodes]);

  const onNodeMove = useCallback((id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }, []);

  const onResolve = useCallback(async () => {
    if (resolveBusy) return;
    exitOrbit();
    setResolveBusy(true);
    try {
      const { positions } = await postResolve(mapId);
      for (const t of patchTimers.current.values()) clearTimeout(t);
      patchTimers.current.clear();
      const entries = Object.entries(positions).filter(
        ([, p]) => p && typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y),
      );
      await Promise.all(entries.map(([id, p]) => patchNodePosition(id, p.x, p.y)));
      const g = await fetchGraph(mapId);
      setNodes(g.nodes);
      setConnections(g.connections);
      initiallyUnplacedRef.current = new Set(
        g.nodes.filter((n) => n.x === 0 && n.y === 0).map((n) => n.id),
      );
      setSimPositions(new Map());
      setLayoutEpoch((e) => e + 1);
    } catch (e) {
      console.error(e);
    } finally {
      setResolveBusy(false);
    }
  }, [resolveBusy, exitOrbit, mapId]);

  const onNodeDragEnd = useCallback((id: string, finalX?: number, finalY?: number) => {
    if (orbitActiveRef.current) return;
    if (finalX !== undefined && finalY !== undefined) {
      void patchNodePosition(id, finalX, finalY).catch((e) => console.error(e));
      return;
    }
    const n = nodesRef.current.find((x) => x.id === id);
    if (!n) return;
    const prev = patchTimers.current.get(id);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      patchTimers.current.delete(id);
      void patchNodePosition(id, n.x, n.y).catch((e) => console.error(e));
    }, 500);
    patchTimers.current.set(id, t);
  }, []);

  const onRequestConnection = useCallback((sourceId: string, targetId: string, clientX: number, clientY: number) => {
    setConnectionPopover({ sourceId, targetId, clientX, clientY });
  }, []);

  const submitConnection = useCallback(
    async (label: string) => {
      if (!connectionPopover) return;
      const { sourceId, targetId } = connectionPopover;
      setConnectionPopover(null);
      try {
        const c = await createConnection(sourceId, targetId, label || null, 1);
        setConnections((prev) => [...prev, c]);
      } catch (e) {
        console.error(e);
      }
    },
    [connectionPopover],
  );

  const onTutor = useCallback(async () => {
    exitOrbit();
    setTutorLoading(true);
    try {
      const before = new Set(nodesRef.current.map((n) => n.id));
      await tutorScan(mapId);
      const g = await fetchGraph(mapId);
      setNodes(g.nodes);
      setConnections(g.connections);
      initiallyUnplacedRef.current = new Set(
        g.nodes.filter((n) => n.x === 0 && n.y === 0).map((n) => n.id),
      );
      setSimPositions(new Map());
      setLayoutEpoch((e) => e + 1);
      const newOnes = g.nodes.filter((n) => !before.has(n.id)).map((n) => n.id);
      setEntranceIds(new Set(newOnes));
      window.setTimeout(() => setEntranceIds(new Set()), 2600);
    } catch (e) {
      console.error(e);
    } finally {
      setTutorLoading(false);
    }
  }, [exitOrbit, mapId]);

  const onPanToNode = useCallback((id: string) => {
    setViewport((vp) => {
      const n = displayNodesRef.current.find((x) => x.id === id);
      if (!n) return vp;
      return centerViewportOnNode(n, vp);
    });
  }, []);

  const openAddBlank = useCallback(() => {
    setAddPrefill(null);
    setAddModalKey((k) => k + 1);
    setAddOpen(true);
  }, []);

  const openAddWithDraft = useCallback((draft: AddNodeDraft) => {
    setAddPrefill(draft);
    setAddModalKey((k) => k + 1);
    setAddOpen(true);
  }, []);

  const worldForAdd = screenCenterWorld(viewport);

  const onViewOnMapFromList = useCallback((id: string) => {
    setMainTab("map");
    onPanToNode(id);
  }, [onPanToNode]);

  if (loadingBayRoute) {
    return (
      <>
        <SvgRoughDefs />
        <LoadingBayOverlay
          mapId={mapId}
          onClose={() => navigate("/")}
          onListChanged={refreshLoadingBayCount}
        />
      </>
    );
  }

  return (
    <>
      <SvgRoughDefs />
      <AmbientBackground />
      <MapSelector
        mapId={mapId}
        onMapIdChange={setMapId}
        nodeTypes={nodeTypes}
        onNodeTypesChange={setNodeTypes}
      />
      <PinboardNav tab={mainTab} onTab={setMainTab} />
      <div className="pinboard-main-pad">
        <div className="pinboard-shell">
          {mainTab === "map" ? (
            <>
              <Toolbar
                topOffset={64}
                nodeTypes={nodeTypes}
                filterType={filterType}
                onFilterType={setFilterType}
                onAddNode={openAddBlank}
                onSearch={onSearchButton}
                searchFilterActive={lockedSearchQuery.trim().length > 0}
                loadingBayCount={loadingBayCount}
                onLoadingBay={() => navigate("/loading-bay")}
                tutorLoading={tutorLoading}
                onTutorScan={() => void onTutor()}
                onResolve={() => void onResolve()}
                resolveBusy={resolveBusy}
              />

              {loadErr ? (
                <div
                  className="pinboard-ui-label"
                  style={{
                    position: "fixed",
                    bottom: 72,
                    left: 16,
                    right: 16,
                    zIndex: 70,
                    color: "#cc8888",
                    fontSize: 12,
                    textAlign: "center",
                  }}
                >
                  {loadErr}
                  {import.meta.env.DEV && !import.meta.env.VITE_API_BASE ? (
                    <>
                      {" "}
                      Run <code style={{ color: "#a8c8a0" }}>cd pinboard-api && npx wrangler dev</code> (proxied via Vite as /api).
                    </>
                  ) : (
                    <>
                      {" "}
                      API: {API_BASE || "(same origin /api)"}
                    </>
                  )}
                </div>
              ) : null}

              <PinboardCanvas
                typeColor={typeColor}
                nodes={displayNodes}
                connections={connections}
                connectionCounts={connectionCounts}
                viewport={viewport}
                onViewportChange={setViewport}
                selectedId={selectedId}
                focusNodeId={focusNodeId}
                onSelect={handleCanvasSelect}
                onOpenDetail={(id) => {
                  setSelectedId(id);
                  setDetailPanelNodeId(id);
                }}
                onCloseDetailPanel={() => setDetailPanelNodeId(null)}
                onNodeMove={onNodeMove}
                onNodeDragEnd={onNodeDragEnd}
                fixSimNode={fixNode}
                releaseSimNode={releaseNode}
                visibleNodeIds={visibleNodeIds}
                entranceNodeIds={entranceIds}
                onRequestConnection={onRequestConnection}
                connectionsVisible={connectionsVisible}
                orbitActive={orbitActive}
                typesHeld={typesHeld}
              />
              {orbitActive ? (
                <div
                  className="pinboard-ui-label"
                  style={{
                    position: "fixed",
                    top: 52,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 75,
                    fontFamily: "Georgia, serif",
                    fontSize: 13,
                    color: "#d4a853",
                    opacity: 0.88,
                    pointerEvents: "none",
                    textAlign: "center",
                    letterSpacing: "0.02em",
                  }}
                >
                  ◎ Orbit mode — press O or Esc to exit
                </div>
              ) : null}
              <HotkeyLegend />
            </>
          ) : null}

          {mainTab === "list" ? (
            <ListView
              nodeTypes={nodeTypes}
              nodes={nodes}
              connections={connections}
              onOpenNode={(id) => {
                setSelectedId(id);
                setDetailPanelNodeId(id);
              }}
              onViewOnMap={onViewOnMapFromList}
            />
          ) : null}

          {mainTab === "explore" ? (
            <ExploreNextView
              mapId={mapId}
              nodeTypeNames={nodeTypes.map((t) => t.name)}
              nodes={nodes}
              connections={connections}
              onAddToMap={openAddWithDraft}
              onGraphRefresh={loadGraph}
            />
          ) : null}

          {detailPanelNodeId ? (
            <NodeDetailPanel
              typeColor={typeColor}
              nodeId={detailPanelNodeId}
              nodeIndex={nodeIndex}
              onClose={() => setDetailPanelNodeId(null)}
              onDeleted={() => void loadGraph()}
              onUpdated={(n) => {
                setNodes((prev) => prev.map((x) => (x.id === n.id ? n : x)));
              }}
              onPanToNode={(id) => {
                setMainTab("map");
                onPanToNode(id);
              }}
            />
          ) : null}

          {addOpen ? (
            <AddNodeModal
              key={addModalKey}
              nodeTypes={nodeTypes}
              worldX={worldForAdd.x}
              worldY={worldForAdd.y}
              initialDraft={addPrefill}
              onClose={() => {
                setAddOpen(false);
                setAddPrefill(null);
              }}
              onCreate={async (payload) => {
                const n = await createNode({ ...payload, map_id: mapId });
                setNodes((prev) => [...prev, n]);
                if (n.x === 0 && n.y === 0) initiallyUnplacedRef.current.add(n.id);
              }}
            />
          ) : null}

          {searchOpen ? (
            <SearchOverlay
              value={searchQuery}
              onChange={setSearchQuery}
              onCommit={commitSearchAndClose}
              onAbandonClear={() => {
                setLockedSearchQuery("");
                setSearchQuery("");
                setSearchOpen(false);
              }}
              onCancel={() => setSearchOpen(false)}
            />
          ) : null}

          {connectionPopover ? (
            <ConnectionPopover
              clientX={connectionPopover.clientX}
              clientY={connectionPopover.clientY}
              onCancel={() => setConnectionPopover(null)}
              onSubmit={(label) => void submitConnection(label)}
            />
          ) : null}

          {false && <GrassFooter />}
        </div>
      </div>
    </>
  );
}
