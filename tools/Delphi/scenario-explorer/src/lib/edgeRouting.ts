import type { GraphNode } from '../types'

function nodeHalfSize(n: GraphNode): { hw: number; hh: number } {
  const w = n.width ?? 100
  const h = n.height ?? 70
  return { hw: w / 2, hh: h / 2 }
}

export function edgeAnchors(
  a: GraphNode,
  b: GraphNode,
): { x1: number; y1: number; x2: number; y2: number } {
  const A = nodeHalfSize(a)
  const B = nodeHalfSize(b)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return {
    x1: a.x + ux * A.hw,
    y1: a.y + uy * A.hh,
    x2: b.x - ux * B.hw,
    y2: b.y - uy * B.hh,
  }
}

const MID_OBSTACLE_R = 80

/**
 * Quadratic bezier from anchors; nudges control point away from nodes clustered near the segment midpoint.
 */
export function classicEdgePathD(
  from: GraphNode,
  to: GraphNode,
  allNodes: GraphNode[],
): string {
  const { x1, y1, x2, y2 } = edgeAnchors(from, to)
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2

  const obstacles = allNodes.filter(
    (n) =>
      n.id !== from.id &&
      n.id !== to.id &&
      Math.hypot(n.x - midX, n.y - midY) < MID_OBSTACLE_R,
  )

  let cx = midX
  let cy = midY
  if (obstacles.length > 0) {
    const ax = obstacles.reduce((s, n) => s + n.x, 0) / obstacles.length
    const ay = obstacles.reduce((s, n) => s + n.y, 0) / obstacles.length
    cx = midX + (midX - ax) * 0.5
    cy = midY + (midY - ay) * 0.5
  }

  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
}

export function obstacleBiasForMidpoint(
  midX: number,
  midY: number,
  allNodes: GraphNode[],
  excludeId1: string,
  excludeId2: string,
): { bx: number; by: number } {
  const obstacles = allNodes.filter(
    (n) =>
      n.id !== excludeId1 &&
      n.id !== excludeId2 &&
      Math.hypot(n.x - midX, n.y - midY) < MID_OBSTACLE_R,
  )
  if (obstacles.length === 0) return { bx: 0, by: 0 }
  const ax = obstacles.reduce((s, n) => s + n.x, 0) / obstacles.length
  const ay = obstacles.reduce((s, n) => s + n.y, 0) / obstacles.length
  return { bx: (midX - ax) * 0.22, by: (midY - ay) * 0.22 }
}
