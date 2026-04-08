export interface EditorToolbarProps {
  statusText: string
  toolMode: 'add-edge' | null
  canDeleteNode: boolean
  canDeleteEdge: boolean
  canEdit: boolean
  onAddNode: () => void
  onAddEdge: () => void
  onCancelTool: () => void
  onDeleteNode: () => void
  onDeleteEdge: () => void
  onEdit: () => void
  onInfo: () => void
  /** Fit entire graph in view (also bound to Z). */
  onFitAll: () => void
  canResolve: boolean
  onRequestResolve: () => void
  viewingResolved: boolean
  hasResolvedSnapshots: boolean
  onViewOriginal: () => void
  onViewLatestResolved: () => void
  /** Curved organic branches vs boxed nodes. */
  organicMindMap: boolean
  onToggleRenderMode: () => void
}

export function EditorToolbar({
  statusText,
  toolMode,
  canDeleteNode,
  canDeleteEdge,
  canEdit,
  onAddNode,
  onAddEdge,
  onCancelTool,
  onDeleteNode,
  onDeleteEdge,
  onEdit,
  onInfo,
  onFitAll,
  canResolve,
  onRequestResolve,
  viewingResolved,
  hasResolvedSnapshots,
  onViewOriginal,
  onViewLatestResolved,
  organicMindMap,
  onToggleRenderMode,
}: EditorToolbarProps) {
  const btn =
    'rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-h)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--panel)] px-2 py-2">
      <button type="button" className={btn} onClick={onAddNode}>
        + Add node
      </button>
      <button
        type="button"
        className={btn}
        onClick={onAddEdge}
        title="Shortcut: E"
      >
        + Add edge
      </button>
      <button
        type="button"
        className={btn}
        disabled={!canDeleteNode}
        onClick={onDeleteNode}
        title="Shortcut: Del"
      >
        − Delete node
      </button>
      <button
        type="button"
        className={btn}
        disabled={!canDeleteEdge}
        onClick={onDeleteEdge}
      >
        − Delete edge
      </button>
      <button type="button" className={btn} disabled={!canEdit} onClick={onEdit} title="Shortcut: R">
        Edit
      </button>
      <button type="button" className={btn} onClick={onInfo}>
        Info
      </button>
      <button type="button" className={btn} onClick={onFitAll} title="Shortcut: Z">
        Fit all
      </button>
      <button
        type="button"
        className={btn}
        disabled={!canResolve}
        onClick={onRequestResolve}
        title="Heuristic restructure (keeps original graph)"
      >
        Resolve
      </button>
      {viewingResolved ? (
        <button type="button" className={btn} onClick={onViewOriginal}>
          View original
        </button>
      ) : (
        <button
          type="button"
          className={btn}
          disabled={!hasResolvedSnapshots}
          onClick={onViewLatestResolved}
        >
          View resolved
        </button>
      )}
      <button
        type="button"
        className={btn}
        onClick={onToggleRenderMode}
        title="Switch between organic curves and classic boxed nodes"
      >
        {organicMindMap ? 'Classic boxes' : 'Organic map'}
      </button>
      {toolMode && (
        <button type="button" className={btn} onClick={onCancelTool}>
          Cancel (Esc)
        </button>
      )}
      <span className="ml-auto min-w-0 max-w-[min(40vw,24rem)] truncate text-right text-[10px] text-[var(--text)]">
        {statusText}
      </span>
    </div>
  )
}
