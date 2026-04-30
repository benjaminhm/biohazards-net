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
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Job, Photo, Document, DocumentBundle, JobStatus, TeamCapabilities } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import ClientDetailsTab from '@/components/tabs/ClientDetailsTab'
import InitialContactTab from '@/components/tabs/InitialContactTab'
import TimelineTab from '@/components/tabs/TimelineTab'
import AssessmentTab from '@/components/tabs/AssessmentTab'
import AssessmentHealthHazardsTab from '@/components/tabs/AssessmentHealthHazardsTab'
import AssessmentRisksTab from '@/components/tabs/AssessmentRisksTab'
import AssessmentRecommendationsTab from '@/components/tabs/AssessmentRecommendationsTab'
import AssessmentEquipmentTab from '@/components/tabs/AssessmentEquipmentTab'
import AssessmentContentsTab from '@/components/tabs/AssessmentContentsTab'
import AssessmentStructureTab from '@/components/tabs/AssessmentStructureTab'
import AssessmentChemicalsTab from '@/components/tabs/AssessmentChemicalsTab'
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
import CompanyLetterTab from '@/components/tabs/CompanyLetterTab'
import PreStartBriefingTab from '@/components/tabs/PreStartBriefingTab'
import { useUser } from '@/lib/userContext'
import {
  UnsavedChangesProvider,
  confirmLeaveWhenUnsaved,
  useUnsavedChanges,
} from '@/lib/unsavedChangesContext'

type Tab = 'home' | 'docs' | 'details' | 'timeline' | 'assessment' | 'case_studies' | 'scope_capture' | 'quote_capture' | 'pre_remediation_checklist_capture' | 'progress_capture' | 'progress_notes_capture' | 'quality_checks_capture' | 'recommendations_capture' | 'progress_report_generate' | 'client_feedback_capture' | 'team_feedback_capture' | 'engagement_agreement_capture' | 'nda_capture' | 'authority_to_proceed_capture' | 'swms_capture' | 'jsa_capture' | 'risk_assessment_capture' | 'waste_disposal_manifest_capture' | 'iaq_multi_capture' | 'quote' | 'photos' | 'messages' | 'invoice' | 'company_letter' | 'prestart_briefing'

/**
 * Home sub-tabs — sequential remediation workflow phases rendered as an empty-room strip
 * under the Home h1. Content for each section will be wired up in subsequent PRs; phase-id
 * renames in docWorkflow.ts, caps gating, and per-tab admin toggles come with those.
 */
type HomeSection =
  | 'initial_contact'
  | 'onsite_assessment'
  | 'scope_of_work'
  | 'quote'
  | 'legal'
  | 'safety_compliance'
  | 'plan'
  | 'execute'
  | 'verify'
  | 'review'

const HOME_SECTIONS: { id: HomeSection; label: string }[] = [
  { id: 'initial_contact', label: 'Initial Contact' },
  { id: 'onsite_assessment', label: 'Onsite Assessment' },
  { id: 'scope_of_work', label: 'Scope of Work' },
  { id: 'quote', label: 'Quote' },
  { id: 'legal', label: 'Legal' },
  { id: 'safety_compliance', label: 'Safety and Compliance' },
  { id: 'plan', label: 'Plan' },
  { id: 'execute', label: 'Execute' },
  { id: 'verify', label: 'Verify' },
  { id: 'review', label: 'Review' },
]

const HOME_SECTION_IDS = HOME_SECTIONS.map(s => s.id) as readonly HomeSection[]

/** Docs primary tab sub-sections: Compose (generate new) / History (filed docs). */
type DocsSection = 'compose' | 'history'
const DOCS_SECTIONS: { id: DocsSection; label: string }[] = [
  { id: 'compose', label: 'Compose' },
  { id: 'history', label: 'History' },
]
const DOCS_SECTION_IDS = DOCS_SECTIONS.map(s => s.id) as readonly DocsSection[]

/**
 * Maps each Home sub-tab to the capability that gates its visibility. Admins and
 * managers have all ten on via ALL_CAPABILITIES / DEFAULT_MANAGER_CAPABILITIES;
 * members start with all ten off and rely on the admin flipping them in the
 * team profile. See CAP_GROUPS > "Job Home — Workflow sub-tabs" in app/team/[id].
 */
const HOME_SECTION_TO_CAP: Record<HomeSection, keyof TeamCapabilities> = {
  initial_contact:   'view_home_initial_contact',
  onsite_assessment: 'view_home_onsite_assessment',
  scope_of_work:     'view_home_scope_of_work',
  quote:             'view_home_quote',
  legal:             'view_home_legal',
  safety_compliance: 'view_home_safety_compliance',
  plan:              'view_home_plan',
  execute:           'view_home_execute',
  verify:            'view_home_verify',
  review:            'view_home_review',
}

/**
 * HomeWorkflowDrawer — vertical collapsible list used for the 10 Home phases.
 *
 * The workflow has more tabs than can comfortably live in a horizontal strip on
 * mobile, and the phases are strictly sequential (1 → 10), so a numbered drawer
 * communicates both the current step and the full roadmap without requiring a
 * horizontal scroll. Desktop inherits the same layout.
 *
 * Closed state: a full-width button showing "{step}. {current label}" + chevron.
 * Open state: the button remains as the trigger, followed by a vertical list of
 * all phases with a numbered circle; tapping a row selects + auto-closes.
 *
 * Lower-level sub-tabs (Assessment, Legal, Safety, Execute, Verify, Review) stay
 * on SubTabStrip — they are shallower and benefit from the horizontal layout.
 */
function HomeWorkflowDrawer<T extends string>({
  sections,
  active,
  onChange,
  ariaLabel,
}: {
  sections: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const activeIndex = sections.findIndex(s => s.id === active)
  const activeSection = activeIndex >= 0 ? sections[activeIndex] : sections[0]
  const activeStep = activeIndex >= 0 ? activeIndex + 1 : 1

  return (
    <nav aria-label={ariaLabel} style={{ marginTop: 12, marginBottom: 20 }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="home-workflow-drawer-list"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 16px',
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text)',
          fontSize: 15,
          fontWeight: 700,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'var(--blue)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {activeStep}
          </span>
          <span>{activeSection?.label ?? 'Select phase'}</span>
        </span>
        <span
          aria-hidden
          style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <ul
          id="home-workflow-drawer-list"
          role="menu"
          style={{
            listStyle: 'none',
            margin: '6px 0 0',
            padding: 6,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {sections.map((s, i) => {
            const selected = s.id === active
            return (
              <li key={s.id} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onChange(s.id)
                    setOpen(false)
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: selected ? 'rgba(59,130,246,0.15)' : 'transparent',
                    color: selected ? 'var(--blue)' : 'var(--text)',
                    fontSize: 14,
                    fontWeight: selected ? 700 : 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      fontSize: 11,
                      fontWeight: 700,
                      background: selected ? 'var(--blue)' : 'var(--bg)',
                      color: selected ? '#fff' : 'var(--text-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span>{s.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}

/**
 * SubTabStrip — shared horizontal-scroll sub-tab strip used for the Home sub-tabs
 * and their sub-sub-tabs (Legal, Safety & Compliance, Execute, Verify, Review).
 * Matches the primary tab-slider look (accent underline, muted inactive).
 */
function SubTabStrip<T extends string>({
  sections,
  active,
  onChange,
  ariaLabel,
}: {
  sections: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="tab-slider"
      style={{
        display: 'flex',
        gap: 0,
        overflowX: 'auto',
        borderBottom: '1px solid var(--border)',
        marginBottom: 20,
        marginTop: 12,
        marginLeft: -16,
        marginRight: -16,
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      {sections.map(s => {
        const selected = active === s.id
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(s.id)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              color: selected ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: selected ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'color 0.15s, border-color 0.15s',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              marginBottom: -1,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

type LegalSection = 'engagement_agreement' | 'nda'
const LEGAL_SECTIONS: { id: LegalSection; label: string }[] = [
  { id: 'engagement_agreement', label: 'Engagement Agreement' },
  { id: 'nda', label: 'Non-Disclosure Agreement' },
]

type SafetySection = 'authority_to_proceed' | 'swms' | 'jsa' | 'risk_assessment'
const SAFETY_SECTIONS: { id: SafetySection; label: string }[] = [
  { id: 'authority_to_proceed', label: 'Authority to Proceed' },
  { id: 'swms', label: 'SWMS' },
  { id: 'jsa', label: 'Job Safety Analysis' },
  { id: 'risk_assessment', label: 'Risk Assessment' },
]

type ExecuteSection = 'progress_photos' | 'progress_notes' | 'waste_manifest'
const EXECUTE_SECTIONS: { id: ExecuteSection; label: string }[] = [
  { id: 'progress_photos', label: 'Progress Photos' },
  { id: 'progress_notes', label: 'Progress Notes' },
  { id: 'waste_manifest', label: 'Waste Disposal Manifest' },
]

type VerifySection = 'quality_checks' | 'recommendations' | 'completion_report'
const VERIFY_SECTIONS: { id: VerifySection; label: string }[] = [
  { id: 'quality_checks', label: 'Quality Control Checks' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'completion_report', label: 'Completion Report' },
]

type ReviewSection = 'client_feedback' | 'team_feedback'
const REVIEW_SECTIONS: { id: ReviewSection; label: string }[] = [
  { id: 'client_feedback', label: 'Client feedback' },
  { id: 'team_feedback', label: 'Team member feedback' },
]

type CaseStudyWorkflowStatus = 'draft' | 'approved' | 'published'

interface WrittenCaseStudyCapture {
  case_title: string
  case_type: string
  region_context: string
  urgency_level: string
  call_context_summary: string
  caller_presentation: string
  constraints_at_intake: string
  initial_objective: string
  iaq_findings: string
  plan_rationale: string
  execution_sequence: string
  review_verification: string
  hazard_profile: string
  control_measures: string
  outcome_summary: string
  handover_summary: string
  key_lessons: string
  training_takeaways: string
}

interface VideoScriptCapture {
  target_platform: 'youtube_long' | 'youtube_short' | 'training_portal_video'
  duration_target_sec: number
  hook: string
  setup: string
  method: string
  outcome: string
  lessons: string
  cta: string
  scenes: string
}

const WRITTEN_INITIAL: WrittenCaseStudyCapture = {
  case_title: '',
  case_type: 'other',
  region_context: 'metro',
  urgency_level: 'standard',
  call_context_summary: '',
  caller_presentation: '',
  constraints_at_intake: '',
  initial_objective: '',
  iaq_findings: '',
  plan_rationale: '',
  execution_sequence: '',
  review_verification: '',
  hazard_profile: '',
  control_measures: '',
  outcome_summary: '',
  handover_summary: '',
  key_lessons: '',
  training_takeaways: '',
}

const VIDEO_INITIAL: VideoScriptCapture = {
  target_platform: 'youtube_long',
  duration_target_sec: 480,
  hook: '',
  setup: '',
  method: '',
  outcome: '',
  lessons: '',
  cta: '',
  scenes: '',
}

const CASE_BUBBLE: React.CSSProperties = {
  width: '100%',
  minHeight: 110,
  padding: '14px 16px',
  borderRadius: 16,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 14,
  lineHeight: 1.5,
  resize: 'vertical',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const CASE_SECTION_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
  marginTop: 20,
  marginBottom: 8,
}

const WRITTEN_FIELDS: { key: keyof WrittenCaseStudyCapture; label: string; placeholder: string; rows?: number }[] = [
  { key: 'case_title', label: 'Case title', placeholder: 'Sanitised case title.', rows: 2 },
  { key: 'case_type', label: 'Case type', placeholder: 'Trauma, flood, meth, mould, sewage, hoarding, other.', rows: 2 },
  { key: 'region_context', label: 'Region context', placeholder: 'Metro / regional / coastal / remote (no exact address).', rows: 2 },
  { key: 'urgency_level', label: 'Urgency level', placeholder: 'Standard / urgent / emergency.', rows: 2 },
  { key: 'call_context_summary', label: 'Call context summary', placeholder: 'What triggered the response and immediate problem framing.', rows: 3 },
  { key: 'caller_presentation', label: 'Caller presentation', placeholder: 'Tone, communication quality, stress indicators in non-graphic objective terms.', rows: 3 },
  { key: 'constraints_at_intake', label: 'Constraints at intake', placeholder: 'Access limits, timing, occupants, insurer or authority constraints.', rows: 3 },
  { key: 'initial_objective', label: 'Initial objective', placeholder: 'Target outcome agreed at dispatch.', rows: 2 },
  { key: 'iaq_findings', label: 'IAQ findings', placeholder: 'Assessment observations and contamination/risk findings.', rows: 3 },
  { key: 'plan_rationale', label: 'Plan rationale', placeholder: 'Why this strategy and controls were selected.', rows: 3 },
  { key: 'execution_sequence', label: 'Execution sequence', placeholder: 'Step-by-step non-graphic process narrative.', rows: 4 },
  { key: 'review_verification', label: 'Review and verification', placeholder: 'How completion/verification was checked.', rows: 3 },
  { key: 'hazard_profile', label: 'Hazard profile', placeholder: 'Key hazards and exposure pathways.', rows: 3 },
  { key: 'control_measures', label: 'Control measures', placeholder: 'Containment, PPE, workflow controls, administrative safeguards.', rows: 3 },
  { key: 'outcome_summary', label: 'Outcome summary', placeholder: 'Result and closure status.', rows: 3 },
  { key: 'handover_summary', label: 'Handover summary', placeholder: 'What was communicated at handover and next steps.', rows: 3 },
  { key: 'key_lessons', label: 'Key lessons', placeholder: 'Scientific/practical lessons from the case.', rows: 3 },
  { key: 'training_takeaways', label: 'Training takeaways', placeholder: 'What students should apply in future cases.', rows: 3 },
]

const VIDEO_FIELDS: { key: keyof VideoScriptCapture; label: string; placeholder: string; rows?: number }[] = [
  { key: 'hook', label: 'Hook', placeholder: 'Opening in 1-2 lines suited to YouTube narrative pacing.', rows: 2 },
  { key: 'setup', label: 'Setup', placeholder: 'Non-graphic contextual setup from written case.', rows: 3 },
  { key: 'method', label: 'Method', placeholder: 'How the team approached the case and why.', rows: 3 },
  { key: 'outcome', label: 'Outcome', placeholder: 'Outcome and verification summary in audience-friendly wording.', rows: 3 },
  { key: 'lessons', label: 'Lessons', placeholder: 'Top 3-5 lessons for viewers.', rows: 3 },
  { key: 'cta', label: 'Call to action', placeholder: 'Next step for learner/viewer.', rows: 2 },
  { key: 'scenes', label: 'Scene breakdown', placeholder: 'Scene-by-scene outline and narration cues.', rows: 8 },
]

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
      return 'Client details'
    case 'timeline':
      return 'Timeline'
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
    case 'company_letter':
      return 'Company Letter'
    case 'prestart_briefing':
      return 'Pre-start Briefing'
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
  const pathname     = usePathname()
  const router       = useRouter()
  const { caps, isAdmin, isManager, loading: userLoading, org } = useUser()
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
  /**
   * Home sub-tab — initialised from ?section=… so deep links like
   * /jobs/<id>?tab=home&section=verify restore the right pane on refresh.
   * Unknown values fall back to 'initial_contact' to avoid a blank workflow strip.
   */
  const initialSectionParam = searchParams.get('section')
  const initialHomeSection: HomeSection =
    initialTab === 'home' &&
    initialSectionParam &&
    HOME_SECTION_IDS.includes(initialSectionParam as HomeSection)
      ? (initialSectionParam as HomeSection)
      : 'initial_contact'
  const [homeSection, setHomeSection] = useState<HomeSection>(initialHomeSection)
  /**
   * Docs sub-tab — initialised from ?section=… when on ?tab=docs, so deep links
   * like /jobs/<id>?tab=docs&section=history restore correctly on refresh.
   * Defaults to 'compose' since producing a doc is the primary intent when you
   * land on Docs.
   */
  const initialDocsSection: DocsSection =
    initialTab === 'docs' &&
    initialSectionParam &&
    DOCS_SECTION_IDS.includes(initialSectionParam as DocsSection)
      ? (initialSectionParam as DocsSection)
      : 'compose'
  const [docsSection, setDocsSection] = useState<DocsSection>(initialDocsSection)
  /**
   * Sub-sub-tab state for Home sections that host multiple surfaces. Each resets to
   * its default when the parent Home section is changed so users don't land on a
   * stale sub-tab when switching phases.
   */
  const [legalSection,   setLegalSection]   = useState<LegalSection>('engagement_agreement')
  const [safetySection,  setSafetySection]  = useState<SafetySection>('authority_to_proceed')
  const [executeSection, setExecuteSection] = useState<ExecuteSection>('progress_photos')
  const [verifySection,  setVerifySection]  = useState<VerifySection>('quality_checks')
  const [reviewSection,  setReviewSection]  = useState<ReviewSection>('client_feedback')
  /** Secondary tabs when viewing Assessment (Presentation → Health Hazards → Risks → Recommendations → Equipment → Document) */
  const [assessmentSection, setAssessmentSection] = useState<'presentation' | 'hazards' | 'risks' | 'contents' | 'structure' | 'recommendations' | 'chemicals' | 'equipment' | 'document'>('presentation')
  const [caseStudiesSection, setCaseStudiesSection] = useState<'written' | 'video_script'>('written')
  const [writtenCaseStatus, setWrittenCaseStatus] = useState<CaseStudyWorkflowStatus>('draft')
  const [writtenCaseReviewer, setWrittenCaseReviewer] = useState('')
  const [writtenCaseReviewedAt, setWrittenCaseReviewedAt] = useState('')
  const [videoCaseStatus, setVideoCaseStatus] = useState<CaseStudyWorkflowStatus>('draft')
  const [videoCaseReviewer, setVideoCaseReviewer] = useState('')
  const [videoCaseReviewedAt, setVideoCaseReviewedAt] = useState('')
  const [writtenCapture, setWrittenCapture] = useState<WrittenCaseStudyCapture>(WRITTEN_INITIAL)
  const [writtenGenerated, setWrittenGenerated] = useState('')
  const [writtenCaseStudyJson, setWrittenCaseStudyJson] = useState<Record<string, unknown> | null>(null)
  const [writtenSavedJson, setWrittenSavedJson] = useState('')
  const [writtenSavedAt, setWrittenSavedAt] = useState('')
  const [videoCapture, setVideoCapture] = useState<VideoScriptCapture>(VIDEO_INITIAL)
  const [videoGenerated, setVideoGenerated] = useState('')
  const [videoSavedJson, setVideoSavedJson] = useState('')
  const [videoSavedAt, setVideoSavedAt] = useState('')
  const [writtenGenerating, setWrittenGenerating] = useState(false)
  const [videoGenerating, setVideoGenerating] = useState(false)
  const [caseStudyError, setCaseStudyError] = useState('')

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

  const assessmentContentsBtnStyle = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: assessmentSection === 'contents' ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: assessmentSection === 'contents' ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    marginBottom: -1,
  } as const

  const assessmentStructureBtnStyle = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: assessmentSection === 'structure' ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: assessmentSection === 'structure' ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    marginBottom: -1,
  } as const

  const assessmentRecommendationsBtnStyle = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: assessmentSection === 'recommendations' ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: assessmentSection === 'recommendations' ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    marginBottom: -1,
  } as const

  const assessmentChemicalsBtnStyle = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: assessmentSection === 'chemicals' ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: assessmentSection === 'chemicals' ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    marginBottom: -1,
  } as const

  const assessmentEquipmentBtnStyle = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: assessmentSection === 'equipment' ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: assessmentSection === 'equipment' ? '2px solid var(--accent)' : '2px solid transparent',
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

  useEffect(() => {
    if (userLoading) return
    if (!isAdmin && !isManager) {
      router.replace(`/field/jobs/${id}`)
      return
    }
    fetchAll()
  }, [id, userLoading, isAdmin, isManager, router])

  /**
   * Reset inner section state when the user leaves the parent tab/section.
   * Assessment is shared between the primary Assessment tab and Home's Onsite Assessment
   * sub-tab, so it only resets when both parents are inactive.
   */
  useEffect(() => {
    const inAssessment = activeTab === 'assessment' || (activeTab === 'home' && homeSection === 'onsite_assessment')
    if (!inAssessment) setAssessmentSection('presentation')
  }, [activeTab, homeSection])

  useEffect(() => {
    if (activeTab !== 'case_studies') setCaseStudiesSection('written')
  }, [activeTab])

  useEffect(() => {
    if (!(activeTab === 'home' && homeSection === 'legal')) setLegalSection('engagement_agreement')
  }, [activeTab, homeSection])

  useEffect(() => {
    if (!(activeTab === 'home' && homeSection === 'safety_compliance')) setSafetySection('authority_to_proceed')
  }, [activeTab, homeSection])

  useEffect(() => {
    if (!(activeTab === 'home' && homeSection === 'execute')) setExecuteSection('progress_photos')
  }, [activeTab, homeSection])

  useEffect(() => {
    if (!(activeTab === 'home' && homeSection === 'verify')) setVerifySection('quality_checks')
  }, [activeTab, homeSection])

  useEffect(() => {
    if (!(activeTab === 'home' && homeSection === 'review')) setReviewSection('client_feedback')
  }, [activeTab, homeSection])

  /**
   * Auto-correct the Home sub-section when the selected phase is not visible
   * to the current user — e.g. a member arrives via ?section=verify but the
   * admin has not granted view_home_verify. Pin to the first visible section
   * so the strip never renders a selected-but-invisible pill.
   */
  useEffect(() => {
    const isVisible = caps[HOME_SECTION_TO_CAP[homeSection]] === true
    if (isVisible) return
    const fallback = HOME_SECTIONS.find(s => caps[HOME_SECTION_TO_CAP[s.id]] === true)
    if (fallback) setHomeSection(fallback.id)
  }, [caps, homeSection])

  /**
   * URL write-back — keep ?tab= and ?section= in sync with local state so that
   * refreshing the page, copying the URL, or using browser back/forward all
   * land on the exact pane the user is looking at. `?section` is scrubbed
   * outside of Home since it's meaningless for other tabs. Uses replace to
   * avoid flooding history with a new entry per sub-tab click.
   */
  useEffect(() => {
    const next = new URLSearchParams(Array.from(searchParams.entries()))
    next.set('tab', activeTab)
    if (activeTab === 'home') next.set('section', homeSection)
    else if (activeTab === 'docs') next.set('section', docsSection)
    else next.delete('section')
    const currentQs = searchParams.toString()
    const nextQs = next.toString()
    if (currentQs === nextQs) return
    router.replace(`${pathname}${nextQs ? `?${nextQs}` : ''}`, { scroll: false })
  }, [activeTab, homeSection, docsSection, pathname, router, searchParams])

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

  /**
   * Filtered Home workflow strip — one entry per cap the user has. Members may
   * have any subset; admins/managers always see all ten. If the set is empty
   * the Home primary tab itself is hidden so we don't render a ghost shell.
   */
  const visibleHomeSections = HOME_SECTIONS.filter(s => caps[HOME_SECTION_TO_CAP[s.id]] === true)

  const allTabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'home',           label: 'Home',           show: visibleHomeSections.length > 0 },
    { id: 'details',        label: 'Client Details', show: true },
    { id: 'timeline',       label: 'Timeline',       show: true },
    { id: 'case_studies',   label: 'Case Studies',   show: org?.features?.case_studies_tab === true },
    { id: 'photos',         label: `Photos${photos.length ? ` (${photos.length})` : ''}`, show: caps.upload_photos_assigned || caps.upload_photos_any },
    { id: 'prestart_briefing', label: 'Pre-start Briefing', show: true },
    { id: 'docs',           label: 'Docs',           show: true },
    { id: 'company_letter', label: 'Company Letter', show: true },
    { id: 'messages',       label: job.inbound_email_address ? (unreadSms > 0 ? `💬 Messages (${unreadSms})` : '💬 Messages') : (unreadSms > 0 ? `💬 SMS (${unreadSms})` : '💬 SMS'), show: caps.send_sms && isActiveJob },
    { id: 'invoice',        label: 'Invoice',        show: canInvoice },
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

  /**
   * Render predicates — a tab/section is "showing" when either (a) the legacy
   * primary-tab route is active (deep-link compat) or (b) the user has selected
   * the matching sub-section under Home. This lets the content render in one
   * place and keeps the Home workflow + the old /?tab=… URLs working.
   */
  const onHome = activeTab === 'home'
  const inHome = (s: HomeSection) => onHome && homeSection === s
  const showDetails        = activeTab === 'details'
  const showTimeline       = activeTab === 'timeline'
  const showInitialContact = inHome('initial_contact')
  const showAssessmentUI   = activeTab === 'assessment' || inHome('onsite_assessment')
  const showScope          = activeTab === 'scope_capture' || inHome('scope_of_work')
  const showQuote          = activeTab === 'quote_capture' || inHome('quote')
  const showPRC            = activeTab === 'pre_remediation_checklist_capture' || inHome('plan')
  const showEngagementAgr  = activeTab === 'engagement_agreement_capture' || (inHome('legal') && legalSection === 'engagement_agreement')
  const showNda            = activeTab === 'nda_capture' || (inHome('legal') && legalSection === 'nda')
  const showAuthority      = activeTab === 'authority_to_proceed_capture' || (inHome('safety_compliance') && safetySection === 'authority_to_proceed')
  const showSwms           = activeTab === 'swms_capture' || (inHome('safety_compliance') && safetySection === 'swms')
  const showJsa            = activeTab === 'jsa_capture' || (inHome('safety_compliance') && safetySection === 'jsa')
  const showRiskAssessment = activeTab === 'risk_assessment_capture' || (inHome('safety_compliance') && safetySection === 'risk_assessment')
  const showProgressPhotos = activeTab === 'progress_capture' || (inHome('execute') && executeSection === 'progress_photos')
  const showProgressNotes  = activeTab === 'progress_notes_capture' || (inHome('execute') && executeSection === 'progress_notes')
  const showWasteManifest  = activeTab === 'waste_disposal_manifest_capture' || (inHome('execute') && executeSection === 'waste_manifest')
  const showQualityChecks  = activeTab === 'quality_checks_capture' || (inHome('verify') && verifySection === 'quality_checks')
  const showRecommendations= activeTab === 'recommendations_capture' || (inHome('verify') && verifySection === 'recommendations')
  const showCompletionRpt  = activeTab === 'progress_report_generate' || (inHome('verify') && verifySection === 'completion_report')
  const showClientFeedback = activeTab === 'client_feedback_capture' || (inHome('review') && reviewSection === 'client_feedback')
  const showTeamFeedback   = activeTab === 'team_feedback_capture' || (inHome('review') && reviewSection === 'team_feedback')

  const workflowCardStyle: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 14,
    background: 'var(--surface)',
    marginBottom: 12,
  }

  function nowStamp() {
    return new Date().toISOString()
  }

  function statusBadgeStyle(status: CaseStudyWorkflowStatus): React.CSSProperties {
    if (status === 'published') return { color: '#4ADE80', border: '1px solid rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.10)' }
    if (status === 'approved') return { color: '#60A5FA', border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.10)' }
    return { color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'var(--surface-2)' }
  }

  function updateWritten<K extends keyof WrittenCaseStudyCapture>(key: K, value: WrittenCaseStudyCapture[K]) {
    setWrittenCapture(prev => ({ ...prev, [key]: value }))
  }

  function updateVideo<K extends keyof VideoScriptCapture>(key: K, value: VideoScriptCapture[K]) {
    setVideoCapture(prev => ({ ...prev, [key]: value }))
  }

  function buildCaseStudySchemaFromForm(currentJob: Job) {
    const steps = writtenCapture.execution_sequence
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((description, idx) => ({
        step_number: idx + 1,
        title: `Step ${idx + 1}`,
        description,
      }))
    return {
      case_study: {
        meta: {
          id: '',
          created_at: new Date().toISOString(),
          job_id: currentJob.id,
          company: currentJob.client_organization_name || '',
          author: '',
        },
        snapshot: {
          title: writtenCapture.case_title,
          subtitle: writtenCapture.initial_objective,
          client_type: currentJob.client_contact_role || '',
          location: writtenCapture.region_context || 'anonymised',
          job_type: writtenCapture.case_type || currentJob.job_type,
          duration: '',
          headline_result: writtenCapture.outcome_summary,
        },
        challenge: {
          summary: writtenCapture.call_context_summary,
          details: writtenCapture.caller_presentation,
          risks_or_hazards: [writtenCapture.hazard_profile].filter(Boolean),
          regulatory_requirements: [],
          why_professional_needed: writtenCapture.constraints_at_intake,
        },
        solution: {
          approach_summary: writtenCapture.plan_rationale,
          steps: steps.length ? steps : [{ step_number: 1, title: '', description: '' }],
          equipment_used: [],
          chemicals_or_products_used: [],
          safety_protocols: [writtenCapture.control_measures].filter(Boolean),
          certifications_applied: [],
        },
        results: {
          outcome_summary: writtenCapture.outcome_summary,
          metrics: [{ label: '', value: '' }],
          before_after: {
            before: writtenCapture.call_context_summary,
            after: writtenCapture.review_verification,
          },
          clearance_testing: writtenCapture.review_verification,
          compliance_status: '',
        },
        testimonial: {
          quote: '',
          client_name: '',
          client_role: '',
          permission_granted: false,
        },
        key_takeaways: [writtenCapture.key_lessons, writtenCapture.training_takeaways].filter(Boolean),
        media: {
          photos_before: [],
          photos_after: [],
          documents_referenced: [],
        },
      },
    }
  }

  async function generateWrittenNarrative() {
    setCaseStudyError('')
    setWrittenGenerating(true)
    try {
      const res = await fetch(`/api/jobs/${id}/suggest-case-study`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'written',
          written_capture: writtenCapture,
        }),
      })
      const data = (await res.json()) as {
        case_study?: Record<string, unknown>
        written_draft?: string
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Could not generate written case study')
      setWrittenGenerated((data.written_draft ?? '').trim())
      if (data.case_study && typeof data.case_study === 'object') {
        setWrittenCaseStudyJson(data.case_study)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not generate written case study'
      setCaseStudyError(message)
      window.alert(message)
    } finally {
      setWrittenGenerating(false)
    }
  }

  function generateVideoFromWritten() {
    setCaseStudyError('')
    const setup = writtenCapture.call_context_summary || writtenCapture.initial_objective
    const method = `${writtenCapture.plan_rationale}\n${writtenCapture.execution_sequence}`.trim()
    const outcome = writtenCapture.outcome_summary || writtenCapture.handover_summary
    const lessons = writtenCapture.training_takeaways || writtenCapture.key_lessons
    const generatedScenes =
      `1) Hook: ${videoCapture.hook || `Urgent ${writtenCapture.case_type} response overview.`}\n` +
      `2) Setup: ${setup || 'Incident context and constraints.'}\n` +
      `3) Method: ${method || 'Assessment, controls, and execution sequence.'}\n` +
      `4) Outcome: ${outcome || 'Verification and handover.'}\n` +
      `5) Lessons: ${lessons || 'Key training takeaways.'}`
    setVideoCapture(prev => ({
      ...prev,
      setup: prev.setup || setup || '',
      method: prev.method || method || '',
      outcome: prev.outcome || outcome || '',
      lessons: prev.lessons || lessons || '',
      scenes: prev.scenes || generatedScenes,
    }))
  }

  async function generateVideoNarrative() {
    setCaseStudyError('')
    setVideoGenerating(true)
    try {
      const res = await fetch(`/api/jobs/${id}/suggest-case-study`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'video',
          written_capture: writtenCapture,
          video_capture: videoCapture,
        }),
      })
      const data = (await res.json()) as {
        video_capture?: Partial<VideoScriptCapture>
        video_draft?: string
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Could not generate video narrative')
      if (data.video_capture && typeof data.video_capture === 'object') {
        setVideoCapture(prev => ({ ...prev, ...data.video_capture }))
      }
      setVideoGenerated((data.video_draft ?? '').trim())
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not generate video narrative'
      setCaseStudyError(message)
      window.alert(message)
    } finally {
      setVideoGenerating(false)
    }
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
        <header style={{ marginBottom: showAssessmentUI || onHome || activeTab === 'docs' ? 0 : 22 }}>
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
        {/*
         * Strip ordering is deliberate: the Home primary strip (10 phases)
         * renders first, then every sub-sub strip (Assessment / Legal /
         * Safety / Execute / Verify / Review) sits directly beneath its
         * parent phase so the visual hierarchy reads parent → child.
         * Assessment's strip also shows on the legacy /?tab=assessment
         * deep link, in which case the Home primary strip is hidden.
         */}
        {activeTab === 'home' && visibleHomeSections.length > 0 && (
          <HomeWorkflowDrawer
            sections={visibleHomeSections}
            active={homeSection}
            onChange={setHomeSection}
            ariaLabel="Job workflow sections"
          />
        )}
        {showAssessmentUI && (
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
              Health Hazards
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
              aria-selected={assessmentSection === 'contents'}
              onClick={() => setAssessmentSection('contents')}
              style={assessmentContentsBtnStyle}
            >
              Contents
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={assessmentSection === 'structure'}
              onClick={() => setAssessmentSection('structure')}
              style={assessmentStructureBtnStyle}
            >
              Structure
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={assessmentSection === 'recommendations'}
              onClick={() => setAssessmentSection('recommendations')}
              style={assessmentRecommendationsBtnStyle}
            >
              Recommendations
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={assessmentSection === 'chemicals'}
              onClick={() => setAssessmentSection('chemicals')}
              style={assessmentChemicalsBtnStyle}
            >
              Chemicals
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={assessmentSection === 'equipment'}
              onClick={() => setAssessmentSection('equipment')}
              style={assessmentEquipmentBtnStyle}
            >
              Equipment
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
        {inHome('legal') && (
          <SubTabStrip
            sections={LEGAL_SECTIONS}
            active={legalSection}
            onChange={setLegalSection}
            ariaLabel="Legal document sections"
          />
        )}
        {inHome('safety_compliance') && (
          <SubTabStrip
            sections={SAFETY_SECTIONS}
            active={safetySection}
            onChange={setSafetySection}
            ariaLabel="Safety and compliance document sections"
          />
        )}
        {inHome('execute') && (
          <SubTabStrip
            sections={EXECUTE_SECTIONS}
            active={executeSection}
            onChange={setExecuteSection}
            ariaLabel="Execute sub-sections"
          />
        )}
        {inHome('verify') && (
          <SubTabStrip
            sections={VERIFY_SECTIONS}
            active={verifySection}
            onChange={setVerifySection}
            ariaLabel="Verify sub-sections"
          />
        )}
        {inHome('review') && (
          <SubTabStrip
            sections={REVIEW_SECTIONS}
            active={reviewSection}
            onChange={setReviewSection}
            ariaLabel="Review sub-sections"
          />
        )}
        {showDetails && (
          <ClientDetailsTab job={job} onJobUpdate={setJob} readOnly={!isAdmin && !caps.edit_job_details} />
        )}
        {showTimeline && (
          <TimelineTab job={job} onJobUpdate={setJob} readOnly={!isAdmin && !caps.edit_job_details} />
        )}
        {showInitialContact && (
          <InitialContactTab
            job={job}
            onJobUpdate={setJob}
            readOnly={!isAdmin && !caps.edit_job_details}
          />
        )}
        {showAssessmentUI && assessmentSection === 'presentation' && (
          <AssessmentTab
            job={job}
            onJobUpdate={setJob}
            photos={photos}
            onPhotosUpdate={setPhotos}
          />
        )}
        {showAssessmentUI && assessmentSection === 'hazards' && (
          <AssessmentHealthHazardsTab job={job} onJobUpdate={setJob} />
        )}
        {showAssessmentUI && assessmentSection === 'risks' && (
          <AssessmentRisksTab job={job} onJobUpdate={setJob} />
        )}
        {showAssessmentUI && assessmentSection === 'contents' && (
          <AssessmentContentsTab job={job} onJobUpdate={setJob} />
        )}
        {showAssessmentUI && assessmentSection === 'structure' && (
          <AssessmentStructureTab job={job} onJobUpdate={setJob} />
        )}
        {showAssessmentUI && assessmentSection === 'recommendations' && (
          <AssessmentRecommendationsTab job={job} onJobUpdate={setJob} />
        )}
        {showAssessmentUI && assessmentSection === 'chemicals' && (
          <AssessmentChemicalsTab job={job} onJobUpdate={setJob} />
        )}
        {showAssessmentUI && assessmentSection === 'equipment' && (
          <AssessmentEquipmentTab job={job} onJobUpdate={setJob} />
        )}
        {showAssessmentUI && assessmentSection === 'document' && (
          <AssessmentDocumentTab job={job} onJobUpdate={setJob} />
        )}
        {activeTab === 'case_studies' && (
          <>
            <div
              role="tablist"
              aria-label="Case studies sections"
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
                aria-selected={caseStudiesSection === 'written'}
                onClick={() => setCaseStudiesSection('written')}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: caseStudiesSection === 'written' ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: caseStudiesSection === 'written' ? '2px solid var(--accent)' : '2px solid transparent',
                  transition: 'color 0.15s, border-color 0.15s',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
              >
                Written Case Study
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={caseStudiesSection === 'video_script'}
                onClick={() => setCaseStudiesSection('video_script')}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: caseStudiesSection === 'video_script' ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: caseStudiesSection === 'video_script' ? '2px solid var(--accent)' : '2px solid transparent',
                  transition: 'color 0.15s, border-color 0.15s',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
              >
                Video Script Case Study
              </button>
            </div>
            {caseStudiesSection === 'written' && (
              <div>
                <div style={workflowCardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Written Case Study Workflow</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Draft {'->'} Approved {'->'} Published</div>
                    </div>
                    <span style={{ ...statusBadgeStyle(writtenCaseStatus), borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                      {writtenCaseStatus}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setWrittenCaseStatus('draft')}>Set Draft</button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        setWrittenCaseStatus('approved')
                        setWrittenCaseReviewer('Current User')
                        setWrittenCaseReviewedAt(nowStamp())
                      }}
                    >
                      Approve
                    </button>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={writtenCaseStatus !== 'approved'} onClick={() => setWrittenCaseStatus('published')}>
                      Publish
                    </button>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 2 }}>
                    <div>Reviewer: {writtenCaseReviewer || '-'}</div>
                    <div>Reviewed at: {writtenCaseReviewedAt ? new Date(writtenCaseReviewedAt).toLocaleString('en-AU') : '-'}</div>
                  </div>
                </div>
                <div style={{ ...workflowCardStyle, display: 'grid', gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Written Case Study</div>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                    Capture a scientific non-graphic narrative in sequence, then generate and save JSON.
                  </p>
                  {caseStudyError && (
                    <div style={{ border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.15)', color: '#fecaca', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
                      {caseStudyError}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={generateWrittenNarrative} disabled={writtenGenerating}>
                      {writtenGenerating ? 'Generating…' : 'Generate Written Draft'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        const payload = JSON.stringify(
                          writtenCaseStudyJson ? { case_study: writtenCaseStudyJson } : buildCaseStudySchemaFromForm(job),
                          null,
                          2
                        )
                        setWrittenSavedJson(payload)
                        setWrittenSavedAt(nowStamp())
                      }}
                    >
                      Save JSON Payload
                    </button>
                  </div>
                  {WRITTEN_FIELDS.map(({ key, label, placeholder, rows }, idx) => (
                    <div key={key}>
                      <div style={idx === 0 ? { ...CASE_SECTION_LABEL, marginTop: 4 } : CASE_SECTION_LABEL}>{label}</div>
                      <textarea
                        value={writtenCapture[key]}
                        onChange={e => updateWritten(key, e.target.value)}
                        placeholder={placeholder}
                        rows={rows ?? 3}
                        style={CASE_BUBBLE}
                      />
                    </div>
                  ))}
                  {writtenGenerated && (
                    <>
                      <div style={CASE_SECTION_LABEL}>Generated narrative draft</div>
                      <textarea value={writtenGenerated} readOnly rows={10} style={CASE_BUBBLE} />
                    </>
                  )}
                  {writtenSavedJson && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--surface-2)' }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                        Saved JSON payload {writtenSavedAt ? `• ${new Date(writtenSavedAt).toLocaleString('en-AU')}` : ''}
                      </div>
                      <pre style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{writtenSavedJson}</pre>
                    </div>
                  )}
                </div>
              </div>
            )}
            {caseStudiesSection === 'video_script' && (
              <div>
                <div style={workflowCardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Video Script Case Study Workflow</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Derived from written case after approval</div>
                    </div>
                    <span style={{ ...statusBadgeStyle(videoCaseStatus), borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                      {videoCaseStatus}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setVideoCaseStatus('draft')}>Set Draft</button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        setVideoCaseStatus('approved')
                        setVideoCaseReviewer('Current User')
                        setVideoCaseReviewedAt(nowStamp())
                      }}
                    >
                      Approve
                    </button>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={videoCaseStatus !== 'approved'} onClick={() => setVideoCaseStatus('published')}>
                      Publish
                    </button>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 2 }}>
                    <div>Reviewer: {videoCaseReviewer || '-'}</div>
                    <div>Reviewed at: {videoCaseReviewedAt ? new Date(videoCaseReviewedAt).toLocaleString('en-AU') : '-'}</div>
                  </div>
                </div>
                <div style={{ ...workflowCardStyle, display: 'grid', gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Video Script Case Study</div>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                    Build YouTube-ready narrative from written case facts, then generate and save JSON.
                  </p>
                  {caseStudyError && (
                    <div style={{ border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.15)', color: '#fecaca', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
                      {caseStudyError}
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                    <select value={videoCapture.target_platform} onChange={e => updateVideo('target_platform', e.target.value as VideoScriptCapture['target_platform'])} style={{ ...CASE_BUBBLE, minHeight: 44, padding: '10px 12px' }}>
                      <option value="youtube_long">YouTube long</option>
                      <option value="youtube_short">YouTube short</option>
                      <option value="training_portal_video">Training portal video</option>
                    </select>
                    <input type="number" value={videoCapture.duration_target_sec} onChange={e => updateVideo('duration_target_sec', Number(e.target.value) || 0)} placeholder="Duration target seconds" style={{ ...CASE_BUBBLE, minHeight: 44, padding: '10px 12px' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={generateVideoFromWritten}>Generate from Written Case</button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        const payload = JSON.stringify({ schema_version: '1.0', ...videoCapture }, null, 2)
                        setVideoSavedJson(payload)
                        setVideoSavedAt(nowStamp())
                      }}
                    >
                      Save JSON Payload
                    </button>
                  </div>
                  {VIDEO_FIELDS.map(({ key, label, placeholder, rows }, idx) => (
                    <div key={key}>
                      <div style={idx === 0 ? { ...CASE_SECTION_LABEL, marginTop: 4 } : CASE_SECTION_LABEL}>{label}</div>
                      <textarea
                        value={videoCapture[key]}
                        onChange={e => updateVideo(key, e.target.value)}
                        placeholder={placeholder}
                        rows={rows ?? 3}
                        style={CASE_BUBBLE}
                      />
                    </div>
                  ))}
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 12, width: 'fit-content' }}
                    onClick={generateVideoNarrative}
                    disabled={videoGenerating}
                  >
                    {videoGenerating ? 'Generating…' : 'Generate Video Narrative'}
                  </button>
                  {videoGenerated && (
                    <>
                      <div style={CASE_SECTION_LABEL}>Generated video narrative</div>
                      <textarea value={videoGenerated} readOnly rows={10} style={CASE_BUBBLE} />
                    </>
                  )}
                  {videoSavedJson && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--surface-2)' }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                        Saved JSON payload {videoSavedAt ? `• ${new Date(videoSavedAt).toLocaleString('en-AU')}` : ''}
                      </div>
                      <pre style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{videoSavedJson}</pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        {showScope && (
          <ScopeOfWorkTab job={job} documents={documents} onJobUpdate={setJob} />
        )}
        {showQuote && (
          <QuoteCaptureTab
            job={job}
            documents={documents}
            onJobUpdate={setJob}
            onGoToScope={() => {
              if (onHome) setHomeSection('scope_of_work')
              else requestTabChange('scope_capture')
            }}
          />
        )}
        {showPRC && (
          <PreRemediationChecklistTab job={job} onJobUpdate={setJob} />
        )}
        {showProgressPhotos && (
          <ProgressPhotosTab
            job={job}
            photos={photos}
            onPhotosUpdate={setPhotos}
          />
        )}
        {showProgressNotes && <ProgressNotesTab job={job} />}
        {showQualityChecks && (
          <PerExecuteCapturePanel job={job} onJobUpdate={setJob} emphasis="quality_checks" />
        )}
        {showRecommendations && (
          <PerExecuteCapturePanel job={job} onJobUpdate={setJob} emphasis="recommendations" />
        )}
        {showCompletionRpt && (
          <CompletionReportTab job={job} photos={photos} onJobUpdate={setJob} />
        )}
        {showClientFeedback && (
          <div style={emptyRoomStyle}>Client feedback (empty room)</div>
        )}
        {showTeamFeedback && (
          <div style={emptyRoomStyle}>Team member feedback (empty room)</div>
        )}
        {showEngagementAgr && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.engagement_agreement} (empty room)</div>
        )}
        {showNda && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.nda} (empty room)</div>
        )}
        {showAuthority && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.authority_to_proceed} (empty room)</div>
        )}
        {showSwms && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.swms} (empty room)</div>
        )}
        {showJsa && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.jsa} (empty room)</div>
        )}
        {showRiskAssessment && (
          <div style={emptyRoomStyle}>{DOC_TYPE_LABELS.risk_assessment} (empty room)</div>
        )}
        {showWasteManifest && (
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
        {activeTab === 'prestart_briefing' && (
          <PreStartBriefingTab job={job} />
        )}
        {activeTab === 'docs' && (
          <>
            <SubTabStrip
              sections={DOCS_SECTIONS}
              active={docsSection}
              onChange={setDocsSection}
              ariaLabel="Docs sections"
            />
            {docsSection === 'compose' && (
              <DocumentsTab
                jobId={job.id}
                documents={documents}
                clientName={job.client_name}
                clientEmail={job.client_email ?? ''}
                onDocumentDeleted={docId => setDocuments(prev => prev.filter(d => d.id !== docId))}
                onNavigate={tab => requestTabChange(tab)}
                mode="compose"
              />
            )}
            {docsSection === 'history' && (
              <DocumentsTab
                jobId={job.id}
                documents={documents}
                documentBundles={documentBundles}
                onBundlesRefresh={refreshDocumentBundles}
                canComposeBundles={caps.edit_documents}
                clientName={job.client_name}
                clientEmail={job.client_email ?? ''}
                onDocumentDeleted={docId => setDocuments(prev => prev.filter(d => d.id !== docId))}
                mode="history"
              />
            )}
          </>
        )}
        {activeTab === 'messages' && (
          <MessagesTab job={job} inboundEmailAddress={job.inbound_email_address ?? null} />
        )}
        {activeTab === 'invoice' && (
          <InvoiceTab jobId={id} />
        )}
        {activeTab === 'company_letter' && (
          <CompanyLetterTab job={job} />
        )}
      </div>
    </div>
        )}
      </UnsavedNavigationGuard>
    </UnsavedChangesProvider>
  )
}

