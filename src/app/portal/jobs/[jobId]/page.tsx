/*
 * app/portal/jobs/[jobId]/page.tsx
 *
 * One job: where it is up to, and every document we have released for it.
 *
 * Quotes link through to the acceptance page; reports and certificates open in
 * the guarded viewer, which is also where Print / Save PDF lives.
 */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  BRAND,
  LINE,
  MUTED,
  Notice,
  StatusPill,
  buttonStyle,
  card,
  eyebrow,
  h1,
  h2,
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

interface JobDetail {
  job: {
    id: string
    status: string
    job_type: string
    site_address: string
    created_at: string
    scheduled_at: string | null
    schedule_note: string | null
  }
  documents: PortalDocument[]
}

const STATUS_LABELS: Record<string, string> = {
  lead: 'New enquiry',
  assessed: 'Assessed',
  quoted: 'Quote issued',
  accepted: 'Approved — scheduling',
  scheduled: 'Scheduled',
  underway: 'Work underway',
  completed: 'Work complete',
  report_sent: 'Report issued',
  paid: 'Closed',
}

const STATUS_EXPLANATIONS: Record<string, string> = {
  lead: 'We have your enquiry and will be in touch to arrange an assessment.',
  assessed: 'We have assessed the site and are preparing your quote.',
  quoted: 'Your quote is ready to review below.',
  accepted: 'Thanks — we are booking this in and will confirm a date with you.',
  scheduled: 'Booked in. Our team will attend on the scheduled date.',
  underway: 'Our team is on site working through the scope.',
  completed: 'Work is finished. Your completion documents are below.',
  report_sent: 'Your post-remediation evaluation has been issued.',
  paid: 'This job is closed. Your documents remain available here.',
}

const COMPLETE_STATUSES = new Set(['completed', 'report_sent', 'paid'])

export default function PortalJobPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [data, setData] = useState<JobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/portal/jobs/${jobId}`, { cache: 'no-store' })
      .then(async r => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? 'Could not load this job')
        return body
      })
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load this job'))
      .finally(() => setLoading(false))
  }, [jobId])

  if (loading) return <p style={meta}>Loading…</p>
  if (error || !data) return <Notice tone="error">{error || 'Job not found.'}</Notice>

  const { job, documents } = data
  const quotes = documents.filter(d => d.type === 'quote')
  const others = documents.filter(d => d.type !== 'quote')

  return (
    <div style={{ maxWidth: 700 }}>
      <Link href="/portal" style={{ ...eyebrow, textDecoration: 'none' }}>
        ← Back to overview
      </Link>
      <h1 style={h1}>{job.site_address || 'Site to be confirmed'}</h1>

      <div style={{ marginTop: 14, marginBottom: 24 }}>
        <StatusPill
          label={STATUS_LABELS[job.status] ?? job.status.replace(/_/g, ' ')}
          tone={COMPLETE_STATUSES.has(job.status) ? 'good' : 'brand'}
        />
        <p style={{ ...meta, marginTop: 10 }}>
          {STATUS_EXPLANATIONS[job.status] ?? ''}
        </p>
        <p style={{ ...meta, marginTop: 6, color: MUTED }}>
          Opened {shortDate(job.created_at)}
          {job.scheduled_at ? ` · scheduled ${shortDate(job.scheduled_at)}` : ''}
        </p>
      </div>

      {quotes.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ ...h2, marginBottom: 12 }}>Quotes</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {quotes.map(quote => (
              <div key={quote.id} style={{ ...card, borderColor: quote.accepted_at ? LINE : BRAND }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{quote.title || quote.label}</div>
                    <div style={{ ...meta, marginTop: 4 }}>
                      {quote.reference ? `${quote.reference} · ` : ''}issued {shortDate(quote.released_at || quote.created_at)}
                    </div>
                    {quote.total != null && (
                      <div style={{ fontSize: 18, fontWeight: 700, color: BRAND, marginTop: 8 }}>
                        {money(quote.total)}
                      </div>
                    )}
                    {quote.accepted_at && (
                      <div style={{ ...meta, marginTop: 8 }}>
                        Approved by {quote.accepted_by} on {shortDate(quote.accepted_at)}
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/portal/quotes/${quote.id}`}
                    style={buttonStyle(quote.accepted_at ? 'secondary' : 'primary')}
                  >
                    {quote.accepted_at ? 'View' : 'Review and approve'}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 style={{ ...h2, marginBottom: 12 }}>Documents</h2>
        {others.length === 0 ? (
          <p style={meta}>
            No other documents yet. Reports and certificates appear here once we release them.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {others.map(doc => (
              <div
                key={doc.id}
                style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{doc.label}</div>
                  <div style={{ ...meta, marginTop: 4 }}>
                    {doc.reference ? `${doc.reference} · ` : ''}issued {shortDate(doc.released_at || doc.created_at)}
                  </div>
                </div>
                <Link href={`/portal/documents/${doc.id}`} style={buttonStyle('secondary')}>
                  View and download
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
