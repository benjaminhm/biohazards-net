/*
 * components/tabs/DocumentsTab.tsx
 *
 * Docs tab: saved documents plus per-phase generate actions. Workflow sections
 * follow the 10-phase taxonomy in DOC_TYPE_GROUPS (see lib/types.ts).
 *
 * Two consolidated "Generate Documents" accordions bracket the post-quote
 * boundary:
 *   • CLIENT_FACING accordion (initial_contact → onsite_assessment → scope_of_work
 *     → quote → legal): renders just above the safety_compliance section so it
 *     visually separates pre-mobilisation client deliverables from operational
 *     docs.
 *   • OPERATIONAL accordion (safety_compliance → plan → execute → verify →
 *     review): renders at the review section as the final doc roll-up.
 *
 * This component used to render Job Home too; that surface now lives in
 * app/jobs/[id]/page.tsx as an empty-room sub-tab strip (pending content
 * migration).
 */
'use client'

import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { Document, DocumentBundle, DocType, DocWorkflowPhaseId } from '@/lib/types'
import DocumentBundlesSection from '@/components/DocumentBundlesSection'
import { DOC_TYPE_LABELS, DOC_TYPE_GROUPS } from '@/lib/types'

type NavigateTab =
  | 'details'
  | 'photos'
  | 'messages'
  | 'assessment'
  | 'scope_capture'
  | 'quote_capture'
  | 'pre_remediation_checklist_capture'
  | 'progress_capture'
  | 'progress_notes_capture'
  | 'quality_checks_capture'
  | 'recommendations_capture'
  | 'progress_report_generate'
  | 'client_feedback_capture'
  | 'team_feedback_capture'
  | 'engagement_agreement_capture'
  | 'nda_capture'
  | 'authority_to_proceed_capture'
  | 'swms_capture'
  | 'jsa_capture'
  | 'risk_assessment_capture'
  | 'waste_disposal_manifest_capture'
  | 'iaq_multi_capture'

/** Pre-mobilisation phases whose generate actions live in the client-facing accordion. */
const CLIENT_FACING_PHASE_IDS: DocWorkflowPhaseId[] = [
  'initial_contact',
  'onsite_assessment',
  'scope_of_work',
  'quote',
  'legal',
]

/** Strip leading "1. " style index from workflow labels inside generate bubbles only. */
function workflowPhaseTitleNoNumber(label: string): string {
  return label.replace(/^\d+\.\s*/, '').trim()
}

/** Post-quote operational phases whose generate actions live in the second accordion. */
const OPERATIONAL_PHASE_IDS: DocWorkflowPhaseId[] = [
  'safety_compliance',
  'plan',
  'execute',
  'verify',
  'review',
]

/** Shared shell so both "Generate documents" accordions read as primary actions. */
const GENERATE_ACCORDION_SHELL: CSSProperties = {
  borderRadius: 12,
  border: '2px solid var(--accent)',
  background: 'linear-gradient(165deg, var(--accent-dim) 0%, var(--surface) 52%, var(--surface-2) 100%)',
  boxShadow: '0 10px 40px rgba(0,0,0,0.5), 0 0 28px var(--accent-glow)',
  overflow: 'hidden',
}

const GENERATE_ACCORDION_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  textAlign: 'left',
  padding: '12px 14px',
  border: 'none',
  background: 'rgba(0,0,0,0.28)',
  color: 'var(--accent)',
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
}

/** Safety & Compliance doc rows: Data Capture uses empty-room tabs; Generate still opens /docs/[type]. */
const SAFETY_COMPLIANCE_DOC_CAPTURE_TAB: Record<
  'authority_to_proceed' | 'swms' | 'jsa' | 'risk_assessment',
  NavigateTab
> = {
  authority_to_proceed: 'authority_to_proceed_capture',
  swms: 'swms_capture',
  jsa: 'jsa_capture',
  risk_assessment: 'risk_assessment_capture',
}

interface Props {
  jobId: string
  documents: Document[]
  documentBundles?: DocumentBundle[]
  onBundlesRefresh?: () => void | Promise<void>
  canComposeBundles?: boolean
  clientName: string
  clientEmail: string
  onDocumentDeleted: (id: string) => void
  onNavigate?: (tab: NavigateTab) => void
  showCreateSection?: boolean
  showSavedSection?: boolean
}

function DocRow({ doc, jobId, clientName, clientEmail, onDeleted }: {
  doc: Document; jobId: string; clientName: string; clientEmail: string; onDeleted: (id: string) => void
}) {
  const router = useRouter()
  const [copied,        setCopied]        = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const printUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/print/${doc.id}`
  const label    = DOC_TYPE_LABELS[doc.type as DocType] ?? doc.type

  function copyLink() {
    navigator.clipboard.writeText(printUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
      onDeleted(doc.id)
    } finally { setDeleting(false); setConfirmDelete(false) }
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {new Date(doc.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            onClick={() => router.push(`/jobs/${jobId}/docs/${doc.type}?docId=${doc.id}`)}
            className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 12px' }}
          >✏️ Edit</button>
          <button onClick={copyLink} className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 12px' }}>
            {copied ? '✓ Copied' : '🔗 Link'}
          </button>
          <a href={`mailto:${clientEmail}?subject=${encodeURIComponent(`${label} — ${clientName}`)}&body=${encodeURIComponent(`Hi ${clientName.split(' ')[0]},\n\nPlease find your ${label.toLowerCase()} at the link below:\n\n${printUrl}\n\nKind regards`)}`}>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 12px' }}>✉️ Email</button>
          </a>
          <a href={printUrl} target="_blank" rel="noopener noreferrer">
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 12px' }}>↗ Open</button>
          </a>
          {confirmDelete ? (
            <>
              <button onClick={handleDelete} disabled={deleting}
                style={{ fontSize: 12, padding: '7px 12px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                {deleting ? '…' : 'Delete'}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                style={{ fontSize: 12, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                Keep
              </button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              style={{ fontSize: 16, padding: '4px 8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              🗑
            </button>
          )}
        </div>
      </div>
      <div onClick={copyLink} title="Click to copy"
        style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', wordBreak: 'break-all', cursor: 'pointer', userSelect: 'all' }}>
        {printUrl}
      </div>
    </div>
  )
}

function DataCaptureForPhase({
  phaseId,
  onNavigate,
}: {
  phaseId: DocWorkflowPhaseId
  onNavigate?: (tab: NavigateTab) => void
}) {
  const n = onNavigate
  switch (phaseId) {
    case 'initial_contact':
      return (
        <button
          type="button"
          onClick={() => n?.('details')}
          style={{
            padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'rgba(148,163,184,0.2)', border: '1px solid rgba(148,163,184,0.5)',
            color: '#E2E8F0', cursor: 'pointer',
          }}
        >
          Job details
        </button>
      )
    case 'onsite_assessment':
      return (
        <button
          type="button"
          onClick={() => n?.('assessment')}
          style={{
            padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'rgba(59,130,246,0.18)', border: '1px solid rgba(96,165,250,0.55)',
            color: '#BFDBFE', cursor: 'pointer',
          }}
        >
          Assessment
        </button>
      )
    case 'scope_of_work':
      return (
        <button
          type="button"
          onClick={() => n?.('scope_capture')}
          style={{
            padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(52,211,153,0.55)',
            color: '#A7F3D0', cursor: 'pointer',
          }}
        >
          Scope of Work
        </button>
      )
    case 'quote':
      return (
        <button
          type="button"
          onClick={() => n?.('quote_capture')}
          style={{
            padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(251,191,36,0.55)',
            color: '#FDE68A', cursor: 'pointer',
          }}
        >
          Quote
        </button>
      )
    case 'legal':
      return (
        <>
          <button
            type="button"
            onClick={() => n?.('engagement_agreement_capture')}
            style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(20,184,166,0.18)', border: '1px solid rgba(45,212,191,0.5)',
              color: '#99F6E4', cursor: 'pointer',
            }}
          >
            Engagement Agreement
          </button>
          <button
            type="button"
            onClick={() => n?.('nda_capture')}
            style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(129,140,248,0.55)',
              color: '#C7D2FE', cursor: 'pointer',
            }}
          >
            Non-Disclosure Agreement
          </button>
        </>
      )
    case 'safety_compliance': {
      const safetyDocTypes = DOC_TYPE_GROUPS.find(g => g.id === 'safety_compliance')?.types ?? []
      const safetyDocCaptureStyles: CSSProperties[] = [
        { background: 'rgba(20,184,166,0.18)', border: '1px solid rgba(45,212,191,0.5)', color: '#99F6E4' },
        { background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(129,140,248,0.55)', color: '#C7D2FE' },
        { background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(251,113,133,0.5)', color: '#FECDD3' },
        { background: 'rgba(14,165,233,0.18)', border: '1px solid rgba(56,189,248,0.55)', color: '#BAE6FD' },
      ]
      return (
        <>
          {safetyDocTypes.map((type, i) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                const tab = SAFETY_COMPLIANCE_DOC_CAPTURE_TAB[type as keyof typeof SAFETY_COMPLIANCE_DOC_CAPTURE_TAB]
                if (tab) n?.(tab)
              }}
              style={{
                padding: '9px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                ...safetyDocCaptureStyles[i % safetyDocCaptureStyles.length],
              }}
            >
              {DOC_TYPE_LABELS[type]}
            </button>
          ))}
        </>
      )
    }
    case 'plan':
      return (
        <button
          type="button"
          onClick={() => n?.('pre_remediation_checklist_capture')}
          style={{
            padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'rgba(168,85,247,0.18)', border: '1px solid rgba(192,132,252,0.55)',
            color: '#E9D5FF', cursor: 'pointer',
          }}
        >
          Pre-Remediation Checklist
        </button>
      )
    case 'execute':
      return (
        <>
          <button
            type="button"
            onClick={() => n?.('progress_capture')}
            style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(167,139,250,0.55)',
              color: '#DDD6FE', cursor: 'pointer',
            }}
          >
            Progress Photos
          </button>
          <button
            type="button"
            onClick={() => n?.('progress_notes_capture')}
            style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(14,165,233,0.18)', border: '1px solid rgba(56,189,248,0.55)',
              color: '#BAE6FD', cursor: 'pointer',
            }}
          >
            Progress Notes
          </button>
          <button
            type="button"
            onClick={() => n?.('quality_checks_capture')}
            style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(74,222,128,0.55)',
              color: '#BBF7D0', cursor: 'pointer',
            }}
          >
            Quality Control Checks
          </button>
          <button
            type="button"
            onClick={() => n?.('recommendations_capture')}
            style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(249,115,22,0.18)', border: '1px solid rgba(251,146,60,0.55)',
              color: '#FED7AA', cursor: 'pointer',
            }}
          >
            Recommendations
          </button>
          <button
            type="button"
            onClick={() => n?.('waste_disposal_manifest_capture')}
            style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(100,116,139,0.22)', border: '1px solid rgba(148,163,184,0.45)',
              color: '#E2E8F0', cursor: 'pointer',
            }}
          >
            {DOC_TYPE_LABELS.waste_disposal_manifest}
          </button>
          <button
            type="button"
            onClick={() => n?.('progress_report_generate')}
            style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(20,184,166,0.18)', border: '1px solid rgba(45,212,191,0.5)',
              color: '#99F6E4', cursor: 'pointer',
            }}
          >
            Completion Report
          </button>
        </>
      )
    case 'verify':
      return null
    case 'review':
      return (
        <>
          <button
            type="button"
            onClick={() => n?.('client_feedback_capture')}
            style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(100,116,139,0.22)', border: '1px solid rgba(148,163,184,0.45)',
              color: '#E2E8F0', cursor: 'pointer',
            }}
          >
            Client feedback
          </button>
          <button
            type="button"
            onClick={() => n?.('team_feedback_capture')}
            style={{
              padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(20,184,166,0.18)', border: '1px solid rgba(45,212,191,0.5)',
              color: '#99F6E4', cursor: 'pointer',
            }}
          >
            Team member feedback
          </button>
        </>
      )
    default:
      return null
  }
}

export default function DocumentsTab({
  jobId,
  documents,
  documentBundles = [],
  onBundlesRefresh,
  canComposeBundles = false,
  clientName,
  clientEmail,
  onDocumentDeleted,
  onNavigate,
  showCreateSection = true,
  showSavedSection = true,
}: Props) {
  const router = useRouter()
  const MAJOR_PHASE_IDS: DocWorkflowPhaseId[] = DOC_TYPE_GROUPS.map(g => g.id)

  /** Consolidated IAQ generate accordion (first PER section render only, Job Home). */
  const [iaqGenerateOpen, setIaqGenerateOpen] = useState(false)

  /** Consolidated PER generate accordion (after Reflect, Job Home). */
  const [perGenerateOpen, setPerGenerateOpen] = useState(false)

  return (
    <div style={{ paddingBottom: 40 }}>
      {showCreateSection && DOC_TYPE_GROUPS.map(group => (
        <div key={group.id} style={{ marginBottom: 28 }}>
          {group.id === 'safety_compliance' && (
            <>
              <div style={{ marginBottom: 16, ...GENERATE_ACCORDION_SHELL }}>
                <button
                  type="button"
                  id="iaq-generate-documents-btn"
                  aria-expanded={iaqGenerateOpen}
                  aria-controls="iaq-generate-documents-panel"
                  onClick={() => setIaqGenerateOpen(v => !v)}
                  style={{
                    ...GENERATE_ACCORDION_HEADER,
                    borderBottom: iaqGenerateOpen ? '1px solid var(--accent-glow)' : 'none',
                  }}
                >
                  <span aria-hidden style={{ fontSize: 11, color: 'var(--accent)' }}>
                    {iaqGenerateOpen ? '▾' : '▸'}
                  </span>
                  Generate Documents
                </button>
                <div
                  id="iaq-generate-documents-panel"
                  role="region"
                  aria-labelledby="iaq-generate-documents-btn"
                  hidden={!iaqGenerateOpen}
                  style={
                    iaqGenerateOpen
                      ? {
                          padding: '12px 12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 16,
                        }
                      : undefined
                  }
                >
                  {DOC_TYPE_GROUPS.filter(
                    g => CLIENT_FACING_PHASE_IDS.includes(g.id) && g.types.length > 0,
                  ).map(ig => (
                    <div key={ig.id}>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: 'var(--text-muted)',
                          marginBottom: 8,
                        }}
                      >
                        {workflowPhaseTitleNoNumber(ig.label)}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {ig.types.map(type => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => router.push(`/jobs/${jobId}/docs/${type}?compose=1`)}
                            style={{
                              padding: '9px 14px',
                              borderRadius: 8,
                              fontSize: 13,
                              fontWeight: 600,
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                              color: 'var(--text)',
                              cursor: 'pointer',
                            }}
                            onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                            onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                          >
                            + {DOC_TYPE_LABELS[type]}
                          </button>
                        ))}
                      </div>
                      {ig.id === 'quote' && (
                        <>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: '0.06em',
                              textTransform: 'uppercase',
                              color: 'var(--text-muted)',
                              marginTop: 12,
                              marginBottom: 8,
                            }}
                          >
                            Multi-Docs
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              gap: 8,
                              rowGap: 10,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => onNavigate?.('iaq_multi_capture')}
                              style={{
                                padding: '9px 14px',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 600,
                                background: 'rgba(20,184,166,0.18)',
                                border: '1px solid rgba(45,212,191,0.5)',
                                color: '#99F6E4',
                                cursor: onNavigate ? 'pointer' : 'default',
                              }}
                            >
                              Assessment/Scope/Quote
                            </button>
                            <span style={{ color: 'var(--border)', userSelect: 'none' }} aria-hidden>|</span>
                            <button
                              type="button"
                              onClick={() => router.push(`/jobs/${jobId}/docs/iaq_multi?compose=1`)}
                              style={{
                                padding: '9px 14px',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 600,
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                color: 'var(--text)',
                                cursor: 'pointer',
                              }}
                              onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                              onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                            >
                              + Assessment/Scope/Quote
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div
                role="separator"
                aria-label="Safety, plan, execute, verify, review phase"
                style={{
                  borderTop: '2px solid #fff',
                  marginTop: 4,
                  marginBottom: 22,
                }}
              />
            </>
          )}
          <div style={{
            fontSize: MAJOR_PHASE_IDS.includes(group.id) ? 13 : 11,
            fontWeight: MAJOR_PHASE_IDS.includes(group.id) ? 800 : 700,
            letterSpacing: MAJOR_PHASE_IDS.includes(group.id) ? '0.1em' : '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 10,
          }}>
            {group.label}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>
            Data Capture
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <DataCaptureForPhase phaseId={group.id} onNavigate={onNavigate} />
          </div>
          {group.id === 'review' && (
            <div style={{ marginTop: 10, ...GENERATE_ACCORDION_SHELL }}>
              <button
                type="button"
                id="per-generate-documents-btn"
                aria-expanded={perGenerateOpen}
                aria-controls="per-generate-documents-panel"
                onClick={() => setPerGenerateOpen(v => !v)}
                style={{
                  ...GENERATE_ACCORDION_HEADER,
                  borderBottom: perGenerateOpen ? '1px solid var(--accent-glow)' : 'none',
                }}
              >
                <span aria-hidden style={{ fontSize: 11, color: 'var(--accent)' }}>
                  {perGenerateOpen ? '▾' : '▸'}
                </span>
                Generate Documents
              </button>
              <div
                id="per-generate-documents-panel"
                role="region"
                aria-labelledby="per-generate-documents-btn"
                hidden={!perGenerateOpen}
                style={
                  perGenerateOpen
                    ? {
                        padding: '12px 12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 16,
                      }
                    : undefined
                }
              >
                {DOC_TYPE_GROUPS.filter(
                  g =>
                    OPERATIONAL_PHASE_IDS.includes(g.id) &&
                    (g.types.length > 0 || g.id === 'execute'),
                ).map(pg => (
                  <div key={pg.id}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                        marginBottom: 8,
                      }}
                    >
                      {pg.label}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {pg.types.map(type => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => router.push(`/jobs/${jobId}/docs/${type}?compose=1`)}
                          style={{
                            padding: '9px 14px',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            color: 'var(--text)',
                            cursor: 'pointer',
                          }}
                          onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                          onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                        >
                          + {DOC_TYPE_LABELS[type]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {showSavedSection && documents.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
            Saved Documents
          </div>
          {documents.map(doc => (
            <DocRow
              key={doc.id}
              doc={doc}
              jobId={jobId}
              clientName={clientName}
              clientEmail={clientEmail}
              onDeleted={onDocumentDeleted}
            />
          ))}
          {(onBundlesRefresh || documentBundles.length > 0 || canComposeBundles) && (
            <DocumentBundlesSection
              jobId={jobId}
              documents={documents}
              bundles={documentBundles}
              clientName={clientName}
              clientEmail={clientEmail}
              canCompose={!!canComposeBundles && !!onBundlesRefresh}
              canDelete={!!canComposeBundles}
              onRefresh={onBundlesRefresh ?? (async () => {})}
            />
          )}
        </div>
      )}

      {showSavedSection && documents.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
          No saved documents yet.
        </div>
      )}
    </div>
  )
}
