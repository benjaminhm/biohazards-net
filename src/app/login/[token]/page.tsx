/*
 * app/login/[token]/page.tsx
 *
 * The token is consumed only when the visitor presses the button. Consuming on
 * page load would let mail scanners burn a single-use link.
 */
'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'

export default function LoginConfirmPage() {
  const { token } = useParams<{ token: string }>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    if (working) return
    setWorking(true)
    setError('')

    try {
      const res = await fetch('/api/auth/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (res.ok) {
        window.location.assign('/')
        return
      }
      const data = await res.json().catch(() => ({}))
      setError(data?.error ?? 'That sign-in link is not valid. Please request a new one.')
    } catch {
      setError('Could not reach the server. Please check your connection.')
    } finally {
      setWorking(false)
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
        <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--text)' }}>biohazards.net</div>
      </div>
      <div style={{
        width: '100%',
        maxWidth: 380,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 24,
      }}>
        {error ? (
          <>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: '#F87171' }}>{error}</p>
            <Link href="/login" style={{
              display: 'block',
              textAlign: 'center',
              padding: '12px 16px',
              borderRadius: 10,
              background: 'var(--accent)',
              color: '#fff',
              fontWeight: 700,
              textDecoration: 'none',
            }}>
              Request a new link
            </Link>
          </>
        ) : (
          <>
            <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5, color: 'var(--text)' }}>
              Press continue to sign in on this device.
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={working}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background: 'var(--accent)',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: working ? 'default' : 'pointer',
                opacity: working ? 0.7 : 1,
              }}
            >
              {working ? 'Signing you in…' : 'Continue'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
