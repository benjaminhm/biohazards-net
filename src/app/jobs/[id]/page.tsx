/*
 * app/jobs/[id]/page.tsx
 *
 * Job detail page — the primary work surface for a single job. Hosts all six tabs
 * as independent components with shared job/photos/documents state managed here.
 *
 * Tab state is persisted in the ?tab= query parameter so refreshing or deep-linking
 * returns to the same tab. Active tab is initialised from searchParams on mount.
 *
 * Unread SMS badge is fetched separately from the messages API so the Messages tab
 * header can show a red dot even before the user opens that tab.
 *
 * All tab components receive callback props (onJobUpdate, onPhotosUpdate,
 * onDocumentDeleted) to bubble state changes back here rather than each tab
 * managing its own API responses and causing stale views.
 *
 * Capability checks (caps) gate which tabs are visible:
 *   - view_assessment requires the Assessment tab.
 *   - view_documents requires Documents.
 *   - send_sms requires Messages.
 * Admins see all tabs regardless of caps.
 */
'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Job, Photo, Document, JobStatus } from '@/lib/types'
import DetailsTab from '@/components/tabs/DetailsTab'
import AssessmentTab from '@/components/tabs/AssessmentTab'
import QuoteTab from '@/components/tabs/QuoteTab'
import PhotosTab from '@/components/tabs/PhotosTab'
import DocumentsTab from '@/components/tabs/DocumentsTab'
import MessagesTab from '@/components/tabs/MessagesTab'
import InvoiceTab from '@/components/tabs/InvoiceTab'
import { useUser } from '@/lib/userContext'

type Tab = 'details' | 'assessment' | 'quote' | 'photos' | 'documents' | 'messages' | 'invoice'

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene: 'Crime Scene', hoarding: 'Hoarding', mold: 'Mold', sewage: 'Sewage',
  trauma: 'Trauma', unattended_death: 'Unattended Death', flood: 'Flood', other: 'Other',
}

const STATUS_LABELS: Record<JobStatus, string> = {
  lead: 'Lead', assessed: 'Assessed', quoted: 'Quoted', accepted: 'Accepted ✓',
  scheduled: 'Scheduled', underway: 'Underway', completed: 'Completed',
  report_sent: 'Report Sent', paid: 'Paid',
}

export default function JobPage() {
  const { id }       = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const { caps, isAdmin, loading: userLoading } = useUser()
  /** Field workers (no view_all_jobs) use /field; ops staff use full queue. */
  const jobsListHref = userLoading
    ? '/jobs/queue'
    : (isAdmin || caps.view_all_jobs ? '/jobs/queue' : '/field')
  const jobsBackLabel = isAdmin || caps.view_all_jobs ? '← Jobs' : '← My jobs'

  const [job,         setJob]         = useState<Job | null>(null)
  const [photos,      setPhotos]      = useState<Photo[]>([])
  const [documents,   setDocuments]   = useState<Document[]>([])
  const [loading,     setLoading]     = useState(true)
  const [unreadSms,   setUnreadSms]   = useState(0)
  const [canInvoice,  setCanInvoice]  = useState(false)

  const initialTab = (searchParams.get('tab') as Tab) ?? 'details'
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    try {
      const [jobRes, docsRes, msgRes, invRes] = await Promise.all([
        fetch(`/api/jobs/${id}`),
        fetch(`/api/documents?jobId=${id}`),
        fetch(`/api/sms/messages?job_id=${id}`),
        fetch(`/api/jobs/${id}/invoices`),
      ])
      const jobData  = await jobRes.json()
      const docsData = await docsRes.json()
      const msgData  = await msgRes.json()
      const invData  = await invRes.json()
      setJob(jobData.job)
      setPhotos(jobData.photos ?? [])
      setDocuments(docsData.documents ?? [])
      const unread = (msgData.messages ?? []).filter((m: { direction: string; read_at: string | null }) => m.direction === 'inbound' && !m.read_at).length
      setUnreadSms(unread)
      setCanInvoice(!!invData.can_invoice)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-muted)' }}>
        <div className="spinner" />Loading job...
      </div>
    )
  }

  if (!job) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Job not found</div>
        <Link href={jobsListHref}><button className="btn btn-secondary">Back</button></Link>
      </div>
    )
  }

  // SMS is only relevant on active jobs — no point messaging a client on a closed file,
  // and hiding it on completed/report_sent/paid jobs prevents accidental Twilio spend.
  const CLOSED_STATUSES: JobStatus[] = ['completed', 'report_sent', 'paid']
  const isActiveJob = !CLOSED_STATUSES.includes(job.status)

  const allTabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'details',    label: 'Details',                                                          show: true },
    { id: 'assessment', label: 'Assessment',                                                       show: caps.view_assessment },
    { id: 'quote',      label: 'Quote',                                                            show: caps.view_quote },
    { id: 'photos',     label: `Photos${photos.length ? ` (${photos.length})` : ''}`,             show: caps.upload_photos_assigned || caps.upload_photos_any },
    { id: 'documents',  label: `Docs${documents.length ? ` (${documents.length})` : ''}`,         show: caps.generate_documents },
    { id: 'messages',   label: unreadSms > 0 ? `💬 SMS (${unreadSms})` : '💬 SMS',               show: caps.send_sms && isActiveJob },
    { id: 'invoice',    label: 'Invoice',                                                          show: canInvoice },
  ]
  const tabs = allTabs.filter(t => t.show)

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 40 }}>
      {/* Header */}
      <div data-devid="P2-E1" style={{ borderBottom: '1px solid var(--border)', padding: '14px 0', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <div className="container">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <Link href={jobsListHref}>
              <button className="btn btn-ghost" style={{ padding: '6px 0', fontSize: 14 }}>{jobsBackLabel}</button>
            </Link>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isAdmin || caps.edit_job_details
                  ? `${job.client_name} — ${JOB_TYPE_LABELS[job.job_type] ?? job.job_type}`
                  : `${JOB_TYPE_LABELS[job.job_type] ?? job.job_type} · ${job.site_address.split(',')[0]}`}
              </div>
            </div>
            <div data-devid="P2-E2" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <span className={`badge badge-${job.status}`}>{STATUS_LABELS[job.status]}</span>
              <span className={`badge badge-${job.urgency}`}>{job.urgency}</span>
            </div>
          </div>

          {/* Tabs — horizontal scroll slider */}
          <div data-devid="P2-E3" className="tab-slider" style={{
            display: 'flex',
            gap: 0,
            overflowX: 'auto',
            borderBottom: '1px solid var(--border)',
            marginBottom: -1,
            marginLeft: -16,
            marginRight: -16,
            paddingLeft: 16,
            paddingRight: 16,
          }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600,
                color: activeTab === t.id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'color 0.15s, border-color 0.15s',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div data-devid="P2-E4" className="container" style={{ paddingTop: 24 }}>
        {activeTab === 'details' && (
          <DetailsTab job={job} onJobUpdate={setJob} readOnly={!isAdmin && !caps.edit_job_details} />
        )}
        {activeTab === 'assessment' && (
          <AssessmentTab job={job} onJobUpdate={setJob} />
        )}
        {activeTab === 'quote' && (
          <QuoteTab job={job} documents={documents} onJobUpdate={setJob} />
        )}
        {activeTab === 'photos' && (
          <PhotosTab
            jobId={id}
            photos={photos}
            areas={job.assessment_data?.areas?.map(a => a.name) ?? []}
            onPhotosUpdate={setPhotos}
          />
        )}
        {activeTab === 'documents' && (
          <DocumentsTab
            jobId={job.id}
            documents={documents}
            clientName={job.client_name}
            clientEmail={job.client_email ?? ''}
            onDocumentDeleted={docId => setDocuments(prev => prev.filter(d => d.id !== docId))}
          />
        )}
        {activeTab === 'messages' && (
          <MessagesTab job={job} />
        )}
        {activeTab === 'invoice' && (
          <InvoiceTab jobId={id} />
        )}
      </div>
    </div>
  )
}
