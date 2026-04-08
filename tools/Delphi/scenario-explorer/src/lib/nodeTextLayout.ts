import { wrapTextToPixelWidth } from './svgWordWrap'
import { MAX_NODE_TEXT_W } from './nodeDefaults'
import type { GraphNode, NodeKind } from '../types'

const PAD_DEFAULT = 15
const PAD_ROOT = 20

function padForKind(kind: NodeKind): number {
  return kind === 'root' ? PAD_ROOT : PAD_DEFAULT
}
const LINE_HEIGHT_EM = 1.25
const MAX_FS = 12
const MIN_FS = 9
/** Extra vertical space for consequence certainty row inside the shape. */
const CONSEQUENCE_FOOTER_PX = 22

function innerWidthForWrap(kind: NodeKind, innerW: number): number {
  const cap = Math.min(innerW, MAX_NODE_TEXT_W)
  if (kind === 'consequence') return cap * 0.72
  if (kind === 'assumption') return cap * 0.78
  return cap
}

export interface TextLayoutResult {
  fontSize: number
  lines: string[]
  contentHeight: number
}

/**
 * Prefer 12px + word wrap; shrink font down to 9px if lines still exceed inner height.
 */
export function layoutTextInNode(n: GraphNode): TextLayoutResult {
  const pad = padForKind(n.kind)
  const w = n.width ?? 120
  const h = n.height ?? 72
  const innerW = Math.max(16, w - 2 * pad)
  const footer = n.kind === 'consequence' ? CONSEQUENCE_FOOTER_PX : 0
  const innerH = Math.max(16, h - 2 * pad - footer)
  const wrapW = innerWidthForWrap(n.kind, innerW)

  let fs = MAX_FS
  let lines = wrapTextToPixelWidth(n.text, wrapW, fs)
  let lh = fs * LINE_HEIGHT_EM
  let needH = lines.length * lh

  while (needH > innerH && fs > MIN_FS) {
    fs -= 1
    lines = wrapTextToPixelWidth(n.text, wrapW, fs)
    lh = fs * LINE_HEIGHT_EM
    needH = lines.length * lh
  }

  return { fontSize: fs, lines, contentHeight: needH }
}

/** Minimum height to contain wrapped text at current width (12px font). */
export function measureContentHeight(n: GraphNode): number {
  const pad = padForKind(n.kind)
  const w = n.width ?? 120
  const innerW = Math.max(16, w - 2 * pad)
  const wrapW = innerWidthForWrap(n.kind, innerW)
  const fs = MAX_FS
  const lines = wrapTextToPixelWidth(n.text, wrapW, fs)
  const needH = lines.length * fs * LINE_HEIGHT_EM
  const footer = n.kind === 'consequence' ? CONSEQUENCE_FOOTER_PX : 0
  return Math.ceil(2 * pad + needH + footer)
}

/** Legacy export: default body padding (non-root). */
export const PAD = PAD_DEFAULT
export { LINE_HEIGHT_EM }
