/*
 * app/portal/quotes/[documentId]/page.tsx
 *
 * Review and approve a quote.
 *
 * The quote itself is rendered by the same builder used for the PDF, framed from
 * /api/portal/documents/[id], so what the client approves is exactly the document
 * we issued. Approval sits outside the frame, with the standing T&Cs restated —
 * that agreement is what makes a click sufficient here.
 */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
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
  money,
  shortDate,
} from '@/components/portal/portalUi'

interface PortalDocument {
  id: string
  type: string
  label: string
  title: string | null
  reference: string | null
  total: number | null
  created_at: string
  released_at: string
  accepted_at: string | null
  accepted_by: string | null
}

export default function PortalQuotePage() {
  const { documentId } = useParams<{ documentId: string }>()
  const router = useRouter()
  const { me } = usePortal()

  const [quote, setQuote] = useState<PortalDocument | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [acceptedNow, setAcceptedNow] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    // The job list already carries per-document detail, and it is scoped to this
    // account, so it doubles as the lookup for a single quote.
    fetch('/api/portal/jobs', { cache: 'no-store' })
      .then(async r => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? 'Could not load this quote')
        return body
      })
      .then((body: { jobs: Array<{ id: string; documents: PortalDocument[] }> }) => {
        for (const job of body.jobs ?? []) {
          const match = job.documents.find(d => d.id === documentId)
          if (match) {
            setQuote(match)
            setJobId(job.id)
            return
          }
        }
        setError('This quote is not available.')
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load this quote'))
      .finally(() => setLoading(false))
  }, [documentId])

  async function accept() {
    if (accepting) return
    setAccepting(true)
    setError('')
    try {
      const res = await fetch(`/api/portal/quotes/${documentId}/accept`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not record your approval')
      setAcceptedNow(body.accepted_at)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your approval')
    } finally {
      setAccepting(false)
    }
  }

  if (loading) return <p style={meta}>Loading quote…</p>
  if (!quote) return <Notice tone="error">{error || 'Quote not found.'}</Notice>

  const alreadyAccepted = !!quote.accepted_at || !!acceptedNow
  const canApprove = me?.contact.can_accept_quotes ?? false

  return (
    <div>
      <Link href={jobId ? `/portal/jobs/${jobId}` : '/portal'} style={{ ...eyebrow, textDecoration: 'none' }}>
        ← Back
      </Link>
      <h1 style={h1}>{quote.title || quote.label}</h1>
      <p style={{ ...meta, margin: '10px 0 20px' }}>
        {quote.reference ? `${quote.reference} · ` : ''}issued{' '}
        {shortDate(quote.released_at || quote.created_at)}
        {quote.total != null ? ` · ${money(quote.total)}` : ''}
      </p>

      {acceptedNow && (
        <Notice tone="success">
          Approved. Thank you — we have been notified and will be in touch to book the work in.
        </Notice>
      )}

      {!acceptedNow && quote.accepted_at && (
        <Notice tone="success">
          Approved by {quote.accepted_by} on {shortDate(quote.accepted_at)}.
        </Notice>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {/* Framed so the client approves the same rendering we issued as the PDF */}
      <div
        style={{
          border: `1px solid ${LINE}`,
          borderRadius: 12,
          overflow: 'hidden',
          background: '#FFFFFF',
          marginBottom: 20,
        }}
      >
        <iframe
          src={`/api/portal/documents/${documentId}`}
          title={quote.title || quote.label}
          style={{ display: 'block', width: '100%', height: '70vh', border: 'none' }}
        />
      </div>

      {!alreadyAccepted && (
        <div style={{ ...card, borderColor: BRAND }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Approve this quote</div>
          <p style={{ ...meta, marginBottom: 16 }}>
            Approving is your authority for us to carry out the scope above, under the{' '}
            <Link href="/portal/terms" style={{ color: BRAND }}>
              trade terms
            </Link>{' '}
            your account accepted
            {me?.account.terms_accepted_at ? ` on ${shortDate(me.account.terms_accepted_at)}` : ''}. We
            record your name, the date and time, and your IP address.
          </p>

          {!canApprove ? (
            <Notice tone="warn">
              Your access does not include approving quotes. Please forward this to whoever approves
              spend for your organisation, or contact us to change your access.
            </Notice>
          ) : (
            <>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={e => setConfirmed(e.target.checked)}
                  style={{ marginTop: 3, accentColor: BRAND, width: 18, height: 18, flexShrink: 0 }}
                />
                <span>
                  I approve this quote{quote.total != null ? ` for ${money(quote.total)}` : ''} on
                  behalf of <strong>{me?.account.legal_name}</strong> and authorise the work to
                  proceed.
                </span>
              </label>

              <button
                type="button"
                onClick={accept}
                disabled={!confirmed || accepting}
                style={{ ...buttonStyle('primary', !confirmed || accepting), marginTop: 18 }}
              >
                {accepting ? 'Recording approval…' : 'Approve and authorise work'}
              </button>

              <p style={{ ...meta, marginTop: 14, fontSize: 12, color: MUTED }}>
                Questions before you approve? Reply to the email that brought you here, or contact us
                at {me?.brand.email}.
              </p>
            </>
          )}
        </div>
      )}

      {alreadyAccepted && (
        <button
          type="button"
          onClick={() => router.push(jobId ? `/portal/jobs/${jobId}` : '/portal')}
          style={buttonStyle('secondary')}
        >
          Back to job
        </button>
      )}
    </div>
  )
}
