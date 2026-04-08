import { useEffect, useRef, type RefObject } from 'react'
import type { ChatMessage } from '../types'

interface ChatPanelProps {
  messages: ChatMessage[]
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  extracting: boolean
  nodeCount: number
  apiConfigured: boolean
  inputRef?: RefObject<HTMLTextAreaElement | null>
}

export function ChatPanel({
  messages,
  input,
  onInputChange,
  onSend,
  extracting,
  nodeCount,
  apiConfigured,
  inputRef,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, extracting])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!extracting && input.trim() && apiConfigured) onSend()
    }
  }

  return (
    <div className="flex h-full min-h-0 w-[min(28vw,22rem)] min-w-[280px] max-w-md shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel)]">
      <header className="border-b border-[var(--border)] px-4 py-3">
        <h1 className="text-base font-semibold tracking-tight text-[var(--text-h)]">
          Scenario Explorer
        </h1>
        <p className="mt-0.5 text-xs text-[var(--text)]">
          {nodeCount} node{nodeCount === 1 ? '' : 's'} on canvas
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {!apiConfigured && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            Set <code className="rounded bg-black/5 px-1 dark:bg-white/10">VITE_ANTHROPIC_API_KEY</code>{' '}
            in <code className="rounded bg-black/5 px-1 dark:bg-white/10">.env.local</code>, then restart
            the dev server. If the key is set but you see a network error, use{' '}
            <code className="rounded bg-black/5 px-1 dark:bg-white/10">npm run dev</code> (Vite proxies
            Anthropic to avoid browser CORS).
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[95%] rounded-2xl px-3 py-2 text-sm leading-snug shadow-[var(--shadow)] ${
                m.role === 'user'
                  ? 'rounded-br-md bg-[var(--chat-user)] text-[var(--chat-user-fg)]'
                  : 'rounded-bl-md bg-[var(--chat-bot)] text-[var(--chat-bot-fg)]'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.extractionSummary && (
                <p className="mt-2 border-t border-black/10 pt-2 text-xs opacity-80 dark:border-white/10">
                  {m.extractionSummary}
                </p>
              )}
            </div>
          </div>
        ))}
        {extracting && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-[var(--chat-bot)] px-3 py-2 text-sm text-[var(--chat-bot-fg)]">
              Extracting consequences…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <textarea
          ref={inputRef}
          className="mb-2 min-h-[4.5rem] w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-h)] outline-none ring-0 transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]"
          placeholder="Describe a scenario… (Enter to send, Shift+Enter for newline)"
          value={input}
          disabled={extracting || !apiConfigured}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="w-full rounded-xl bg-[var(--accent)] py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={extracting || !input.trim() || !apiConfigured}
          onClick={onSend}
        >
          Send
        </button>
      </div>
    </div>
  )
}
