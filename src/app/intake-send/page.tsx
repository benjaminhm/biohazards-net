'use client'

import { useState } from 'react'

// Always use the current domain — works for any subdomain automatically
function getIntakeUrl() {
  if (typeof window === 'undefined') return '/new-client'
  return `${window.location.origin}/new-client`
}

const DEFAULT_MESSAGE = `Hi, thanks for getting in touch. Please fill in your details using the link below — it helps us understand what you need and respond quickly. Everything you share is confidential.`

export default function IntakeSendPage() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [sending, setSending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [smsSent, setSmsSent] = useState(false)
  const [error, setError] = useState('')

  const INTAKE_URL = getIntakeUrl()
  const smsBody = encodeURIComponent(`${message}\n\n${INTAKE_URL}\n\n— Brisbane Biohazard Cleaning`)
  const cleanPhone = phone.replace(/\s/g, '')

  async function sendEmail() {
    if (!email) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/send-intake-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, message, intakeUrl: INTAKE_URL }),
      })
      if (!res.ok) throw new Error()
      setEmailSent(true)
    } catch {
      setError('Email failed to send. Try again.')
    } finally {
      setSending(false)
    }
  }

  function reset() {
    setName('')
    setPhone('')
    setEmail('')
    setMessage(DEFAULT_MESSAGE)
    setEmailSent(false)
    setSmsSent(false)
    setError('')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 20px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Send Intake Link</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Send the client form via SMS or email</div>
          </div>
          <a href="/" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← Queue</a>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 80px' }}>

        {/* Link preview */}
        <div style={{
          background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.25)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 24,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>🔗</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Intake form link</div>
            <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{INTAKE_URL}</div>
          </div>
        </div>

        {/* Client name */}
        <div className="field">
          <label>Client First Name <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>optional</span></label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Dave"
            autoFocus
          />
        </div>

        {/* Phone */}
        <div className="field">
          <label>Mobile Number</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="04xx xxx xxx"
          />
        </div>

        {/* Email */}
        <div className="field">
          <label>Email Address</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="client@email.com"
          />
        </div>

        {/* Message */}
        <div className="field">
          <label>Message</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', fontSize: 14, lineHeight: 1.5 }}
          />
        </div>

        {error && (
          <div style={{ color: '#F87171', fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}

        {/* Send buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>

          {/* SMS — opens native Messages app, no backend needed */}
          {phone && (
            <a
              href={`sms:${cleanPhone}?body=${smsBody}`}
              onClick={() => setSmsSent(true)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '14px 20px', borderRadius: 8, textDecoration: 'none',
                background: smsSent ? 'rgba(34,197,94,0.15)' : 'var(--surface)',
                border: `2px solid ${smsSent ? '#22C55E' : 'var(--border)'}`,
                color: smsSent ? '#22C55E' : 'var(--text)',
                fontWeight: 700, fontSize: 15, transition: 'all 0.15s',
              }}
            >
              {smsSent ? '✓ SMS Opened' : '💬 Send via SMS'}
              {!smsSent && phone && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>{phone}</span>
              )}
            </a>
          )}

          {/* Email — sends via Resend */}
          {email && (
            <button
              onClick={sendEmail}
              disabled={sending || emailSent}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '14px 20px', borderRadius: 8,
                background: emailSent ? 'rgba(34,197,94,0.15)' : 'var(--accent)',
                border: `2px solid ${emailSent ? '#22C55E' : 'var(--accent)'}`,
                color: emailSent ? '#22C55E' : '#fff',
                fontWeight: 700, fontSize: 15, cursor: emailSent ? 'default' : 'pointer',
                transition: 'all 0.15s', opacity: sending ? 0.7 : 1,
              }}
            >
              {sending
                ? <><span className="spinner" /> Sending...</>
                : emailSent
                  ? '✓ Email Sent'
                  : <>✉️ Send via Email <span style={{ fontWeight: 400, fontSize: 13, opacity: 0.85 }}>{email}</span></>}
            </button>
          )}

          {!phone && !email && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, padding: '20px 0' }}>
              Enter a mobile number or email to send
            </div>
          )}
        </div>

        {/* Send another */}
        {(emailSent || smsSent) && (
          <button
            onClick={reset}
            className="btn btn-ghost"
            style={{ width: '100%', marginTop: 16, fontSize: 14 }}
          >
            Send to another client
          </button>
        )}
      </div>
    </div>
  )
}
