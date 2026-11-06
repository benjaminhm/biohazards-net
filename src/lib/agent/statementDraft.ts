/*
 * lib/agent/statementDraft.ts
 *
 * The file agent's Statement of Accounts draft: quantities only. It copies the
 * House Survey's priced rooms (square metres, and each room's price at the
 * survey rate staff set) and the Contents Disposal Record's cubic metres into
 * assessment_data.statement_of_accounts. The result is an ordinary capture
 * patch (paths survey_areas and invoice2_m3), approved like any other. Those
 * are the only quantity fields the statement has: the invoice 2 breakdown
 * (skips, trailers, utes, tip receipts, prepaid) is dollars. CDR facts with no
 * home on the statement are reported back instead. Dollar fields are only
 * drafted when staff ask for them, as a patch from the Statement agent.
 */
import type { AssessmentData } from '@/lib/types'
import {
  computeDisposalTotals,
  disposalWasteCharge,
  loadHasContent,
  mergedDisposalManifestCapture,
  vehicleTypeLabel,
} from '@/lib/disposalManifest'
import { houseSurveyDocument } from '@/lib/houseSurvey'
import { houseSurveyWithQuote } from '@/lib/surveyQuoteLink'
import {
  emptyStatementCapture,
  normalizeStatementCapture,
  surveyAreaQuantities,
  type StatementOfAccountsCapture,
  type StatementSurveyArea,
} from '@/lib/statementOfAccounts'
import { cdrSummary, surveySummary } from './recordSummaries'

export interface StatementQuantities {
  survey_areas?: StatementSurveyArea[] | null
  invoice2_m3?: number | null
}

/** Counted cubic metres on the CDR: the quantity on its summary. */
export function cdrVolumeM3(ad: AssessmentData | null | undefined): number | null {
  const m3 = cdrSummary(ad).quantity
  return m3 != null && m3 > 0 ? Math.round(m3 * 100) / 100 : null
}

function currentStatement(ad: AssessmentData | null | undefined): StatementOfAccountsCapture | null {
  const raw = (ad as Record<string, unknown> | null | undefined)?.statement_of_accounts
  return raw == null ? null : normalizeStatementCapture(raw)
}

/** Current values of the draftable keys. Null when the statement is not started. */
export function statementQuantities(ad: AssessmentData | null | undefined): Required<StatementQuantities> {
  const s = currentStatement(ad)
  return { survey_areas: s?.survey_areas ?? null, invoice2_m3: s?.invoice2_m3 ?? null }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function m3Text(n: number): string {
  return `${n.toFixed(n % 1 === 0 ? 0 : 2)} m³`
}

/** CDR quantities the statement has no field for, as plain lines. */
export function cdrNotOnStatement(ad: AssessmentData | null | undefined): string[] {
  const loads = mergedDisposalManifestCapture(ad).loads.filter(loadHasContent)
  if (!loads.length) return []
  const t = computeDisposalTotals(loads)
  const vehicles = new Map<string, number>()
  for (const load of loads) {
    for (const v of load.vehicles) {
      if (!v.type) continue
      const label = vehicleTypeLabel(v.type)
      vehicles.set(label, (vehicles.get(label) ?? 0) + 1)
    }
  }
  const out = [`${t.load_count} load${t.load_count === 1 ? '' : 's'}`]
  if (vehicles.size) out.push(`vehicles: ${[...vehicles].map(([k, n]) => `${n} × ${k}`).join(', ')}`)
  if (t.weight_recorded) out.push(`weight ${t.weight_kg} kg`)
  if (t.distance_recorded) out.push(`distance ${t.distance_km} km`)
  return out
}

/**
 * CDR dollar figures and the statement line each could fill. Never drafted
 * automatically; the agent offers them and drafts one only when staff say so.
 */
export function cdrDollarFigures(ad: AssessmentData | null | undefined) {
  const capture = mergedDisposalManifestCapture(ad)
  const loads = capture.loads.filter(loadHasContent)
  const t = computeDisposalTotals(loads)
  const charge = disposalWasteCharge(loads, capture.cost_per_m3, capture.prepaid_m3)
  const out: { figure: string; amount: number; statement_field: string }[] = []
  if (t.skip_fees_recorded) out.push({ figure: 'CDR skip hire total', amount: t.skip_fees, statement_field: 'invoice2_skips' })
  if (t.fees_recorded) out.push({ figure: 'CDR tip / dump fees total', amount: t.dump_fees, statement_field: 'invoice2_tip_receipts' })
  if (charge.prepaid_value != null) out.push({ figure: `CDR prepaid ${charge.prepaid_m3} m³ at the CDR rate`, amount: charge.prepaid_value, statement_field: 'invoice2_prepaid' })
  if (charge.gross != null) out.push({ figure: 'CDR waste charge (m³ × rate) before prepaid', amount: charge.gross, statement_field: 'invoice2_amount' })
  return out
}

/**
 * Checks a patch on statement_of_accounts: known fields only,
 * dollar fields as plain numbers (manual_adjustment may be negative), flags as
 * true/false, invoice numbers, links and reasons as text. Null when it is fine.
 */
export function statementPatchProblem(patch: unknown): string | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'patch must be an object of statement fields.'
  const shape = emptyStatementCapture() as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in shape)) return `The statement has no field "${key}".`
    if (key === 'survey_areas') {
      if (value !== null && !Array.isArray(value)) return 'survey_areas must be a list of {label, sqm, total}.'
      continue
    }
    const kind = typeof shape[key]
    if (kind === 'boolean') {
      if (typeof value !== 'boolean') return `${key} must be true or false.`
    } else if (kind === 'string') {
      if (typeof value !== 'string') return `${key} must be text.`
    } else if (value !== null) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${key} must be a plain number (e.g. 1650 not "$1,650"), or null.`
      if (value < 0 && key !== 'manual_adjustment') return `${key} cannot be negative.`
    }
  }
  return null
}

export type StatementDraftResult =
  | { ok: true; before: Record<string, unknown>; proposed: StatementQuantities; summary: string; not_on_statement: string[] }
  | { ok: false; reason: string; not_on_statement: string[] }

/** Survey rooms and CDR volume that differ from what the statement already has. */
export function buildStatementDraft(ad: AssessmentData | null | undefined): StatementDraftResult {
  const rooms = surveyAreaQuantities(ad)
  const m3 = cdrVolumeM3(ad)
  const not_on_statement = cdrNotOnStatement(ad)
  if (!rooms.length && m3 == null) {
    return { ok: false, reason: 'Nothing to copy: the House Survey has no priced rooms and the Contents Disposal Record has no volume.', not_on_statement }
  }
  const current = statementQuantities(ad)
  const raw = ((ad as Record<string, unknown> | null | undefined)?.statement_of_accounts ?? {}) as Record<string, unknown>
  const before: Record<string, unknown> = {}
  const proposed: StatementQuantities = {}
  const parts: string[] = []
  if (rooms.length && !same(current.survey_areas, rooms)) {
    before.survey_areas = raw.survey_areas ?? null
    proposed.survey_areas = rooms
    const sqm = rooms.reduce((t, r) => t + (r.sqm ?? 0), 0)
    parts.push(`${rooms.length} survey room${rooms.length === 1 ? '' : 's'} (${Math.round(sqm * 100) / 100} m²)`)
  }
  if (m3 != null && current.invoice2_m3 !== m3) {
    before.invoice2_m3 = raw.invoice2_m3 ?? null
    proposed.invoice2_m3 = m3
    parts.push(`CDR volume ${m3Text(m3)}${current.invoice2_m3 != null ? ` (was ${m3Text(current.invoice2_m3)})` : ''}`)
  }
  if (!parts.length) return { ok: false, reason: 'The statement already has these survey rooms and this CDR volume.', not_on_statement }
  return { ok: true, before, proposed, summary: `Statement of Accounts quantities: ${parts.join(', ')}`, not_on_statement }
}

/**
 * The Survey and CDR summary totals and the statement line each could fill,
 * in the statement's terms (inc GST when it charges GST). Never drafted
 * automatically; the Statement agent drafts one only when staff say so.
 */
export function summaryDollarFigures(ad: AssessmentData | null | undefined) {
  const incGst = currentStatement(ad)?.charges_gst ?? true
  const gst = incGst ? 'inc GST' : 'ex GST'
  const out: { figure: string; amount: number; statement_field: string }[] = []
  const survey = surveySummary(ad)
  const surveyTotal = incGst ? survey.total_inc_gst : survey.total_ex_gst
  if (surveyTotal != null) out.push({ figure: `House Survey total ${gst} (surface cleaning, labour, call-out fee)`, amount: surveyTotal, statement_field: 'invoice1_adjusted_amount' })
  const cdr = cdrSummary(ad)
  const cdrTotal = incGst ? cdr.total_inc_gst : cdr.total_ex_gst
  if (cdrTotal != null) out.push({ figure: `CDR total ${gst} (contents removal, labour, call-out fee)`, amount: cdrTotal, statement_field: 'invoice2_amount' })
  return out
}

/** What the Statement agent reads for the survey and CDR: their summaries only, and the statement as it stands. */
export function statementAgentFigures(ad: AssessmentData | null | undefined) {
  return {
    survey_summary: surveySummary(ad),
    cdr_summary: cdrSummary(ad),
    dollar_figures_staff_can_use: summaryDollarFigures(ad),
    statement: statementView(ad),
    note: 'survey_summary and cdr_summary are the reference for what the House Survey and the CDR actually cost. Skip, trailer, ute and tip dollars, prepaid volume and the CDR waste charge are not part of them and are never used. survey_areas and invoice2_m3 are the only quantity fields on the statement (fill_quantities_from_survey_and_cdr fills them). Every other statement field is dollars or text, drafted only with values the staff member states or tells you to take from dollar_figures_staff_can_use.',
  }
}

function statementView(ad: AssessmentData | null | undefined) {
  const s = currentStatement(ad)
  return s
    ? {
        started: true,
        survey_areas: s.survey_areas,
        invoice2_m3: s.invoice2_m3,
        invoice1_amount: s.invoice1_amount,
        invoice1_breakdown: { callout: s.invoice1_callout, contents: s.invoice1_contents, cleaning: s.invoice1_cleaning },
        invoice1_adjusted_amount: s.invoice1_adjusted_amount,
        adjustment_reason: s.adjustment_reason,
        invoice2_amount: s.invoice2_amount,
        invoice2_breakdown: {
          skips: s.invoice2_skips, trailers: s.invoice2_trailers, utes: s.invoice2_utes,
          tip_receipts: s.invoice2_tip_receipts, prepaid: s.invoice2_prepaid,
        },
        charges_gst: s.charges_gst,
        deposit_taken: s.deposit_taken,
        deposit_amount: s.deposit_amount,
        invoice_numbers: { original: s.original_invoice_number, new: s.new_invoice_number },
        manual_adjustment: s.manual_adjustment,
      }
    : { started: false }
}

/** What the file agent reads: survey rooms, CDR loads and the statement as it stands. */
export function surveyAndDisposalSummary(ad: AssessmentData | null | undefined) {
  const survey = houseSurveyDocument('', '', houseSurveyWithQuote(ad))
  const loads = mergedDisposalManifestCapture(ad).loads.filter(loadHasContent)
  const totals = computeDisposalTotals(loads)
  const s = currentStatement(ad)
  return {
    survey: {
      price_per_m2: survey.price_per_m2,
      rooms: survey.areas.map(a => ({ room: a.title, priced_m2: a.priced, price_inc_gst: a.price_inc })),
      total_m2: survey.totals.priced,
      total_inc_gst: survey.totals.price_inc,
    },
    contents_disposal_record: {
      loads: loads.length,
      volume_m3: cdrVolumeM3(ad),
      weight_kg: totals.weight_kg || null,
      not_on_statement: cdrNotOnStatement(ad),
      dollar_figures_staff_can_use: cdrDollarFigures(ad),
    },
    statement: s
      ? {
          started: true,
          survey_areas: s.survey_areas,
          invoice2_m3: s.invoice2_m3,
          invoice1_amount: s.invoice1_amount,
          invoice1_breakdown: { callout: s.invoice1_callout, contents: s.invoice1_contents, cleaning: s.invoice1_cleaning },
          invoice2_amount: s.invoice2_amount,
          invoice2_breakdown: {
            skips: s.invoice2_skips, trailers: s.invoice2_trailers, utes: s.invoice2_utes,
            tip_receipts: s.invoice2_tip_receipts, prepaid: s.invoice2_prepaid,
          },
          deposit_taken: s.deposit_taken,
          deposit_amount: s.deposit_amount,
          invoice_numbers: { original: s.original_invoice_number, new: s.new_invoice_number },
          manual_adjustment: s.manual_adjustment,
        }
      : { started: false },
    note: 'survey_areas and invoice2_m3 are the only quantity fields on the statement (the Statement agent fills them from the survey and CDR). not_on_statement has no statement field. Every other statement field is dollars or text, drafted only with values the staff member states or tells you to take from dollar_figures_staff_can_use.',
  }
}
