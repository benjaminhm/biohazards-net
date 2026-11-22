'use client'

/*
 * components/workspace/ChatPanel.tsx
 *
 * Middle panel: one running conversation with the head agent and each job's
 * file agent. Every reply is labelled with who said it and which job; a
 * coloured edge per job keeps a long thread readable. Agent drafts show as
 * change cards under the reply that made them. "Talking to" above the input
 * says who answers next: the head agent, a job's file agent, or one of its
 * document agents ("Job #6743 › Statement agent"); × steps back one level.
 *
 * Voice: hold the mic to talk (browser speech recognition, en-AU); replies can
 * be read aloud (browser speech synthesis) with the speaker toggle.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ChatRow } from '@/lib/agent/workspaceText'
import type { DocAgentType } from '@/lib/agent/subagents/types'
import { DOC_AGENT_LABEL } from '@/lib/agent/subagents/labels'
import DraftList, { type DraftView } from './DraftList'
import {
  hasNativeVoice,
  nativeSpeak,
  nativeStopSpeaking,
  startNativeVoice,
  stopNativeVoice,
  triggerNativeHaptic,
  type NativeVoiceEventDetail,
} from '@/lib/tabletApp'

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

const noopSubscribe = () => () => {}

function readCanListen(): boolean {
  return hasNativeVoice() || speechRecognitionCtor() !== null
}

const SPEAK_KEY = 'bh_agent_speak'

export function speak(text: string) {
  if (typeof window === 'undefined') return
  const clean = text.replace(/[#*_`]/g, '')
  if (nativeSpeak(clean)) return
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(clean)
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
  activeDocAgent,
  busy,
  error,
  onSend,
  onClearJob,
  onClearDocAgent,
  onSwitchAgent,
  onOpenJob,
  onDraftsDecided,
}: {
  rows: ChatRow[]
  localLines: LocalLine[]
  drafts: DraftView[]
  jobs: ChatJobRef[]
  activeJob: ChatJobRef | null
  activeDocAgent: DocAgentType | null
  busy: boolean
  error: string
  onSend: (text: string, viaVoice: boolean) => Promise<string | null>
  onClearJob: () => void
  /** Back from a document agent to the job's file agent. */
  onClearDocAgent: () => void
  /** Open another agent on this job (null = file agent), from a referral. */
  onSwitchAgent: (jobId: string, docAgent: DocAgentType | null) => void
  onOpenJob: (id: string) => void
  onDraftsDecided: (created: string[]) => void
}) {
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const canListen = useSyncExternalStore(noopSubscribe, readCanListen, () => false)
  const [speakOn, setSpeakOn] = useState(() => typeof window !== 'undefined' && localStorage.getItem(SPEAK_KEY) === '1')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const usingNativeVoiceRef = useRef(false)
  const heardRef = useRef('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const sendRef = useRef<(text: string, viaVoice: boolean) => Promise<void>>(async () => {})

  const byId = new Map(jobs.map(j => [j.id, j]))
  const byCode = new Map(jobs.filter(j => j.job_code).map(j => [j.job_code as string, j]))
  const draftById = new Map(drafts.map(d => [d.id, d]))

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [rows.length, localLines.length, busy])

  useEffect(() => () => {
    recRef.current?.stop()
    if (usingNativeVoiceRef.current) stopNativeVoice()
  }, [])

  function setSpeak(on: boolean) {
    setSpeakOn(on)
    localStorage.setItem(SPEAK_KEY, on ? '1' : '0')
    triggerNativeHaptic('light')
    if (!on) {
      nativeStopSpeaking()
      window.speechSynthesis?.cancel()
    }
  }

  async function send(text: string, viaVoice: boolean) {
    const t = text.trim()
    if (!t || busy) return
    setInput('')
    triggerNativeHaptic('light')
    const reply = await onSend(t, viaVoice)
    if (reply && (speakOn || viaVoice)) speak(reply)
  }

  useEffect(() => {
    sendRef.current = send
  })

  // Listen to native Android SpeechRecognizer events dispatched by MainActivity.
  useEffect(() => {
    function onNativeVoice(e: Event) {
      const detail = (e as CustomEvent<NativeVoiceEventDetail>).detail
      if (!detail) return
      if (detail.type === 'start') {
        setListening(true)
      } else if (detail.type === 'partial') {
        const text = detail.text ?? ''
        heardRef.current = text
        setInput(text)
      } else if (detail.type === 'final') {
        usingNativeVoiceRef.current = false
        setListening(false)
        const heard = (detail.text ?? heardRef.current).trim()
        heardRef.current = ''
        if (heard) void sendRef.current(heard, true)
      } else if (detail.type === 'end' || detail.type === 'error') {
        usingNativeVoiceRef.current = false
        setListening(false)
        const heard = heardRef.current.trim()
        heardRef.current = ''
        if (detail.type === 'end' && heard) void sendRef.current(heard, true)
      }
    }
    window.addEventListener('bh-native-voice', onNativeVoice)
    return () => window.removeEventListener('bh-native-voice', onNativeVoice)
  }, [])

  function startTalking() {
    if (listening || busy) return
    nativeStopSpeaking()
    window.speechSynthesis?.cancel()
    triggerNativeHaptic('light')

    if (hasNativeVoice()) {
      usingNativeVoiceRef.current = true
      heardRef.current = ''
      setListening(true)
      startNativeVoice('en-AU')
      return
    }

    const Ctor = speechRecognitionCtor()
    if (!Ctor) return
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
    if (usingNativeVoiceRef.current) {
      stopNativeVoice()
      return
    }
    recRef.current?.stop()
  }

  type Item = { kind: 'row'; row: ChatRow } | { kind: 'local'; line: LocalLine }
  const items: Item[] = [
    ...rows.map(row => ({ kind: 'row' as const, row })),
    ...localLines.map(line => ({ kind: 'local' as const, line })),
  ].sort((a, b) => (a.kind === 'row' ? a.row.created_at : a.line.created_at).localeCompare(b.kind === 'row' ? b.row.created_at : b.line.created_at))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', background: 'var(--bg)' }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!items.length && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, maxWidth: 380, padding: '20px 22px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-card)' }}>
            {activeDocAgent
              ? <>Ask the {DOC_AGENT_LABEL[activeDocAgent].agent} about its {DOC_AGENT_LABEL[activeDocAgent].doc}, or give it figures to draft.</>
              : <>Ask the head agent something like &ldquo;what needs me today?&rdquo;, or pick a job on the left to talk to its file agent or one of its document agents.
                Type <code>@1234</code> to jump to a job, or <code>@1234/statement</code> (soa, bcq, ccq, sacq, survey, cdr, completion) to a document agent.</>}
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
              <div
                key={r.id}
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '82%',
                  padding: '10px 14px',
                  borderRadius: '14px 14px 4px 14px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  fontSize: 14,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {text}
              </div>
            )
          }
          const job = r.job_id ? byId.get(r.job_id) : null
          const label = r.speaker === 'head_agent'
            ? 'Head agent'
            : r.speaker === 'doc_agent'
              ? `${r.author || (r.doc_agent ? DOC_AGENT_LABEL[r.doc_agent].agent : 'Document agent')}${job ? ` · #${job.job_code ?? ''}` : ''}`
              : `${r.author && r.author !== 'File agent' ? r.author : 'File agent'}${job ? ` · #${job.job_code ?? ''}` : ''}`
          const switchTo = r.content?.switch_to
          const cardDrafts = (r.content?.draft_ids ?? []).map(id => draftById.get(id)).filter((d): d is DraftView => Boolean(d))
          const hand = r.content?.handover
          const edgeColor = r.job_id ? `hsl(${jobHue(r.job_id)} 72% 52%)` : 'var(--accent)'
          return (
            <div
              key={r.id}
              style={{
                alignSelf: 'flex-start',
                maxWidth: '94%',
                padding: '10px 14px',
                borderRadius: 12,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${edgeColor}`,
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>
                {r.job_id && job ? (
                  <button type="button" onClick={() => onOpenJob(job.id)} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
                    {label}
                  </button>
                ) : label}
              </div>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5, color: 'var(--text)' }}>
                {r.speaker === 'head_agent' ? withJobChips(text, byCode, onOpenJob) : text}
              </div>
              {hand && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>→ Opened #{hand.job_code ?? ''}</div>}
              {switchTo && r.job_id && (
                <button
                  type="button"
                  onClick={() => onSwitchAgent(r.job_id as string, switchTo.doc_agent)}
                  style={{ marginTop: 8, fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 8, border: '1px solid var(--accent-border)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer' }}
                >
                  Switch to {switchTo.label}
                </button>
              )}
              {cardDrafts.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <DraftList drafts={cardDrafts} onDecided={onDraftsDecided} />
                </div>
              )}
            </div>
          )
        })}
        {busy && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Thinking…</div>}
        {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)', padding: '10px 12px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <span>Talking to:</span>
          {activeJob && activeDocAgent ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 10px', borderRadius: 999, border: `1px solid hsl(${jobHue(activeJob.id)} 70% 52%)`, background: 'var(--surface-2)', color: 'var(--text)', fontWeight: 600 }}>
              Job {activeJob.job_code ?? ''} › {DOC_AGENT_LABEL[activeDocAgent].agent}
              <button type="button" onClick={onClearDocAgent} aria-label="Back to the file agent" title="Back to the file agent" style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>
                ×
              </button>
            </span>
          ) : activeJob ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 10px', borderRadius: 999, border: `1px solid hsl(${jobHue(activeJob.id)} 70% 52%)`, background: 'var(--surface-2)', color: 'var(--text)', fontWeight: 600 }}>
              Job #{activeJob.job_code ?? ''}{activeJob.client_name ? ` · ${activeJob.client_name}` : ''}
              <button type="button" onClick={onClearJob} aria-label="Back to the head agent" title="Back to the head agent" style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>
                ×
              </button>
            </span>
          ) : (
            <span style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid var(--accent-border)', background: 'var(--accent-dim)', color: 'var(--accent)', fontWeight: 600 }}>Head agent · all jobs</span>
          )}
          <button
            type="button"
            onClick={() => setSpeak(!speakOn)}
            title={speakOn ? 'Replies are read aloud. Click to mute.' : 'Read replies aloud'}
            style={{ marginLeft: 'auto', border: '1px solid var(--border)', background: speakOn ? 'var(--accent-dim)' : 'var(--surface-2)', color: speakOn ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
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
            placeholder={
              listening
                ? 'Listening… let go to send'
                : activeJob && activeDocAgent
                  ? `Message the ${DOC_AGENT_LABEL[activeDocAgent].agent} for #${activeJob.job_code ?? ''}`
                  : activeJob
                    ? `Message the file agent for #${activeJob.job_code ?? ''}, or @${activeJob.job_code ?? '1234'}/statement`
                    : 'Ask about all jobs, or @1234 (or @1234/statement) to jump'
            }
            style={{ flex: 1, resize: 'none', fontSize: 14, borderRadius: 12 }}
          />
          {canListen && (
            <button
              type="button"
              onPointerDown={startTalking}
              onPointerUp={stopTalking}
              onPointerCancel={() => listening && stopTalking()}
              onPointerLeave={() => listening && stopTalking()}
              disabled={busy}
              title="Hold to talk"
              aria-label="Hold to talk"
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                cursor: 'pointer',
                fontSize: 18,
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${listening ? '#EF4444' : 'var(--border-2)'}`,
                background: listening ? 'rgba(239,68,68,0.16)' : 'var(--surface-2)',
                color: listening ? '#EF4444' : 'var(--text)',
                touchAction: 'none',
              }}
            >
              🎙
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !input.trim()}
            onClick={() => void send(input, false)}
            style={{ height: 46, borderRadius: 12, padding: '0 18px' }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
