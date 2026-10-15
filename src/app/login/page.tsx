/*
 * app/login/page.tsx
 *
 * Staff sign-in. One email, one magic link. The confirmation copy does not
 * say whether the address is allowed.
 */
'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

/** Only follow a same-origin path. The proxy puts the original URL in redirect_url. */
function sameOriginPath(raw: string | null): string {
  if (!raw || typeof window === 'undefined') return '/'
  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) return '/'
    if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

function linkError(code: string | null): string {
  if (code === 'used') return 'That sign-in link has already been used. Please request a new one.'
  if (code === 'expired') return 'That sign-in link has expired. Please request a new one.'
  if (code === 'invalid') return 'That sign-in link is not valid. Please request a new one.'
  return ''
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [checkingSession, setCheckingSession] = useState(true)
  const searchParams = useSearchParams()
  const linkProblem = linkError(searchParams.get('error'))

  useEffect(() => {
    let cancelled = false
    const next = sameOriginPath(searchParams.get('redirect_url'))
    // redirect: 'manual' so a logged-out proxy bounce to /login is not a 200.
    fetch('/api/me', { redirect: 'manual' })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json().catch(() => null)
          if (data?.userId) {
            window.location.replace(next)
            return
          }
        }
        if (!cancelled) setCheckingSession(false)
      })
      .catch(() => {
        if (!cancelled) setCheckingSession(false)
      })
    return () => {
      cancelled = true
    }
  }, [searchParams])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (sending) return
    setSending(true)
    setError('')

    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Something went wrong. Please try again.')
      } else {
        setSent(data?.message ?? 'If that email can sign in, a link is on its way.')
      }
    } catch {
      setError('Could not reach the server. Please check your connection.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 24,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, margin: '0 auto 12px',
        }}>
          ☣️
        </div>
        <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--text)' }}>biohazards.net</div>
      </div>

      {checkingSession ? null : (
      <form
        onSubmit={submit}
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {linkProblem && !sent && (
          <p style={{ margin: 0, fontSize: 13, color: '#F87171' }}>{linkProblem}</p>
        )}
        {sent ? (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text)' }}>{sent}</p>
        ) : (
          <>
            <label htmlFor="email" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com.au"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 15,
              }}
            />
            {error && (
              <p style={{ margin: 0, fontSize: 13, color: '#F87171' }}>{error}</p>
            )}
            <button
              type="submit"
              disabled={sending}
              style={{
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background: 'var(--accent)',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: sending ? 'default' : 'pointer',
                opacity: sending ? 0.7 : 1,
              }}
            >
              {sending ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </>
        )}
      </form>
      )}
    </div>
  )
}
