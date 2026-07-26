/*
 * app/portal/login/[token]/page.tsx
 *
 * Magic-link confirm step.
 *
 * The token is only consumed when the visitor presses the button, which POSTs to
 * /api/portal/auth/consume. Consuming on page load would let mail servers, link
 * scanners and chat previewers burn a single-use token before the recipient ever
 * opened it.
 */
'use client'

import { useParams } from 'next/navigation'
import { useState } from 'react'
import {
  Notice,
  buttonStyle,
  card,
  eyebrow,
  h1,
  meta,
  narrow,
} from '@/components/portal/portalUi'
import Link from 'next/link'

export default function PortalLoginConfirmPage() {
  const { token } = useParams<{ token: string }>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    if (working) return
    setWorking(true)
    setError('')

    try {
      const res = await fetch('/api/portal/auth/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (res.ok) {
        // Full navigation so the layout re-reads /api/portal/me with the new cookie.
        window.location.assign('/portal')
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
    <div style={{ ...narrow, paddingTop: 72 }}>
      <div style={eyebrow}>Trade account</div>
      <h1 style={h1}>Confirm sign in</h1>

      <div style={{ ...card, marginTop: 24 }}>
        {error ? (
          <>
            <Notice tone="error">{error}</Notice>
            <Link href="/portal/login" style={{ ...buttonStyle('primary'), width: '100%' }}>
              Request a new link
            </Link>
          </>
        ) : (
          <>
            <p style={{ ...meta, margin: '0 0 20px' }}>
              Press continue to open your trade account on this device.
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={working}
              style={{ ...buttonStyle('primary', working), width: '100%' }}
            >
              {working ? 'Signing you in…' : 'Continue to my account'}
            </button>
          </>
        )}
      </div>

      <p style={{ ...meta, marginTop: 22 }}>
        Did not request this? You can close this page — nothing happens until you press continue.
      </p>

      <p style={{ ...meta, marginTop: 10 }}>
        <Link href="/portal/login" style={{ color: '#FF6B35' }}>
          Use a different email
        </Link>
      </p>
    </div>
  )
}
