import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const API_URL = 'https://delphi-api.gladesystems.workers.dev/delphi/analyse'
const LS_PASSCODE = 'delphi_passcode'
const LS_SESSION = 'delphi_session_id'
const LS_MESSAGES = 'delphi_messages_v1'

type ChatMsg = { id: string; role: 'user' | 'assistant'; content: string }

const DELPHI_SECTIONS = [
  'MOVE',
  'MECHANISM',
  'CONFIDENCE',
  'SECOND ORDER',
  'THIRD ORDER',
  'COUNTERMOVES',
  'DISTRIBUTED VERSION',
  'HISTORICAL PARALLEL',
  'LEVERAGE POINT',
  'REVERSIBILITY',
  'WEAKEST ASSUMPTION',
  "WHAT DELPHI DOESN'T KNOW",
] as const

function parseDelphiResponse(text: string): { label: string; content: string }[] {
  const positions: { label: string; idx: number }[] = []
  for (const label of DELPHI_SECTIONS) {
    const idx = text.indexOf(label)
    if (idx !== -1) positions.push({ label, idx })
  }
  positions.sort((a, b) => a.idx - b.idx)
  const result: { label: string; content: string }[] = []
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx + positions[i].label.length
    const end = i + 1 < positions.length ? positions[i + 1].idx : text.length
    const content = text.slice(start, end).replace(/^[\s:\n]+/, '').trim()
    if (content) result.push({ label: positions[i].label, content })
  }
  return result.length > 0 ? result : [{ label: '', content: text }]
}

type IntroStar = {
  x: number
  y: number
  r: number
  base: number
  phase: number
  twinkleSpeed: number
  shimmerAmp: number
  bright: boolean
}

type DustMote = {
  x: number
  y: number
  r: number
  dx: number
  dy: number
  op: number
}

function NightSkyCanvas() {
  const skyRef = useRef<HTMLCanvasElement>(null)
  const starsRef = useRef<IntroStar[]>([])
  const dustRef = useRef<DustMote[]>([])

  useEffect(() => {
    const canvas = skyRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const placeDust = () => {
      const w = canvas.width
      const h = canvas.height
      dustRef.current = Array.from({ length: 40 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.5 + Math.random() * 1.2,
        dx: (Math.random() - 0.5) * 0.08,
        dy: -0.05 - Math.random() * 0.1,
        op: 0.1 + Math.random() * 0.25,
      }))
    }

    const placeStars = () => {
      const w = canvas.width
      const h = canvas.height
      starsRef.current = Array.from({ length: 160 }, () => {
        let x = 0
        let y = 0
        for (let tries = 0; tries < 40; tries++) {
          x = Math.random() * w
          y = Math.random() * h
          if (!(x > w - 130 && y < 125)) break
        }
        const isFast = Math.random() < 0.1
        const twinkleSpeed = isFast
          ? 0.01 + Math.random() * 0.025
          : 0.003 + Math.random() * 0.007
        const shimmerAmp = isFast ? 0.2 + Math.random() * 0.3 : 0.08 + Math.random() * 0.12
        return {
          x,
          y,
          r: 0.35 + Math.random() * 1.4,
          base: 0.35 + Math.random() * 0.65,
          phase: Math.random() * Math.PI * 2,
          twinkleSpeed,
          shimmerAmp,
          bright: Math.random() < 0.18,
        }
      })
    }

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      placeStars()
      placeDust()
    }
    resize()

    let raf = 0
    const draw = (tMs: number) => {
      const t = tMs / 1000
      const w = canvas.width
      const h = canvas.height
      ctx.fillStyle = '#030508'
      ctx.fillRect(0, 0, w, h)

      const mx = w - 68
      const my = 44
      ctx.fillStyle = '#e8e4dc'
      ctx.beginPath()
      ctx.arc(mx, my, 24, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(mx - 9, my, 20, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'

      for (const s of starsRef.current) {
        const tw = 0.5 + 0.5 * Math.sin(t * (s.twinkleSpeed * 100) + s.phase)
        const op = Math.min(1, s.base * (0.5 + s.shimmerAmp * tw))
        ctx.globalAlpha = op
        ctx.fillStyle = '#f0f4ff'
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
        if (s.bright && tw > 0.88) {
          ctx.globalAlpha = op * 0.85
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 0.6
          const k = 4 + tw * 2
          ctx.beginPath()
          ctx.moveTo(s.x - k, s.y)
          ctx.lineTo(s.x + k, s.y)
          ctx.moveTo(s.x, s.y - k)
          ctx.lineTo(s.x, s.y + k)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }

      for (const d of dustRef.current) {
        d.x += d.dx
        d.y += d.dy
        if (d.y < 0) d.y = h
        if (d.x < 0) d.x += w
        else if (d.x > w) d.x -= w
        ctx.globalAlpha = d.op
        ctx.fillStyle = '#dff0d8'
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={skyRef} className="night-sky-canvas night-sky-canvas--fixed" aria-hidden />
}

function WobblyPanel({
  children,
  padding = '12px 14px',
  viewW = 400,
  viewH = 200,
  style,
}: {
  children: ReactNode
  padding?: string
  viewW?: number
  viewH?: number
  style?: CSSProperties
}) {
  const bw = Math.max(2, viewW - 2)
  const bh = Math.max(2, viewH - 2)
  return (
    <div
      style={{
        position: 'relative',
        padding,
        border: 'none',
        borderRadius: 0,
        boxShadow: 'none',
        ...style,
      }}
    >
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        viewBox={`0 0 ${viewW} ${viewH}`}
        preserveAspectRatio="none"
        filter="url(#rough)"
        aria-hidden
      >
        <rect
          x="1"
          y="1"
          width={bw}
          height={bh}
          rx="1"
          ry="1"
          fill="rgba(18,35,22,0.75)"
          stroke="#2d4a35"
          strokeWidth="0.8"
          vectorEffect="nonScalingStroke"
        />
      </svg>
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  )
}

function PasscodeGate({
  onSubmit,
}: {
  onSubmit: (passcode: string) => void
}) {
  const [value, setValue] = useState('')

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(2, 6, 3, 0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <WobblyPanel padding="22px 24px" viewH={160} viewW={380} style={{ width: '100%', maxWidth: 400 }}>
        <p
          style={{
            fontSize: '9px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#4a7c59',
            fontFamily: 'Arial, sans-serif',
            marginBottom: 10,
          }}
        >
          Delphi
        </p>
        <p style={{ fontSize: '16px', color: '#cce8c0', marginBottom: 14, fontFamily: 'Georgia, serif' }}>
          Enter passcode
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) onSubmit(value.trim())
          }}
        >
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Passcode"
            autoFocus
            className="delphi-textarea"
            style={{ width: '100%', fontStyle: 'normal' }}
          />
          <button type="submit" className="delphi-btn" style={{ marginTop: 14, width: '100%' }}>
            Continue
          </button>
        </form>
      </WobblyPanel>
    </div>
  )
}

function AssistantSections({ text }: { text: string }) {
  const parts = parseDelphiResponse(text)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {parts.map((p, i) => (
        <WobblyPanel key={i} padding="10px 14px" viewH={120} viewW={500} style={{ width: '100%' }}>
          {p.label ? (
            <div
              style={{
                fontSize: '9px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#4a7c59',
                fontFamily: 'Arial, sans-serif',
                marginBottom: 8,
              }}
            >
              {p.label}
            </div>
          ) : null}
          <div className="delphi-section-body">{p.content}</div>
        </WobblyPanel>
      ))}
    </div>
  )
}

export default function App() {
  const [passcode, setPasscode] = useState<string | null>(() => localStorage.getItem(LS_PASSCODE))
  const [sessionId, setSessionId] = useState<string | null>(() => localStorage.getItem(LS_SESSION))
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    try {
      const raw = localStorage.getItem(LS_MESSAGES)
      if (!raw) return []
      const parsed = JSON.parse(raw) as ChatMsg[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(LS_MESSAGES, JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    if (sessionId) localStorage.setItem(LS_SESSION, sessionId)
    else localStorage.removeItem(LS_SESSION)
  }, [sessionId])

  const persistPasscode = useCallback((p: string) => {
    localStorage.setItem(LS_PASSCODE, p)
    setPasscode(p)
  }, [])

  const newSession = useCallback(() => {
    setSessionId(null)
    setMessages([])
    localStorage.removeItem(LS_SESSION)
    localStorage.removeItem(LS_MESSAGES)
    setError(null)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async () => {
    const text = input.trim()
    if (!text || !passcode || loading) return
    setInput('')
    setError(null)
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', content: text }
    setMessages((m) => [...m, userMsg])
    setLoading(true)
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passcode}`,
        },
        body: JSON.stringify({
          message: text,
          ...(sessionId ? { session_id: sessionId } : {}),
        }),
      })
      const data = (await res.json()) as { reply?: string; session_id?: string; error?: string }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      const reply = data.reply ?? ''
      if (data.session_id) setSessionId(data.session_id)
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', content: reply },
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  if (!passcode) {
    return (
      <>
        <div style={{ position: 'fixed', width: 0, height: 0, overflow: 'hidden' }} aria-hidden>
          <svg width="0" height="0">
            <defs>
              <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
                <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed="3" result="noise" />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="noise"
                  scale="2.2"
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            </defs>
          </svg>
        </div>
        <NightSkyCanvas />
        <div className="journal-vignette-delphi" aria-hidden />
        <PasscodeGate onSubmit={persistPasscode} />
      </>
    )
  }

  return (
    <>
      <div style={{ position: 'fixed', width: 0, height: 0, overflow: 'hidden' }} aria-hidden>
        <svg width="0" height="0">
          <defs>
            <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed="3" result="noise" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="2.2"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>
      </div>
      <NightSkyCanvas />
      <div className="journal-vignette-delphi" aria-hidden />

      <div className="delphi-shell">
        <header style={{ textAlign: 'center', flexShrink: 0, paddingBottom: 8 }}>
          <h1
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: '22px',
              letterSpacing: '0.5em',
              color: '#aed4b8',
              fontWeight: 600,
              fontStyle: 'italic',
            }}
          >
            DELPHI
          </h1>
          <p
            style={{
              fontSize: '10px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#4a7c59',
              fontFamily: 'Arial, sans-serif',
              marginTop: 6,
            }}
          >
            consequence mapping & strategy
          </p>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 10 }}>
            <button type="button" className="delphi-btn delphi-btn--ghost" onClick={newSession}>
              New session
            </button>
            <button
              type="button"
              className="delphi-btn delphi-btn--ghost"
              onClick={() => {
                localStorage.removeItem(LS_PASSCODE)
                setPasscode(null)
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        {error ? (
          <WobblyPanel padding="10px 12px" viewH={56} viewW={400} style={{ flexShrink: 0 }}>
            <p style={{ color: '#c08080', fontSize: 13 }}>{error}</p>
          </WobblyPanel>
        ) : null}

        <div className="delphi-messages">
          {messages.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#5a9e6f', fontStyle: 'italic', fontSize: 14 }}>
              Describe a move or decision. Delphi maps consequences.
            </p>
          ) : null}
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <WobblyPanel key={msg.id} padding="10px 14px" viewH={72} viewW={400} style={{ alignSelf: 'flex-end', maxWidth: '92%' }}>
                <div className="delphi-user-bubble">{msg.content}</div>
              </WobblyPanel>
            ) : (
              <div key={msg.id} style={{ alignSelf: 'stretch' }}>
                <AssistantSections text={msg.content} />
              </div>
            ),
          )}
          {loading ? (
            <WobblyPanel padding="12px 14px" viewH={48} viewW={200} style={{ alignSelf: 'center' }}>
              <span style={{ color: '#5a9e6f', fontStyle: 'italic', fontSize: 13 }}>Delphi is thinking…</span>
            </WobblyPanel>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <WobblyPanel padding="10px 12px" viewH={100} viewW={600} style={{ flexShrink: 0, width: '100%' }}>
          <div className="delphi-input-row">
            <textarea
              className="delphi-textarea"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What move are you considering?"
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <button type="button" className="delphi-btn" disabled={loading || !input.trim()} onClick={() => void send()}>
              Send
            </button>
          </div>
        </WobblyPanel>
      </div>
    </>
  )
}
