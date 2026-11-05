/*
 * lib/xero/invoice.ts
 *
 * Pure builders for the job's Xero invoice. One invoice per job; each accepted
 * quote on the job is one line, priced ex GST from the quote's own totals.
 * Kept free of I/O so it can be unit tested.
 */
import { createHash } from 'node:crypto'

export interface XeroSettings {
  /** Sales account code for quote lines (Xero AU default chart: 200 Sales). */
  account_code: string
  /** Tax type when the quote charges GST. */
  gst_tax_type: string
  /** Tax type when the quote has no GST. */
  no_gst_tax_type: string
  /** Days from invoice date to due date. */
  due_days: number
}

export const DEFAULT_XERO_SETTINGS: XeroSettings = {
  account_code: '200',
  gst_tax_type: 'OUTPUT',
  no_gst_tax_type: 'EXEMPTOUTPUT',
  due_days: 7,
}

export function xeroSettings(raw: unknown): XeroSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)
  const due = Number(r.due_days)
  return {
    account_code: str(r.account_code, DEFAULT_XERO_SETTINGS.account_code),
    gst_tax_type: str(r.gst_tax_type, DEFAULT_XERO_SETTINGS.gst_tax_type),
    no_gst_tax_type: str(r.no_gst_tax_type, DEFAULT_XERO_SETTINGS.no_gst_tax_type),
    due_days: Number.isFinite(due) && due >= 0 ? Math.round(due) : DEFAULT_XERO_SETTINGS.due_days,
  }
}

export interface AcceptedQuote {
  document_id: string
  type: string
  content: Record<string, unknown>
}

export interface XeroLine {
  Description: string
  Quantity: number
  UnitAmount: number
  AccountCode: string
  TaxType: string
}

const TYPE_LABELS: Record<string, string> = {
  quote: 'Quote',
  biohazard_cleaning_quote: 'Biohazard cleaning',
  contents_clearance_quote: 'Contents clearance',
  surface_area_cleaning_quote: 'Surface area cleaning',
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const cents = (n: number) => Math.round(n * 100) / 100

/** Ex-GST amount and whether GST applies, from a quote's subtotal / gst / total. */
export function quoteAmount(content: Record<string, unknown>): { exGst: number; gst: boolean } | null {
  const subtotal = num(content.subtotal)
  const gst = num(content.gst)
  const total = num(content.total)
  const hasGst = gst != null && gst > 0
  if (subtotal != null) return { exGst: cents(subtotal), gst: hasGst }
  if (total != null) return { exGst: cents(hasGst ? total - (gst as number) : total), gst: hasGst }
  return null
}

export function quoteLine(q: AcceptedQuote, settings: XeroSettings): XeroLine | null {
  const amount = quoteAmount(q.content)
  if (!amount) return null
  const label = TYPE_LABELS[q.type] ?? 'Quote'
  const title = typeof q.content.title === 'string' ? q.content.title.trim() : ''
  const reference = typeof q.content.reference === 'string' ? q.content.reference.trim() : ''
  const head = title && title.toLowerCase() !== label.toLowerCase() ? `${label}: ${title}` : label
  return {
    Description: reference ? `${head} (quote ${reference})` : head,
    Quantity: 1,
    UnitAmount: amount.exGst,
    AccountCode: settings.account_code,
    TaxType: amount.gst ? settings.gst_tax_type : settings.no_gst_tax_type,
  }
}

export interface BuiltLines {
  lines: XeroLine[]
  /** Accepted quotes with no subtotal or total, so they could not be priced. */
  unpriced: string[]
}

export function buildInvoiceLines(quotes: AcceptedQuote[], settings: XeroSettings): BuiltLines {
  const lines: XeroLine[] = []
  const unpriced: string[] = []
  for (const q of quotes) {
    const line = quoteLine(q, settings)
    if (line) lines.push(line)
    else unpriced.push(q.document_id)
  }
  return { lines, unpriced }
}

export function linesHash(lines: XeroLine[]): string {
  return createHash('sha256').update(JSON.stringify(lines)).digest('hex').slice(0, 32)
}

/** YYYY-MM-DD in Brisbane, offset by `addDays`. */
export function brisbaneDate(now: Date, addDays = 0): string {
  const d = new Date(now.getTime() + addDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(d)
}

export interface InvoiceInput {
  contactId: string
  reference: string
  lines: XeroLine[]
  settings: XeroSettings
  now: Date
}

export function draftInvoiceBody(input: InvoiceInput) {
  return {
    Type: 'ACCREC',
    Status: 'DRAFT',
    Contact: { ContactID: input.contactId },
    Reference: input.reference,
    Date: brisbaneDate(input.now),
    DueDate: brisbaneDate(input.now, input.settings.due_days),
    LineAmountTypes: 'Exclusive',
    LineItems: input.lines,
  }
}

/** Value for a Xero `where` string literal: quotes and backslashes removed. */
export function whereLiteral(value: string): string {
  return value.replace(/["\\]/g, '').trim()
}

export interface ContactInput {
  name: string
  email: string
  phone: string
}

export function contactFromJob(job: {
  client_name?: string | null
  client_organization_name?: string | null
  client_email?: string | null
  client_phone?: string | null
  job_code?: string | null
}): ContactInput {
  const org = job.client_organization_name?.trim() ?? ''
  const person = job.client_name?.trim() ?? ''
  const email = job.client_email?.trim() ?? ''
  const usable = (s: string) => s && !/^caller\s*\+?\d|^unknown caller$/i.test(s)
  const name = (usable(org) && org) || (usable(person) && person) || email || `Job ${job.job_code ?? ''}`.trim()
  return { name, email, phone: job.client_phone?.trim() ?? '' }
}
