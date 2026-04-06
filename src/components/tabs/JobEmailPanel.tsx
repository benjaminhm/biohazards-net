/*
 * components/tabs/JobEmailPanel.tsx
 *
 * Pilot: per-job inbound address + thread (GET /api/jobs/[id]/email).
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface EmailRow {
  id: string
  from_address: string
  to_address: string
  subject: string | null
  body_text: string
  created_at: string
}

interface Props {
  jobId: string
  address: string
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function JobEmailPanel({ jobId, address }: Props) {
  const [messages, setMessages] = useState<EmailRow[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}/email`)
    const data = await res.json()
    if (data.messages) setMessages(data.messages)
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    load()
    const id = setInterval(load, 20000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function copyAddr() {
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 220px)', minHeight: 360 }}>
      <div style={{ padding: '10px 0 14px', borderBottom: '1px solid var(--border)' }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>
          Inbound email (this job)
        </label>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 10px' }}>
          Forward or BCC this address so messages land in this file. Replies stay in your mail client until we add outbound.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <code
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              wordBreak: 'break-all',
            }}
          >
            {address}
          </code>
          <button
            type="button"
            onClick={copyAddr}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-2)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', paddingTop: 32 }}>Loading…</div>
        )}
        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✉️</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No emails yet</div>
            <div style={{ fontSize: 13 }}>Send or forward mail to the address above.</div>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
              {fmtTime(m.created_at)} · {m.from_address}
            </div>
            {m.subject ? (
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{m.subject}</div>
            ) : null}
            <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {m.body_text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
