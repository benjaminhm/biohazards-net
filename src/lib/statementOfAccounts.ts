import type { AssessmentData, DisposalManifestCapture, Document, QuoteGstMode, StatementLedgerLine } from '@/lib/types'
import { disposalPriceLines, mergedDisposalManifestCapture } from '@/lib/disposalManifest'

export interface StatementOfAccountsCapture {
  deposit_taken: boolean
  /** Dollars received. Includes GST when deposit_includes_gst is true and the quote charges GST. */
  deposit_amount: number | null
  deposit_includes_gst: boolean
  original_invoice_number: string
  original_invoice_url: string
  new_invoice_number: string
  new_invoice_url: string
  /** Invoice 1 after the surfaces were measured again. Null until staff enter it. */
  invoice1_adjusted_amount: number | null
  /** The adjusted amount includes GST when the quote charges GST. */
  invoice1_adjusted_includes_gst: boolean
  /** Issued invoice 1. Typed. Not taken from the quote. */
  invoice1_amount: number | null
  /** Contents invoice. Typed. Not taken from the disposal record. */
  invoice2_amount: number | null
  /** Every typed amount includes GST. */
  charges_gst: boolean
}

export interface StatementFigures {
  reference: string
  gst_mode: QuoteGstMode
  quote_ex: number
  quote_gst: number
  quote_inc: number
  disposal: number
  deposit_taken: boolean
  deposit_entered: number
  deposit_ex: number
  owing_ex: number
  gst: number
  owing_inc: number
  original_owing_ex: number
  original_owing_inc: number
  new_invoice_ex: number
  new_invoice_inc: number
  /** True once staff enter a remeasured invoice 1. */
  remeasured: boolean
  invoice1_revised_ex: number | null
  invoice1_revised_inc: number | null
  /** Original invoice 1 minus the remeasure. Positive when the price went down. */
  remeasure_ex: number
  remeasure_inc: number
  /** Contents invoice after the remeasure difference is applied. */
  invoice2_owing_ex: number
  invoice2_owing_inc: number
  job_total_ex: number | null
  job_total_inc: number | null
  has_invoice2: boolean
  lines: StatementLedgerLine[]
}

function textField(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export function emptyStatementCapture(): StatementOfAccountsCapture {
  return {
    deposit_taken: false,
    deposit_amount: null,
    deposit_includes_gst: true,
    original_invoice_number: '',
    original_invoice_url: '',
    new_invoice_number: '',
    new_invoice_url: '',
    invoice1_adjusted_amount: null,
    invoice1_adjusted_includes_gst: true,
    invoice1_amount: null,
    invoice2_amount: null,
    charges_gst: true,
  }
}

export function normalizeStatementCapture(raw: unknown): StatementOfAccountsCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const amount = typeof o.deposit_amount === 'number' ? o.deposit_amount : Number(o.deposit_amount)
  return {
    deposit_taken: o.deposit_taken === true,
    deposit_amount: Number.isFinite(amount) && amount >= 0 ? amount : null,
    deposit_includes_gst: o.deposit_includes_gst !== false,
    original_invoice_number: textField(o.original_invoice_number),
    original_invoice_url: textField(o.original_invoice_url),
    new_invoice_number: textField(o.new_invoice_number),
    new_invoice_url: textField(o.new_invoice_url),
    invoice1_adjusted_amount: moneyOrNull(o.invoice1_adjusted_amount),
    invoice1_adjusted_includes_gst: o.invoice1_adjusted_includes_gst !== false,
    invoice1_amount: moneyOrNull(o.invoice1_amount),
    invoice2_amount: moneyOrNull(o.invoice2_amount),
    charges_gst: o.charges_gst !== false,
  }
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function latestOfType(documents: Document[], type: Document['type']): Document | null {
  const rows = documents.filter(d => d.type === type)
  if (!rows.length) return null
  return [...rows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
}

export function latestQuoteDocument(documents: Document[]): Document | null {
  return latestOfType(documents, 'quote')
}

export function latestDisposalDocument(documents: Document[]): Document | null {
  return latestOfType(documents, 'waste_disposal_manifest')
}

export function documentReference(doc: Document | null, fallback: string): string {
  const raw = doc?.content?.reference
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
}

export function disposalTotals(capture: DisposalManifestCapture | null | undefined): { ex: number; inc: number } {
  if (!capture) return { ex: 0, inc: 0 }
  const lines = disposalPriceLines(capture.loads ?? [], capture.cost_per_m3, capture.prepaid_m3)
  return { ex: lines.total_ex, inc: lines.total_inc }
}

export function disposalTotal(capture: DisposalManifestCapture | null | undefined): number {
  return disposalTotals(capture).ex
}

function withNumber(label: string, number: string): string {
  const trimmed = number.trim()
  return trimmed ? `${label} (${trimmed})` : label
}

function positionLine(owingEx: number, owingInc: number, overLabel: string, underLabel: string, evenLabel: string): StatementLedgerLine {
  if (owingInc > 0.004) return { label: underLabel, ex: owingEx, inc: owingInc, strong: true }
  if (owingInc < -0.004) return { label: overLabel, ex: round2(-owingEx), inc: round2(-owingInc), strong: true }
  return { label: evenLabel, ex: 0, inc: 0, strong: true }
}

/** Dollars are typed on the statement. The quote and disposal record are references only. */
export function statementFigures(capture: StatementOfAccountsCapture): StatementFigures {
  const gst_mode: QuoteGstMode = capture.charges_gst ? 'exclusive' : 'no_gst'
  const pair = (amount: number | null) => amount == null ? null : enteredPair(amount, gst_mode, true)
  const invoice1 = pair(capture.invoice1_amount) ?? { ex: 0, inc: 0 }
  const deposit = capture.deposit_taken ? (pair(capture.deposit_amount) ?? { ex: 0, inc: 0 }) : { ex: 0, inc: 0 }
  const revised = pair(capture.invoice1_adjusted_amount)
  const invoice2 = pair(capture.invoice2_amount)
  const quote_ex = invoice1.ex
  const quote_inc = invoice1.inc
  const quote_gst = gst_mode === 'no_gst' ? 0 : round2(quote_inc - quote_ex)
  const deposit_ex = deposit.ex
  const deposit_inc = deposit.inc
  const new_invoice_ex = invoice2?.ex ?? 0
  const new_invoice_inc = invoice2?.inc ?? 0
  const original_owing_ex = round2(quote_ex - deposit_ex)
  const original_owing_inc = round2(quote_inc - deposit_inc)
  const remeasured = revised != null
  const remeasure_ex = revised == null ? 0 : round2(quote_ex - revised.ex)
  const remeasure_inc = revised == null ? 0 : round2(quote_inc - revised.inc)
  const has_invoice2 = invoice2 != null
  const invoice2_owing_ex = round2(new_invoice_ex - remeasure_ex)
  const invoice2_owing_inc = round2(new_invoice_inc - remeasure_inc)
  const owing_ex = has_invoice2
    ? round2(original_owing_ex + invoice2_owing_ex)
    : round2(original_owing_ex - remeasure_ex)
  const owing_inc = has_invoice2
    ? round2(original_owing_inc + invoice2_owing_inc)
    : round2(original_owing_inc - remeasure_inc)
  const priced = revised ?? invoice1
  const job_total_ex = round2(priced.ex + new_invoice_ex)
  const job_total_inc = round2(priced.inc + new_invoice_inc)
  const gst = gst_mode === 'no_gst' ? 0 : round2(owing_inc - owing_ex)
  const lines: StatementLedgerLine[] = [
    { label: 'Invoice 1', ex: quote_ex, inc: quote_inc },
    { label: 'Deposit paid', ex: deposit_ex, inc: deposit_inc },
    positionLine(
      original_owing_ex,
      original_owing_inc,
      'Overpay on invoice 1',
      withNumber('Underpay. Still to come on invoice 1', capture.original_invoice_number),
      'Invoice 1 is paid',
    ),
  ]
  if (revised) {
    lines.push({ label: 'Invoice 1 after adjustment', ex: revised.ex, inc: revised.inc })
    lines.push(positionLine(
      -remeasure_ex,
      -remeasure_inc,
      'Overpay carried to the next invoice',
      'Underpay added to the next invoice',
      'No change from the adjustment',
    ))
  }
  if (invoice2) {
    lines.push({ label: 'Invoice 2', ex: new_invoice_ex, inc: new_invoice_inc })
    lines.push(positionLine(
      invoice2_owing_ex,
      invoice2_owing_inc,
      withNumber('Overpay on invoice 2', capture.new_invoice_number),
      withNumber('Underpay. Owing on invoice 2', capture.new_invoice_number),
      'Invoice 2 is paid',
    ))
  }
  if (revised || invoice2) {
    lines.push({ label: 'Job total after adjustments', ex: job_total_ex, inc: job_total_inc, strong: true })
  }
  lines.push({ label: 'Total remaining owed', ex: owing_ex, inc: owing_inc, strong: true })
  return {
    reference: '',
    gst_mode,
    quote_ex,
    quote_gst,
    quote_inc,
    disposal: round2(new_invoice_ex),
    deposit_taken: capture.deposit_taken,
    deposit_entered: deposit_inc,
    deposit_ex,
    owing_ex,
    gst,
    owing_inc,
    original_owing_ex,
    original_owing_inc,
    new_invoice_ex,
    new_invoice_inc,
    remeasured,
    invoice1_revised_ex: revised?.ex ?? null,
    invoice1_revised_inc: revised?.inc ?? null,
    remeasure_ex,
    remeasure_inc,
    invoice2_owing_ex: has_invoice2 ? invoice2_owing_ex : 0,
    invoice2_owing_inc: has_invoice2 ? invoice2_owing_inc : 0,
    job_total_ex,
    job_total_inc,
    has_invoice2,
    lines,
  }
}

/** Split a typed dollar amount into ex GST and inc GST. */
function enteredPair(amount: number, gstMode: QuoteGstMode, includesGst: boolean): { ex: number; inc: number } {
  if (gstMode === 'no_gst') {
    const value = round2(amount)
    return { ex: value, inc: value }
  }
  if (includesGst) {
    const inc = round2(amount)
    return { ex: round2(inc / 1.1), inc }
  }
  const ex = round2(amount)
  return { ex, inc: round2(ex * 1.1) }
}

export function statementFromJob(
  documents: Document[],
  assessment: AssessmentData | null | undefined,
): StatementFigures {
  const capture = normalizeStatementCapture(assessment?.statement_of_accounts)
  const figures = statementFigures(capture)
  return { ...figures, reference: documentReference(latestQuoteDocument(documents), '—') }
}
