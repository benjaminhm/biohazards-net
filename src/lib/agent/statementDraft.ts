/*
 * lib/agent/statementDraft.ts
 *
 * What the agents read and draft for the Statement of Accounts. The statement
 * works itself out from the records (statementV2Figures); staff inputs are only
 * the deposit and its date, an optional adjustment with its reason, and the
 * invoice number and link. Agents draft those inputs when staff ask, and flag
 * what stops the statement being issued.
 */
import type { AssessmentData } from '@/lib/types'
import { formatAud } from '@/lib/disposalManifest'
import { normalizeStatementCapture, STATEMENT_MODEL_VERSION, statementV2Figures } from '@/lib/statementOfAccounts'
import { bcqRecordSummary, cdrSummary, surveySummary } from './recordSummaries'
import { buildPatchDraft, type PatchDraft } from './patchDraft'

/** Counted cubic metres on the CDR: the quantity on its summary. */
export function cdrVolumeM3(ad: AssessmentData | null | undefined): number | null {
  const m3 = cdrSummary(ad).quantity
  return m3 != null && m3 > 0 ? Math.round(m3 * 100) / 100 : null
}

const NUMBER_INPUTS = ['deposit_amount', 'manual_adjustment'] as const
const TEXT_INPUTS = ['deposit_date', 'manual_adjustment_reason', 'invoice_number', 'invoice_url'] as const
export const STATEMENT_INPUTS = [...NUMBER_INPUTS, ...TEXT_INPUTS] as const
export type StatementInputs = Partial<Record<(typeof NUMBER_INPUTS)[number], number | null> & Record<(typeof TEXT_INPUTS)[number], string>>

/**
 * Checks a patch on statement_of_accounts: the staff inputs only (plus
 * model_version 2 and deposit_taken, which the draft tool keeps in step).
 * Null when it is fine.
 */
export function statementPatchProblem(patch: unknown): string | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'patch must be an object of statement fields.'
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'model_version') {
      if (value !== STATEMENT_MODEL_VERSION) return `model_version must be ${STATEMENT_MODEL_VERSION}.`
    } else if (key === 'deposit_taken') {
      if (typeof value !== 'boolean') return 'deposit_taken must be true or false.'
    } else if ((NUMBER_INPUTS as readonly string[]).includes(key)) {
      if (value === null) continue
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${key} must be a plain number (e.g. 1650 not "$1,650"), or null.`
      if (value < 0 && key !== 'manual_adjustment') return `${key} cannot be negative.`
    } else if ((TEXT_INPUTS as readonly string[]).includes(key)) {
      if (typeof value !== 'string') return `${key} must be text.`
      if (key === 'deposit_date' && value.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return 'deposit_date must be YYYY-MM-DD.'
    } else {
      return `The statement has no input "${key}". Staff enter only ${STATEMENT_INPUTS.join(', ')}; everything else comes from the records.`
    }
  }
  return null
}

/** A draft of the inputs given, kept as model 2. Null when nothing changes. */
export function statementInputsDraft(ad: AssessmentData | null | undefined, inputs: StatementInputs): PatchDraft | null {
  const raw = ((ad as Record<string, unknown> | null | undefined)?.statement_of_accounts ?? null) as Record<string, unknown> | null
  const patch: Record<string, unknown> = Object.fromEntries(STATEMENT_INPUTS.filter(k => inputs[k] !== undefined).map(k => [k, inputs[k]]))
  if (Object.keys(patch).length === 0) return null
  if (raw?.model_version !== STATEMENT_MODEL_VERSION) {
    const migrated = normalizeStatementCapture(raw)
    patch.model_version = STATEMENT_MODEL_VERSION
    for (const k of STATEMENT_INPUTS) {
      if (patch[k] === undefined && migrated[k] != null && migrated[k] !== '' && raw?.[k] !== migrated[k]) patch[k] = migrated[k]
    }
  }
  const deposit = patch.deposit_amount !== undefined ? patch.deposit_amount : normalizeStatementCapture(raw).deposit_amount
  patch.deposit_taken = typeof deposit === 'number' && deposit > 0
  const draft = buildPatchDraft(raw, patch)
  return Object.keys(draft.proposed).length ? draft : null
}

/** What stops the statement being issued, and a deposit that is not about half the quotes. */
export function statementFlags(ad: AssessmentData | null | undefined): string[] {
  const f = statementV2Figures(ad)
  const flags = [...f.problems]
  if (f.deposit > 0.004 && f.suggested_deposit != null && Math.abs(f.deposit - f.suggested_deposit) > f.suggested_deposit * 0.05) {
    flags.push(`The deposit ${formatAud(f.deposit)} is not about half the quotes (${formatAud(f.suggested_deposit)}).`)
  }
  return flags
}

function statementView(ad: AssessmentData | null | undefined) {
  if (ad?.statement_of_accounts == null) return { started: false }
  const f = statementV2Figures(ad)
  return {
    started: true,
    charges_gst: f.charges_gst,
    lines_ex_gst: f.lines,
    total_ex_gst: f.total_ex,
    gst: f.gst,
    total_inc_gst: f.total_inc,
    deposit_amount: f.deposit,
    deposit_date: f.deposit_date,
    adjustment: f.adjustment,
    adjustment_reason: f.adjustment_reason,
    balance: f.balance,
    invoice_number: f.invoice_number,
    invoice_url: f.invoice_url,
  }
}

const NOTE = 'The statement calculates itself: surface cleaning (survey_summary), contents removal (cdr_summary) and biohazard cleaning (bcq_record_summary, or the quote total when the BCQ is fixed price), GST once, less the deposit, plus an optional adjustment with a reason. Quotes are estimates and never part of the sum. Staff inputs are only deposit_amount, deposit_date, manual_adjustment + manual_adjustment_reason, invoice_number and invoice_url; amounts are inc GST when charges_gst.'

/** What the Statement agent reads: the three record summaries, the statement as it stands, and its flags. */
export function statementAgentFigures(ad: AssessmentData | null | undefined) {
  const f = statementV2Figures(ad)
  return {
    survey_summary: surveySummary(ad),
    cdr_summary: cdrSummary(ad),
    bcq_record_summary: bcqRecordSummary(ad),
    statement: statementView(ad),
    estimates: f.estimates,
    suggested_deposit: f.suggested_deposit,
    flags: statementFlags(ad),
    note: NOTE,
  }
}

/** What the file agent reads for the survey, CDR, biohazard record and statement: summaries only. */
export function surveyAndDisposalSummary(ad: AssessmentData | null | undefined) {
  return {
    survey_summary: surveySummary(ad),
    cdr_summary: cdrSummary(ad),
    bcq_record_summary: bcqRecordSummary(ad),
    statement: statementView(ad),
    flags: ad?.statement_of_accounts == null ? [] : statementFlags(ad),
    note: NOTE,
  }
}
