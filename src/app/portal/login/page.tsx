/*
 * app/portal/login/page.tsx
 *
 * Magic-link request form — the front door of the accounts portal.
 *
 * The confirmation message is identical whether or not the email is on an
 * account, matching the API. Saying "we don't recognise that address" would let
 * anyone test which companies we work for.
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

export default function PortalLoginPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')

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
        setSent(data?.message ?? 'Check your email for a sign-in link.')
      }
    } catch {
      setError('Could not reach the server. Please check your connection.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ ...narrow, paddingTop: 72 }}>
      <div style={eyebrow}>Trade account</div>
      <h1 style={h1}>Sign in</h1>
      <p style={{ ...meta, margin: '10px 0 26px' }}>
        There is no password. Enter your work email and we will send you a link that signs you in.
      </p>

      {sent ? (
        <>
          <Notice tone="success">{sent}</Notice>
          <p style={meta}>
            The link works once and expires in 15 minutes. If it does not arrive, check your junk
            folder, then{' '}
            <button
              type="button"
              onClick={() => {
                setSent('')
                setEmail('')
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
            {sending ? 'Sending…' : 'Email me a sign-in link'}
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
