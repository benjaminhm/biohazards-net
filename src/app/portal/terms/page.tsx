/*
 * app/portal/terms/page.tsx
 *
 * Standing Terms & Conditions — read and accept.
 *
 * The portal layout redirects here whenever the account has not accepted the
 * current version, because accepting the master agreement is what allows a quote
 * to be accepted with a single click later. Once signed, the page becomes a
 * read-only record of what was agreed and when.
 */
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePortal } from '@/components/portal/PortalContext'
import {
  BRAND,
  LINE,
  MUTED,
  Notice,
  buttonStyle,
  card,
  eyebrow,
  h1,
  meta,
  shortDate,
} from '@/components/portal/portalUi'

interface TermsPayload {
  terms: { version: string; published_at: string; title: string; html: string }
  accepted_version: string | null
  accepted_at: string | null
  current: boolean
}

export default function PortalTermsPage() {
  const { me, refresh } = usePortal()
  const router = useRouter()
  const [data, setData] = useState<TermsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/portal/terms', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setError('Could not load the terms. Please reload the page.'))
      .finally(() => setLoading(false))
  }, [])

  async function accept() {
    if (!data || accepting) return
    setAccepting(true)
    setError('')
    try {
      const res = await fetch('/api/portal/terms/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: data.terms.version }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not record your acceptance')
      await refresh()
      router.replace('/portal')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your acceptance')
    } finally {
      setAccepting(false)
    }
  }

  if (loading) return <p style={meta}>Loading terms…</p>
  if (!data) return <Notice tone="error">{error || 'Terms are unavailable right now.'}</Notice>

  const alreadySigned = data.current

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={eyebrow}>Version {data.terms.version}</div>
      <h1 style={h1}>{data.terms.title}</h1>

      {alreadySigned ? (
        <Notice tone="success">
          Accepted on {shortDate(data.accepted_at)}. These terms apply to all work we carry out for
          you.
        </Notice>
      ) : (
        <Notice tone="warn">
          {data.accepted_version
            ? `We have updated our trade terms since you last accepted them (version ${data.accepted_version}). Please review and accept the current version to continue.`
            : 'Please review and accept these terms. Once accepted, you can approve quotes with a single click instead of signing each one.'}
        </Notice>
      )}

      <div
        className="portal-terms"
        style={{
          ...card,
          maxHeight: '58vh',
          overflowY: 'auto',
          fontSize: 14,
          lineHeight: 1.7,
          color: '#374151',
        }}
        // Terms markup is authored in lib/portal/terms.ts and version-controlled,
        // never client-supplied, so there is no untrusted HTML here.
        dangerouslySetInnerHTML={{ __html: data.terms.html }}
      />

      <style>{`
        .portal-terms h2 { font-size: 15px; font-weight: 700; color: #111; margin: 22px 0 8px; }
        .portal-terms h2:first-child { margin-top: 0; }
        .portal-terms p { margin: 0 0 12px; }
      `}</style>

      {error && (
        <div style={{ marginTop: 16 }}>
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {!alreadySigned && (
        <div style={{ ...card, marginTop: 18, borderColor: LINE }}>
          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              fontSize: 14,
              lineHeight: 1.6,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              style={{ marginTop: 3, accentColor: BRAND, width: 18, height: 18, flexShrink: 0 }}
            />
            <span>
              I have read these terms and I am authorised to accept them on behalf of{' '}
              <strong>{me?.account.legal_name ?? 'my company'}</strong>.
            </span>
          </label>

          <button
            type="button"
            onClick={accept}
            disabled={!confirmed || accepting}
            style={{ ...buttonStyle('primary', !confirmed || accepting), marginTop: 18 }}
          >
            {accepting ? 'Recording…' : 'Accept terms'}
          </button>

          <p style={{ ...meta, marginTop: 14, color: MUTED }}>
            We record your name, the date and time, and your IP address against this acceptance.
          </p>
        </div>
      )}
    </div>
  )
}
