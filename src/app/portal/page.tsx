/*
 * app/portal/page.tsx
 *
 * Trade account overview.
 *
 * Ordered by what the client needs to do rather than by recency: quotes awaiting
 * a decision first, then work in progress, then completed jobs whose reports they
 * may need to download later.
 */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePortal } from '@/components/portal/PortalContext'
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

interface PortalJob {
  id: string
  status: string
  job_type: string
  site_address: string
  created_at: string
  scheduled_at: string | null
  documents: PortalDocument[]
  quotes: PortalDocument[]
  completion_documents: PortalDocument[]
}

interface AwaitingQuote extends PortalDocument {
  job_id: string
  site_address: string
}

const IN_PROGRESS_STATUSES = new Set(['accepted', 'scheduled', 'underway'])
const COMPLETE_STATUSES = new Set(['completed', 'report_sent', 'paid'])

const STATUS_LABELS: Record<string, string> = {
  lead: 'New enquiry',
  assessed: 'Assessed',
  quoted: 'Quoted',
  accepted: 'Approved — scheduling',
  scheduled: 'Scheduled',
  underway: 'Work underway',
  completed: 'Work complete',
  report_sent: 'Report issued',
  paid: 'Closed',
}

export default function PortalDashboard() {
  const { me } = usePortal()
  const [jobs, setJobs] = useState<PortalJob[]>([])
  const [awaiting, setAwaiting] = useState<AwaitingQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/portal/jobs', { cache: 'no-store' })
      .then(async r => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? 'Could not load your jobs')
        return body
      })
      .then(body => {
        setJobs(body.jobs ?? [])
        setAwaiting(body.quotes_awaiting ?? [])
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load your jobs'))
      .finally(() => setLoading(false))
  }, [])

  const active = jobs.filter(j => IN_PROGRESS_STATUSES.has(j.status))
  const completed = jobs.filter(j => COMPLETE_STATUSES.has(j.status))
  const other = jobs.filter(j => !IN_PROGRESS_STATUSES.has(j.status) && !COMPLETE_STATUSES.has(j.status))

  return (
    <div>
      <div style={eyebrow}>Overview</div>
      <h1 style={h1}>{me?.account.trading_as || me?.account.legal_name}</h1>
      <p style={{ ...meta, margin: '10px 0 26px' }}>
        Quotes to approve, work in progress, and reports for completed jobs.
      </p>

      {error && <Notice tone="error">{error}</Notice>}

      {loading ? (
        <p style={meta}>Loading your jobs…</p>
      ) : jobs.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '40px 24px' }}>
          <p style={{ fontSize: 15, marginBottom: 8 }}>Nothing here yet.</p>
          <p style={meta}>
            Once we start work for you, your jobs, quotes and reports will appear here.
          </p>
        </div>
      ) : (
        <>
          {awaiting.length > 0 && (
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ ...h2, marginBottom: 12 }}>Awaiting your approval</h2>
              <div style={{ display: 'grid', gap: 10 }}>
                {awaiting.map(quote => (
                  <div
                    key={quote.id}
                    style={{ ...card, borderColor: BRAND, borderWidth: 1, display: 'flex', gap: 14, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>
                        {quote.title || quote.label}
                      </div>
                      <div style={{ ...meta, marginTop: 4 }}>
                        {quote.site_address || 'Site to be confirmed'}
                        {quote.reference ? ` · ${quote.reference}` : ''}
                      </div>
                      {quote.total != null && (
                        <div style={{ fontSize: 18, fontWeight: 700, color: BRAND, marginTop: 8 }}>
                          {money(quote.total)}
                        </div>
                      )}
                    </div>
                    <Link href={`/portal/quotes/${quote.id}`} style={buttonStyle('primary')}>
                      Review quote
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}

          <JobSection title="Work in progress" jobs={active} empty="No jobs are currently underway." />
          <JobSection
            title="Completed"
            jobs={completed}
            empty="No completed jobs yet."
            hint="Reports and certificates for finished work stay available here."
          />
          {other.length > 0 && <JobSection title="Enquiries and quoting" jobs={other} empty="" />}
        </>
      )}
    </div>
  )

  function JobSection({
    title,
    jobs: list,
    empty,
    hint,
  }: {
    title: string
    jobs: PortalJob[]
    empty: string
    hint?: string
  }) {
    if (list.length === 0 && !empty) return null
    return (
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ ...h2, marginBottom: hint ? 4 : 12 }}>{title}</h2>
        {hint && <p style={{ ...meta, marginBottom: 12 }}>{hint}</p>}
        {list.length === 0 ? (
          <p style={{ ...meta, color: MUTED }}>{empty}</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {list.map(job => (
              <Link
                key={job.id}
                href={`/portal/jobs/${job.id}`}
                style={{ ...card, display: 'block', textDecoration: 'none', color: 'inherit', borderColor: LINE }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>
                      {job.site_address || 'Site to be confirmed'}
                    </div>
                    <div style={{ ...meta, marginTop: 4 }}>
                      {job.scheduled_at
                        ? `Scheduled ${shortDate(job.scheduled_at)}`
                        : `Opened ${shortDate(job.created_at)}`}
                      {job.completion_documents.length > 0
                        ? ` · ${job.completion_documents.length} ${job.completion_documents.length === 1 ? 'report' : 'reports'} available`
                        : ''}
                    </div>
                  </div>
                  <StatusPill
                    label={STATUS_LABELS[job.status] ?? job.status.replace(/_/g, ' ')}
                    tone={COMPLETE_STATUSES.has(job.status) ? 'good' : 'brand'}
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    )
  }
}
