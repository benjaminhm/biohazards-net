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
import { useUser, canSeeAssessment, canCreateDocuments } from '@/lib/userContext'

type Tab = 'details' | 'assessment' | 'quote' | 'photos' | 'documents'

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
  const { role }     = useUser()

  const [job,       setJob]       = useState<Job | null>(null)
  const [photos,    setPhotos]    = useState<Photo[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading,   setLoading]   = useState(true)

  const initialTab = (searchParams.get('tab') as Tab) ?? 'details'
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    try {
      const [jobRes, docsRes] = await Promise.all([
        fetch(`/api/jobs/${id}`),
        fetch(`/api/documents?jobId=${id}`),
      ])
      const jobData  = await jobRes.json()
      const docsData = await docsRes.json()
      setJob(jobData.job)
      setPhotos(jobData.photos ?? [])
      setDocuments(docsData.documents ?? [])
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
        <Link href="/jobs/queue"><button className="btn btn-secondary">Back to Queue</button></Link>
      </div>
    )
  }

  const allTabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'details',    label: 'Details',                                                          show: true },
    { id: 'assessment', label: 'Assessment',                                                       show: canSeeAssessment(role) },
    { id: 'quote',      label: 'Quote',                                                            show: canSeeAssessment(role) },
    { id: 'photos',     label: `Photos${photos.length ? ` (${photos.length})` : ''}`,             show: true },
    { id: 'documents',  label: `Docs${documents.length ? ` (${documents.length})` : ''}`,         show: canCreateDocuments(role) },
  ]
  const tabs = allTabs.filter(t => t.show)

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 40 }}>
      {/* Header */}
      <div data-devid="P2-E1" style={{ borderBottom: '1px solid var(--border)', padding: '14px 0', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
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
          <DetailsTab job={job} onJobUpdate={setJob} />
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
      </div>
    </div>
  )
}
