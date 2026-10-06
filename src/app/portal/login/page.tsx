/*
 * app/portal/login/page.tsx
 *
 * Sign-in request form — the front door of the accounts portal.
 *
 * The confirmation message is identical whether or not the email is on an
 * account, matching the API. Saying "we don't recognise that address" would let
 * anyone test which companies we work for.
 *
 * Once the email is away the same panel offers the code, because for a client
 * behind a mail gateway that rewrites links it is the only path that works.
 */
'use client'

import { useState } from 'react'
import {
  Notice,
  buttonStyle,
  card,
  eyebrow,
  h1,
  input,
  label,
  meta,
  narrow,
} from '@/components/portal/portalUi'

/** Mirrors SELF_SERVICE_TTL_MINUTES; portalAuth is server-only so it cannot be imported here. */
const EXPIRY_COPY = '1 hour'

export default function PortalLoginPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [codeError, setCodeError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (sending) return
    setSending(true)
    setError('')

    try {
      const res = await fetch('/api/portal/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Something went wrong. Please try again.')
      } else {
        setSent(data?.message ?? 'Check your email for a sign-in link and code.')
      }
    } catch {
      setError('Could not reach the server. Please check your connection.')
    } finally {
      setSending(false)
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (verifying) return
    setVerifying(true)
    setCodeError('')

    try {
      const res = await fetch('/api/portal/auth/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })
      if (res.ok) {
        // Full navigation so the layout re-reads /api/portal/me with the new cookie.
        window.location.assign('/portal')
        return
      }
      const data = await res.json().catch(() => ({}))
      setCodeError(data?.error ?? 'That code is not valid. Please check the email.')
    } catch {
      setCodeError('Could not reach the server. Please check your connection.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div style={{ ...narrow, paddingTop: 72 }}>
      <div style={eyebrow}>Trade account</div>
      <h1 style={h1}>Sign in</h1>
      <p style={{ ...meta, margin: '10px 0 26px' }}>
        There is no password. Enter your work email and we will send you a sign-in link and a
        6-digit code.
      </p>

      {sent ? (
        <>
          <Notice tone="success">{sent}</Notice>

          <form onSubmit={submitCode} style={{ ...card, marginTop: 18 }}>
            {codeError && <Notice tone="error">{codeError}</Notice>}
            <label htmlFor="portal-code" style={label}>
              Can&rsquo;t open the link? Enter the 6-digit code
            </label>
            <input
              id="portal-code"
              // Not type="number": it strips leading zeros and shows spinners.
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={7}
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^\d\s-]/g, ''))}
              placeholder="123456"
              style={{
                ...input,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 22,
                letterSpacing: '0.22em',
              }}
            />
            <button
              type="submit"
              disabled={verifying || code.replace(/\D/g, '').length !== 6}
              style={{
                ...buttonStyle('primary', verifying || code.replace(/\D/g, '').length !== 6),
                marginTop: 16,
                width: '100%',
              }}
            >
              {verifying ? 'Signing you in…' : 'Sign in with code'}
            </button>
          </form>

          <p style={{ ...meta, marginTop: 18 }}>
            The link and the code are the same single-use sign-in and both expire in {EXPIRY_COPY}.
            If nothing arrives, check your junk folder, then{' '}
            <button
              type="button"
              onClick={() => {
                setSent('')
                setEmail('')
                setCode('')
                setCodeError('')
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                color: '#FF6B35',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              try again
            </button>
            .
          </p>
        </>
      ) : (
        <form onSubmit={submit} style={card}>
          {error && <Notice tone="error">{error}</Notice>}
          <label htmlFor="portal-email" style={label}>
            Work email
          </label>
          <input
            id="portal-email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com.au"
            style={input}
          />
          <button type="submit" disabled={sending} style={{ ...buttonStyle('primary', sending), marginTop: 18, width: '100%' }}>
            {sending ? 'Sending…' : 'Email me a sign-in link and code'}
          </button>
        </form>
      )}

      <p style={{ ...meta, marginTop: 26 }}>
        Trade accounts are set up by our team. If you do not have one yet, contact us and we will
        arrange it.
      </p>
    </div>
  )
}
