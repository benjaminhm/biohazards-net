/*
 * app/calls/page.tsx
 *
 * Calls — every inbound call and what the agents did with it. Each call shows
 * its stages side by side (raw transcript, cleaned transcript and changes,
 * head agent record, file agent writes) so a wrong or missing field can be
 * traced to the stage that caused it. Staff can re-run a call from any stage
 * or paste a transcript to run it through the same pipeline.
 *
 * Internal only. Agents fill the job file; staff price and send quotes.
 */
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'

interface CallListItem {
  id: string
  caller_number: string
  started_at: string | null
  duration_s: number | null
  status: string
  error: string | null
  error_stage: string | null
  job_id: string | null
  validation: { issues?: string[]; decision?: string } | null
  extraction: { job_description?: string; contact?: { name?: string } } | null
  created_at: string
  jobs: { job_code: string | null; client_name: string | null } | null
}

interface CallDetail extends CallListItem {
  transcript_raw: string | null
  transcript_source: string | null
  transcript_clean: string | null
  clean_changes: { from: string; to: string; reason: string }[] | null
  clean_unclear: string[] | null
  extraction_model: string | null
  filed: Record<string, unknown> | null
  payload_raw: unknown
}

interface AgentAction {
  id: string
  agent: string
  action: string
  target_path: string
  before: unknown
  after: unknown
  note: string
  status: string
  created_at: string
}

const IN_PROGRESS = new Set(['received', 'transcribed', 'cleaned', 'extracted'])

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  received: { label: 'Received', color: '#94A3B8' },
  transcribed: { label: 'Transcribed', color: '#60A5FA' },
  cleaned: { label: 'Cleaned', color: '#60A5FA' },
  extracted: { label: 'Read by head agent', color: '#60A5FA' },
  filed: { label: 'Filed', color: '#10B981' },
  needs_review: { label: 'Check', color: '#F59E0B' },
  failed: { label: 'Failed', color: '#F87171' },
}

const card: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
}

const pre: CSSProperties = {
  whiteSpace: 'pre-wrap',
  fontSize: 13,
  lineHeight: 1.5,
  background: 'var(--surface-2)',
  borderRadius: 8,
  padding: 12,
  margin: 0,
  maxHeight: 360,
  overflow: 'auto',
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

function Pill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { label: status, color: '#94A3B8' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, color: s.color, border: `1px solid ${s.color}` }}>
      {s.label}
    </span>
  )
}

function Stage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Json({ value }: { value: unknown }) {
  return <pre style={{ ...pre, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{JSON.stringify(value, null, 2)}</pre>
}

function CallDetailView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [call, setCall] = useState<CallDetail | null>(null)
  const [actions, setActions] = useState<AgentAction[]>([])
  const [error, setError] = useState('')
  const [rerunning, setRerunning] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/calls/${id}`)
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Could not load the call')
      return
    }
    setCall(data.call)
    setActions(data.actions ?? [])
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!call || !IN_PROGRESS.has(call.status)) return
    const t = setTimeout(() => void load(), 4000)
    return () => clearTimeout(t)
  }, [call, load])

  async function rerun(from: string) {
    setRerunning(true)
    try {
      await fetch(`/api/calls/${id}/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from }),
      })
      await load()
      onChanged()
    } finally {
      setRerunning(false)
    }
  }

  if (error) return <div style={{ color: '#F87171', fontSize: 13 }}>{error}</div>
  if (!call) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>

  const issues = call.validation?.issues ?? []

  return (
    <div>
      {call.error && (
        <div style={{ ...card, borderColor: '#F87171', marginTop: 12, fontSize: 13 }}>
          Failed at <strong>{call.error_stage}</strong>: {call.error}
        </div>
      )}

      {issues.length > 0 && (
        <Stage title="To check">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
            {issues.map((issue, i) => <li key={i}>{issue}</li>)}
          </ul>
        </Stage>
      )}

      <Stage title={`1 · Raw transcript${call.transcript_source ? ` (${call.transcript_source === 'openai' ? 'OpenAI speech-to-text' : 'from provider'})` : ''}`}>
        {call.transcript_raw ? <pre style={pre}>{call.transcript_raw}</pre> : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not yet.</div>}
      </Stage>

      <Stage title="2 · Cleaned transcript">
        {call.transcript_clean ? <pre style={pre}>{call.transcript_clean}</pre> : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not yet.</div>}
        {(call.clean_changes?.length ?? 0) > 0 && (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <strong>Changes made</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
              {call.clean_changes!.map((c, i) => (
                <li key={i}>&ldquo;{c.from}&rdquo; → &ldquo;{c.to}&rdquo; <span style={{ color: 'var(--text-muted)' }}>({c.reason})</span></li>
              ))}
            </ul>
          </div>
        )}
        {(call.clean_unclear?.length ?? 0) > 0 && (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <strong>Unclear in the recording</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
              {call.clean_unclear!.map((u, i) => <li key={i}>{u}</li>)}
            </ul>
          </div>
        )}
      </Stage>

      <Stage title={`3 · Head agent record${call.extraction_model ? ` (${call.extraction_model})` : ''}`}>
        {call.extraction ? <Json value={call.extraction} /> : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not yet.</div>}
      </Stage>

      <Stage title="4 · Writes to the job file">
        {actions.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>None yet.</div>
        ) : (
          actions.map(a => (
            <details key={a.id} style={{ ...card, padding: 12, marginBottom: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                <strong>{a.agent.replace('_', ' ')}</strong> · {a.action.replace(/_/g, ' ')}
                {a.target_path ? <span style={{ color: 'var(--text-muted)' }}> · {a.target_path}</span> : null}
                {a.status !== 'applied' ? <span style={{ color: '#F59E0B' }}> · {a.status.replace('_', ' ')}</span> : null}
                {a.note ? <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{a.note}</div> : null}
              </summary>
              {a.before != null && (
                <>
                  <div style={{ fontSize: 12, margin: '8px 0 4px' }}>Before</div>
                  <Json value={a.before} />
                </>
              )}
              <div style={{ fontSize: 12, margin: '8px 0 4px' }}>After</div>
              <Json value={a.after} />
            </details>
          ))
        )}
      </Stage>

      <Stage title="Re-run">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['transcribe', 'clean', 'extract', 'file'] as const).map(s => (
            <button key={s} type="button" className="btn btn-secondary" style={{ fontSize: 12 }} disabled={rerunning || IN_PROGRESS.has(call.status)} onClick={() => void rerun(s)}>
              From {s}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Earlier stages are kept. A call already filed into a job is not filed again.
        </div>
      </Stage>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>Raw webhook payload</summary>
        <Json value={call.payload_raw} />
      </details>
    </div>
  )
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [caller, setCaller] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/calls')
    const data = await res.json()
    if (!res.ok) setError(data.error || 'Could not load calls')
    else {
      setError('')
      setCalls(data.calls ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!calls.some(c => IN_PROGRESS.has(c.status))) return
    const t = setTimeout(() => void load(), 5000)
    return () => clearTimeout(t)
  }, [calls, load])

  async function submitTranscript() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, caller_number: caller }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not run the transcript')
      setTranscript('')
      setCaller('')
      setPasteOpen(false)
      setOpen(data.call_id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run the transcript')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px 80px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <Link href="/" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Home</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, margin: '12px 0 16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>Calls</h1>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Inbound calls and what the agents filed. Quotes are drafted without prices — you price and send them.
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setPasteOpen(v => !v)}>
            {pasteOpen ? 'Cancel' : 'Paste a transcript'}
          </button>
        </div>

        {pasteOpen && (
          <div style={{ ...card, marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Caller number (optional)</label>
            <input
              value={caller}
              onChange={e => setCaller(e.target.value)}
              placeholder="04xx xxx xxx"
              style={{ display: 'block', width: '100%', margin: '4px 0 12px', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'inherit' }}
            />
            <label style={{ fontSize: 12, fontWeight: 600 }}>Transcript</label>
            <textarea
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              rows={10}
              style={{ display: 'block', width: '100%', margin: '4px 0 12px', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'inherit', resize: 'vertical' }}
            />
            <button type="button" className="btn btn-primary" disabled={submitting || transcript.trim().length < 20} onClick={() => void submitTranscript()}>
              {submitting ? 'Starting…' : 'Run through the pipeline'}
            </button>
          </div>
        )}

        {error && <div style={{ color: '#F87171', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {loading && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}
        {!loading && calls.length === 0 && !error && (
          <div style={{ ...card, color: 'var(--text-muted)', fontSize: 14 }}>No calls yet.</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {calls.map(c => {
            const issues = c.validation?.issues?.length ?? 0
            return (
              <div key={c.id} style={card}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(open === c.id ? null : c.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') setOpen(open === c.id ? null : c.id)
                  }}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12, cursor: 'pointer', alignItems: 'flex-start' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {c.extraction?.contact?.name || c.caller_number || 'Unknown caller'}
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 13 }}>
                        {' '}· {when(c.started_at ?? c.created_at)}
                        {c.duration_s ? ` · ${Math.round(c.duration_s / 60)} min` : ''}
                      </span>
                    </div>
                    {c.extraction?.job_description && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{c.extraction.job_description}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    {issues > 0 && <span style={{ fontSize: 12, color: '#F59E0B' }}>{issues} to check</span>}
                    <Pill status={c.status} />
                  </div>
                </div>
                {c.job_id && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <Link href={`/jobs/${c.job_id}`} style={{ color: 'var(--accent)' }}>
                      {c.validation?.decision === 'attached' ? 'Attached to' : 'Created'} job {c.jobs?.job_code ?? ''} {c.jobs?.client_name ? `· ${c.jobs.client_name}` : ''} →
                    </Link>
                  </div>
                )}
                {open === c.id && <CallDetailView id={c.id} onChanged={() => void load()} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
