/*
 * Job → Dashboard.
 *
 * One glance at the job's paperwork: which documents have been saved (with a
 * link to open the latest copy and one to edit it) and which are still to do
 * (with a link to where each is made). "Done" means a saved document exists.
 */
'use client'

import { useMemo, type CSSProperties } from 'react'
import Link from 'next/link'
import type { DocType, Document, Job } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import { companyLetterheadHasContent, normalizeCompanyLetterheadCapture } from '@/lib/companyLetterhead'

/** Where a document is made. `home` sections match the job page's Home strip. */
export type DocDashboardTarget =
  | { kind: 'home'; section: string; sub?: string }
  | { kind: 'tab'; tab: string }
  | { kind: 'compose'; type: DocType }

interface Row {
  type: DocType
  target: DocDashboardTarget
  /** Left out of "To do" — made only when needed. Still listed under Done once saved. */
  optional?: boolean
  /** Counts as a quote: once any quote is saved, the other quote types drop off "To do". */
  quote?: boolean
}

const ROWS: Row[] = [
  { type: 'house_survey', target: { kind: 'home', section: 'survey' } },
  { type: 'assessment_document', target: { kind: 'home', section: 'onsite_assessment', sub: 'document' } },
  { type: 'sow', target: { kind: 'home', section: 'scope_of_work' } },
  { type: 'biohazard_cleaning_quote', target: { kind: 'home', section: 'biohazard_cleaning' }, quote: true },
  { type: 'contents_clearance_quote', target: { kind: 'home', section: 'contents_clearance' }, quote: true },
  { type: 'surface_area_cleaning_quote', target: { kind: 'home', section: 'surface_area_cleaning' }, quote: true },
  { type: 'quote', target: { kind: 'home', section: 'quote' }, quote: true },
  { type: 'iaq_multi', target: { kind: 'compose', type: 'iaq_multi' }, quote: true, optional: true },
  { type: 'engagement_agreement', target: { kind: 'home', section: 'legal', sub: 'engagement_agreement' } },
  { type: 'nda', target: { kind: 'home', section: 'legal', sub: 'nda' }, optional: true },
  { type: 'authority_to_proceed', target: { kind: 'home', section: 'safety_compliance', sub: 'authority_to_proceed' } },
  { type: 'swms', target: { kind: 'home', section: 'safety_compliance', sub: 'swms' } },
  { type: 'jsa', target: { kind: 'home', section: 'safety_compliance', sub: 'jsa' } },
  { type: 'risk_assessment', target: { kind: 'home', section: 'safety_compliance', sub: 'risk_assessment' } },
  { type: 'waste_disposal_manifest', target: { kind: 'home', section: 'execute' } },
  { type: 'report', target: { kind: 'home', section: 'verify' } },
  { type: 'certificate_of_decontamination', target: { kind: 'compose', type: 'certificate_of_decontamination' } },
  { type: 'company_letterhead', target: { kind: 'home', section: 'company_letterhead' }, optional: true },
  { type: 'company_letter', target: { kind: 'tab', tab: 'company_letter' }, optional: true },
  { type: 'statement_of_accounts', target: { kind: 'home', section: 'statement' } },
  { type: 'payment_reminder', target: { kind: 'home', section: 'payment_overdue' }, optional: true },
]

/** True when work has been saved on the job but no document generated yet. */
function draftStarted(type: DocType, job: Job): boolean {
  const ad = job.assessment_data
  if (type === 'report') return (ad?.post_remediation_evaluations ?? []).length > 0
  if (type === 'company_letterhead') {
    return companyLetterheadHasContent(normalizeCompanyLetterheadCapture(ad?.company_letterhead))
  }
  return false
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const sectionHeading: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  margin: '22px 0 10px',
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 14px',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--surface)',
  marginBottom: 8,
}

const smallBtn: CSSProperties = { fontSize: 13, padding: '6px 12px', fontWeight: 600 }

interface Props {
  job: Job
  documents: Document[]
  onGo: (target: DocDashboardTarget) => void
}

export default function JobDocsDashboardTab({ job, documents, onGo }: Props) {
  const byType = useMemo(() => {
    const map = new Map<DocType, Document[]>()
    for (const doc of documents) {
      const list = map.get(doc.type) ?? []
      list.push(doc)
      map.set(doc.type, list)
    }
    for (const list of map.values()) list.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    return map
  }, [documents])

  const done = ROWS.filter(r => byType.has(r.type))
  const anyQuoteDone = done.some(r => r.quote)
  const todo = ROWS.filter(r => !byType.has(r.type) && !r.optional && !(r.quote && anyQuoteDone))

  return (
    <div style={{ maxWidth: 760, paddingBottom: 48 }}>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '12px 0 0', lineHeight: 1.5 }}>
        {done.length} saved · {todo.length} to do. A document counts as done once it has been generated and saved.
      </p>

      <div style={sectionHeading}>To do</div>
      {todo.length === 0 ? (
        <div style={{ ...rowStyle, color: 'var(--text-muted)', fontSize: 14 }}>Nothing left on the list.</div>
      ) : (
        todo.map(r => {
          const started = draftStarted(r.type, job)
          return (
            <div key={r.type} style={rowStyle}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, flexShrink: 0, border: '2px solid var(--text-muted)' }} />
                <span style={{ fontSize: 15, fontWeight: 600 }}>{DOC_TYPE_LABELS[r.type]}</span>
                {started && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#FBBF24' }}>Draft started</span>
                )}
              </span>
              <button type="button" className="btn btn-primary" style={smallBtn} onClick={() => onGo(r.target)}>
                {started ? 'Continue' : 'Start'}
              </button>
            </div>
          )
        })
      )}

      <div style={sectionHeading}>Done</div>
      {done.length === 0 ? (
        <div style={{ ...rowStyle, color: 'var(--text-muted)', fontSize: 14 }}>No documents saved yet.</div>
      ) : (
        done.map(r => {
          const docs = byType.get(r.type) ?? []
          const latest = docs[0]
          return (
            <div key={r.type} style={rowStyle}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, flexShrink: 0, background: '#4ADE80' }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{DOC_TYPE_LABELS[r.type]}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Saved {fmtDate(latest.created_at)}
                    {docs.length > 1 ? ` · ${docs.length} versions` : ''}
                  </span>
                </span>
              </span>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button type="button" className="btn btn-secondary" style={smallBtn} onClick={() => onGo(r.target)}>
                  Edit
                </button>
                <Link href={`/jobs/${job.id}/docs/${latest.type}?docId=${latest.id}`}>
                  <button type="button" className="btn btn-primary" style={smallBtn}>Open</button>
                </Link>
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}
