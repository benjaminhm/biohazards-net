/*
 * Send a saved quote to the client to sign, and show where it is up to.
 *
 *   useJobSigning        the signing requests on a job (one fetch shared by every row)
 *   SendForSigningModal  the send window: who it is from, who it goes to, the wording
 *   SigningStatus        the strip under a saved quote: sent / opened / signed / declined
 *
 * The From address is decided on the server from the job's trading name and is
 * only shown here. A person reads the wording and presses Send
 * (docs/ai-product-principles.md); nothing is sent without that.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

export interface SigningSummary {
  id: string
  job_id: string
  document_id: string | null
  status: 'sent' | 'viewed' | 'signed' | 'declined' | 'voided'
  document_title: string
  reference: string | null
  brand_label: string
  from_address: string
  reply_to: string | null
  to_email: string
  to_name: string
  sent_at: string
  sent_by_name: string | null
  expires_at: string
  first_viewed_at: string | null
  signed_at: string | null
  signer_name: string | null
  declined_at: string | null
  decline_reason: string | null
  voided_at: string | null
  delivered_at: string | null
  delivery_error: string | null
}

interface Preview {
  title: string
  reference: string | null
  blockers: string[]
  sender: { brandLabel: string; from: string; replyTo: string | null; usesBrandAddress: boolean } | null
  defaults: { toEmail: string; toName: string; subject: string; message: string }
  requests: SigningSummary[]
}

// Every saved-quote row on a job asks for the same list; share one request.
const inFlight = new Map<string, Promise<SigningSummary[]>>()

function loadJobSigning(jobId: string): Promise<SigningSummary[]> {
  let pending = inFlight.get(jobId)
  if (!pending) {
    pending = fetch(`/api/signing?jobId=${encodeURIComponent(jobId)}`)
      .then(res => (res.ok ? res.json() : { requests: [] }))
      .then((data: { requests?: SigningSummary[] }) => data.requests ?? [])
      .catch(() => [])
      .finally(() => inFlight.delete(jobId))
    inFlight.set(jobId, pending)
  }
  return pending
}

/** Signing requests for a job. Pass null to skip (rows that are not quotes). */
export function useJobSigning(jobId: string | null) {
  const [requests, setRequests] = useState<SigningSummary[]>([])

  const reload = useCallback(async () => {
    if (!jobId) return
    setRequests(await loadJobSigning(jobId))
  }, [jobId])

  useEffect(() => {
    if (!jobId) return
    let live = true
    const load = () => {
      void loadJobSigning(jobId).then(list => {
        if (live) setRequests(list)
      })
    }
    load()
    // The client signs somewhere else; pick it up when staff come back to the tab.
    window.addEventListener('focus', load)
    return () => {
      live = false
      window.removeEventListener('focus', load)
    }
  }, [jobId])

  return { requests, reload }
}

/** The request that matters for a document: the newest one that was not cancelled, else the newest. */
export function currentSigning(requests: SigningSummary[], documentId: string): SigningSummary | null {
  const mine = requests.filter(r => r.document_id === documentId)
  return mine.find(r => r.status !== 'voided') ?? mine[0] ?? null
}

function when(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

const fieldLabel: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'var(--text-muted)', marginBottom: 6,
}
const fieldInput: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14,
}

export function SendForSigningModal({ documentId, onClose, onSent }: {
  documentId: string
  onClose: () => void
  onSent: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [toName, setToName] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    fetch(`/api/signing?documentId=${encodeURIComponent(documentId)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? 'Could not load')
        return data as Preview
      })
      .then(data => {
        if (!live) return
        setPreview(data)
        setToName(data.defaults.toName)
        setToEmail(data.defaults.toEmail)
        setSubject(data.defaults.subject)
        setMessage(data.defaults.message)
      })
      .catch(err => {
        if (live) setLoadError(err instanceof Error ? err.message : 'Could not load')
      })
    return () => { live = false }
  }, [documentId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, sending])

  const waiting = preview?.requests.find(r => r.status === 'sent' || r.status === 'viewed') ?? null
  const blocked = !preview || preview.blockers.length > 0 || !preview.sender
  const ready = !blocked && toName.trim().length >= 2 && /\S+@\S+\.\S+/.test(toEmail.trim()) && subject.trim() && message.trim()

  async function send() {
    if (!ready || sending) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/signing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, toName, toEmail, subject, message }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Could not send')
      onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
      setSending(false)
    }
  }

  const docLine = preview ? `${preview.title}${preview.reference ? ` ${preview.reference}` : ''}` : ''

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-signing-title"
      onClick={e => { if (e.target === e.currentTarget && !sending) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 220,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: '22px 22px 18px', width: '100%', maxWidth: 560,
        maxHeight: '100%', overflowY: 'auto', border: '1px solid var(--border)', boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <div id="send-signing-title" style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>Send for signing</div>
            {docLine && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{docLine}</div>}
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}>
            ✕
          </button>
        </div>

        {loadError && <div role="alert" style={{ fontSize: 13, color: '#F87171' }}>{loadError}</div>}
        {!preview && !loadError && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Preparing the document…</div>}

        {preview && (
          <>
            {preview.blockers.length > 0 && (
              <div role="alert" style={{ fontSize: 13, color: '#F87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                {preview.blockers.map(b => <div key={b}>{b}</div>)}
              </div>
            )}

            {preview.sender && (
              <div style={{ marginBottom: 14 }}>
                <span style={fieldLabel}>From</span>
                <div style={{ fontSize: 14, color: 'var(--text)', wordBreak: 'break-word' }}>{preview.sender.from}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                  {!preview.sender.usesBrandAddress && (
                    <>Sent under the {preview.sender.brandLabel} name from the shared address, because {preview.sender.brandLabel} does not have its own sending address set up. </>
                  )}
                  {preview.sender.replyTo
                    ? <>Replies go to {preview.sender.replyTo}.</>
                    : <>No reply address is set: add an email in Settings so the client can reply.</>}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '1 1 180px' }}>
                <label htmlFor="sfs-name" style={fieldLabel}>Signer name</label>
                <input id="sfs-name" style={fieldInput} value={toName} onChange={e => setToName(e.target.value)} maxLength={120} autoComplete="off" />
              </div>
              <div style={{ flex: '1 1 220px' }}>
                <label htmlFor="sfs-email" style={fieldLabel}>Signer email</label>
                <input id="sfs-email" type="email" style={fieldInput} value={toEmail} onChange={e => setToEmail(e.target.value)} autoComplete="off" />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label htmlFor="sfs-subject" style={fieldLabel}>Subject</label>
              <input id="sfs-subject" style={fieldInput} value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label htmlFor="sfs-message" style={fieldLabel}>Message</label>
              <textarea id="sfs-message" style={{ ...fieldInput, minHeight: 190, resize: 'vertical', lineHeight: 1.5 }} value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} />
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
              The client gets a private link with a Review and sign button under your message. They sign the quote as it is saved right now; changes made after sending are not included. Once signed, they are emailed the signed PDF with its signature docket, and the job moves to Accepted.
            </div>

            {waiting && (
              <div style={{ fontSize: 12, color: 'var(--text)', background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.35)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                This quote was already sent to {waiting.to_email} on {when(waiting.sent_at)} and has not been signed. Sending again replaces that link, so the earlier email will stop working.
              </div>
            )}

            {error && <div role="alert" style={{ fontSize: 13, color: '#F87171', marginBottom: 12, lineHeight: 1.5 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={sending} style={{ fontSize: 13, padding: '9px 16px' }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={send} disabled={!ready || sending} style={{ fontSize: 13, padding: '9px 18px' }}>
                {sending ? 'Sending…' : 'Send for signing'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const STATUS_STYLE: Record<SigningSummary['status'], { label: string; color: string }> = {
  sent: { label: 'Sent for signing', color: '#60A5FA' },
  viewed: { label: 'Opened, not signed', color: '#FBBF24' },
  signed: { label: 'Signed', color: '#34D399' },
  declined: { label: 'Declined', color: '#F87171' },
  voided: { label: 'Cancelled', color: 'var(--text-muted)' },
}

/** Where a saved quote's signing is up to, with the few things staff can do about it. */
export function SigningStatus({ request, onChanged }: { request: SigningSummary; onChanged: () => void }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)

  async function act(action: 'void' | 'resend' | 'deliver', done: string) {
    setBusy(action)
    setError('')
    setNote('')
    try {
      const res = await fetch(`/api/signing/${request.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'That did not work')
      setNote(done)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work')
    } finally {
      setBusy('')
      setConfirmCancel(false)
    }
  }

  const style = STATUS_STYLE[request.status]
  const waiting = request.status === 'sent' || request.status === 'viewed'
  const small: CSSProperties = { fontSize: 11, padding: '5px 10px' }

  let detail = ''
  if (request.status === 'sent') detail = `to ${request.to_email} on ${when(request.sent_at)}. Not opened yet.`
  if (request.status === 'viewed') detail = `by ${request.to_email} on ${when(request.first_viewed_at)}. Sent ${when(request.sent_at)}.`
  if (request.status === 'signed') detail = `by ${request.signer_name ?? request.to_name} (${request.to_email}) on ${when(request.signed_at)}.`
  if (request.status === 'declined') detail = `by ${request.to_email} on ${when(request.declined_at)}.${request.decline_reason ? ` "${request.decline_reason}"` : ''}`
  if (request.status === 'voided') detail = `on ${when(request.voided_at)}. Was sent to ${request.to_email}.`

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: style.color, border: `1px solid ${style.color}`, borderRadius: 999, padding: '1px 8px', fontSize: 11, whiteSpace: 'nowrap' }}>
          {style.label}
        </span>
        <span style={{ color: 'var(--text)', flex: '1 1 200px' }}>{detail}</span>
        {waiting && (
          <>
            <button type="button" className="btn btn-secondary" style={small} disabled={!!busy}
              onClick={() => act('resend', 'Sent again with a new link.')}>
              {busy === 'resend' ? 'Sending…' : 'Send again'}
            </button>
            {confirmCancel ? (
              <>
                <button type="button" style={{ ...small, borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                  disabled={!!busy} onClick={() => act('void', 'Cancelled. The link no longer works.')}>
                  {busy === 'void' ? '…' : 'Cancel request'}
                </button>
                <button type="button" className="btn btn-secondary" style={small} onClick={() => setConfirmCancel(false)}>Keep</button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary" style={small} disabled={!!busy} onClick={() => setConfirmCancel(true)}>Cancel</button>
            )}
          </>
        )}
        {request.status === 'signed' && (
          <>
            <a href={`/api/signing/${request.id}/pdf`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ ...small, textDecoration: 'none' }}>
              Signed PDF
            </a>
            <button type="button" className="btn btn-secondary" style={small} disabled={!!busy}
              onClick={() => act('deliver', 'Signed copy emailed.')}>
              {busy === 'deliver' ? 'Sending…' : 'Email signed copy again'}
            </button>
          </>
        )}
      </div>
      <div style={{ color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-word' }}>
        From {request.from_address}{request.sent_by_name ? `, sent by ${request.sent_by_name}` : ''}.
        {request.status === 'signed' && request.delivered_at && !request.delivery_error && ` Signed copy emailed ${when(request.delivered_at)}.`}
        {request.status === 'signed' && !request.delivered_at && !request.delivery_error && ' Signed copy is being emailed.'}
      </div>
      {request.status === 'signed' && request.delivery_error && (
        <div role="alert" style={{ color: '#F87171', marginTop: 4 }}>
          {request.delivered_at ? request.delivery_error : `The signed copy has not been emailed to the client: ${request.delivery_error}`}
        </div>
      )}
      {note && <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{note}</div>}
      {error && <div role="alert" style={{ color: '#F87171', marginTop: 4 }}>{error}</div>}
    </div>
  )
}
