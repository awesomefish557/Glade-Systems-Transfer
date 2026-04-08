import { useRef, useState } from 'react'
import type { ResolvedVersion } from '../types'
import type { Scenario, ScenarioExtraction } from '../lib/scenarioStorage'

function formatUpdatedAt(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function formatRelative(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return formatUpdatedAt(ts)
}

function versionNodeCount(v: ResolvedVersion): number {
  return (
    1 +
    v.structure.assumptions.length +
    v.structure.primaryConsequences.length +
    v.structure.actionPaths.reduce((acc, p) => acc + 1 + p.children.length, 0) +
    v.structure.orphans.length
  )
}

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const tabBtn =
  'flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition'
const tabActive = 'bg-[var(--accent)]/15 text-[var(--accent)] ring-1 ring-[var(--accent-ring)]'
const tabIdle =
  'text-[var(--text)] hover:bg-black/5 dark:hover:bg-white/10'

export interface ConversationSidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  scenarios: Scenario[]
  currentId: string
  onNewScenario: () => void
  onSelectScenario: (id: string) => void
  onDeleteScenario: (id: string) => void
  onRenameScenario: (id: string, title: string) => void
  resolvedVersions: ResolvedVersion[]
  currentResolvedVersionId: string | null
  onSelectResolvedVersion: (id: string | null) => void
  onDeleteResolvedVersion: (id: string) => void
  /** Stage lighting: extractions for the current scenario. */
  extractions: ScenarioExtraction[]
  activeTurnId: string | null
  onSelectTurn: (turnId: string | null) => void
  /** Node ids on the live graph (for surviving counts). */
  graphNodeIds: ReadonlySet<string>
}

export function ConversationSidebar({
  collapsed,
  onToggleCollapsed,
  scenarios,
  currentId,
  onNewScenario,
  onSelectScenario,
  onDeleteScenario,
  onRenameScenario,
  resolvedVersions,
  currentResolvedVersionId,
  onSelectResolvedVersion,
  onDeleteResolvedVersion,
  extractions,
  activeTurnId,
  onSelectTurn,
  graphNodeIds,
}: ConversationSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [sidebarTab, setSidebarTab] = useState<'scenarios' | 'history' | 'turns'>('scenarios')
  const skipRenameCommitRef = useRef(false)

  const commitRename = (id: string) => {
    const t = editValue.trim()
    if (t) onRenameScenario(id, t)
    setEditingId(null)
  }

  const sortedResolved = [...resolvedVersions].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <aside
      className={`flex h-full min-h-0 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] transition-[width,min-width] duration-200 ease-out ${
        collapsed ? 'w-11 min-w-[2.75rem]' : 'w-[min(20vw,18rem)] min-w-[13rem] max-w-[18rem]'
      }`}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] px-1.5 py-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-h)] transition hover:bg-black/5 dark:hover:bg-white/10"
          title={collapsed ? 'Expand scenarios' : 'Collapse scenarios'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold tracking-tight text-[var(--text-h)]">Delphi</h2>
              <p className="truncate text-[10px] uppercase tracking-wide text-[var(--text)] opacity-80">
                Scenarios
              </p>
            </div>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="shrink-0 px-2 pb-2 pt-1">
          <button
            type="button"
            onClick={onNewScenario}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2 text-xs font-medium text-[var(--text-h)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            New scenario
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="flex shrink-0 flex-wrap gap-1 px-2 pb-2">
          <button
            type="button"
            className={`${tabBtn} ${sidebarTab === 'scenarios' ? tabActive : tabIdle}`}
            onClick={() => setSidebarTab('scenarios')}
          >
            Scenarios
          </button>
          <button
            type="button"
            className={`${tabBtn} ${sidebarTab === 'history' ? tabActive : tabIdle}`}
            onClick={() => setSidebarTab('history')}
          >
            Resolve
          </button>
          <button
            type="button"
            className={`${tabBtn} ${sidebarTab === 'turns' ? tabActive : tabIdle}`}
            onClick={() => setSidebarTab('turns')}
          >
            Turns
          </button>
        </div>
      )}

      {collapsed ? (
        <div className="flex flex-1 flex-col items-center gap-2 pt-2">
          <button
            type="button"
            onClick={onNewScenario}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-h)] transition hover:bg-black/5 dark:hover:bg-white/10"
            title="New scenario"
          >
            <span className="text-lg leading-none">+</span>
          </button>
        </div>
      ) : sidebarTab === 'turns' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <p className="mb-2 text-[10px] leading-snug text-[var(--text)] opacity-80">
            Highlight nodes from one chat extraction. Root stays bright. Manual nodes fade when a turn is
            lit.
          </p>
          <div
            className={`mb-2 rounded-lg border px-2 py-2 ${
              activeTurnId === null
                ? 'border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent-ring)]'
                : 'border-transparent hover:bg-black/5 dark:hover:bg-white/10'
            }`}
          >
            <button type="button" className="w-full text-left" onClick={() => onSelectTurn(null)}>
              <p className="text-xs font-medium text-[var(--text-h)]">Show all</p>
              <p className="text-[10px] text-[var(--text)] opacity-75">Full map at 100% opacity</p>
            </button>
          </div>
          <ul className="list-none space-y-1">
            {extractions.length === 0 ? (
              <li className="rounded-lg border border-dashed border-[var(--border)] px-2 py-3 text-center text-[10px] text-[var(--text)] opacity-70">
                No extractions yet. Send a scenario message to create nodes.
              </li>
            ) : (
              extractions.map((ex, idx) => {
                const alive = ex.nodeIds.filter((id) => graphNodeIds.has(id)).length
                const active = ex.id === activeTurnId
                return (
                  <li
                    key={ex.id}
                    className={`rounded-lg border px-2 py-2 ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent-ring)]'
                        : 'border-transparent hover:bg-black/5 dark:hover:bg-white/10'
                    }`}
                  >
                    <button type="button" className="w-full text-left" onClick={() => onSelectTurn(ex.id)}>
                      <p className="line-clamp-2 text-xs font-medium text-[var(--text-h)]">
                        {ex.label ?? `Turn ${idx + 1}`}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--text)] opacity-75">
                        {alive} node{alive === 1 ? '' : 's'} · {formatRelative(ex.timestamp)}
                      </p>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      ) : sidebarTab === 'scenarios' ? (
        <ul className="min-h-0 flex-1 list-none space-y-0.5 overflow-y-auto px-2 pb-3">
          {scenarios.map((s) => {
            const active = s.id === currentId
            const editing = editingId === s.id
            return (
              <li key={s.id} className="group relative">
                <div
                  className={`w-full rounded-lg border py-2 pl-2 pr-8 text-left transition ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent-ring)]'
                      : 'border-transparent hover:bg-black/5 dark:hover:bg-white/10'
                  }`}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => onSelectScenario(s.id)}
                  >
                    {editing ? (
                      <input
                        autoFocus
                        className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-xs font-medium text-[var(--text-h)] outline-none focus:ring-1 focus:ring-[var(--accent-ring)]"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            skipRenameCommitRef.current = true
                            commitRename(s.id)
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            skipRenameCommitRef.current = true
                            setEditingId(null)
                          }
                        }}
                        onBlur={() => {
                          if (skipRenameCommitRef.current) {
                            skipRenameCommitRef.current = false
                            return
                          }
                          commitRename(s.id)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <p
                        className="line-clamp-2 text-xs font-medium leading-snug text-[var(--text-h)]"
                        title={s.title}
                        onDoubleClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setEditingId(s.id)
                          setEditValue(s.title)
                        }}
                      >
                        {s.title}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-[var(--text)] opacity-75">
                      {formatUpdatedAt(s.updatedAt)}
                    </p>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteScenario(s.id)
                  }}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-[var(--text)] opacity-0 transition hover:bg-red-500/15 hover:text-red-600 group-hover:opacity-100 dark:hover:text-red-400"
                  title="Delete scenario"
                  aria-label={`Delete ${s.title}`}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <p className="mb-2 text-[10px] leading-snug text-[var(--text)] opacity-80">
            Snapshots for the current scenario. Original graph is never modified.
          </p>
          <ul className="list-none space-y-1">
            <li>
              <div
                className={`rounded-lg border px-2 py-2 ${
                  currentResolvedVersionId == null
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent-ring)]'
                    : 'border-transparent hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => onSelectResolvedVersion(null)}
                >
                  <p className="text-xs font-medium text-[var(--text-h)]">Original</p>
                  <p className="text-[10px] text-[var(--text)] opacity-75">Live exploration graph</p>
                </button>
              </div>
            </li>
            {sortedResolved.map((v, i) => {
              const n = versionNodeCount(v)
              const active = v.id === currentResolvedVersionId
              return (
                <li
                  key={v.id}
                  className={`rounded-lg border px-2 py-2 ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent-ring)]'
                      : 'border-transparent hover:bg-black/5 dark:hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onSelectResolvedVersion(v.id)}
                    >
                      <p className="text-xs font-medium text-[var(--text-h)]">
                        Resolved v{sortedResolved.length - i}
                      </p>
                      <p className="text-[10px] text-[var(--text)] opacity-80">
                        {formatRelative(v.timestamp)} · {n} nodes · {v.structure.orphans.length} orphans
                      </p>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-500/10 dark:text-red-400"
                      title="Delete snapshot"
                      onClick={() => {
                        if (window.confirm('Delete this resolved snapshot?')) onDeleteResolvedVersion(v.id)
                      }}
                    >
                      Del
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          {sortedResolved.length === 0 && (
            <p className="mt-3 text-center text-[10px] text-[var(--text)] opacity-60">
              No snapshots yet. Use Resolve on the canvas toolbar.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
