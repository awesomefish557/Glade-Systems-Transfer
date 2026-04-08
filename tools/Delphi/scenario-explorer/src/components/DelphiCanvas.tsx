import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { GraphEdge, GraphNode, Viewport } from '../types'
import { minSizeForKind } from '../lib/nodeDefaults'
import {
  edgeOrganicSide,
  edgesOnPathFromRoot,
  estimateOrganicExtents,
  findRootId,
  organicCubicPath,
  organicEdgeAnchors,
  organicLabelPlacement,
} from '../lib/organicMindMap'
import { classicEdgePathD, obstacleBiasForMidpoint } from '../lib/edgeRouting'
import { layoutTextInNode, LINE_HEIGHT_EM } from '../lib/nodeTextLayout'
import { EditorToolbar, type EditorToolbarProps } from './EditorToolbar'

export type DelphiEditorToolbarInput = Omit<EditorToolbarProps, 'onFitAll'>

const HANDLE_R = 5

function certaintyClass(c: number | null | undefined): string {
  if (c == null || Number.isNaN(c)) return 'diamond-unknown'
  if (c >= 70) return 'diamond-high'
  if (c >= 30) return 'diamond-mid'
  return 'diamond-low'
}

function nodeBBox(n: GraphNode): { hw: number; hh: number } {
  const w = n.width ?? 100
  const h = n.height ?? 70
  return { hw: w / 2, hh: h / 2 }
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

function sizeFromCorner(corner: ResizeCorner, lx: number, ly: number, minW: number, minH: number) {
  let w = 0
  let h = 0
  switch (corner) {
    case 'se':
      w = 2 * lx
      h = 2 * ly
      break
    case 'sw':
      w = -2 * lx
      h = 2 * ly
      break
    case 'ne':
      w = 2 * lx
      h = -2 * ly
      break
    case 'nw':
      w = -2 * lx
      h = -2 * ly
      break
  }
  return { w: Math.max(minW, w), h: Math.max(minH, h) }
}

function organicDotClass(n: GraphNode): string {
  if (n.kind === 'root') return 'organic-dot-root'
  if (n.kind === 'assumption') return 'organic-dot-assumption'
  if (n.kind === 'question') return 'organic-dot-question'
  if (n.kind === 'consequence') {
    const c = n.certainty
    if (c == null || Number.isNaN(c)) return 'organic-dot-consequence-unknown'
    if (c >= 70) return 'organic-dot-consequence-high'
    if (c >= 30) return 'organic-dot-consequence-mid'
    return 'organic-dot-consequence-low'
  }
  return 'organic-dot-question'
}

function organicTextClass(n: GraphNode, orphan: boolean): string {
  if (orphan) return 'organic-label-orphan pointer-events-none'
  if (n.kind === 'root') return 'organic-label-root pointer-events-none'
  if (n.kind === 'assumption') return 'organic-label-assumption pointer-events-none'
  if (n.kind === 'consequence') return 'organic-label-consequence pointer-events-none'
  return 'organic-label-question pointer-events-none'
}

export interface DelphiCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Increment (e.g. keyboard) to run “fit all” inside the canvas. */
  fitRequest?: number
  viewport: Viewport
  onViewportChange: (v: Viewport) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  selectedEdgeId: string | null
  onSelectEdge: (id: string | null) => void
  toolMode: 'add-edge' | null
  onNodeClickAddEdge: (nodeId: string) => void
  onMoveNode: (id: string, x: number, y: number) => void
  onDeleteNode: (id: string) => void
  onEditNode: (id: string, text: string) => void
  onResizeNode: (id: string, width: number, height: number) => void
  /** After a node finishes dragging (exploration only); e.g. re-run force layout. */
  onNodeDragEnd?: (nodeId: string) => void
  editorToolbar: DelphiEditorToolbarInput
  /** Resolved snapshot: pan/zoom/select only; no edit/drag/resize. */
  readOnly?: boolean
  /** In resolved view, fade these nodes (orphans / tangents). */
  orphanNodeIds?: ReadonlySet<string>
  /** Muted chrome for resolved layout. */
  canvasVariant?: 'original' | 'resolved'
  /** Curved branches + label flow (vs boxed shapes + straight edges). */
  renderMode?: 'organic' | 'classic'
  /** When set, dim nodes/edges not from this extraction turn (root stays bright). */
  activeTurnId?: string | null
}

export function DelphiCanvas({
  nodes,
  edges,
  fitRequest = 0,
  viewport,
  onViewportChange,
  selectedId,
  onSelect,
  selectedEdgeId,
  onSelectEdge,
  toolMode,
  onNodeClickAddEdge,
  onMoveNode,
  onDeleteNode,
  onEditNode,
  onResizeNode,
  onNodeDragEnd,
  editorToolbar,
  readOnly = false,
  orphanNodeIds,
  canvasVariant = 'original',
  renderMode = 'organic',
  activeTurnId = null,
}: DelphiCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const pendingDragReleaseId = useRef<string | null>(null)
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null)
  const panRef = useRef<{ sx: number; sy: number; tx: number; ty: number; scale: number } | null>(
    null,
  )
  const resizeRef = useRef<{
    id: string
    corner: ResizeCorner
    cx: number
    cy: number
  } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const vpRef = useRef(viewport)
  vpRef.current = viewport

  const pathHighlightEdgeIds = useMemo(() => {
    if (renderMode !== 'organic') return new Set<string>()
    const rootId = findRootId(nodes)
    if (!rootId) return new Set<string>()
    const acc = new Set<string>()
    for (const nid of [selectedId, hoverNodeId].filter(Boolean) as string[]) {
      for (const eid of edgesOnPathFromRoot(nid, rootId, edges)) acc.add(eid)
    }
    return acc
  }, [renderMode, nodes, edges, selectedId, hoverNodeId])

  const handleFitAll = useCallback(() => {
    const el = svgRef.current
    if (!nodes.length || !el) return
    const r = el.getBoundingClientRect()
    const pw = Math.max(1, r.width)
    const ph = Math.max(1, r.height)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      const { hw, hh } =
        renderMode === 'organic' ? estimateOrganicExtents(n) : nodeBBox(n)
      minX = Math.min(minX, n.x - hw)
      maxX = Math.max(maxX, n.x + hw)
      minY = Math.min(minY, n.y - hh)
      maxY = Math.max(maxY, n.y + hh)
    }
    const pad = 72
    minX -= pad
    maxX += pad
    minY -= pad
    maxY += pad
    const bw = Math.max(maxX - minX, 160)
    const bh = Math.max(maxY - minY, 160)
    const scaleX = pw / bw
    const scaleY = ph / bh
    let nextScale = Math.min(scaleX, scaleY, 3) * 0.94
    nextScale = Math.max(0.08, Math.min(3, nextScale))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    onViewportChange({
      scale: nextScale,
      tx: pw / 2 - cx * nextScale,
      ty: ph / 2 - cy * nextScale,
    })
  }, [nodes, onViewportChange, renderMode])

  const prevFitRequest = useRef(0)
  useEffect(() => {
    if (fitRequest <= prevFitRequest.current) return
    prevFitRequest.current = fitRequest
    handleFitAll()
  }, [fitRequest, handleFitAll])

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const el = svgRef.current
      if (!el) return { x: 0, y: 0 }
      const r = el.getBoundingClientRect()
      const mx = clientX - r.left
      const my = clientY - r.top
      const v = vpRef.current
      return {
        x: (mx - v.tx) / v.scale,
        y: (my - v.ty) / v.scale,
      }
    },
    [],
  )

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = vpRef.current
      const el = svg
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      const wx = (mx - v.tx) / v.scale
      const wy = (my - v.ty) / v.scale
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      const nextScale = Math.min(3, Math.max(0.1, v.scale * factor))
      const ntx = mx - wx * nextScale
      const nty = my - wy * nextScale
      onViewportChange({ scale: nextScale, tx: ntx, ty: nty })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [onViewportChange])

  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      const el = menuRef.current
      if (el && e.target instanceof Node && el.contains(e.target)) return
      setMenu(null)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [menu])

  const endPanOrDrag = useCallback(() => {
    const dragId = pendingDragReleaseId.current
    pendingDragReleaseId.current = null
    panRef.current = null
    dragRef.current = null
    resizeRef.current = null
    if (dragId && onNodeDragEnd && !readOnly) onNodeDragEnd(dragId)
  }, [onNodeDragEnd, readOnly])

  useEffect(() => {
    window.addEventListener('pointerup', endPanOrDrag)
    window.addEventListener('pointercancel', endPanOrDrag)
    return () => {
      window.removeEventListener('pointerup', endPanOrDrag)
      window.removeEventListener('pointercancel', endPanOrDrag)
    }
  }, [endPanOrDrag])

  const onPointerMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      const p = panRef.current
      const dx = e.clientX - p.sx
      const dy = e.clientY - p.sy
      onViewportChange({
        scale: p.scale,
        tx: p.tx + dx,
        ty: p.ty + dy,
      })
      return
    }
    const rz = resizeRef.current
    if (rz && renderMode === 'classic') {
      const n = nodes.find((x) => x.id === rz.id)
      if (!n) return
      const w = toWorld(e.clientX, e.clientY)
      const lx = w.x - rz.cx
      const ly = w.y - rz.cy
      const { minW, minH } = minSizeForKind(n.kind)
      const { w: nw, h: nh } = sizeFromCorner(rz.corner, lx, ly, minW, minH)
      onResizeNode(n.id, nw, nh)
      return
    }
    const d = dragRef.current
    if (!d) return
    const w = toWorld(e.clientX, e.clientY)
    onMoveNode(d.id, w.x - d.ox, w.y - d.oy)
  }

  const startDragNode = (e: React.PointerEvent, n: GraphNode) => {
    if (e.button !== 0) return
    if (readOnly) {
      e.stopPropagation()
      onSelect(n.id)
      onSelectEdge(null)
      return
    }
    if (toolMode === 'add-edge') {
      e.stopPropagation()
      e.preventDefault()
      onNodeClickAddEdge(n.id)
      return
    }
    e.stopPropagation()
    const w = toWorld(e.clientX, e.clientY)
    pendingDragReleaseId.current = n.id
    dragRef.current = { id: n.id, ox: w.x - n.x, oy: w.y - n.y }
    onSelect(n.id)
    onSelectEdge(null)
    setMenu(null)
    ;(e.currentTarget as SVGGElement).setPointerCapture(e.pointerId)
  }

  const startResize = (
    e: React.PointerEvent,
    n: GraphNode,
    corner: ResizeCorner,
  ) => {
    e.stopPropagation()
    e.preventDefault()
    resizeRef.current = { id: n.id, corner, cx: n.x, cy: n.y }
    onSelect(n.id)
    onSelectEdge(null)
    ;(e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId)
  }

  const onPointerDownBg = (e: React.PointerEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      panRef.current = {
        sx: e.clientX,
        sy: e.clientY,
        tx: viewport.tx,
        ty: viewport.ty,
        scale: viewport.scale,
      }
      svgRef.current?.setPointerCapture(e.pointerId)
    } else if (e.button === 0) {
      if (toolMode !== 'add-edge') {
        onSelect(null)
        onSelectEdge(null)
      }
      setMenu(null)
    }
  }

  const onContextMenu = (e: React.MouseEvent, n: GraphNode) => {
    e.preventDefault()
    onSelect(n.id)
    onSelectEdge(null)
    setMenu({ x: e.clientX, y: e.clientY, nodeId: n.id })
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  const hasStageLighting = typeof activeTurnId === 'string' && activeTurnId.length > 0
  const nodeStageOpacity = (n: GraphNode) => {
    if (!hasStageLighting) return 1
    if (n.kind === 'root') return 1
    if (n.turnId === activeTurnId) return 1
    return 0.25
  }
  const edgeStageOpacity = (e: GraphEdge) => {
    if (!hasStageLighting) return 1
    const a = nodeMap.get(e.from)
    const b = nodeMap.get(e.to)
    if (!a || !b) return 1
    const lit = (x: GraphNode) => x.kind === 'root' || x.turnId === activeTurnId
    const fa = lit(a)
    const fb = lit(b)
    if (fa && fb) return 1
    if (fa || fb) return 0.4
    return 0.15
  }
  const stageOpacityStyle = (o: number): CSSProperties => ({
    opacity: o,
    transition: 'opacity 0.3s ease',
  })

  const renderHandles = (n: GraphNode, sel: string) => {
    if (readOnly || renderMode === 'organic' || n.id !== selectedId) return null
    const hw = (n.width ?? 100) / 2
    const hh = (n.height ?? 70) / 2
    const corners: { c: ResizeCorner; x: number; y: number }[] = [
      { c: 'nw', x: -hw, y: -hh },
      { c: 'ne', x: hw, y: -hh },
      { c: 'sw', x: -hw, y: hh },
      { c: 'se', x: hw, y: hh },
    ]
    return corners.map(({ c, x, y }) => (
      <circle
        key={c}
        cx={x}
        cy={y}
        r={HANDLE_R}
        className={`cursor-nwse-resize fill-[var(--accent)] stroke-[var(--panel)] stroke-2${sel}`}
        onPointerDown={(e) => startResize(e, n, c)}
      />
    ))
  }

  const renderNode = (n: GraphNode) => {
    const orphan = orphanNodeIds?.has(n.id) ? ' node-orphan' : ''
    const sel = n.id === selectedId ? ' node-selected' : ''
    const w = n.width ?? 100
    const h = n.height ?? 70
    const hw = w / 2
    const hh = h / 2
    const { fontSize, lines } = layoutTextInNode(n)
    const lh = fontSize * LINE_HEIGHT_EM
    const textY0 = -((lines.length - 1) * lh) / 2

    const textBlock = (
      <text
        textAnchor="middle"
        className="pointer-events-none fill-[var(--text-h)]"
        style={{ fontSize }}
        y={textY0}
        dominantBaseline="middle"
      >
        {lines.map((ln, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 0 : lh}>
            {ln}
          </tspan>
        ))}
      </text>
    )

    if (n.kind === 'root') {
      const clipId = `dc-clip-root-${n.id}`
      return (
        <g
          key={n.id}
          transform={`translate(${n.x},${n.y})`}
          onPointerDown={(e) => startDragNode(e, n)}
          onDoubleClick={
            readOnly
              ? undefined
              : () => {
                  const next = window.prompt('Edit label', n.text)
                  if (next != null && next.trim()) onEditNode(n.id, next.trim())
                }
          }
          onContextMenu={readOnly ? undefined : (e) => onContextMenu(e, n)}
          style={{
            cursor: readOnly ? 'default' : toolMode === 'add-edge' ? 'crosshair' : 'grab',
            ...stageOpacityStyle(nodeStageOpacity(n)),
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={-hw} y={-hh} width={w} height={h} rx={14} ry={14} />
            </clipPath>
          </defs>
          <title>{n.text}</title>
          <rect
            x={-hw}
            y={-hh}
            width={w}
            height={h}
            rx={14}
            ry={14}
            className={`node-root stroke-[1.5]${sel}`}
          />
          <g clipPath={`url(#${clipId})`}>{textBlock}</g>
          {renderHandles(n, sel)}
        </g>
      )
    }

    if (n.kind === 'consequence') {
      const pct =
        n.certainty != null && !Number.isNaN(n.certainty)
          ? `${Math.round(n.certainty)}%`
          : '—'
      const clipId = `dc-clip-c-${n.id}`
      return (
        <g
          key={n.id}
          transform={`translate(${n.x},${n.y})`}
          onPointerDown={(e) => startDragNode(e, n)}
          onDoubleClick={
            readOnly
              ? undefined
              : () => {
                  const next = window.prompt('Edit label', n.text)
                  if (next != null && next.trim()) onEditNode(n.id, next.trim())
                }
          }
          onContextMenu={readOnly ? undefined : (e) => onContextMenu(e, n)}
          style={{
            cursor: readOnly ? 'default' : toolMode === 'add-edge' ? 'crosshair' : 'grab',
            ...stageOpacityStyle(nodeStageOpacity(n)),
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <polygon points={`0,-${hh} ${hw},0 0,${hh} -${hw},0`} />
            </clipPath>
          </defs>
          <title>{n.text}</title>
          <polygon
            points={`0,-${hh} ${hw},0 0,${hh} -${hw},0`}
            className={`${certaintyClass(n.certainty)} stroke-[1.5]${sel}${orphan}`}
          />
          <g clipPath={`url(#${clipId})`}>
            {textBlock}
            <text
              y={hh - 10}
              textAnchor="middle"
              className="pointer-events-none fill-[var(--text)] opacity-90"
              style={{ fontSize: Math.min(10, fontSize - 1) }}
            >
              {pct}
            </text>
          </g>
          {renderHandles(n, sel)}
        </g>
      )
    }

    if (n.kind === 'question') {
      const clipId = `dc-clip-q-${n.id}`
      return (
        <g
          key={n.id}
          transform={`translate(${n.x},${n.y})`}
          onPointerDown={(e) => startDragNode(e, n)}
          onDoubleClick={
            readOnly
              ? undefined
              : () => {
                  const next = window.prompt('Edit label', n.text)
                  if (next != null && next.trim()) onEditNode(n.id, next.trim())
                }
          }
          onContextMenu={readOnly ? undefined : (e) => onContextMenu(e, n)}
          style={{
            cursor: readOnly ? 'default' : toolMode === 'add-edge' ? 'crosshair' : 'grab',
            ...stageOpacityStyle(nodeStageOpacity(n)),
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={-hw} y={-hh} width={w} height={h} rx={12} ry={12} />
            </clipPath>
          </defs>
          <title>{n.text}</title>
          <rect
            x={-hw}
            y={-hh}
            width={w}
            height={h}
            rx={12}
            ry={12}
            className={`node-question stroke-[1.5]${sel}${orphan}`}
          />
          <g clipPath={`url(#${clipId})`}>{textBlock}</g>
          {renderHandles(n, sel)}
        </g>
      )
    }

    const pts: string[] = []
    const scale = Math.min(w, h) / (2 * 58)
    const R = 58 * scale
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 6) + (i * Math.PI) / 3
      pts.push(`${Math.cos(ang) * R},${Math.sin(ang) * R}`)
    }
    const clipId = `dc-clip-a-${n.id}`
    return (
      <g
        key={n.id}
        transform={`translate(${n.x},${n.y})`}
        onPointerDown={(e) => startDragNode(e, n)}
        onDoubleClick={
          readOnly
            ? undefined
            : () => {
                const next = window.prompt('Edit label', n.text)
                if (next != null && next.trim()) onEditNode(n.id, next.trim())
              }
        }
        onContextMenu={readOnly ? undefined : (e) => onContextMenu(e, n)}
        style={{
          cursor: readOnly ? 'default' : toolMode === 'add-edge' ? 'crosshair' : 'grab',
          ...stageOpacityStyle(nodeStageOpacity(n)),
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <polygon points={pts.join(' ')} />
          </clipPath>
        </defs>
        <title>{n.text}</title>
        <polygon points={pts.join(' ')} className={`node-assumption stroke-[1.5]${sel}${orphan}`} />
        <g clipPath={`url(#${clipId})`}>{textBlock}</g>
        {renderHandles(n, sel)}
      </g>
    )
  }

  const hitW = 18 / viewport.scale

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--canvas-bg)]${canvasVariant === 'resolved' ? ' delphi-resolved-view' : ''}`}
    >
      <div className="relative min-h-0 flex-1">
        {menu && !readOnly && (
          <div
            ref={menuRef}
            className="fixed z-20 min-w-[8rem] rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 text-sm shadow-lg"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
          >
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                const x = nodes.find((n) => n.id === menu.nodeId)
                if (x) {
                  const next = window.prompt('Edit label', x.text)
                  if (next != null && next.trim()) onEditNode(x.id, next.trim())
                }
                setMenu(null)
              }}
            >
              Edit label…
            </button>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-black/5 dark:text-red-400 dark:hover:bg-white/10"
              onClick={() => {
                onDeleteNode(menu.nodeId)
                setMenu(null)
              }}
            >
              Delete node
            </button>
          </div>
        )}

        <svg
          ref={svgRef}
          className="h-full w-full touch-none select-none"
          onPointerMove={onPointerMove}
          onPointerUp={endPanOrDrag}
          onPointerCancel={endPanOrDrag}
          onPointerDown={onPointerDownBg}
        >
          <defs>
            <pattern
              id="delphi-blueprint-grid"
              width={30}
              height={30}
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 30 0 L 0 0 0 30"
                fill="none"
                className="blueprint-grid-line"
                strokeWidth={0.5}
              />
            </pattern>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L8,4 L0,8 z" className="fill-[var(--text)] opacity-40" />
            </marker>
          </defs>
          <g transform={`translate(${viewport.tx},${viewport.ty}) scale(${viewport.scale})`}>
            <rect
              x={-8000}
              y={-8000}
              width={20000}
              height={20000}
              fill="var(--canvas-bg)"
              className="pointer-events-none"
            />
            <rect
              x={-8000}
              y={-8000}
              width={20000}
              height={20000}
              fill="url(#delphi-blueprint-grid)"
              className="pointer-events-none"
            />

            {renderMode === 'organic' ? (
              <>
                <g className="organic-branches">
                  {edges.map((e) => {
                    const a = nodeMap.get(e.from)
                    const b = nodeMap.get(e.to)
                    if (!a || !b) return null
                    const side = edgeOrganicSide(e, edges)
                    const { x1, y1, x2, y2 } = organicEdgeAnchors(a, b)
                    const bias = obstacleBiasForMidpoint(
                      (x1 + x2) / 2,
                      (y1 + y2) / 2,
                      nodes,
                      e.from,
                      e.to,
                    )
                    const d = organicCubicPath(x1, y1, x2, y2, side, 0.2, bias)
                    const pathHi = pathHighlightEdgeIds.has(e.id)
                    const edgeSel = e.id === selectedEdgeId
                    const hi = pathHi || edgeSel
                    const strokeCls =
                      canvasVariant === 'resolved'
                        ? hi
                          ? 'organic-edge-highlight organic-edge-resolved'
                          : 'organic-edge-resolved'
                        : hi
                          ? 'organic-edge organic-edge-highlight'
                          : 'organic-edge'
                    return (
                      <g key={e.id} style={stageOpacityStyle(edgeStageOpacity(e))}>
                        <path
                          d={d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={Math.max(16, hitW * 1.5)}
                          strokeLinecap="round"
                          className="cursor-pointer"
                          style={{ pointerEvents: 'stroke' }}
                          onPointerDown={(ev) => {
                            ev.stopPropagation()
                            onSelectEdge(e.id)
                            onSelect(null)
                          }}
                        />
                        <path
                          d={d}
                          fill="none"
                          className={`${strokeCls} pointer-events-none`}
                          strokeWidth={hi ? 2.85 : 1.7}
                          strokeLinecap="round"
                          markerEnd="url(#arrowhead)"
                        />
                      </g>
                    )
                  })}
                </g>
                <g className="organic-nodes">
                  {nodes.map((n) => {
                    const orphan = Boolean(orphanNodeIds?.has(n.id))
                    const { ox, oy, lines, fs, lh } = organicLabelPlacement(n, edges, nodeMap)
                    const dotR = n.kind === 'root' ? 7.5 : 5.5
                    const sel = n.id === selectedId
                    const textStartY = oy - ((lines.length - 1) * lh) / 2
                    return (
                      <g
                        key={n.id}
                        transform={`translate(${n.x},${n.y})`}
                        className={orphan ? 'opacity-[0.42]' : undefined}
                        onPointerEnter={() => setHoverNodeId(n.id)}
                        onPointerLeave={() => setHoverNodeId(null)}
                        onPointerDown={(e) => startDragNode(e, n)}
                        onDoubleClick={
                          readOnly
                            ? undefined
                            : () => {
                                const next = window.prompt('Edit label', n.text)
                                if (next != null && next.trim()) onEditNode(n.id, next.trim())
                              }
                        }
                        onContextMenu={readOnly ? undefined : (e) => onContextMenu(e, n)}
                        style={{
                          cursor: readOnly
                            ? 'default'
                            : toolMode === 'add-edge'
                              ? 'crosshair'
                              : 'grab',
                          ...stageOpacityStyle(nodeStageOpacity(n)),
                        }}
                      >
                        <title>{n.text}</title>
                        {sel && (
                          <circle
                            r={dotR + 9}
                            className="pointer-events-none fill-none stroke-[var(--accent)]"
                            strokeWidth={2}
                            strokeOpacity={0.75}
                          />
                        )}
                        <circle r={Math.max(dotR, 14)} className="fill-transparent" />
                        <circle r={dotR} className={organicDotClass(n)} />
                        <text
                          textAnchor="middle"
                          style={{ fontSize: fs }}
                          y={textStartY}
                          dominantBaseline="middle"
                          className={organicTextClass(n, orphan)}
                        >
                          {lines.map((ln, i) => (
                            <tspan key={i} x={ox} dy={i === 0 ? 0 : lh}>
                              {ln}
                            </tspan>
                          ))}
                        </text>
                        {n.kind === 'consequence' && (
                          <text
                            y={textStartY + lines.length * lh + 6}
                            x={ox}
                            textAnchor="middle"
                            className="pointer-events-none fill-[var(--text)] opacity-70"
                            style={{ fontSize: Math.max(9, fs - 2) }}
                          >
                            {n.certainty != null && !Number.isNaN(n.certainty)
                              ? `${Math.round(n.certainty)}%`
                              : '—'}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </g>
              </>
            ) : (
              <>
                {edges.map((e) => {
                  const a = nodeMap.get(e.from)
                  const b = nodeMap.get(e.to)
                  if (!a || !b) return null
                  const d = classicEdgePathD(a, b, nodes)
                  const selected = e.id === selectedEdgeId
                  return (
                    <g key={e.id} style={stageOpacityStyle(edgeStageOpacity(e))}>
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={hitW}
                        strokeLinecap="round"
                        className="cursor-pointer"
                        style={{ pointerEvents: 'stroke' }}
                        onPointerDown={(ev) => {
                          ev.stopPropagation()
                          onSelectEdge(e.id)
                          onSelect(null)
                        }}
                      />
                      <path
                        d={d}
                        fill="none"
                        className={`edge-line pointer-events-none${canvasVariant === 'resolved' ? ' edge-resolved' : ''}`}
                        strokeWidth={selected ? 2.5 : 1.25}
                        strokeLinecap="round"
                        markerEnd="url(#arrowhead)"
                      />
                    </g>
                  )
                })}
                {nodes.map((n) => renderNode(n))}
              </>
            )}
          </g>
        </svg>

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-[var(--text)]">
            Start describing a scenario · Scroll to zoom · Middle-drag to pan
          </div>
        )}
      </div>
      <EditorToolbar {...editorToolbar} onFitAll={handleFitAll} />
    </div>
  )
}
