'use client'

/*
 * Human-in-the-loop (HITL) transactional SMS confirmation dialog + trigger
 * button for sending quote / document links via an approved Twilio Alphanumeric
 * Sender ID (e.g. 'FCQ' for Forensic Cleaning QLD).
 *
 * Nothing is sent automatically: staff always review/edit the recipient mobile
 * number and exact SMS wording, see clearly that the Alphanumeric Sender ID is
 * one-way (no replies), and explicitly click "Confirm & Send".
 *
 * Used by:
 *   - SendForSigningModal (quote signing links)
 *   - SendStatementPackModal (statement pack links)
 *   - DocumentsTab DocRow (standalone branded document links)
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { triggerNativeHaptic } from '@/lib/tabletApp'

const fieldLabel: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
}

const fieldInput: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 14,
}

export interface BrandSmsSentInfo {
  from: string
  to: string
  sid: string
  warning?: string
}

export function SendBrandSmsDialog({
  jobId,
  senderId,
  initialPhone,
  initialMessage,
  replyEmail,
  onClose,
  onSent,
}: {
  jobId: string
  senderId: string
  initialPhone?: string | null
  initialMessage: string
  replyEmail?: string | null
  onClose: () => void
  onSent?: (info: BrandSmsSentInfo) => void
}) {
  const [phone, setPhone] = useState((initialPhone ?? '').trim())
  const [body, setBody] = useState(initialMessage)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<BrandSmsSentInfo | null>(null)

  // Escape closes this dialog only, leaving any Link ready modal behind intact.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (!sending) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sending, onClose])

  const cleanReplyEmail = (replyEmail ?? '').trim()
  const hasNoReplyNote =
    /no[- ]?reply|do not reply/i.test(body) ||
    (cleanReplyEmail !== '' && body.toLowerCase().includes(cleanReplyEmail.toLowerCase()))

  function appendNoReplyNote() {
    const note = cleanReplyEmail
      ? `This is a no-reply SMS — please email ${cleanReplyEmail} if you have any questions.`
      : 'This is a no-reply SMS — please contact our office if you have any questions.'
    setBody(prev => (prev.trim() ? `${prev.trim()}\n\n${note}` : note))
  }

  async function handleConfirmSend() {
    if (sending) return
    const to = phone.trim()
    const msg = body.trim()
    if (!to) {
      setError('Enter the client mobile number first.')
      return
    }
    if (!msg) {
      setError('Message cannot be empty.')
      return
    }

    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/sms/doc-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          to_number: to,
          body: msg,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        from?: string
        to?: string
        sid?: string
        warning?: string
        error?: string
      }
      if (!res.ok || !data.ok) {
        triggerNativeHaptic('warning')
        setError(data.error ?? 'Could not send SMS.')
        return
      }
      const info: BrandSmsSentInfo = {
        from: data.from ?? senderId,
        to: data.to ?? to,
        sid: data.sid ?? '',
        warning: data.warning,
      }
      triggerNativeHaptic('confirm')
      setSent(info)
      onSent?.(info)
    } catch {
      triggerNativeHaptic('warning')
      setError('Network error while sending SMS. Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Send SMS as ${senderId}`}
      onClick={e => {
        if (e.target === e.currentTarget && !sending) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 320,
        background: 'rgba(2, 6, 23, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 20,
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>
              Send SMS as {senderId}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Review the number and message below before sending.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 20,
              cursor: sending ? 'default' : 'pointer',
              lineHeight: 1,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {sent ? (
          <div>
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                borderRadius: 10,
                padding: '12px 14px',
                marginBottom: 14,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: '#10B981' }}>
                ✓ SMS sent from {sent.from}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4 }}>
                Delivered to <strong>{sent.to}</strong> and logged on the job&apos;s Messages tab.
              </div>
              {sent.warning && (
                <div style={{ fontSize: 12, color: '#FBBF24', marginTop: 6 }}>{sent.warning}</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={onClose} style={{ fontSize: 13, padding: '9px 18px' }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '9px 12px',
                marginBottom: 14,
                fontSize: 12,
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>From:</span>
              <span
                style={{
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  color: 'var(--accent)',
                  background: 'var(--accent-dim)',
                  border: '1px solid var(--accent-border)',
                  borderRadius: 6,
                  padding: '2px 8px',
                }}
              >
                {senderId}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                One-way transactional SMS · recipients cannot reply
              </span>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label htmlFor="brand-sms-to" style={fieldLabel}>
                Client mobile number
              </label>
              <input
                id="brand-sms-to"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0412 345 678"
                style={fieldInput}
                value={phone}
                onChange={e => {
                  setPhone(e.target.value)
                  if (error) setError('')
                }}
                disabled={sending}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <label htmlFor="brand-sms-body" style={{ ...fieldLabel, marginBottom: 6 }}>
                  SMS message
                </label>
                <span style={{ fontSize: 11, color: body.length > 1600 ? '#F87171' : 'var(--text-muted)', marginBottom: 6 }}>
                  {body.length} chars
                </span>
              </div>
              <textarea
                id="brand-sms-body"
                style={{ ...fieldInput, minHeight: 155, resize: 'vertical', lineHeight: 1.5 }}
                value={body}
                onChange={e => {
                  setBody(e.target.value)
                  if (error) setError('')
                }}
                disabled={sending}
              />
            </div>

            {!hasNoReplyNote && (
              <div style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={appendNoReplyNote}
                  disabled={sending}
                  style={{
                    background: 'none',
                    border: '1px dashed var(--border)',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  + Add no-reply contact note{cleanReplyEmail ? ` (${cleanReplyEmail})` : ''}
                </button>
              </div>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  color: '#F87171',
                  background: 'rgba(248, 113, 113, 0.1)',
                  border: '1px solid rgba(248, 113, 113, 0.35)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  marginBottom: 12,
                  lineHeight: 1.45,
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={sending}
                style={{ fontSize: 13, padding: '9px 14px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmSend()}
                disabled={sending || !phone.trim() || !body.trim() || body.length > 1600}
                style={{ fontSize: 13, padding: '9px 16px' }}
              >
                {sending ? `Sending via ${senderId}…` : `Confirm & Send via ${senderId}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function SendBrandSmsButton({
  jobId,
  senderId,
  phone,
  message,
  replyEmail,
  onSent,
}: {
  jobId?: string | null
  senderId?: string | null
  phone?: string | null
  message: string
  replyEmail?: string | null
  onSent?: (info: BrandSmsSentInfo) => void
}) {
  const [open, setOpen] = useState(false)
  const [lastSent, setLastSent] = useState<BrandSmsSentInfo | null>(null)

  if (!jobId || !senderId) return null

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!message.trim()}
        onClick={() => {
          triggerNativeHaptic('light')
          setOpen(true)
        }}
        style={{ fontSize: 13, padding: '9px 14px' }}
      >
        {lastSent ? `✓ Sent SMS (${senderId})` : `💬 Send SMS (${senderId})`}
      </button>
      {open && (
        <SendBrandSmsDialog
          jobId={jobId}
          senderId={senderId}
          initialPhone={phone}
          initialMessage={message}
          replyEmail={replyEmail}
          onClose={() => setOpen(false)}
          onSent={info => {
            setLastSent(info)
            onSent?.(info)
          }}
        />
      )}
    </>
  )
}
