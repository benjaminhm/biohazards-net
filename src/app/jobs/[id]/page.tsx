/*
 * app/jobs/[id]/page.tsx
 *
 * Job detail page — the primary work surface for a single job. Hosts all six tabs
 * as independent components with shared job/photos/documents state managed here.
 *
 * Tab state is persisted in the ?tab= query parameter so refreshing or deep-linking
 * returns to the same tab. Active tab is initialised from searchParams on mount.
 *
 * When the Assessment tab is active, a secondary tab row (Presentation / Hazards / Risks / Document)
 * sits under the page title: Presentation is AssessmentTab; Hazards lists hazard chips
 * (Identify/Generate); Risks shows suggested_risks_ai with refresh from Presentation;
 * Document is AssessmentDocumentTab (internal assessment_document_capture; suggest/save).
 *
 * Unread SMS badge is fetched separately from the messages API so the Messages tab
 * header can show a red dot even before the user opens that tab.
 * Pilot orgs (JOB_INBOUND_EMAIL_ORG_SLUGS) get per-job inbound email next to SMS.
 *
 * All tab components receive callback props (onJobUpdate, onPhotosUpdate,
 * onDocumentDeleted) to bubble state changes back here rather than each tab
 * managing its own API responses and causing stale views.
 *
 * Capability checks (caps) gate which tabs are visible:
 *   - view_assessment gates the Assessment tab (Presentation / Hazards / Risks / Document capture).
 *   - view_documents requires Documents.
 *   - send_sms requires Messages.
 * Admins see all tabs regardless of caps.
 */
'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Job, Photo, Document, DocumentBundle, JobStatus } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import DetailsTab from '@/components/tabs/DetailsTab'
import AssessmentTab from '@/components/tabs/AssessmentTab'
import AssessmentBiohazardsTab from '@/components/tabs/AssessmentBiohazardsTab'
import AssessmentRisksTab from '@/components/tabs/AssessmentRisksTab'
import QuoteTab from '@/components/tabs/QuoteTab'
import PhotosTab from '@/components/tabs/PhotosTab'
import DocumentsTab from '@/components/tabs/DocumentsTab'
import PreRemediationChecklistTab from '@/components/tabs/PreRemediationChecklistTab'
import ScopeOfWorkTab from '@/components/tabs/ScopeOfWorkTab'
import AssessmentDocumentTab from '@/components/tabs/AssessmentDocumentTab'
import QuoteCaptureTab from '@/components/tabs/QuoteCaptureTab'
import IaqBundleCaptureTab from '@/components/tabs/IaqBundleCaptureTab'
import MessagesTab from '@/components/tabs/MessagesTab'
import InvoiceTab from '@/components/tabs/InvoiceTab'
import ProgressNotesTab from '@/components/tabs/ProgressNotesTab'
import ProgressPhotosTab from '@/components/tabs/ProgressPhotosTab'
import CompletionReportTab from '@/components/tabs/CompletionReportTab'
import PerExecuteCapturePanel from '@/components/tabs/PerExecuteCapturePanel'
import { useUser } from '@/lib/userContext'
import {
  UnsavedChangesProvider,
  confirmLeaveWhenUnsaved,
  useUnsavedChanges,
} from '@/lib/unsavedChangesContext'

type Tab = 'home' | 'docs' | 'details' | 'assessment' | 'case_studies' | 'scope_capture' | 'quote_capture' | 'pre_remediation_checklist_capture' | 'progress_capture' | 'progress_notes_capture' | 'quality_checks_capture' | 'recommendations_capture' | 'progress_report_generate' | 'client_feedback_capture' | 'team_feedback_capture' | 'engagement_agreement_capture' | 'nda_capture' | 'authority_to_proceed_capture' | 'swms_capture' | 'jsa_capture' | 'risk_assessment_capture' | 'waste_disposal_manifest_capture' | 'iaq_multi_capture' | 'quote' | 'photos' | 'messages' | 'invoice'

function UnsavedNavigationGuard({
  setActiveTab,
  children,
}: {
  setActiveTab: (next: Tab) => void
  children: (p: {
    requestTabChange: (next: Tab) => void
    onBackToJobsClick: (e: React.MouseEvent<HTMLAnchorElement>) => void
  }) => React.ReactNode
}) {
  const { hasUnsaved } = useUnsavedChanges()
  const requestTabChange = (next: Tab) => {
    if (!confirmLeaveWhenUnsaved(hasUnsaved)) return
    setActiveTab(next)
  }
  const onBackToJobsClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!confirmLeaveWhenUnsaved(hasUnsaved)) e.preventDefault()
  }
  return <>{children({ requestTabChange, onBackToJobsClick })}</>
}

function pageTitleForTab(tab: Tab, job: Job): string {
  switch (tab) {
    case 'home':
      return 'Home'
    case 'docs':
      return 'Docs'
    case 'details':
      return 'Job details'
    case 'assessment':
      return 'Assessment'
    case 'case_studies':
      return 'Case studies'
    case 'scope_capture':
      return 'Scope of work'
    case 'quote_capture':
      return 'Quote'
    case 'pre_remediation_checklist_capture':
      return 'Pre-Remediation Checklist'
    case 'progress_capture':
      return 'Progress photos'
    case 'progress_notes_capture':
      return 'Progress notes'
    case 'quality_checks_capture':
      return 'Quality control checks'
    case 'recommendations_capture':
      return 'Recommendations'
    case 'progress_report_generate':
      return 'Completion report'
    case 'client_feedback_capture':
      return 'Client feedback'
    case 'team_feedback_capture':
      return 'Team member feedback'
    case 'engagement_agreement_capture':
      return DOC_TYPE_LABELS.engagement_agreement
    case 'nda_capture':
      return DOC_TYPE_LABELS.nda
    case 'authority_to_proceed_capture':
      return DOC_TYPE_LABELS.authority_to_proceed
    case 'swms_capture':
      return DOC_TYPE_LABELS.swms
    case 'jsa_capture':
      return DOC_TYPE_LABELS.jsa
    case 'risk_assessment_capture':
      return DOC_TYPE_LABELS.risk_assessment
    case 'waste_disposal_manifest_capture':
      return DOC_TYPE_LABELS.waste_disposal_manifest
    case 'iaq_multi_capture':
      return 'Assessment / Scope / Quote'
    case 'quote':
      return 'Quote'
    case 'photos':
      return 'Photos'
    case 'messages':
      return job.inbound_email_address ? 'Messages' : 'SMS'
    case 'invoice':
      return 'Invoice'
    default:
      return 'Job'
  }
}

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
  const { caps, isAdmin, loading: userLoading, org } = useUser()
  /** Field workers (no view_all_jobs) use /field; ops staff use full queue. */
  const jobsListHref = userLoading
    ? '/jobs/queue'
    : (isAdmin || caps.view_all_jobs ? '/jobs/queue' : '/field')
  const jobsBackLabel = isAdmin || caps.view_all_jobs ? '← Jobs' : '← My jobs'

  const [job,         setJob]         = useState<Job | null>(null)
  const [photos,      setPhotos]      = useState<Photo[]>([])
  const [documents,   setDocuments]   = useState<Document[]>([])
  const [documentBundles, setDocumentBundles] = useState<DocumentBundle[]>([])
  const [loading,     setLoading]     = useState(true)
  const [unreadSms,   setUnreadSms]   = useState(0)
  const [canInvoice,  setCanInvoice]  = useState(false)

  const initialTabParam = searchParams.get('tab')
  const initialTab = initialTabParam === 'documents'
    ? 'home'
    : ((initialTabParam as Tab | null) ?? 'home')
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  /** Secondary tabs when viewing Assessment (Presentation → Hazards → Risks → Document) */
  const [assessmentSection, setAssessmentSection] = useState<'presentation' | 'hazards' | 'risks' | 'document'>('presentation')

  const assessmentPresentationBtnStyle = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: assessmentSection === 'presentation' ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: assessmentSection === 'presentation' ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    marginBottom: -1,
  } as const

  const assessmentBiohazardsBtnStyle = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: assessmentSection === 'hazards' ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: assessmentSection === 'hazards' ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    marginBottom: -1,
  } as const

  const assessmentRisksBtnStyle = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: assessmentSection === 'risks' ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: assessmentSection === 'risks' ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    marginBottom: -1,
  } as const

  const assessmentDocumentBtnStyle = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: assessmentSection === 'document' ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: assessmentSection === 'document' ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    marginBottom: -1,
  } as const

  useEffect(() => { fetchAll() }, [id])

  useEffect(() => {
    if (activeTab !== 'assessment') setAssessmentSection('presentation')
  }, [activeTab])

  async function refreshDocumentBundles() {
    const bundlesRes = await fetch(`/api/jobs/${id}/document-bundles`)
    if (bundlesRes.ok) {
      const bd = await bundlesRes.json()
      setDocumentBundles(bd.bundles ?? [])
    }
  }

  async function fetchAll() {
    setLoading(true)
    try {
      const [jobRes, docsRes, msgRes, invRes, bundlesRes] = await Promise.all([
        fetch(`/api/jobs/${id}`),
        fetch(`/api/documents?jobId=${id}`),
        fetch(`/api/sms/messages?job_id=${id}`),
        fetch(`/api/jobs/${id}/invoices`),
        fetch(`/api/jobs/${id}/document-bundles`),
      ])
      const jobData  = await jobRes.json()
      const docsData = await docsRes.json()
      const msgData  = await msgRes.json()
      const invData  = await invRes.json()
      if (bundlesRes.ok) {
        const bd = await bundlesRes.json()
        setDocumentBundles(bd.bundles ?? [])
      } else {
        setDocumentBundles([])
      }
      setJob(
        jobData.job
          ? {
              ...jobData.job,
              inbound_email_address: jobData.inbound_email_address ?? jobData.job.inbound_email_address ?? null,
            }
          : null
      )
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
    { id: 'home',       label: 'Home',         show: caps.generate_documents },
    { id: 'details',    label: 'Details',                                                          show: true },
    { id: 'case_studies', label: 'Case Studies',                                                   show: job.org_id ? (org?.features?.case_studies_tab === true) : false },
    { id: 'photos',     label: `Photos${photos.length ? ` (${photos.length})` : ''}`,             show: caps.upload_photos_assigned || caps.upload_photos_any },
    { id: 'docs',       label: 'Docs',                                                             show: true },
    { id: 'messages',   label: job.inbound_email_address ? (unreadSms > 0 ? `💬 Messages (${unreadSms})` : '💬 Messages') : (unreadSms > 0 ? `💬 SMS (${unreadSms})` : '💬 SMS'), show: caps.send_sms && isActiveJob },
    { id: 'invoice',    label: 'Invoice',                                                          show: canInvoice },
  ]
  const tabs = allTabs.filter(t => t.show)
  const pageTitle = pageTitleForTab(activeTab, job)
  const emptyRoomStyle: React.CSSProperties = {
    minHeight: 360,
    border: '1px dashed var(--border)',
    borderRadius: 12,
    background: 'var(--surface)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    fontSize: 14,
    fontWeight: 600,
  }

  return (
    <UnsavedChangesProvider>
      <UnsavedNavigationGuard setActiveTab={setActiveTab}>
        {({ requestTabChange, onBackToJobsClick }) => (
    <div style={{ minHeight: '100vh', paddingBottom: 40 }}>
      {/* Header */}
      <div data-devid="P2-E1" style={{ borderBottom: '1px solid var(--border)', padding: '14px 0', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <div className="container">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <Link href={jobsListHref} onClick={onBackToJobsClick}>
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
              <button key={t.id} onClick={() => requestTabChange(t.id)} style={{
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
        <header style={{ marginBottom: activeTab === 'assessment' ? 0 : 22 }}>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: 'var(--text)',
              lineHeight: 1.15,
              margin: 0,
            }}
          >
            {pageTitle}
          </h1>
        </header>
        {activeTab === 'assessment' && (
          <div
            role="tablist"
            aria-label="Assessment sections"
            style={{
              display: 'flex',
              gap: 0,
              flexWrap: 'wrap',
              marginBottom: 20,
              marginTop: 12,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={assessmentSection === 'presentation'}
              onClick={() => setAssessmentSection('presentation')}
              style={assessmentPresentationBtnStyle}
            >
              Presentation
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={assessmentSection === 'hazards'}
              onClick={() => setAssessmentSection('hazards')}
              style={assessmentBiohazardsBtnStyle}
            >
              Hazards
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={assessmentSection === 'risks'}
              onClick={() => setAssessmentSection('risks')}
              style={assessmentRisksBtnStyle}
            >
              Risks
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={assessmentSection === 'document'}
              onClick={() => setAssessmentSection('document')}
              style={assessmentDocumentBtnStyle}
            >
              Document
            </button>
          </div>
        )}
        {activeTab === 'details' && (
          <DetailsTab job={job} onJobUpdate={setJob} readOnly={!isAdmin && !caps.edit_job_details} />
        )}
        {activeTab === 'assessment' && assessmentSection === 'presentation' && (
          <AssessmentTab
            job={job}
            onJobUpdate={setJob}
            photos={photos}
            onPhotosUpdate={setPhotos}
          />
        )}
        {activeTab === 'assessment' && assessmentSection === 'hazards' && (
          <AssessmentBiohazardsTab job={job} onJobUpdate={setJob} />
        )}
        {activeTab === 'assessment' && assessmentSection === 'risks' && (
          <AssessmentRisksTab job={job} onJobUpdate={setJob} />
        )}
        {activeTab === 'assessment' && assessmentSection === 'document' && (
          <AssessmentDocumentTab job={job} onJobUpdate={setJob} />
        )}
        {activeTab === 'case_studies' && (
          <div style={emptyRoomStyle}>Case studies (empty room)</div>
        )}
        {activeTab === 'scope_capture' && (
          <ScopeOfWorkTab job={job} documents={documents} onJobUpdate={setJob} />
        )}
        {activeTab === 'quote_capture' && (
          <QuoteCaptureTab
            job={job}
            documents={documents}
            onJobUpdate={setJob}
            onGoToScope={() => requestTabChange('scope_capture')}
          />
        )}
        {activeTab === 'pre_remediation_checklist_capture' && (
          <PreRemediationChecklistTab job={job} onJobUpdate={setJob} />
        )}
        {activeTab === 'progress_capture' && (
          <ProgressPhotosTab
            job={job}
            photos={photos}
            onPhotosUpdate={setPhotos}
          />
        )}
        {activeTab === 'progress_notes_capture' && <ProgressNotesTab job={job} />}
        {activeTab === 'quality_checks_capture' && (
          <PerExecuteCapturePanel job={job} onJobUpdate={setJob} emphasis="quality_checks" />
        )}
        {activeTab === 'recommendations_capture' && (
          <PerExecuteCapturePanel job={job} onJobUpdate={setJob} emphasis="recommendations" />
        )}
        {activeTab === 'progress_report_generate' && (
          <CompletionReportTab job={job} photos={photos} onJobUpdate={setJob} />
        )}
        {activeTab === 'client_feedback_capture' && (
          <div style={emptyRoomStyle}>Client feedback (empty room)</div>
        )}
        {activeTab === 'team_feedback_capture' && (
          <div style={emptyRoomStyle}>Team member feedback (empty room)</div>
        )}
        {activeTab === 'engagement_agreement_capture' && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.engagement_agreement} (empty room)</div>
        )}
        {activeTab === 'nda_capture' && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.nda} (empty room)</div>
        )}
        {activeTab === 'authority_to_proceed_capture' && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.authority_to_proceed} (empty room)</div>
        )}
        {activeTab === 'swms_capture' && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.swms} (empty room)</div>
        )}
        {activeTab === 'jsa_capture' && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.jsa} (empty room)</div>
        )}
        {activeTab === 'risk_assessment_capture' && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.risk_assessment} (empty room)</div>
        )}
        {activeTab === 'waste_disposal_manifest_capture' && (
          <PerExecuteCapturePanel job={job} onJobUpdate={setJob} emphasis="waste_manifest_notes" />
        )}
        {activeTab === 'iaq_multi_capture' && (
          <IaqBundleCaptureTab job={job} documents={documents} onJobUpdate={setJob} />
        )}
        {activeTab === 'quote' && (
          <QuoteTab job={job} documents={documents} onJobUpdate={setJob} />
        )}
        {activeTab === 'photos' && (
          <PhotosTab
            jobId={id}
            photos={photos}
            assessmentData={job.assessment_data}
            onAssessmentDataUpdate={(assessment_data) => setJob(prev => prev ? { ...prev, assessment_data } : prev)}
            onPhotosUpdate={setPhotos}
          />
        )}
        {activeTab === 'home' && (
          <DocumentsTab
            jobId={job.id}
            documents={documents}
            clientName={job.client_name}
            clientEmail={job.client_email ?? ''}
            onDocumentDeleted={docId => setDocuments(prev => prev.filter(d => d.id !== docId))}
            onNavigate={requestTabChange}
            showSavedSection={false}
          />
        )}
        {activeTab === 'docs' && (
          <DocumentsTab
            jobId={job.id}
            documents={documents}
            documentBundles={documentBundles}
            onBundlesRefresh={refreshDocumentBundles}
            canComposeBundles={caps.edit_documents}
            clientName={job.client_name}
            clientEmail={job.client_email ?? ''}
            onDocumentDeleted={docId => setDocuments(prev => prev.filter(d => d.id !== docId))}
            showCreateSection={false}
          />
        )}
        {activeTab === 'messages' && (
          <MessagesTab job={job} inboundEmailAddress={job.inbound_email_address ?? null} />
        )}
        {activeTab === 'invoice' && (
          <InvoiceTab jobId={id} />
        )}
      </div>
    </div>
        )}
      </UnsavedNavigationGuard>
    </UnsavedChangesProvider>
  )
}

