/*
 * lib/agent/statementDraft.ts
 *
 * The file agent's Statement of Accounts draft: quantities only. It copies the
 * House Survey's priced rooms (square metres, and each room's price at the
 * survey rate staff set) and the Contents Disposal Record's cubic metres into
 * assessment_data.statement_of_accounts. The result is an ordinary capture
 * patch (paths survey_areas and invoice2_m3), approved like any other. Dollar
 * fields are only drafted when staff ask for them, through draft_capture_patch.
 */
import type { AssessmentData } from '@/lib/types'
import { computeDisposalTotals, loadHasContent, mergedDisposalManifestCapture } from '@/lib/disposalManifest'
import { houseSurveyDocument } from '@/lib/houseSurvey'
import { houseSurveyWithQuote } from '@/lib/surveyQuoteLink'
import {
  normalizeStatementCapture,
  surveyAreaQuantities,
  type StatementOfAccountsCapture,
  type StatementSurveyArea,
} from '@/lib/statementOfAccounts'

export interface StatementQuantities {
  survey_areas?: StatementSurveyArea[] | null
  invoice2_m3?: number | null
}

/** Total billed cubic metres on the CDR, as the Statement tab's "Use CDR volume" button uses. */
export function cdrVolumeM3(ad: AssessmentData | null | undefined): number | null {
  const loads = mergedDisposalManifestCapture(ad).loads.filter(loadHasContent)
  const m3 = computeDisposalTotals(loads).volume_m3
  return m3 > 0 ? Math.round(m3 * 100) / 100 : null
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

export type StatementDraftResult =
  | { ok: true; before: Record<string, unknown>; proposed: StatementQuantities; summary: string }
  | { ok: false; reason: string }

/** Survey rooms and CDR volume that differ from what the statement already has. */
export function buildStatementDraft(ad: AssessmentData | null | undefined): StatementDraftResult {
  const rooms = surveyAreaQuantities(ad)
  const m3 = cdrVolumeM3(ad)
  if (!rooms.length && m3 == null) {
    return { ok: false, reason: 'Nothing to copy: the House Survey has no priced rooms and the Contents Disposal Record has no volume.' }
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
  if (!parts.length) return { ok: false, reason: 'The statement already has these survey rooms and this CDR volume.' }
  return { ok: true, before, proposed, summary: `Statement of Accounts quantities: ${parts.join(', ')}` }
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
    },
    statement: s
      ? {
          started: true,
          survey_areas: s.survey_areas,
          invoice2_m3: s.invoice2_m3,
          invoice1_amount: s.invoice1_amount,
          invoice2_amount: s.invoice2_amount,
          deposit_taken: s.deposit_taken,
          deposit_amount: s.deposit_amount,
        }
      : { started: false },
    note: 'draft_statement fills survey_areas and invoice2_m3 only. Draft dollar amounts, deposit, adjustments, invoice numbers or payment links with draft_capture_patch only when the staff member asks.',
  }
}
