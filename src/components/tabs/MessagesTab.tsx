/*
 * components/tabs/MessagesTab.tsx
 *
 * SMS chat + optional per-job inbound email panel (pilot orgs — see JobEmailPanel).
 */
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import JobEmailPanel from '@/components/tabs/JobEmailPanel'

interface Message {
  id: string
  direction: 'inbound' | 'outbound'
  from_number: string
  to_number: string
  body: string
  created_at: string
  read_at: string | null
}

interface Job {
  id: string
  client_name?: string
  client_phone?: string
}

interface Props {
  job: Job
  /** When set (pilot org), email column appears next to SMS. */
  inboundEmailAddress?: string | null
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function MessagesTab({ job, inboundEmailAddress }: Props) {
  const [messages, setMessages]   = useState<Message[]>([])
  const [loading, setLoading]     = useState(true)
  const [body, setBody]           = useState('')
  const [sending, setSending]     = useState(false)
  const [error, setError]         = useState('')
  const [toNumber, setToNumber]   = useState(job.client_phone ?? '')
  const bottomRef                 = useRef<HTMLDivElement>(null)
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null)
  const [wide, setWide]           = useState(false)

  useEffect(() => {
    const q = () => setWide(typeof window !== 'undefined' && window.innerWidth >= 920)
    q()
    window.addEventListener('resize', q)
    return () => window.removeEventListener('resize', q)
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/sms/messages?job_id=${job.id}`)
    const data = await res.json()
    if (data.messages) setMessages(data.messages)
    setLoading(false)
  }, [job.id])

  useEffect(() => {
    load()
    pollRef.current = setInterval(load, 15000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!body.trim() || !toNumber.trim()) return
    setSending(true)
    setError('')
    const res = await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: job.id, to_number: toNumber.trim(), body: body.trim() }),
    })
    let data: { error?: string; message?: Message } = {}
    try {
      data = await res.json()
    } catch {
      setError(`Send failed (${res.status})`)
      setSending(false)
      return
    }
    if (!res.ok || data.error) {
      setError(data.error ?? `Send failed (${res.status})`)
    } else if (data.message) {
      setMessages(m => [...m, data.message!])
      setBody('')
    }
    setSending(false)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const smsColumn = (
    <div style={{ display: 'flex', flexDirection: 'column', height: inboundEmailAddress ? (wide ? 'calc(100vh - 220px)' : 'auto') : 'calc(100vh - 220px)', minHeight: inboundEmailAddress && !wide ? 380 : 400 }}>
      <div style={{ padding: '10px 0 14px', borderBottom: '1px solid var(--border)' }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>
          Client number
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={toNumber}
            onChange={e => setToNumber(e.target.value)}
            placeholder="+61400000000"
            style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }}
          />
          {job.client_phone && toNumber !== job.client_phone && (
            <button onClick={() => setToNumber(job.client_phone!)}
              style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Reset to job
            </button>
          )}
        </div>
        {!job.client_phone && (
          <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 6 }}>⚠ No client phone on this job — add one in Details first</div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', paddingTop: 40 }}>Loading…</div>
        )}
        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No messages yet</div>
            <div style={{ fontSize: 13 }}>Send a message to {job.client_name || 'the client'} below.</div>
          </div>
        )}
        {messages.map(msg => {
          const isOut = msg.direction === 'outbound'
          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '78%',
                padding: '10px 14px',
                borderRadius: isOut ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: isOut ? 'var(--accent)' : 'var(--surface)',
                border: isOut ? 'none' : '1px solid var(--border)',
                color: isOut ? '#fff' : 'var(--text)',
              }}>
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>{msg.body}</div>
                <div style={{ fontSize: 10, marginTop: 5, opacity: 0.65, textAlign: isOut ? 'right' : 'left' }}>
                  {fmtTime(msg.created_at)}
                  {isOut && <span style={{ marginLeft: 6 }}>✓</span>}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171', fontSize: 13, marginBottom: 8 }}>
          {error}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message… (Enter to send)"
          rows={2}
          style={{
            flex: 1, padding: '10px 12px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--bg)',
            color: 'var(--text)', fontSize: 14, resize: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={send}
          disabled={sending || !body.trim() || !toNumber.trim()}
          style={{
            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
            background: body.trim() && toNumber.trim() ? 'var(--accent)' : 'var(--border)',
            border: 'none', cursor: 'pointer', fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: sending ? 0.6 : 1, transition: 'background 0.15s',
          }}
        >
          {sending ? '…' : '↑'}
        </button>
      </div>
    </div>
  )

  if (!inboundEmailAddress) {
    return <div style={{ padding: '0 4px' }}>{smsColumn}</div>
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: wide ? 'row' : 'column',
        gap: 0,
        alignItems: 'stretch',
        padding: '0 4px',
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          paddingRight: wide ? 20 : 0,
          borderRight: wide ? '1px solid var(--border)' : undefined,
          borderBottom: wide ? undefined : '1px solid var(--border)',
          paddingBottom: wide ? 0 : 20,
          marginBottom: wide ? 0 : 8,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>SMS</div>
        {smsColumn}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingLeft: wide ? 20 : 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Email</div>
        <JobEmailPanel jobId={job.id} address={inboundEmailAddress} />
      </div>
    </div>
  )
}
