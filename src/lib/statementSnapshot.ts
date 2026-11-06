/*
 * lib/statementSnapshot.ts
 *
 * What the Statement of Accounts copies from the House Survey and the
 * Contents Disposal Record when it is generated, so an issued statement keeps
 * showing the rooms and disposal figures it was issued with even if the
 * survey or CDR is edited later. Both stay their own captures and documents.
 *
 * Survey rooms follow the survey's own pricing: a rate per m² ex GST, each
 * room's price ex GST, plus 10% GST. A room whose saved statement total
 * differs from the rate shows the rate that total works out to.
 */
import type { AssessmentData, StatementDisposalSnapshot, StatementSurveyRoom, StatementSurveySnapshot } from '@/lib/types'
import { houseSurveyDocument, surveyPrice } from '@/lib/houseSurvey'
import { houseSurveyWithQuote } from '@/lib/surveyQuoteLink'
import { computeDisposalTotals, loadHasContent, mergedDisposalManifestCapture, vehicleTypeLabel } from '@/lib/disposalManifest'
import type { StatementSurveyArea } from '@/lib/statementOfAccounts'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n)
}

function surveyRoom(area: StatementSurveyArea, rateEx: number | null): StatementSurveyRoom | null {
  const name = area.label.trim()
  if (!name || !finite(area.sqm)) return null
  const atRate = surveyPrice(area.sqm, rateEx)
  const total = finite(area.total) ? round2(area.total) : atRate.inc
  if (total == null) return { name, sqm: area.sqm, rate_ex: rateEx, line_ex: null, line_inc: null }
  if (atRate.inc != null && Math.abs(atRate.inc - total) < 0.005) {
    return { name, sqm: area.sqm, rate_ex: rateEx, line_ex: atRate.ex, line_inc: atRate.inc }
  }
  const lineEx = round2(total / 1.1)
  return { name, sqm: area.sqm, rate_ex: area.sqm > 0 ? round2(lineEx / area.sqm) : null, line_ex: lineEx, line_inc: total }
}

/**
 * Survey rooms from the statement's area rows (staff can edit them on the
 * Statement tab; blank means the saved survey). Null when there are none.
 */
export function statementSurveySnapshot(
  areas: StatementSurveyArea[],
  assessment: AssessmentData | null | undefined,
  reference: string,
): StatementSurveySnapshot | null {
  const rate = houseSurveyDocument('', '', houseSurveyWithQuote(assessment)).price_per_m2
  const rooms = areas.map(a => surveyRoom(a, rate)).filter((r): r is StatementSurveyRoom => r !== null)
  if (!rooms.length) return null
  const priced = rooms.filter(r => r.line_ex != null && r.line_inc != null)
  const subtotal = priced.length ? round2(priced.reduce((t, r) => t + (r.line_ex ?? 0), 0)) : null
  const totalInc = priced.length ? round2(priced.reduce((t, r) => t + (r.line_inc ?? 0), 0)) : null
  return {
    reference,
    rooms,
    total_sqm: round2(rooms.reduce((t, r) => t + (r.sqm ?? 0), 0)),
    subtotal_ex: subtotal,
    gst: subtotal != null && totalInc != null ? round2(totalInc - subtotal) : null,
    total_value_inc: totalInc,
  }
}

/** Disposal facts from the CDR loads. Null when the job has no loads recorded. */
export function statementDisposalSnapshot(
  assessment: AssessmentData | null | undefined,
  reference: string,
  invoicedM3: number | null | undefined,
): StatementDisposalSnapshot | null {
  const loads = mergedDisposalManifestCapture(assessment).loads.filter(loadHasContent)
  if (!loads.length) return null
  const totals = computeDisposalTotals(loads)
  const counts = new Map<string, number>()
  for (const load of loads) for (const v of load.vehicles) counts.set(v.type, (counts.get(v.type) ?? 0) + 1)
  const totalM3 = totals.volume_recorded > 0 ? round2(totals.volume_m3) : null
  const invoiced = finite(invoicedM3) ? round2(invoicedM3) : null
  return {
    reference,
    total_m3: totalM3,
    load_count: totals.load_count,
    vehicles: [...counts].map(([type, count]) => ({ type, label: vehicleTypeLabel(type), count })),
    distance_km: totals.distance_recorded > 0 ? round2(totals.distance_km) : null,
    weight_kg: totals.weight_recorded > 0 ? round2(totals.weight_kg) : null,
    invoiced_m3: invoiced != null && (totalM3 == null || Math.abs(invoiced - totalM3) > 0.005) ? invoiced : null,
  }
}
