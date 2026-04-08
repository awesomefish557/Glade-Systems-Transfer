import type { GraphNode, NodeKind } from '../types'

export const MIN_ROOT_W = 198
export const MIN_ROOT_H = 110
export const MIN_CONSEQUENCE_W = 77
export const MIN_CONSEQUENCE_H = 55
export const MIN_QUESTION_W = 99
export const MIN_QUESTION_H = 66
export const MIN_ASSUMPTION_W = 77
export const MIN_ASSUMPTION_H = 55

export const MAX_NODE_TEXT_W = 200

export function defaultSizeForKind(kind: NodeKind): { width: number; height: number } {
  switch (kind) {
    case 'root':
      return { width: 220, height: 112 }
    case 'consequence':
      return { width: 120, height: 72 }
    case 'question':
      return { width: 140, height: 80 }
    case 'assumption':
      return { width: 120, height: 72 }
  }
}

export function minSizeForKind(kind: NodeKind): { minW: number; minH: number } {
  switch (kind) {
    case 'root':
      return { minW: MIN_ROOT_W, minH: MIN_ROOT_H }
    case 'consequence':
      return { minW: MIN_CONSEQUENCE_W, minH: MIN_CONSEQUENCE_H }
    case 'question':
      return { minW: MIN_QUESTION_W, minH: MIN_QUESTION_H }
    case 'assumption':
      return { minW: MIN_ASSUMPTION_W, minH: MIN_ASSUMPTION_H }
  }
}

/** Ensure persisted nodes have width/height after schema change. */
export function ensureNodeDimensions(n: GraphNode): GraphNode {
  if (n.width != null && n.height != null && n.width > 0 && n.height > 0) return n
  const { width, height } = defaultSizeForKind(n.kind)
  return { ...n, width, height }
}
