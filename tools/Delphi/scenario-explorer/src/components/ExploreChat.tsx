import { useEffect, useRef, useState } from 'react'
import type { ExploreMessage } from '../types'

interface ExploreChatProps {
  messages: ExploreMessage[]
  onSendMessage: (text: string) => Promise<void>
  onExtractBranch: () => Promise<void>
  exploreLoading: boolean
  extractLoading: boolean
  disabled?: boolean
  apiConfigured: boolean
}

export function ExploreChat({
  messages,
  onSendMessage,
  onExtractBranch,
  exploreLoading,
  extractLoading,
  disabled = false,
  apiConfigured,
}: ExploreChatProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const busy = exploreLoading || extractLoading

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, exploreLoading])

  const handleSend = async () => {
    const t = input.trim()
    if (!t || busy || disabled || !apiConfigured) return
    setInput('')
    await onSendMessage(t)
  }

  return (
    <div className="flex h-full min-h-0 w-[min(30vw,22rem)] min-w-[260px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel)]">
      <header className="shrink-0 border-b border-[var(--border)] px-3 py-2.5">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text)] opacity-80">
          Explore branch
        </h2>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--text)] opacity-70">
          Chat casually, then extract to the map.
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {!apiConfigured && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-900 dark:text-amber-100">
            API key required for explore chat.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={`${msg.timestamp}-${i}`}
            className={`flex text-xs leading-snug ${
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[92%] rounded-lg px-2.5 py-1.5 ${
                msg.role === 'user'
                  ? 'bg-[var(--chat-user)]/18 text-[var(--text-h)]'
                  : 'border border-[var(--border)] bg-[var(--bg)] text-[var(--text-h)]'
              }`}
            >
              <span className="mr-1 font-semibold opacity-50">
                {msg.role === 'assistant' ? '✦' : '→'}
              </span>
              <span className="whitespace-pre-wrap">{msg.content}</span>
            </div>
          </div>
        ))}
        {exploreLoading && (
          <div className="flex justify-start text-xs text-[var(--text)] opacity-70">
            <span className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5">
              …
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 space-y-2 border-t border-[var(--border)] p-2.5">
        <div className="flex gap-1.5">
          <input
            type="text"
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-xs text-[var(--text-h)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-ring)]"
            placeholder="Ask away…"
            value={input}
            disabled={busy || disabled || !apiConfigured}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
          />
          <button
            type="button"
            className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || disabled || !apiConfigured || !input.trim()}
            onClick={() => void handleSend()}
          >
            Send
          </button>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="w-full rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            disabled={busy || disabled || !apiConfigured}
            onClick={() => void onExtractBranch()}
          >
            {extractLoading ? 'Extracting…' : 'Extract branch'}
          </button>
        )}
      </div>
    </div>
  )
}
