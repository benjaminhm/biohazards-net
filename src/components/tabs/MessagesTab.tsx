/*
 * components/tabs/MessagesTab.tsx
 *
 * The Messages tab on the job detail page. Provides a chat-like SMS interface
 * between the business and the client via Twilio.
 *
 * Key behaviours:
 *   - On mount, fetches all messages for the job via GET /api/sms/messages?jobId=...
 *     and marks any unread inbound messages as read (the API handles both in one call).
 *   - Polls for new messages every 15 seconds via setInterval so staff see incoming
 *     replies without a full page refresh.
 *   - Outbound SMS is sent via POST /api/sms/send. The `to_number` field is
 *     pre-filled with job.client_phone but can be overridden (e.g. to text a NOK).
 *   - fmtTime() shows "HH:MM" for today's messages and "D MMM HH:MM" for older ones
 *     so the conversation timeline is readable without full timestamps.
 *   - Auto-scrolls to the bottom whenever messages change so new messages are
 *     always visible (bottomRef).
 *
 * No optimistic updates — messages refresh after send to show the server-confirmed
 * outbound record rather than a client-side placeholder.
 */
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

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
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function MessagesTab({ job }: Props) {
  const [messages, setMessages]   = useState<Message[]>([])
  const [loading, setLoading]     = useState(true)
  const [body, setBody]           = useState('')
  const [sending, setSending]     = useState(false)
  const [error, setError]         = useState('')
  const [toNumber, setToNumber]   = useState(job.client_phone ?? '')
  const bottomRef                 = useRef<HTMLDivElement>(null)
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/sms/messages?job_id=${job.id}`)
    const data = await res.json()
    if (data.messages) setMessages(data.messages)
    setLoading(false)
  }, [job.id])

  useEffect(() => {
    load()
    // Poll for new inbound messages every 15s
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
    const data = await res.json()
    if (data.error) {
      setError(data.error)
    } else {
      setMessages(m => [...m, data.message])
      setBody('')
    }
    setSending(false)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 220px)', minHeight: 400 }}>

      {/* To number bar */}
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

      {/* Message thread */}
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

      {/* Error */}
      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171', fontSize: 13, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {/* Compose */}
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
}
