'use client'

/*
 * components/agent/AgentDrawer.tsx
 *
 * Staff chat drawer for the agent (/api/agent). Text or mic (Web Speech API,
 * en-AU) input. The conversation lives in component state and is sent whole
 * each turn. Write actions come back as `pending` and show an Approve / Decline
 * card — nothing changes on the job until staff approve.
 */
import { useEffect, useRef, useState } from 'react'
import type Anthropic from '@anthropic-ai/sdk'

type Msg = Anthropic.MessageParam

interface Pending {
  tool_use_id: string
  name: string
  input: Record<string, unknown>
  summary: string
}

type Line = { who: 'you' | 'agent'; text: string } | { who: 'activity'; text: string }

const ACTIVITY: Record<string, string> = {
  find_jobs: 'Searched jobs',
  get_job_summary: 'Read job details',
  list_job_documents: 'Listed documents',
  list_job_photos: 'Searched photos',
  add_progress_note: 'Progress note',
  update_job_status: 'Job status',
  set_photos_in_reports: 'Photos in reports',
}

function toLines(messages: Msg[]): Line[] {
  const out: Line[] = []
  for (const m of messages) {
    if (typeof m.content === 'string') {
      if (m.content.trim()) out.push({ who: m.role === 'user' ? 'you' : 'agent', text: m.content })
      continue
    }
    for (const b of m.content) {
      if (b.type === 'text' && b.text.trim()) out.push({ who: m.role === 'user' ? 'you' : 'agent', text: b.text })
      else if (b.type === 'tool_use') out.push({ who: 'activity', text: ACTIVITY[b.name] ?? b.name })
      else if (b.type === 'tool_result' && b.is_error) out.push({ who: 'activity', text: `Failed: ${String(b.content).slice(0, 140)}` })
    }
  }
  return out
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export default function AgentDrawer({ jobId, onChanged }: { jobId?: string; onChanged?: () => void }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const [canListen, setCanListen] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const baseTextRef = useRef('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCanListen(speechRecognitionCtor() !== null)
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, pending, busy])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => () => recRef.current?.stop(), [])

  async function call(next: Msg[], approval?: { tool_use_id: string; approved: boolean }) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, job_id: jobId, approval }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Agent request failed')
      setMessages(data.messages ?? next)
      setPending(data.pending ?? null)
      if (approval?.approved) onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Agent request failed')
    } finally {
      setBusy(false)
    }
  }

  function send() {
    const text = input.trim()
    if (!text || busy) return
    recRef.current?.stop()
    setInput('')
    setPending(null)
    const next: Msg[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    void call(next)
  }

  function decide(approved: boolean) {
    if (!pending || busy) return
    const p = pending
    setPending(null)
    void call(messages, { tool_use_id: p.tool_use_id, approved })
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const Ctor = speechRecognitionCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'en-AU'
    rec.interimResults = true
    rec.continuous = false
    baseTextRef.current = input ? `${input.trimEnd()} ` : ''
    rec.onresult = e => {
      let heard = ''
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript
      setInput(baseTextRef.current + heard)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  const lines = toLines(messages)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 900,
          padding: '12px 18px', borderRadius: 999, border: '1px solid var(--border)',
          background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 14,
          boxShadow: '0 6px 20px rgba(0,0,0,0.25)', cursor: 'pointer',
        }}
      >
        Ask
      </button>
    )
  }

  return (
    <aside
      aria-label="Assistant"
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 900,
        width: 'min(420px, 100vw)', display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', borderLeft: '1px solid var(--border)',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.25)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontWeight: 700 }}>Assistant</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Staff only. Changes need your approval.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {messages.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 12 }}
              disabled={busy}
              onClick={() => {
                setMessages([])
                setPending(null)
                setError('')
              }}
            >
              New chat
            </button>
          )}
          <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lines.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Try: &ldquo;show me the after photos from the kitchen&rdquo;, &ldquo;add a note that the bathroom is done&rdquo;, or &ldquo;mark this job underway&rdquo;.
          </div>
        )}
        {lines.map((l, i) =>
          l.who === 'activity' ? (
            <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{l.text}</div>
          ) : (
            <div
              key={i}
              style={{
                alignSelf: l.who === 'you' ? 'flex-end' : 'flex-start',
                maxWidth: '85%', padding: '8px 12px', borderRadius: 12, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                background: l.who === 'you' ? 'var(--accent)' : 'var(--surface-2)',
                color: l.who === 'you' ? '#fff' : 'inherit',
              }}
            >
              {l.text}
            </div>
          ),
        )}
        {pending && (
          <div style={{ border: '1px solid var(--accent)', borderRadius: 12, padding: 12, background: 'var(--surface-2)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>Approve change</div>
            <div style={{ fontSize: 14, marginBottom: 10 }}>{pending.summary}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide(true)}>Approve</button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => decide(false)}>Decline</button>
            </div>
          </div>
        )}
        {busy && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Working…</div>}
        {error && <div style={{ fontSize: 13, color: '#F87171' }}>{error}</div>}
      </div>

      <form
        onSubmit={e => {
          e.preventDefault()
          send()
        }}
        style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}
      >
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={listening ? 'Listening…' : pending ? 'Or type to change the request…' : 'Ask or tell me what to do…'}
          rows={2}
          style={{
            flex: 1, resize: 'none', padding: '8px 10px', borderRadius: 8, fontSize: 14,
            border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'inherit',
          }}
        />
        {canListen && (
          <button
            type="button"
            onClick={toggleMic}
            aria-label={listening ? 'Stop listening' : 'Speak'}
            className="btn btn-secondary"
            style={{ minWidth: 44, background: listening ? '#F87171' : undefined, color: listening ? '#fff' : undefined }}
          >
            {listening ? 'Stop' : 'Mic'}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
      </form>
    </aside>
  )
}
