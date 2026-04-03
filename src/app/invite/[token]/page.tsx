/*
 * app/invite/[token]/page.tsx
 *
 * Invite claim page. When a staff member follows an invite link, this page
 * validates the 64-char hex token via GET /api/invites/[token] and shows
 * which org they're being added to and at what role.
 *
 * Claim flow:
 *   1. If the user is not signed into Clerk, redirect to /login?redirect_url=...
 *      so they sign in/up first, then land back here.
 *   2. Once signed in, POST /api/invites/[token] claims the invite, which either
 *      creates a new org_users row or updates an existing one.
 *   3. After claim, redirect to / (the dashboard) so the user sees their new org.
 *
 * The invite is single-use on the server (token is marked used after claim)
 * but this page does not enforce that — the API route returns an error if the
 * token is already claimed, which this page surfaces as an error message.
 */
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'

interface InviteInfo {
  role: string
  label?: string
  org_name: string
  org_slug: string | null
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  operator: 'Operator',
  field: 'Field Worker',
}

export default function InvitePage() {
  const params = useParams()
  const token = params.token as string
  const router = useRouter()
  const { isSignedIn, isLoaded } = useUser()

  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState(false)

  useEffect(() => {
    fetch(`/api/invites/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setInvite(d)
      })
      .catch(() => setError('Failed to load invite'))
      .finally(() => setLoading(false))
  }, [token])

  // If not signed in, redirect to login with return URL
  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn && !loading) {
      const returnUrl = encodeURIComponent(`/invite/${token}`)
      router.replace(`/login?redirect_url=${returnUrl}`)
    }
  }, [isLoaded, isSignedIn, loading, token, router])

  async function handleClaim() {
    setClaiming(true)
    try {
      const res = await fetch(`/api/invites/${token}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to join')
        return
      }
      setClaimed(true)
      // Redirect to their org subdomain or /field after 2s
      setTimeout(() => {
        if (data.org_slug) {
          window.location.href = `https://${data.org_slug}.biohazards.net/${data.role === 'field' ? 'field' : ''}`
        } else {
          router.replace(data.role === 'field' ? '/field' : '/')
        }
      }, 2000)
    } finally {
      setClaiming(false)
    }
  }

  if (loading || !isLoaded) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <span className="spinner" />
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Branding */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8 }}>
            biohazards.net
          </div>
        </div>

        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 28,
          textAlign: 'center',
        }}>

          {error ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 16 }}>❌</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Invite Invalid</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>{error}</div>
            </>
          ) : claimed ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>You&apos;re in!</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Redirecting to your dashboard…</div>
              <div className="spinner" style={{ margin: '20px auto 0' }} />
            </>
          ) : invite ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🧤</div>
              <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>
                Join {invite.org_name}
              </div>
              {invite.label && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                  {invite.label}
                </div>
              )}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--surface-2, rgba(255,107,53,0.1))',
                border: '1px solid var(--accent)',
                borderRadius: 999,
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--accent)',
                marginBottom: 28,
              }}>
                {ROLE_LABELS[invite.role] ?? invite.role}
              </div>

              <div style={{ height: 1, background: 'var(--border)', marginBottom: 24 }} />

              <button
                onClick={handleClaim}
                disabled={claiming}
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: 12,
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 16,
                  cursor: claiming ? 'not-allowed' : 'pointer',
                  opacity: claiming ? 0.7 : 1,
                }}
              >
                {claiming ? <span className="spinner" /> : `Accept & Join`}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
