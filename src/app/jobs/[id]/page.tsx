'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Job, Photo, Document, DocType, JobStatus } from '@/lib/types'
import DetailsTab from '@/components/tabs/DetailsTab'
import AssessmentTab from '@/components/tabs/AssessmentTab'
import PhotosTab from '@/components/tabs/PhotosTab'
import DocumentsTab from '@/components/tabs/DocumentsTab'
import GenerateModal from '@/components/GenerateModal'

type Tab = 'details' | 'assessment' | 'photos' | 'documents'

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene: 'Crime Scene',
  hoarding: 'Hoarding',
  mold: 'Mold',
  sewage: 'Sewage',
  trauma: 'Trauma',
  unattended_death: 'Unattended Death',
  flood: 'Flood',
  other: 'Other',
}

const STATUS_LABELS: Record<JobStatus, string> = {
  lead: 'Lead',
  assessed: 'Assessed',
  quoted: 'Quoted',
  accepted: 'Accepted ✓',
  scheduled: 'Scheduled',
  underway: 'Underway',
  completed: 'Completed',
  report_sent: 'Report Sent',
  paid: 'Paid',
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [job, setJob] = useState<Job | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('details')

  // Generate state — modal opens immediately, content arrives async
  const [modalType, setModalType]       = useState<DocType | null>(null)
  const [modalContent, setModalContent] = useState<object | null>(null)
  const [generateError, setGenerateError] = useState('')

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    try {
      const [jobRes, docsRes] = await Promise.all([
        fetch(`/api/jobs/${id}`),
        fetch(`/api/documents?jobId=${id}`),
      ])
      const jobData = await jobRes.json()
      const docsData = await docsRes.json()
      setJob(jobData.job)
      setPhotos(jobData.photos ?? [])
      setDocuments(docsData.documents ?? [])
    } finally {
      setLoading(false)
    }
  }

  async function generate(type: DocType) {
    if (!job?.assessment_data) {
      setGenerateError('Please fill in the Assessment tab before generating documents.')
      setTimeout(() => setGenerateError(''), 4000)
      return
    }
    // Open modal immediately — content will arrive shortly
    setModalType(type)
    setModalContent(null)
    setGenerateError('')
    try {
      const res = await fetch(`/api/generate/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Generation failed')
      setModalContent(data.content)
    } catch (err: unknown) {
      setModalContent(null)
      setModalType(null)
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate document')
      setTimeout(() => setGenerateError(''), 5000)
    }
  }

  function onDocumentSaved(doc: Document) {
    setDocuments(prev => [doc, ...prev])
    setModalType(null)
    setModalContent(null)
  }

  function closeModal() {
    setModalType(null)
    setModalContent(null)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-muted)' }}>
        <div className="spinner" />
        Loading job...
      </div>
    )
  }

  if (!job) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Job not found</div>
        <Link href="/jobs/queue"><button className="btn btn-secondary">Back to Queue</button></Link>
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'assessment', label: 'Assessment' },
    { id: 'photos', label: `Photos${photos.length ? ` (${photos.length})` : ''}` },
    { id: 'documents', label: `Documents${documents.length ? ` (${documents.length})` : ''}` },
  ]

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 120 }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 0', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <div className="container">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <Link href="/jobs/queue">
              <button className="btn btn-ghost" style={{ padding: '6px 0', fontSize: 14 }}>← Jobs</button>
            </Link>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {job.client_name} — {JOB_TYPE_LABELS[job.job_type] ?? job.job_type}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <span className={`badge badge-${job.status}`}>{STATUS_LABELS[job.status]}</span>
              <span className={`badge badge-${job.urgency}`}>{job.urgency}</span>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: -1 }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: activeTab === t.id ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="container" style={{ paddingTop: 24 }}>
        {activeTab === 'details' && (
          <DetailsTab job={job} onJobUpdate={updated => setJob(updated)} />
        )}
        {activeTab === 'assessment' && (
          <AssessmentTab job={job} onJobUpdate={updated => setJob(updated)} />
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
          <DocumentsTab documents={documents} />
        )}
      </div>

      {/* Generate buttons — always visible */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(transparent, var(--bg) 30%)',
        padding: '20px 16px 20px',
        zIndex: 20,
      }}>
        {generateError && (
          <div className="container" style={{ marginBottom: 10 }}>
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#F87171', fontSize: 13 }}>
              {generateError}
            </div>
          </div>
        )}
        <div className="container">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['quote', 'sow', 'report'] as DocType[]).map(t => {
              const labels = { quote: 'Quote', sow: 'SOW', report: 'Report' }
              return (
                <button
                  key={t}
                  onClick={() => generate(t)}
                  disabled={!!modalType}
                  className="btn btn-primary"
                  style={{ flex: 1, fontSize: 13, padding: '12px 8px', opacity: modalType && modalType !== t ? 0.5 : 1 }}
                >
                  + {labels[t]}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Generate modal — opens immediately, content streams in */}
      {modalType && (
        <GenerateModal
          jobId={id}
          type={modalType}
          content={modalContent}
          photos={photos}
          clientName={job.client_name}
          clientEmail={job.client_email ?? ''}
          onClose={closeModal}
          onSaved={onDocumentSaved}
        />
      )}
    </div>
  )
}
