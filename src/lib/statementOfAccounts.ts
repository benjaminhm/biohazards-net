import type { AssessmentData, DisposalManifestCapture, Document, QuoteGstMode } from '@/lib/types'
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
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function quoteMode(content: Record<string, unknown>): QuoteGstMode {
  const mode = content.gst_mode
  if (mode === 'no_gst' || mode === 'inclusive' || mode === 'exclusive') return mode
  const gst = Number(content.gst ?? 0)
  const total = Number(content.total ?? 0)
  const subtotal = Number(content.subtotal ?? 0)
  if (!Number.isFinite(gst) || gst <= 0) return 'no_gst'
  if (Math.abs(total - subtotal) < 0.02) return 'inclusive'
  return 'exclusive'
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

/** Quote remainder stays on the original invoice. Contents disposal is the new invoice. */
export function statementFigures(
  quote: Document | null,
  disposal: { ex: number; inc: number } | number,
  capture: StatementOfAccountsCapture,
): StatementFigures {
  const content = (quote?.content ?? {}) as Record<string, unknown>
  const gst_mode = quote ? quoteMode(content) : 'no_gst'
  const quote_ex = round2(Math.max(0, Number(content.subtotal ?? content.total ?? 0) || 0))
  const quote_gst = gst_mode === 'no_gst' ? 0 : round2(Math.max(0, Number(content.gst ?? 0) || 0))
  const quote_inc = gst_mode === 'no_gst'
    ? quote_ex
    : round2(Math.max(0, Number(content.total ?? quote_ex + quote_gst) || 0))
  const entered = capture.deposit_taken ? Math.max(0, capture.deposit_amount ?? 0) : 0
  const deposit_ex = gst_mode === 'no_gst' || !capture.deposit_includes_gst
    ? round2(entered)
    : round2(entered / 1.1)
  const deposit_inc = round2(entered)
  const new_invoice_ex = round2(typeof disposal === 'number' ? disposal : disposal.ex)
  const new_invoice_inc = round2(typeof disposal === 'number'
    ? (gst_mode === 'no_gst' ? disposal : disposal * 1.1)
    : disposal.inc)
  const original_owing_ex = round2(quote_ex - deposit_ex)
  const original_owing_inc = round2(quote_inc - deposit_inc)
  const owing_ex = round2(original_owing_ex + new_invoice_ex)
  const owing_inc = round2(original_owing_inc + new_invoice_inc)
  const gst = gst_mode === 'no_gst' ? 0 : round2(owing_inc - owing_ex)
  const reference = typeof content.reference === 'string' && content.reference.trim()
    ? content.reference.trim()
    : 'Quote'
  return {
    reference,
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
  }
}

export function statementFromJob(
  documents: Document[],
  assessment: AssessmentData | null | undefined,
): StatementFigures {
  const capture = normalizeStatementCapture(assessment?.statement_of_accounts)
  return statementFigures(latestQuoteDocument(documents), disposalTotals(mergedDisposalManifestCapture(assessment)), capture)
}
