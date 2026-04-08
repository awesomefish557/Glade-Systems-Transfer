import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { ConversationSidebar } from './components/ConversationSidebar'
import { DelphiCanvas } from './components/DelphiCanvas'
import { ExploreChat } from './components/ExploreChat'
import { useConversations } from './hooks/useConversations'
import { extractScenario } from './lib/extract'
import { sendExploreCasualReply } from './lib/exploreChatApi'
import { appendExtractionToGraph, type PlacementCursor } from './lib/graphFromExtraction'
import { ensureNodeDimensions, defaultSizeForKind, minSizeForKind } from './lib/nodeDefaults'
import { measureContentHeight } from './lib/nodeTextLayout'
import {
  mergeForcePositions,
  runForceLayoutExplore,
  runForceLayoutExploreTicks,
  runForceLayoutResolved,
} from './lib/d3Layout'
import { radialLayoutNewNodes } from './lib/radialLayout'
import {
  buildResolvedDisplayEdges,
  layoutResolvedDisplay,
  orphanIdSet,
  resolveGraph,
} from './lib/resolveGraph'
import { excerpt, type Scenario, type ScenarioDraft, type ScenarioExtraction } from './lib/scenarioStorage'
import type {
  ChatMessage,
  ExtractionPayload,
  ExploreMessage,
  GraphEdge,
  GraphNode,
  NodeKind,
  Viewport,
} from './types'

const SIDEBAR_COLLAPSED_KEY = 'delphi-sidebar-collapsed'
const RENDER_MODE_KEY = 'delphi-render-mode'
const MAX_NODES = 96
const WARN_NODES = 50
const HARD_WARN_NODES = 80
const LAYOUT_CX = 400
const LAYOUT_CY = 300

const EXPLORE_BLEND = 0.7
const DRAG_RELAX_TICKS = 2
const DRAG_RELAX_BLEND = 0.55

function withExploreLayout(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  return mergeForcePositions(nodes, runForceLayoutExplore(nodes, edges, LAYOUT_CX, LAYOUT_CY), {
    blendNew: EXPLORE_BLEND,
  })
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

function hydrateFromScenario(s: Scenario): {
  messages: ChatMessage[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  tailId: string | null
  cursor: PlacementCursor
  viewport: Viewport
} {
  return {
    messages: s.messages,
    nodes: s.graph.nodes.map(ensureNodeDimensions),
    edges: s.graph.edges,
    tailId: s.graph.tailId,
    cursor: s.graph.cursor,
    viewport: s.graph.viewport,
  }
}

export default function App() {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY ?? ''
  const model = import.meta.env.VITE_ANTHROPIC_MODEL || DEFAULT_MODEL
  const apiConfigured = Boolean(apiKey.trim())

  const draftRef = useRef<ScenarioDraft>({
    messages: [],
    nodes: [],
    edges: [],
    tailId: null,
    cursor: { x: 120, y: 180 },
    viewport: { tx: 48, ty: 40, scale: 1 },
    resolvedVersions: [],
    currentResolvedVersionId: null,
    extractions: [],
    activeTurnId: null,
  })
  const {
    vault,
    vaultRef,
    selectScenario,
    newScenario: createBlankScenario,
    deleteScenario,
    renameScenario,
    debouncedSave,
    scenarioList,
  } = useConversations(draftRef)

  const boot = vault.conversations[vault.currentId]!
  const [messages, setMessages] = useState<ChatMessage[]>(() => boot.messages)
  const [nodes, setNodes] = useState<GraphNode[]>(() => boot.graph.nodes.map(ensureNodeDimensions))
  const [edges, setEdges] = useState<GraphEdge[]>(() => boot.graph.edges)
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const [tailId, setTailId] = useState<string | null>(() => boot.graph.tailId)
  const [cursor, setCursor] = useState<PlacementCursor>(() => boot.graph.cursor)
  const [viewport, setViewport] = useState<Viewport>(() => boot.graph.viewport)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [toolMode, setToolMode] = useState<'add-edge' | null>(null)
  const [edgeFromId, setEdgeFromId] = useState<string | null>(null)
  const [fitRequest, setFitRequest] = useState(0)
  const edgeFromIdRef = useRef<string | null>(null)
  edgeFromIdRef.current = edgeFromId
  const [resolvedVersions, setResolvedVersions] = useState(
    () => boot.resolvedVersions ?? [],
  )
  const [currentResolvedVersionId, setCurrentResolvedVersionId] = useState<string | null>(
    () => boot.currentResolvedVersionId ?? null,
  )
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false)
  const [organicMindMap, setOrganicMindMap] = useState(() => {
    try {
      return localStorage.getItem(RENDER_MODE_KEY) !== 'classic'
    } catch {
      return true
    }
  })
  const [input, setInput] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [exploreMessages, setExploreMessages] = useState<ExploreMessage[]>([])
  const [exploreLoading, setExploreLoading] = useState(false)
  const [exploreExtracting, setExploreExtracting] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [extractions, setExtractions] = useState<ScenarioExtraction[]>(() => boot.extractions ?? [])
  const [activeTurnId, setActiveTurnId] = useState<string | null>(() => {
    const at = boot.activeTurnId ?? null
    const ex = boot.extractions ?? []
    return at && ex.some((e) => e.id === at) ? at : null
  })
  const activeTurnIdRef = useRef(activeTurnId)
  activeTurnIdRef.current = activeTurnId

  const warnedRef = useRef({ n50: false, n80: false })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const focusInputAfterHydrateRef = useRef(false)

  draftRef.current = {
    messages,
    nodes,
    edges,
    tailId,
    cursor,
    viewport,
    resolvedVersions,
    currentResolvedVersionId,
    extractions,
    activeTurnId,
  }

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed))
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    try {
      localStorage.setItem(RENDER_MODE_KEY, organicMindMap ? 'organic' : 'classic')
    } catch {
      /* ignore */
    }
  }, [organicMindMap])

  useEffect(() => {
    const id = vault.currentId
    const s = vaultRef.current.conversations[id]
    if (!s) return
    const h = hydrateFromScenario(s)
    setMessages(h.messages)
    setNodes(h.nodes)
    setEdges(h.edges)
    setTailId(h.tailId)
    setCursor(h.cursor)
    setViewport(h.viewport)
    setResolvedVersions(s.resolvedVersions ?? [])
    setCurrentResolvedVersionId(s.currentResolvedVersionId ?? null)
    const ex = s.extractions ?? []
    setExtractions(ex)
    const at = s.activeTurnId ?? null
    setActiveTurnId(at && ex.some((e) => e.id === at) ? at : null)
    warnedRef.current = { n50: false, n80: false }
    setSelectedId(null)
    setSelectedEdgeId(null)
    setToolMode(null)
    setEdgeFromId(null)
    setInput('')
    setExploreMessages([])
    setExploreLoading(false)
    setExploreExtracting(false)
    if (focusInputAfterHydrateRef.current) {
      focusInputAfterHydrateRef.current = false
      queueMicrotask(() => inputRef.current?.focus())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.currentId])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => debouncedSave(), 400)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [
    messages,
    nodes,
    edges,
    tailId,
    cursor,
    viewport,
    resolvedVersions,
    currentResolvedVersionId,
    extractions,
    activeTurnId,
    debouncedSave,
  ])

  const onMoveNode = useCallback((id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)))
  }, [])

  const onEditNode = useCallback((id: string, text: string) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n
        const next = { ...n, text }
        const needH = measureContentHeight(next)
        const { minH } = minSizeForKind(n.kind)
        return { ...next, height: Math.max(n.height ?? minH, needH, minH) }
      }),
    )
  }, [])

  const onResizeNode = useCallback((id: string, width: number, height: number) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n
        const { minW, minH } = minSizeForKind(n.kind)
        const w = Math.max(minW, width)
        const needH = measureContentHeight({ ...n, width: w, height: 4000 })
        const h = Math.max(minH, height, needH)
        return { ...n, width: w, height: h }
      }),
    )
  }, [])

  const onDeleteNode = useCallback((id: string) => {
    setExtractions((prev) => {
      const next = prev
        .map((ex) => ({ ...ex, nodeIds: ex.nodeIds.filter((nid) => nid !== id) }))
        .filter((ex) => ex.nodeIds.length > 0)
      const cur = activeTurnIdRef.current
      if (cur && !next.some((e) => e.id === cur)) {
        queueMicrotask(() => setActiveTurnId(null))
      }
      return next
    })
    setEdges((prevE) => {
      const nextE = prevE.filter((e) => e.from !== id && e.to !== id)
      setNodes((prevN) => {
        const nextN = prevN.filter((n) => n.id !== id)
        setTailId((t) => {
          if (t !== id) return t
          return nextN[nextN.length - 1]?.id ?? null
        })
        return withExploreLayout(nextN, nextE)
      })
      return nextE
    })
    setSelectedId((s) => (s === id ? null : s))
    setSelectedEdgeId(null)
  }, [])

  const onDeleteEdge = useCallback(() => {
    if (!selectedEdgeId) return
    const eid = selectedEdgeId
    setEdges((prev) => {
      const next = prev.filter((e) => e.id !== eid)
      setNodes((prevN) => withExploreLayout(prevN, next))
      return next
    })
    setSelectedEdgeId(null)
  }, [selectedEdgeId])

  const onNodeClickAddEdge = useCallback((toId: string) => {
    const from = edgeFromIdRef.current
    if (!from) {
      setEdgeFromId(toId)
      return
    }
    if (from === toId) return
    setEdges((prev) => {
      if (prev.some((e) => e.from === from && e.to === toId)) return prev
      const next = [...prev, { id: crypto.randomUUID(), from, to: toId }]
      setNodes((prevN) => withExploreLayout(prevN, next))
      return next
    })
    setEdgeFromId(null)
    setToolMode(null)
  }, [])

  const addManualNode = useCallback(() => {
    const k = window.prompt('Node type: consequence, question, assumption, or root', 'consequence')
    if (!k) return
    const kind = k.trim().toLowerCase() as NodeKind
    if (!['consequence', 'question', 'assumption', 'root'].includes(kind)) return
    const text = window.prompt('Label text', 'New node')
    if (text == null || !text.trim()) return
    if (nodes.length >= MAX_NODES) return
    const { width, height } = defaultSizeForKind(kind)
    const n: GraphNode = {
      id: crypto.randomUUID(),
      kind,
      x: LAYOUT_CX,
      y: LAYOUT_CY + 80,
      text: text.trim(),
      width,
      height,
    }
    const needH = measureContentHeight(n)
    const { minH } = minSizeForKind(kind)
    n.height = Math.max(minH, needH)
    setNodes((prev) => withExploreLayout([...prev, ensureNodeDimensions(n)], edgesRef.current))
    setSelectedId(n.id)
    setSelectedEdgeId(null)
  }, [nodes.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const inField =
        t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable

      if (e.key === 'Escape') {
        setToolMode(null)
        setEdgeFromId(null)
        return
      }

      if (inField) return

      if (e.key === 'a' || e.key === 'A') {
        if (e.metaKey || e.ctrlKey) return
        e.preventDefault()
        addManualNode()
        return
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        setToolMode('add-edge')
        setEdgeFromId(null)
        return
      }
      if (e.key === 'z' || e.key === 'Z') {
        if (e.metaKey || e.ctrlKey) return
        e.preventDefault()
        setFitRequest((x) => x + 1)
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        if (!selectedId) return
        e.preventDefault()
        const n = nodes.find((x) => x.id === selectedId)
        if (!n) return
        const next = window.prompt('Edit label', n.text)
        if (next != null && next.trim()) onEditNode(n.id, next.trim())
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEdgeId) {
          e.preventDefault()
          onDeleteEdge()
          return
        }
        if (selectedId) {
          e.preventDefault()
          onDeleteNode(selectedId)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    addManualNode,
    nodes,
    onDeleteEdge,
    onDeleteNode,
    onEditNode,
    selectedEdgeId,
    selectedId,
  ])

  const pushMessage = useCallback((m: Omit<ChatMessage, 'id'>) => {
    setMessages((prev) => [...prev, { ...m, id: crypto.randomUUID() }])
  }, [])

  const applyExtractionPayload = useCallback(
    (
      payload: ExtractionPayload,
      meta: { labelSource: string; messageIndexForTurn: number; isFirstScenarioMessage: boolean },
    ):
      | { ok: true; summary: string; sizedLength: number; turnId: string }
      | { ok: false; code: 'limit' | 'empty' } => {
      const hasRoot = nodes.some((n) => n.kind === 'root')
      const rootExtra = meta.isFirstScenarioMessage && !hasRoot ? 1 : 0
      const totalNew =
        rootExtra +
        payload.assumptions.length +
        payload.consequences.length +
        payload.questions.length

      if (nodes.length + totalNew > MAX_NODES) {
        return { ok: false, code: 'limit' }
      }
      if (totalNew === 0) {
        return { ok: false, code: 'empty' }
      }

      const result = appendExtractionToGraph(payload, nodes, edges, tailId, cursor)
      const laid = radialLayoutNewNodes(
        result.nodes,
        result.edges,
        LAYOUT_CX,
        LAYOUT_CY,
        new Set(result.newNodeIds),
      )
      const sized = laid.map((n) => {
        const base = ensureNodeDimensions(n)
        const needH = measureContentHeight(base)
        const { minH } = minSizeForKind(base.kind)
        return { ...base, height: Math.max(base.height ?? minH, needH, minH) }
      })
      const turnId = crypto.randomUUID()
      const extractedAt = Date.now()
      const tagged = sized.map((n) =>
        result.newNodeIds.includes(n.id) ? { ...n, turnId, extractedAt } : n,
      )
      setNodes(withExploreLayout(tagged, result.edges))
      setEdges(result.edges)
      setExtractions((prev) => [
        ...prev,
        {
          id: turnId,
          timestamp: extractedAt,
          messageIndex: meta.messageIndexForTurn,
          nodeIds: [...result.newNodeIds],
          label: excerpt(meta.labelSource, 44),
        },
      ])
      setTailId(result.tailId)
      setCursor(result.cursor)
      return { ok: true, summary: result.summary, sizedLength: sized.length, turnId }
    },
    [nodes, edges, tailId, cursor],
  )

  const newScenario = useCallback(() => {
    focusInputAfterHydrateRef.current = true
    createBlankScenario()
  }, [createBlankScenario])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || extracting || !apiConfigured) return
    const isFirstScenarioMessage = messages.filter((m) => m.role === 'user').length === 0
    const messageIndexForTurn = messages.length
    const labelSource = text
    setInput('')
    pushMessage({ role: 'user', content: text })
    setExtracting(true)

    if (nodes.length >= MAX_NODES) {
      pushMessage({
        role: 'system',
        content: `Canvas is at the ${MAX_NODES}-node limit. Delete nodes to add more.`,
      })
      setExtracting(false)
      return
    }

    try {
      const payload = await extractScenario(text, apiKey, model, isFirstScenarioMessage)
      const applied = applyExtractionPayload(payload, {
        labelSource,
        messageIndexForTurn,
        isFirstScenarioMessage,
      })

      if (applied.ok === false) {
        if (applied.code === 'limit') {
          pushMessage({
            role: 'system',
            content:
              `That would exceed the canvas limit (${MAX_NODES} nodes). Remove some nodes and try again.`,
          })
        } else {
          pushMessage({
            role: 'system',
            content:
              'No consequences or questions were extracted from that message. Try adding a bit more causal detail, or rephrase as a scenario with stakes and actors.',
          })
        }
        return
      }

      pushMessage({
        role: 'system',
        content: 'Extraction complete.',
        extractionSummary: applied.summary,
      })

      const n = applied.sizedLength
      if (n >= HARD_WARN_NODES && !warnedRef.current.n80) {
        warnedRef.current.n80 = true
        pushMessage({
          role: 'system',
          content:
            'This canvas is getting dense (80+ nodes). Consider pausing new extractions or clearing older branches for clarity.',
        })
      } else if (n >= WARN_NODES && !warnedRef.current.n50) {
        warnedRef.current.n50 = true
        pushMessage({
          role: 'system',
          content:
            'You have 50+ nodes. If the map feels crowded, drag related items into clusters or delete strays.',
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      pushMessage({
        role: 'system',
        content: `Could not reach Claude or parse the response: ${msg}`,
      })
    } finally {
      setExtracting(false)
    }
  }

  const handleExploreSend = useCallback(
    async (text: string) => {
      if (!apiConfigured || extracting) return
      const trimmed = text.trim()
      if (!trimmed) return

      const userMsg: ExploreMessage = { role: 'user', content: trimmed, timestamp: Date.now() }
      let historyForApi: ExploreMessage[] = []
      setExploreMessages((prev) => {
        historyForApi = [...prev, userMsg]
        return historyForApi
      })

      setExploreLoading(true)
      try {
        const reply = await sendExploreCasualReply(historyForApi, apiKey, model)
        setExploreMessages((prev) => [
          ...prev,
          { role: 'assistant', content: reply, timestamp: Date.now() },
        ])
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Request failed'
        setExploreMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Couldn't reply: ${msg}`, timestamp: Date.now() },
        ])
      } finally {
        setExploreLoading(false)
      }
    },
    [apiConfigured, extracting, apiKey, model],
  )

  const handleExploreExtract = useCallback(async () => {
    if (!apiConfigured || exploreExtracting || extracting || exploreMessages.length === 0) return
    if (nodes.length >= MAX_NODES) {
      pushMessage({
        role: 'system',
        content: `Canvas is at the ${MAX_NODES}-node limit. Delete nodes to add more.`,
      })
      return
    }
    setExploreExtracting(true)
    try {
      const transcript = exploreMessages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n')
      const branchPrompt = `The user explored a branch of their scenario in this short chat:\n\n${transcript}\n\nExtract consequences, questions, and assumptions implied by this branch (focus on stakes and knock-on effects the user cares about). Be concise.`
      const labelFromUsers = exploreMessages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join(' → ')
      const payload = await extractScenario(branchPrompt, apiKey, model, false)
      const messageIndexForTurn = messages.length
      const applied = applyExtractionPayload(payload, {
        labelSource: labelFromUsers || excerpt(transcript, 120),
        messageIndexForTurn,
        isFirstScenarioMessage: false,
      })

      if (applied.ok === false) {
        if (applied.code === 'limit') {
          pushMessage({
            role: 'system',
            content:
              `That would exceed the canvas limit (${MAX_NODES} nodes). Remove some nodes and try again.`,
          })
        } else {
          pushMessage({
            role: 'system',
            content:
              'Nothing to extract from that explore thread yet. Add a bit more detail, then try again.',
          })
        }
        return
      }

      setExploreMessages([])
      setActiveTurnId(applied.turnId)
      setFitRequest((x) => x + 1)
      pushMessage({
        role: 'system',
        content: 'Extracted branch from explore chat.',
        extractionSummary: applied.summary,
      })

      const n = applied.sizedLength
      if (n >= HARD_WARN_NODES && !warnedRef.current.n80) {
        warnedRef.current.n80 = true
        pushMessage({
          role: 'system',
          content:
            'This canvas is getting dense (80+ nodes). Consider pausing new extractions or clearing older branches for clarity.',
        })
      } else if (n >= WARN_NODES && !warnedRef.current.n50) {
        warnedRef.current.n50 = true
        pushMessage({
          role: 'system',
          content:
            'You have 50+ nodes. If the map feels crowded, drag related items into clusters or delete strays.',
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      pushMessage({
        role: 'system',
        content: `Explore extract failed: ${msg}`,
      })
    } finally {
      setExploreExtracting(false)
    }
  }, [
    apiConfigured,
    exploreExtracting,
    extracting,
    exploreMessages,
    nodes.length,
    apiKey,
    model,
    applyExtractionPayload,
    messages.length,
    pushMessage,
  ])

  const activeResolvedVersion = useMemo(
    () => resolvedVersions.find((v) => v.id === currentResolvedVersionId) ?? null,
    [resolvedVersions, currentResolvedVersionId],
  )

  const viewingResolved = Boolean(activeResolvedVersion)

  const canvasNodes = useMemo(() => {
    if (!activeResolvedVersion) return nodes
    const laid = layoutResolvedDisplay(activeResolvedVersion)
    const dispEdges = buildResolvedDisplayEdges(activeResolvedVersion)
    return runForceLayoutResolved(laid, dispEdges, activeResolvedVersion, LAYOUT_CX, LAYOUT_CY)
  }, [activeResolvedVersion, nodes])

  const canvasEdges = useMemo(() => {
    if (!activeResolvedVersion) return edges
    return buildResolvedDisplayEdges(activeResolvedVersion)
  }, [activeResolvedVersion, edges])

  const orphanNodeSet = useMemo(() => {
    if (!activeResolvedVersion) return undefined
    return orphanIdSet(activeResolvedVersion)
  }, [activeResolvedVersion])

  const graphNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes])

  const selectedNode = selectedId
    ? (viewingResolved ? canvasNodes : nodes).find((n) => n.id === selectedId)
    : null
  const selectedEdge = selectedEdgeId
    ? (viewingResolved ? canvasEdges : edges).find((e) => e.id === selectedEdgeId)
    : null

  const toolbarStatus = useMemo(() => {
    const prefix = viewingResolved ? 'Resolved view · ' : ''
    if (toolMode === 'add-edge' && !viewingResolved) {
      return (
        prefix +
        (edgeFromId
          ? `Source set — click target. (${edgeFromId.slice(0, 8)}…)`
          : 'Click source node, then target.')
      )
    }
    if (selectedEdgeId) {
      const pool = viewingResolved ? canvasEdges : edges
      const e = pool.find((x) => x.id === selectedEdgeId)
      return prefix + (e ? `Edge ${e.from.slice(0, 6)}… → ${e.to.slice(0, 6)}…` : 'Edge selected')
    }
    if (selectedId) {
      const pool = viewingResolved ? canvasNodes : nodes
      const n = pool.find((x) => x.id === selectedId)
      return (
        prefix +
        (n ? `Node: ${n.text.slice(0, 48)}${n.text.length > 48 ? '…' : ''}` : 'Node selected')
      )
    }
    return prefix + (viewingResolved ? 'Read-only snapshot' : 'Nothing selected')
  }, [
    viewingResolved,
    toolMode,
    edgeFromId,
    selectedEdgeId,
    selectedId,
    edges,
    nodes,
    canvasEdges,
    canvasNodes,
  ])

  const canResolve = Boolean(nodes.some((n) => n.kind === 'root')) && !viewingResolved

  const onDeleteResolvedVersion = useCallback((id: string) => {
    setResolvedVersions((prev) => prev.filter((x) => x.id !== id))
    setCurrentResolvedVersionId((cur) => (cur === id ? null : cur))
  }, [])

  const onViewLatestResolved = useCallback(() => {
    const sorted = [...resolvedVersions].sort((a, b) => b.timestamp - a.timestamp)
    const latest = sorted[0]
    if (latest) setCurrentResolvedVersionId(latest.id)
  }, [resolvedVersions])

  const confirmResolve = useCallback(() => {
    const v = resolveGraph(nodes, edges, messages)
    if (!v) {
      window.alert('Add a root node (first scenario message) before resolving.')
      setResolveDialogOpen(false)
      return
    }
    setResolvedVersions((prev) => [...prev, v])
    setCurrentResolvedVersionId(v.id)
    setResolveDialogOpen(false)
    setToolMode(null)
    setEdgeFromId(null)
    setFitRequest((x) => x + 1)
  }, [nodes, edges, messages])

  const prevResolvedRef = useRef<string | null>(null)
  useEffect(() => {
    if (currentResolvedVersionId && currentResolvedVersionId !== prevResolvedRef.current) {
      prevResolvedRef.current = currentResolvedVersionId
      setFitRequest((x) => x + 1)
    }
    if (!currentResolvedVersionId) prevResolvedRef.current = null
  }, [currentResolvedVersionId])

  useEffect(() => {
    setSelectedEdgeId(null)
  }, [currentResolvedVersionId])

  useEffect(() => {
    if (viewingResolved) {
      setToolMode(null)
      setEdgeFromId(null)
    }
  }, [viewingResolved])

  const onExploreNodeDragEnd = useCallback((_nodeId: string) => {
    setNodes((prevN) =>
      mergeForcePositions(
        prevN,
        runForceLayoutExploreTicks(prevN, edgesRef.current, LAYOUT_CX, LAYOUT_CY, DRAG_RELAX_TICKS),
        { blendNew: DRAG_RELAX_BLEND },
      ),
    )
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-row">
      {resolveDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onClick={() => setResolveDialogOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resolve-dialog-title"
            className="max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="resolve-dialog-title" className="text-base font-semibold text-[var(--text-h)]">
              Restructure this map?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text)]">
              The exploration graph stays intact. A new resolved snapshot will be created and you can
              switch back anytime.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-h)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setResolveDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/15 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/25"
                onClick={confirmResolve}
              >
                Create snapshot
              </button>
            </div>
          </div>
        </div>
      )}
      <ConversationSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        scenarios={scenarioList}
        currentId={vault.currentId}
        onNewScenario={newScenario}
        onSelectScenario={selectScenario}
        onDeleteScenario={deleteScenario}
        onRenameScenario={renameScenario}
        resolvedVersions={resolvedVersions}
        currentResolvedVersionId={currentResolvedVersionId}
        onSelectResolvedVersion={setCurrentResolvedVersionId}
        onDeleteResolvedVersion={onDeleteResolvedVersion}
        extractions={extractions}
        activeTurnId={activeTurnId}
        onSelectTurn={setActiveTurnId}
        graphNodeIds={graphNodeIds}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-row">
        <DelphiCanvas
          nodes={canvasNodes}
          edges={canvasEdges}
          activeTurnId={activeTurnId}
          fitRequest={fitRequest}
          viewport={viewport}
          onViewportChange={setViewport}
          selectedId={selectedId}
          onSelect={setSelectedId}
          selectedEdgeId={selectedEdgeId}
          onSelectEdge={setSelectedEdgeId}
          toolMode={viewingResolved ? null : toolMode}
          onNodeClickAddEdge={onNodeClickAddEdge}
          onMoveNode={onMoveNode}
          onNodeDragEnd={viewingResolved ? undefined : onExploreNodeDragEnd}
          onDeleteNode={onDeleteNode}
          onEditNode={onEditNode}
          onResizeNode={onResizeNode}
          readOnly={viewingResolved}
          orphanNodeIds={orphanNodeSet}
          canvasVariant={viewingResolved ? 'resolved' : 'original'}
          renderMode={organicMindMap ? 'organic' : 'classic'}
          editorToolbar={{
            statusText: toolbarStatus,
            toolMode: viewingResolved ? null : toolMode,
            canDeleteNode: !viewingResolved && Boolean(selectedId),
            canDeleteEdge: !viewingResolved && Boolean(selectedEdgeId),
            canEdit: !viewingResolved && Boolean(selectedId),
            onAddNode: addManualNode,
            onAddEdge: () => {
              setToolMode('add-edge')
              setEdgeFromId(null)
            },
            onCancelTool: () => {
              setToolMode(null)
              setEdgeFromId(null)
            },
            onDeleteNode: () => selectedId && onDeleteNode(selectedId),
            onDeleteEdge: onDeleteEdge,
            onEdit: () => {
              if (!selectedNode) return
              const next = window.prompt('Edit label', selectedNode.text)
              if (next != null && next.trim()) onEditNode(selectedNode.id, next.trim())
            },
            onInfo: () => {
              if (selectedEdge && selectedEdgeId) {
                window.alert(
                  `Edge id: ${selectedEdgeId}\nFrom: ${selectedEdge.from}\nTo: ${selectedEdge.to}`,
                )
                return
              }
              if (selectedNode) {
                window.alert(
                  `Node id: ${selectedNode.id}\nKind: ${selectedNode.kind}\nText: ${selectedNode.text}`,
                )
              } else {
                window.alert('Select a node or edge first.')
              }
            },
            canResolve,
            onRequestResolve: () => setResolveDialogOpen(true),
            viewingResolved,
            hasResolvedSnapshots: resolvedVersions.length > 0,
            onViewOriginal: () => setCurrentResolvedVersionId(null),
            onViewLatestResolved,
            organicMindMap,
            onToggleRenderMode: () => {
              setOrganicMindMap((v) => !v)
              setFitRequest((x) => x + 1)
            },
          }}
        />
        <ExploreChat
          messages={exploreMessages}
          onSendMessage={handleExploreSend}
          onExtractBranch={handleExploreExtract}
          exploreLoading={exploreLoading}
          extractLoading={exploreExtracting}
          disabled={viewingResolved || extracting}
          apiConfigured={apiConfigured}
        />
      </div>
      <ChatPanel
        messages={messages}
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        extracting={extracting}
        nodeCount={nodes.length}
        apiConfigured={apiConfigured}
        inputRef={inputRef}
      />
    </div>
  )
}
