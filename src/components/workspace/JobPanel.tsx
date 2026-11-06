'use client'

/*
 * components/workspace/JobPanel.tsx
 *
 * Right panel: the open job, editable by hand, reusing the Classic job tabs.
 * Pending agent drafts sit at the top with approve / reject. Reloaded by the
 * workspace after each agent turn and each approval.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Document, Job, Photo } from '@/lib/types'
import ClientDetailsTab from '@/components/tabs/ClientDetailsTab'
import TimelineTab from '@/components/tabs/TimelineTab'
import DocumentsTab from '@/components/tabs/DocumentsTab'
import PhotosTab from '@/components/tabs/PhotosTab'
import ProgressNotesTab from '@/components/tabs/ProgressNotesTab'
import DraftList, { type DraftView } from './DraftList'
import JobFlags from './JobFlags'
import { STATUS_LABELS } from './JobListPanel'

type Tab = 'details' | 'documents' | 'photos' | 'calls' | 'notes'
const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'documents', label: 'Documents' },
  { id: 'photos', label: 'Photos' },
  { id: 'calls', label: 'Calls' },
  { id: 'notes', label: 'Notes' },
]

interface CallItem {
  id: string
  created_at: string
  caller_number: string
  status: string
  extraction: { summary?: string } | null
  validation: { decision?: string } | null
}

export default function JobPanel({
  job,
  photos,
  documents,
  drafts,
  version,
  onJobUpdate,
  onPhotosUpdate,
  onDocumentsUpdate,
  onDraftsDecided,
}: {
  job: Job
  photos: Photo[]
  documents: Document[]
  drafts: DraftView[]
  version: number
  onJobUpdate: (job: Job) => void
  onPhotosUpdate: (photos: Photo[]) => void
  onDocumentsUpdate: (docs: Document[]) => void
  onDraftsDecided: () => void
}) {
  const [tab, setTab] = useState<Tab>('details')
  const [loadedCalls, setLoadedCalls] = useState<{ key: string; calls: CallItem[] } | null>(null)
  const callsKey = `${job.id}:${version}`
  const calls = loadedCalls?.key === callsKey ? loadedCalls.calls : null

  useEffect(() => {
    if (tab !== 'calls') return
    let live = true
    fetch(`/api/calls?job_id=${job.id}`)
      .then(r => (r.ok ? r.json() : { calls: [] }))
      .then(d => { if (live) setLoadedCalls({ key: callsKey, calls: d.calls ?? [] }) })
      .catch(() => { if (live) setLoadedCalls({ key: callsKey, calls: [] }) })
    return () => { live = false }
  }, [tab, job.id, callsKey])

  const pending = drafts.filter(d => d.status === 'pending')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', borderLeft: '1px solid var(--border)' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, fontWeight: 800, color: 'var(--accent)' }}>
            {job.job_code ? `#${job.job_code}` : ''}
          </span>
          <span style={{ flex: 1, fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.client_name || 'Unnamed'}
          </span>
          <span className={`badge badge-${job.status}`}>{STATUS_LABELS[job.status]}</span>
          <Link href={`/jobs/${job.id}`} style={{ fontSize: 12, color: 'var(--text-muted)' }} title="Open this job in Classic view">
            Classic ↗
          </Link>
        </div>
        {job.site_address && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{job.site_address}</div>}
        <div style={{ display: 'flex', gap: 2, marginTop: 10 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding: '5px 10px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
                background: tab === t.id ? 'var(--surface-2)' : 'transparent',
                color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <div style={{ marginBottom: 10 }}>
          <JobFlags jobId={job.id} reloadKey={version} compact />
        </div>
        {pending.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <DraftList drafts={pending} onDecided={onDraftsDecided} />
          </div>
        )}

        {tab === 'details' && (
          <div key={`details-${version}`}>
            <ClientDetailsTab job={job} onJobUpdate={onJobUpdate} />
            <TimelineTab job={job} onJobUpdate={onJobUpdate} />
          </div>
        )}
        {tab === 'documents' && (
          <DocumentsTab
            key={`docs-${version}`}
            jobId={job.id}
            documents={documents}
            clientName={job.client_name}
            clientEmail={job.client_email ?? ''}
            onDocumentDeleted={docId => onDocumentsUpdate(documents.filter(d => d.id !== docId))}
            mode="history"
          />
        )}
        {tab === 'photos' && (
          <PhotosTab
            jobId={job.id}
            photos={photos}
            assessmentData={job.assessment_data}
            onAssessmentDataUpdate={assessment_data => onJobUpdate({ ...job, assessment_data })}
            onPhotosUpdate={onPhotosUpdate}
          />
        )}
        {tab === 'calls' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {calls === null && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>}
            {calls?.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No calls or website enquiries on this job.</div>}
            {calls?.map(c => (
              <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--surface)' }}>
                <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>{new Date(c.created_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  <span>{c.caller_number || 'Website enquiry'}</span>
                  <span style={{ marginLeft: 'auto' }}>{c.status.replace(/_/g, ' ')}</span>
                </div>
                {c.extraction?.summary && <div style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' }}>{c.extraction.summary}</div>}
              </div>
            ))}
            <Link href="/calls" style={{ fontSize: 12, color: 'var(--text-muted)' }}>All calls ↗</Link>
          </div>
        )}
        {tab === 'notes' && <ProgressNotesTab key={`notes-${version}`} job={job} />}
      </div>
    </div>
  )
}
