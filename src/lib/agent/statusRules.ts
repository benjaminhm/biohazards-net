/*
 * lib/agent/statusRules.ts
 *
 * What a job should have on file at each status. Edit STATUS_EXPECTATIONS to
 * change the rules; a status also expects everything listed for the statuses
 * before it. Used by job health and by the file agent's status drafts.
 */
import type { JobStatus } from '@/lib/types'

export const STATUS_ORDER: JobStatus[] = ['lead', 'assessed', 'quoted', 'accepted', 'scheduled', 'underway', 'completed', 'report_sent', 'paid']

const QUOTE_TYPES = ['biohazard_cleaning_quote', 'contents_clearance_quote', 'surface_area_cleaning_quote', 'quote']

export interface StatusExpectation {
  /** At least one saved document of any of these types. */
  documentTypes?: string[]
  /** A quote acceptance recorded on the job. */
  acceptance?: boolean
  label: string
}

export const STATUS_EXPECTATIONS: Partial<Record<JobStatus, StatusExpectation[]>> = {
  quoted: [{ documentTypes: QUOTE_TYPES, label: 'a saved quote' }],
  accepted: [{ acceptance: true, label: 'a quote acceptance' }],
  completed: [{ documentTypes: ['report'], label: 'a completion report' }],
  report_sent: [{ documentTypes: ['statement_of_accounts'], label: 'a Statement of Accounts' }],
}

export interface StatusFacts {
  documentTypes: Set<string>
  acceptances: number
  xeroInvoice: boolean
}

export interface StatusCheck {
  /** Expected for this status but not on file. Staff are warned; the change is allowed. */
  missing: string[]
  /** Set when the change makes no sense at all; the agent will not draft it. */
  blocked: string | null
}

function expectationsUpTo(status: JobStatus): StatusExpectation[] {
  const idx = STATUS_ORDER.indexOf(status)
  if (idx < 0) return []
  return STATUS_ORDER.slice(0, idx + 1).flatMap(s => STATUS_EXPECTATIONS[s] ?? [])
}

function met(e: StatusExpectation, f: StatusFacts): boolean {
  if (e.acceptance && f.acceptances === 0) return false
  if (e.documentTypes && !e.documentTypes.some(t => f.documentTypes.has(t))) return false
  return true
}

export function checkStatus(status: JobStatus, facts: StatusFacts): StatusCheck {
  const missing = expectationsUpTo(status).filter(e => !met(e, facts)).map(e => e.label)
  const blocked = status === 'paid' && !facts.documentTypes.has('statement_of_accounts') && !facts.xeroInvoice
    ? 'A job cannot be marked paid with no Statement of Accounts and no Xero invoice.'
    : null
  return { missing, blocked }
}

export function nextStatus(status: string): JobStatus | null {
  const idx = STATUS_ORDER.indexOf(status as JobStatus)
  return idx >= 0 && idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : null
}
