/*
 * lib/agent/recordSummaries.ts
 *
 * The House Survey, Contents Disposal Record and Biohazard Cleaning Record
 * summaries as read-only objects: the same figures their tabs and documents
 * show (houseSurveyDocument, disposalRecordSummary, biohazardRecordSummary).
 * The Statement agent reads these instead of the records themselves.
 */
import type { AssessmentData } from '@/lib/types'
import type { FixedCharges, RecordSummary } from '@/lib/fixedCharges'
import { disposalRecordSummary, loadHasContent, mergedDisposalManifestCapture, quoteDisposalLink } from '@/lib/disposalManifest'
import { houseSurveyDocument } from '@/lib/houseSurvey'
import { houseSurveyWithQuote, quoteSurveyLink } from '@/lib/surveyQuoteLink'
import { biohazardRecordFromJob } from '@/lib/biohazardCleaningRecord'

export interface RecordSummaryView {
  /** False until the record is started on the job; every figure is then null. */
  exists: boolean
  line: 'Surface cleaning' | 'Contents removal'
  quantity: number | null
  unit: 'm²' | 'm³'
  rate_ex_gst: number | null
  /** quantity × rate. */
  line_amount_ex_gst: number | null
  labour_days: number | null
  rate_per_labour_day_ex_gst: number | null
  labour_amount_ex_gst: number | null
  callout_fee_ex_gst: number | null
  /** Contents Disposal Record: kilometres × rate per km. Absent on the House Survey. */
  distance_km?: number | null
  rate_per_km_ex_gst?: number | null
  distance_amount_ex_gst?: number | null
  total_ex_gst: number | null
  gst: number | null
  total_inc_gst: number | null
}

function summaryView(
  line: RecordSummaryView['line'],
  unit: RecordSummaryView['unit'],
  figures: { quantity: number | null; rate: number | null; charges: FixedCharges; summary: RecordSummary } | null,
): RecordSummaryView {
  return {
    exists: figures != null,
    line,
    quantity: figures?.quantity ?? null,
    unit,
    rate_ex_gst: figures?.rate ?? null,
    line_amount_ex_gst: figures?.summary.quantity_ex ?? null,
    labour_days: figures?.charges.labour_days ?? null,
    rate_per_labour_day_ex_gst: figures?.charges.rate_per_labour_day ?? null,
    labour_amount_ex_gst: figures?.summary.labour_ex ?? null,
    callout_fee_ex_gst: figures?.summary.mobilisation_ex ?? null,
    total_ex_gst: figures?.summary.total_ex ?? null,
    gst: figures?.summary.gst ?? null,
    total_inc_gst: figures?.summary.total_inc ?? null,
  }
}

/** Surface cleaning (priced m² × rate), labour, call-out fee and GST, as the House Survey summary shows them. */
export function surveySummary(ad: AssessmentData | null | undefined): RecordSummaryView {
  if (ad?.house_survey == null) return summaryView('Surface cleaning', 'm²', null)
  const doc = houseSurveyDocument('', '', houseSurveyWithQuote(ad), quoteSurveyLink(ad)?.charges ?? null)
  if (!doc.charges || !doc.summary) return summaryView('Surface cleaning', 'm²', null)
  return summaryView('Surface cleaning', 'm²', { quantity: doc.totals.priced, rate: doc.price_per_m2, charges: doc.charges, summary: doc.summary })
}

export interface BiohazardRecordSummaryView {
  /** The job has a Biohazard Cleaning Quote. */
  has_quote: boolean
  /** The quote is priced by area or tests, so the statement bills from this record. False is fixed price: the quote total. */
  needed: boolean
  exists: boolean
  lines: { label: string; amount_ex_gst: number }[]
  /** Actuals still to enter before the statement can be issued. */
  missing: string[]
  total_ex_gst: number | null
  gst: number | null
  total_inc_gst: number | null
}

/** Biohazard Cleaning Record lines and totals, as the House Survey shows them (biohazardRecordSummary). */
export function bcqRecordSummary(ad: AssessmentData | null | undefined): BiohazardRecordSummaryView {
  const r = biohazardRecordFromJob(ad)
  const shown = r != null && (r.exists || r.needed)
  return {
    has_quote: r != null,
    needed: r?.needed ?? false,
    exists: r?.exists ?? false,
    lines: shown ? r.summary.lines.map(line => ({ label: line.label, amount_ex_gst: line.amount_ex })) : [],
    missing: r?.needed ? r.summary.missing : [],
    total_ex_gst: shown ? r.summary.total_ex : null,
    gst: shown ? r.summary.gst : null,
    total_inc_gst: shown ? r.summary.total_inc : null,
  }
}

/** Contents removal (counted m³ × rate), distance (km × rate), labour, call-out fee and GST, as the Contents Disposal Record summary shows them. */
export function cdrSummary(ad: AssessmentData | null | undefined): RecordSummaryView {
  if (ad?.disposal_manifest_capture == null) return summaryView('Contents removal', 'm³', null)
  const capture = mergedDisposalManifestCapture(ad)
  const r = disposalRecordSummary({ ...capture, loads: capture.loads.filter(loadHasContent) }, quoteDisposalLink(ad))
  return {
    ...summaryView('Contents removal', 'm³', { quantity: r.volume_m3, rate: r.rate_per_m3, charges: r.charges, summary: r.summary }),
    distance_km: r.distance_km,
    rate_per_km_ex_gst: r.rate_per_km,
    distance_amount_ex_gst: r.summary.distance_ex ?? 0,
  }
}
