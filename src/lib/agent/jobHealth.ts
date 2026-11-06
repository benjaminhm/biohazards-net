/*
 * lib/agent/jobHealth.ts
 *
 * What on a job is missing, out of date or needs action, worked out from what
 * is saved (pure, no database). The file agent reads this to know what to
 * raise with staff and which document sub-agent to hand work to.
 */
import type { AssessmentData } from '@/lib/types'
import { buildStatementDraft, cdrVolumeM3 } from './statementDraft'
import { DOC_AGENTS } from './subagents/registry'
import type { DocAgentType } from './subagents/types'

export type HealthSeverity = 'info' | 'warning' | 'urgent'

export interface HealthIssue {
  code: string
  severity: HealthSeverity
  message: string
  /** Sub-agent that can fix it, when a document is involved. */
  doc_agent?: DocAgentType
}

export interface HealthDocument {
  id: string
  type: string
  content: unknown
  created_at: string
}

export interface HealthAcceptance {
  document_id: string | null
  quote_total: number | null
  accepted_at: string
}

export interface HealthInput {
  status: string
  assessment: AssessmentData | null
  documents: HealthDocument[]
  acceptances: HealthAcceptance[]
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > 0.009
}

/** Captures started but never generated into a saved document. */
function capturedNotGenerated(ad: Record<string, unknown>, docs: HealthDocument[]): HealthIssue[] {
  const out: HealthIssue[] = []
  for (const def of Object.values(DOC_AGENTS)) {
    if (ad[def.captureKey] == null) continue
    if (docs.some(d => d.type === def.documentType)) continue
    out.push({
      code: `not_generated:${def.type}`,
      severity: 'info',
      message: `${def.docLabel} is captured but no document has been generated yet.`,
      doc_agent: def.type,
    })
  }
  return out
}

function statementChecks(ad: AssessmentData | null): HealthIssue[] {
  const raw = (ad as Record<string, unknown> | null)?.statement_of_accounts
  if (raw == null) return []
  const r = buildStatementDraft(ad)
  if (!r.ok || !Object.keys(r.proposed ?? {}).length) return []
  return [{
    code: 'statement_quantities_stale',
    severity: 'warning',
    message: `Statement of Accounts quantities differ from the House Survey / CDR (${r.summary}).`,
    doc_agent: 'statement_of_accounts',
  }]
}

function cdrVsClearanceQuote(ad: AssessmentData | null): HealthIssue[] {
  const est = num(((ad as Record<string, unknown> | null)?.contents_clearance_quote as { estimated_m3?: unknown } | undefined)?.estimated_m3)
  const actual = cdrVolumeM3(ad)
  if (est == null || est <= 0 || actual == null || !differs(est, actual)) return []
  return [{
    code: 'cdr_vs_ccq_m3',
    severity: 'info',
    message: `CDR volume is ${actual} m³ but the Contents Clearance Quote estimated ${est} m³.`,
    doc_agent: 'contents_clearance_quote',
  }]
}

/** A saved quote whose total no longer matches what the client accepted. */
function editedAfterAcceptance(docs: HealthDocument[], acceptances: HealthAcceptance[]): HealthIssue[] {
  const out: HealthIssue[] = []
  for (const a of acceptances) {
    if (!a.document_id || a.quote_total == null) continue
    const doc = docs.find(d => d.id === a.document_id)
    if (!doc) continue
    const c = (doc.content ?? {}) as Record<string, unknown>
    const total = num(c.total)
    if (total == null || !differs(total, a.quote_total)) continue
    const ref = typeof c.reference === 'string' && c.reference ? ` ${c.reference}` : ''
    const def = Object.values(DOC_AGENTS).find(d => d.documentType === doc.type)
    out.push({
      code: `quote_edited_after_acceptance:${doc.id}`,
      severity: 'warning',
      message: `Quote${ref} was accepted at $${a.quote_total.toFixed(2)} but now totals $${total.toFixed(2)}.`,
      ...(def ? { doc_agent: def.type } : {}),
    })
  }
  return out
}

export function jobHealth(input: HealthInput): HealthIssue[] {
  const ad = (input.assessment ?? {}) as Record<string, unknown>
  return [
    ...editedAfterAcceptance(input.documents, input.acceptances),
    ...statementChecks(input.assessment),
    ...cdrVsClearanceQuote(input.assessment),
    ...capturedNotGenerated(ad, input.documents),
  ]
}
