'use client'

/*
 * components/workspace/ChatPanel.tsx
 *
 * Middle panel: one running conversation with the head agent and each job's
 * file agent. Every reply is labelled with who said it and which job; a
 * coloured edge per job keeps a long thread readable. Agent drafts show as
 * change cards under the reply that made them. "Talking to" above the input
 * says who answers next.
 *
 * Voice: hold the mic to talk (browser speech recognition, en-AU); replies can
 * be read aloud (browser speech synthesis) with the speaker toggle.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatRow } from '@/lib/agent/workspaceText'
import DraftList, { type DraftView } from './DraftList'

export interface ChatJobRef { id: string; job_code: string | null; client_name: string | null }

export interface LocalLine { id: string; text: string; created_at: string }

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

const SPEAK_KEY = 'bh_agent_speak'

export function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text.replace(/[#*_`]/g, ''))
  u.lang = 'en-AU'
  window.speechSynthesis.speak(u)
}

function jobHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

/** Turn "#3452" into a clickable job chip. */
function withJobChips(text: string, byCode: Map<string, ChatJobRef>, onOpen: (id: string) => void): ReactNode[] {
  const out: ReactNode[] = []
  const re = /#([A-Za-z0-9]{3,8})\b/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const job = byCode.get(m[1])
    if (!job) continue
    out.push(text.slice(last, m.index))
    out.push(
      <button
        key={`${m.index}-${m[1]}`}
        type="button"
        onClick={() => onOpen(job.id)}
        style={{
          padding: '0 6px', margin: '0 1px', borderRadius: 5, border: '1px solid rgba(255,107,53,0.4)', cursor: 'pointer',
          background: 'var(--accent-dim)', color: 'var(--accent)', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, fontWeight: 700,
        }}
      >
        #{m[1]}
      </button>,
    )
    last = m.index + m[0].length
  }
  out.push(text.slice(last))
  return out
}

export default function ChatPanel({
  rows,
  localLines,
  drafts,
  jobs,
  activeJob,
  busy,
  error,
  onSend,
  onClearJob,
  onOpenJob,
  onDraftsDecided,
}: {
  rows: ChatRow[]
  localLines: LocalLine[]
  drafts: DraftView[]
  jobs: ChatJobRef[]
  activeJob: ChatJobRef | null
  busy: boolean
  error: string
  onSend: (text: string, viaVoice: boolean) => Promise<string | null>
  onClearJob: () => void
  onOpenJob: (id: string) => void
  onDraftsDecided: (created: string[]) => void
}) {
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [canListen] = useState(() => speechRecognitionCtor() !== null)
  const [speakOn, setSpeakOn] = useState(() => typeof window !== 'undefined' && localStorage.getItem(SPEAK_KEY) === '1')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const heardRef = useRef('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const byId = new Map(jobs.map(j => [j.id, j]))
  const byCode = new Map(jobs.filter(j => j.job_code).map(j => [j.job_code as string, j]))
  const draftById = new Map(drafts.map(d => [d.id, d]))

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [rows.length, localLines.length, busy])

  useEffect(() => () => recRef.current?.stop(), [])

  function setSpeak(on: boolean) {
    setSpeakOn(on)
    localStorage.setItem(SPEAK_KEY, on ? '1' : '0')
    if (!on) window.speechSynthesis?.cancel()
  }

  async function send(text: string, viaVoice: boolean) {
    const t = text.trim()
    if (!t || busy) return
    setInput('')
    const reply = await onSend(t, viaVoice)
    if (reply && (speakOn || viaVoice)) speak(reply)
  }

  function startTalking() {
    if (listening || busy) return
    const Ctor = speechRecognitionCtor()
    if (!Ctor) return
    window.speechSynthesis?.cancel()
    const rec = new Ctor()
    rec.lang = 'en-AU'
    rec.interimResults = true
    rec.continuous = true
    heardRef.current = ''
    rec.onresult = e => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      heardRef.current = text
      setInput(text)
    }
    rec.onend = () => {
      setListening(false)
      recRef.current = null
      const heard = heardRef.current.trim()
      heardRef.current = ''
      if (heard) void send(heard, true)
    }
    rec.onerror = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  function stopTalking() {
    recRef.current?.stop()
  }

  type Item = { kind: 'row'; row: ChatRow } | { kind: 'local'; line: LocalLine }
  const items: Item[] = [
    ...rows.map(row => ({ kind: 'row' as const, row })),
    ...localLines.map(line => ({ kind: 'local' as const, line })),
  ].sort((a, b) => (a.kind === 'row' ? a.row.created_at : a.line.created_at).localeCompare(b.kind === 'row' ? b.row.created_at : b.line.created_at))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!items.length && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, maxWidth: 360 }}>
            Ask the head agent something like &ldquo;what needs me today?&rdquo;, or pick a job on the left to talk to its file agent.
            Type <code>@1234</code> to jump to a job.
          </div>
        )}
        {items.map(item => {
          if (item.kind === 'local') {
            return (
              <div key={item.line.id} style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>{item.line.text}</div>
            )
          }
          const r = item.row
          const text = r.content?.text ?? ''
          if (r.speaker === 'system') {
            return (
              <div key={r.id} style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '0 20px' }}>
                {text} · {new Date(r.created_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
              </div>
            )
          }
          if (r.speaker === 'user') {
            return (
              <div key={r.id} style={{ alignSelf: 'flex-end', maxWidth: '80%', padding: '8px 12px', borderRadius: 12, background: 'var(--surface-2)', fontSize: 14, whiteSpace: 'pre-wrap' }}>
                {text}
              </div>
            )
          }
          const job = r.job_id ? byId.get(r.job_id) : null
          const label = r.speaker === 'head_agent'
            ? 'Head agent'
            : `${r.author && r.author !== 'File agent' ? r.author : 'File agent'}${job ? ` · #${job.job_code ?? ''}` : ''}`
          const cardDrafts = (r.content?.draft_ids ?? []).map(id => draftById.get(id)).filter((d): d is DraftView => Boolean(d))
          const hand = r.content?.handover
          return (
            <div
              key={r.id}
              style={{
                alignSelf: 'flex-start', maxWidth: '92%', paddingLeft: 10,
                borderLeft: `3px solid ${r.job_id ? `hsl(${jobHue(r.job_id)} 70% 55%)` : 'var(--accent)'}`,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 2 }}>
                {r.job_id && job ? (
                  <button type="button" onClick={() => onOpenJob(job.id)} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
                    {label}
                  </button>
                ) : label}
              </div>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                {r.speaker === 'head_agent' ? withJobChips(text, byCode, onOpenJob) : text}
              </div>
              {hand && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>→ Opened #{hand.job_code ?? ''}</div>}
              {cardDrafts.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <DraftList drafts={cardDrafts} onDecided={onDraftsDecided} />
                </div>
              )}
            </div>
          )
        })}
        {busy && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Thinking…</div>}
        {error && <div style={{ fontSize: 13, color: '#F87171' }}>{error}</div>}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', padding: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          <span>Talking to:</span>
          {activeJob ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 4px 2px 8px', borderRadius: 999, border: `1px solid hsl(${jobHue(activeJob.id)} 70% 55%)`, color: 'var(--text)' }}>
              Job #{activeJob.job_code ?? ''}{activeJob.client_name ? ` · ${activeJob.client_name}` : ''}
              <button type="button" onClick={onClearJob} aria-label="Back to the head agent" title="Back to the head agent" style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>
                ×
              </button>
            </span>
          ) : (
            <span style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid var(--accent)', color: 'var(--text)' }}>Head agent · all jobs</span>
          )}
          <button
            type="button"
            onClick={() => setSpeak(!speakOn)}
            title={speakOn ? 'Replies are read aloud. Click to mute.' : 'Read replies aloud'}
            style={{ marginLeft: 'auto', border: '1px solid var(--border)', background: speakOn ? 'var(--accent-dim)' : 'transparent', color: speakOn ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
          >
            {speakOn ? '🔊 Speaking' : '🔇 Muted'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            className="input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input, false)
              }
            }}
            rows={2}
            placeholder={listening ? 'Listening… let go to send' : activeJob ? `Message the file agent for #${activeJob.job_code ?? ''}` : 'Ask about all jobs, or @1234 to jump to one'}
            style={{ flex: 1, resize: 'none', fontSize: 14 }}
          />
          {canListen && (
            <button
              type="button"
              onPointerDown={startTalking}
              onPointerUp={stopTalking}
              onPointerLeave={() => listening && stopTalking()}
              disabled={busy}
              title="Hold to talk"
              aria-label="Hold to talk"
              style={{
                width: 42, height: 42, borderRadius: 21, cursor: 'pointer', fontSize: 18, flexShrink: 0,
                border: `1px solid ${listening ? '#F87171' : 'var(--border)'}`,
                background: listening ? 'rgba(248,113,113,0.15)' : 'var(--surface)',
              }}
            >
              🎙
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || !input.trim()} onClick={() => void send(input, false)}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
