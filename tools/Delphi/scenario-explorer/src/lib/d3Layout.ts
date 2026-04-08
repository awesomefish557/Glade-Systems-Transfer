import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
} from 'd3-force'
import { estimateOrganicExtents } from './organicMindMap'
import type { GraphEdge, GraphNode, ResolvedVersion } from '../types'

type SimNode = {
  id: string
  x: number
  y: number
  vx?: number
  vy?: number
  index?: number
  fx?: number | null
  fy?: number | null
}

type ResolvedSimNode = SimNode & { layer: number; targetRadius: number }

function collisionRadius(n: GraphNode): number {
  if (n.width != null && n.height != null && n.width > 0 && n.height > 0) {
    return Math.min(78, Math.hypot(n.width, n.height) * 0.4 + 8)
  }
  const { hw, hh } = estimateOrganicExtents(n)
  return Math.min(78, Math.hypot(hw, hh) + 12)
}

/** Lazy explore: collision floor 45px (can grow with node size). */
function exploreCollideRadius(n: GraphNode): number {
  return Math.max(45, collisionRadius(n))
}

function toSimNodes(nodes: GraphNode[], centerX: number, centerY: number): SimNode[] {
  return nodes.map((n, i) => ({
    id: n.id,
    x: Number.isFinite(n.x) ? n.x : centerX + (i % 9) * 6,
    y: Number.isFinite(n.y) ? n.y : centerY + (i % 6) * 6,
  }))
}

function simToPositionMap(simNodes: SimNode[]): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>()
  for (const sn of simNodes) {
    m.set(sn.id, { x: sn.x, y: sn.y })
  }
  return m
}

export type MergeForceOptions = {
  /** Weight of the new force position; old position weight is `1 - blendNew`. Default 1 (full replace). */
  blendNew?: number
}

/**
 * Apply d3-force positions onto graph nodes (immutable).
 * Use blendNew &lt; 1 after structural edits to reduce jarring jumps.
 */
export function mergeForcePositions(
  nodes: GraphNode[],
  pos: Map<string, { x: number; y: number }>,
  options?: MergeForceOptions,
): GraphNode[] {
  const b = options?.blendNew ?? 1
  const o = 1 - b
  return nodes.map((n) => {
    const p = pos.get(n.id)
    if (!p) return n
    if (b >= 1) return { ...n, x: p.x, y: p.y }
    return { ...n, x: n.x * o + p.x * b, y: n.y * o + p.y * b }
  })
}

function buildExploreSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerX: number,
  centerY: number,
) {
  const simNodes = toSimNodes(nodes, centerX, centerY)
  const byId = new Map(simNodes.map((n) => [n.id, n]))
  const links = edges
    .map((e) => {
      const s = byId.get(e.from)
      const t = byId.get(e.to)
      if (!s || !t) return null
      return { source: s, target: t }
    })
    .filter((x): x is { source: SimNode; target: SimNode } => x != null)

  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  return {
    sim: forceSimulation(simNodes)
      .force(
        'link',
        forceLink<SimNode, { source: SimNode; target: SimNode }>(links)
          .id((d) => d.id)
          .distance(140)
          .strength(0.25),
      )
      .force('charge', forceManyBody().strength(-350))
      .force('center', forceCenter(centerX, centerY).strength(0.05))
      .force(
        'collide',
        forceCollide<SimNode>()
          .radius((d) => exploreCollideRadius(nodeById.get(d.id)!))
          .iterations(2),
      )
      .velocityDecay(0.5)
      .stop(),
    simNodes,
  }
}

/**
 * Exploration: light repulsion, weak links, few ticks — casual layout, easy to drag.
 */
export function runForceLayoutExplore(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerX: number,
  centerY: number,
): Map<string, { x: number; y: number }> {
  return runForceLayoutExploreTicks(nodes, edges, centerX, centerY, 20)
}

/** Run only `tickCount` simulation steps (e.g. 1–2 after node drag). */
export function runForceLayoutExploreTicks(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerX: number,
  centerY: number,
  tickCount: number,
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map()
  const { sim, simNodes } = buildExploreSimulation(nodes, edges, centerX, centerY)
  sim.alpha(Math.min(0.8, 0.25 + tickCount * 0.04))
  const n = Math.max(0, Math.floor(tickCount))
  for (let i = 0; i < n; i++) sim.tick()

  if (import.meta.env.DEV && tickCount >= 15) {
    console.log('[d3-force] explore', { ticks: n, alpha: sim.alpha(), nodes: nodes.length })
  }

  return simToPositionMap(simNodes)
}

/**
 * Resolved snapshot: radial hierarchy (root center → ring 1 → ring 2 → outer orphans).
 */
export function runForceLayoutResolved(
  positionedNodes: GraphNode[],
  edges: GraphEdge[],
  v: ResolvedVersion,
  centerX = 400,
  centerY = 300,
): GraphNode[] {
  if (positionedNodes.length === 0) return positionedNodes

  const rootId = v.rootId
  const assumptions = v.structure.assumptions
  const primaries = v.structure.primaryConsequences
  const paths = v.structure.actionPaths
  const orphans = v.structure.orphans

  const layer1Ids = new Set([...assumptions.map((n) => n.id), ...primaries.map((n) => n.id)])
  const pathDecisionIds = new Set(paths.map((p) => p.decision.id))
  const pathChildIds = new Set(paths.flatMap((p) => p.children.map((c) => c.id)))
  const orphanIds = new Set(orphans.map((o) => o.id))

  const layerOf = (id: string): number => {
    if (id === rootId) return 0
    if (layer1Ids.has(id)) return 1
    if (orphanIds.has(id)) return 3
    return 2
  }

  const targetRadiusFor = (id: string, layer: number): number => {
    if (layer === 0) return 0
    if (layer === 1) return 200
    if (layer === 2) {
      return pathChildIds.has(id) && !pathDecisionIds.has(id) ? 385 : 400
    }
    return 500
  }

  const simMap = new Map<string, ResolvedSimNode>()
  const decisionAngle = new Map<string, number>()

  simMap.set(rootId, {
    id: rootId,
    x: centerX,
    y: centerY,
    layer: 0,
    targetRadius: 0,
  })

  const l1 = [...assumptions, ...primaries]
  const n1 = Math.max(l1.length, 1)
  l1.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n1 - Math.PI / 2
    const r = 200
    simMap.set(node.id, {
      id: node.id,
      x: centerX + r * Math.cos(angle),
      y: centerY + r * Math.sin(angle),
      layer: 1,
      targetRadius: 200,
    })
  })

  const decisions = paths.map((p) => p.decision)
  const nD = Math.max(decisions.length, 1)
  decisions.forEach((dec, i) => {
    const angle = (2 * Math.PI * i) / nD - Math.PI / 2
    decisionAngle.set(dec.id, angle)
    simMap.set(dec.id, {
      id: dec.id,
      x: centerX + 400 * Math.cos(angle),
      y: centerY + 400 * Math.sin(angle),
      layer: 2,
      targetRadius: 400,
    })
  })

  for (const ap of paths) {
    const pa = decisionAngle.get(ap.decision.id) ?? 0
    const kids = ap.children
    const nk = kids.length
    if (nk === 0) continue
    const spread = Math.min(0.55, Math.PI / Math.max(nk * 1.15, 1))
    kids.forEach((ch, j) => {
      const angle = pa + (j - (nk - 1) / 2) * spread
      const r = 385
      simMap.set(ch.id, {
        id: ch.id,
        x: centerX + r * Math.cos(angle),
        y: centerY + r * Math.sin(angle),
        layer: 2,
        targetRadius: 385,
      })
    })
  }

  const nO = Math.max(orphans.length, 1)
  orphans.forEach((o, i) => {
    const angle = (2 * Math.PI * i) / nO - Math.PI / 2
    const r = 500
    simMap.set(o.id, {
      id: o.id,
      x: centerX + r * Math.cos(angle),
      y: centerY + r * Math.sin(angle),
      layer: 3,
      targetRadius: 500,
    })
  })

  const simNodes: ResolvedSimNode[] = positionedNodes.map((n) => {
    const existing = simMap.get(n.id)
    if (existing) return existing
    const layer = layerOf(n.id)
    const tr = targetRadiusFor(n.id, layer)
    const angle = Math.atan2(n.y - centerY, n.x - centerX) || 0
    const rr = layer === 0 ? 0 : Math.max(tr, 120)
    return {
      id: n.id,
      x: centerX + rr * Math.cos(angle),
      y: centerY + rr * Math.sin(angle),
      layer,
      targetRadius: tr,
    }
  })

  const byId = new Map(simNodes.map((n) => [n.id, n]))
  const links = edges
    .map((e) => {
      const s = byId.get(e.from)
      const t = byId.get(e.to)
      if (!s || !t) return null
      return { source: s, target: t }
    })
    .filter((x): x is { source: ResolvedSimNode; target: ResolvedSimNode } => x != null)

  const graphById = new Map(positionedNodes.map((n) => [n.id, n]))

  const sim = forceSimulation(simNodes)
    .force(
      'link',
      forceLink<ResolvedSimNode, { source: ResolvedSimNode; target: ResolvedSimNode }>(links)
        .id((d) => d.id)
        .distance(180)
        .strength(0.3),
    )
    .force('charge', forceManyBody().strength(-450))
    .force('center', forceCenter(centerX, centerY).strength(0.02))
    .force(
      'radial',
      forceRadial<ResolvedSimNode>((d) => d.targetRadius, centerX, centerY).strength((d: ResolvedSimNode) =>
        d.layer === 0 ? 0 : 0.14,
      ),
    )
    .force(
      'collide',
      forceCollide<ResolvedSimNode>()
        .radius((d) => Math.max(50, collisionRadius(graphById.get(d.id)!)))
        .iterations(2),
    )
    .velocityDecay(0.6)
    .stop()

  const rootSim = simNodes.find((s) => s.id === rootId)
  if (rootSim) {
    rootSim.fx = centerX
    rootSim.fy = centerY
  }

  const TICKS = 100
  sim.alpha(1)
  for (let i = 0; i < TICKS; i++) sim.tick()

  if (rootSim) {
    rootSim.fx = null
    rootSim.fy = null
  }

  if (import.meta.env.DEV) {
    console.log('[d3-force] resolved radial', { ticks: TICKS, alpha: sim.alpha() })
  }

  const pos = simToPositionMap(simNodes)
  return mergeForcePositions(positionedNodes, pos, { blendNew: 1 })
}
