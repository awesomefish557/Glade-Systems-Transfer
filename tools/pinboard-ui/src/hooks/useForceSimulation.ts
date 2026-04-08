import * as d3 from "d3";
import { useCallback, useEffect, useRef } from "react";
import type { GraphConnection, GraphNode } from "../types";

type SimNode = d3.SimulationNodeDatum & { id: string };

export function useForceSimulation(
  nodes: GraphNode[],
  connections: GraphConnection[],
  orbitActive: boolean,
  layoutEpoch: number,
  onTick: (positions: Map<string, { x: number; y: number }>) => void,
  onSettle: (positions: Map<string, { x: number; y: number }>) => void | Promise<void>,
) {
  const simRef = useRef<d3.Simulation<SimNode, undefined> | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;

  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

  const nodeIdSig = [...nodes].map((n) => n.id).sort().join(",");
  const connIdSig = [...connections].map((c) => c.id).sort().join(",");

  useEffect(() => {
    const latestNodes = nodesRef.current;
    const latestConns = connectionsRef.current;

    if (orbitActive || latestNodes.length === 0) {
      simRef.current?.stop();
      simRef.current = null;
      return;
    }

    simRef.current?.stop();

    const simNodes: SimNode[] = latestNodes.map((n) => ({
      id: n.id,
      x: n.x === 0 && n.y === 0 ? (Math.random() - 0.5) * 100 : n.x,
      y: n.x === 0 && n.y === 0 ? (Math.random() - 0.5) * 100 : n.y,
      fx: n.x !== 0 || n.y !== 0 ? n.x : undefined,
      fy: n.x !== 0 || n.y !== 0 ? n.y : undefined,
    }));

    const idSet = new Set(simNodes.map((n) => n.id));
    const simLinks = latestConns
      .filter((c) => idSet.has(c.source_id) && idSet.has(c.target_id))
      .map((c) => ({
        source: c.source_id,
        target: c.target_id,
      }));

    const sim = d3
      .forceSimulation(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, d3.SimulationLinkDatum<SimNode>>(simLinks)
          .id((d) => d.id)
          .distance(320)
          .strength(0.4),
      )
      .force(
        "charge",
        d3
          .forceManyBody()
          .strength(-2200)
          .theta(0.9)
          .distanceMax(600)
          .distanceMin(40),
      )
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius(52).strength(0.85).iterations(3),
      )
      .force("center", d3.forceCenter(0, 0).strength(0.04))
      .alphaDecay(0.015)
      .velocityDecay(0.4);

    let initialSettleHandled = false;

    sim.on("tick", () => {
      const positions = new Map<string, { x: number; y: number }>();
      for (const n of simNodes) {
        positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
      }
      onTickRef.current(positions);
    });

    sim.on("end", () => {
      if (initialSettleHandled) return;
      initialSettleHandled = true;
      const positions = new Map<string, { x: number; y: number }>();
      for (const n of simNodes) {
        positions.set(n.id, { x: Math.round(n.x ?? 0), y: Math.round(n.y ?? 0) });
      }
      void Promise.resolve(onSettleRef.current(positions)).then(() => {
        for (const sn of simNodes) {
          sn.fx = undefined;
          sn.fy = undefined;
        }
        if (simRef.current !== sim) return;
        sim.alpha(0.25).restart();
      });
    });

    simRef.current = sim;

    return () => {
      sim.stop();
      if (simRef.current === sim) simRef.current = null;
    };
  }, [nodeIdSig, connIdSig, orbitActive, layoutEpoch]);

  const fixNode = useCallback((id: string, x: number, y: number) => {
    if (!simRef.current) return;
    const list = simRef.current.nodes();
    const n = list.find((node) => node.id === id);
    if (!n) return;
    n.fx = x;
    n.fy = y;
    n.x = x;
    n.y = y;
    simRef.current.alpha(0.1).restart();
  }, []);

  const releaseNode = useCallback((id: string) => {
    if (!simRef.current) return;
    const list = simRef.current.nodes();
    const n = list.find((node) => node.id === id);
    if (!n) return;
    n.fx = undefined;
    n.fy = undefined;
  }, []);

  return { fixNode, releaseNode };
}
