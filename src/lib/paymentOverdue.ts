/**
 * Payment Overdue — a reminder letter grounded in the Statement of Accounts.
 *
 * Invoice numbers and amounts are read from the statement. This capture only
 * records which of those invoices is late, the dates, the contracted payer,
 * and an optional personal guarantor. The 14 / 21 / 28 day dates count from
 * the letter date.
 */
import type { Job, PaymentReminderContent, StatementLedgerLine } from '@/lib/types'
import { formatAud } from '@/lib/disposalManifest'
import {
  normalizeStatementCapture,
  statementFigures,
  type StatementOfAccountsCapture,
} from '@/lib/statementOfAccounts'

export type PayerSource = 'account' | 'organisation' | 'person'

export interface ContractedPayer {
  name: string
  address: string
  abn: string
  source: PayerSource
}

export interface AccountPayer {
  legal_name: string
  billing_address: string
  abn: string
}

export interface PaymentOverdueCapture {
  letter_date: string
  payer_name: string
  payer_address: string
  payer_abn: string
  guarantor_name: string
  guarantor_address: string
  guarantee_reference: string
  invoice1_late: boolean
  invoice1_submitted: string
  invoice1_due: string
  invoice2_late: boolean
  invoice2_submitted: string
  invoice2_due: string
}

export interface OverdueInvoiceOption {
  key: 'invoice1' | 'invoice2'
  label: string
  remainingInc: number
}

export interface LateInvoiceLine {
  key: 'invoice1' | 'invoice2'
  label: string
  submitted: string
  due: string
  daysLate: number
  amountInc: number
}

export interface PaymentReminderDraft {
  siteAddress: string
  letterDate: string
  payerName: string
  payerAddress: string
  payerAbn: string
  guarantor: { name: string; address: string; reference: string } | null
  statementLines: StatementLedgerLine[]
  chargesGst: boolean
  lateInvoices: LateInvoiceLine[]
  lateTotalInc: number
  payBy: string
  demandOn: string
  finalOn: string
  paragraphs: string[]
}

export type PaymentReminderResult =
  | { ok: true; draft: PaymentReminderDraft }
  | { ok: false; issues: string[] }

export function emptyPaymentOverdueCapture(): PaymentOverdueCapture {
  return {
    letter_date: '',
    payer_name: '',
    payer_address: '',
    payer_abn: '',
    guarantor_name: '',
    guarantor_address: '',
    guarantee_reference: '',
    invoice1_late: false,
    invoice1_submitted: '',
    invoice1_due: '',
    invoice2_late: false,
    invoice2_submitted: '',
    invoice2_due: '',
  }
}

function textField(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function flag(raw: unknown): boolean {
  return raw === true
}

export function normalizePaymentOverdueCapture(raw: unknown): PaymentOverdueCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    letter_date: textField(o.letter_date),
    payer_name: textField(o.payer_name),
    payer_address: textField(o.payer_address),
    payer_abn: textField(o.payer_abn),
    guarantor_name: textField(o.guarantor_name),
    guarantor_address: textField(o.guarantor_address),
    guarantee_reference: textField(o.guarantee_reference),
    invoice1_late: flag(o.invoice1_late),
    invoice1_submitted: textField(o.invoice1_submitted),
    invoice1_due: textField(o.invoice1_due),
    invoice2_late: flag(o.invoice2_late),
    invoice2_submitted: textField(o.invoice2_submitted),
    invoice2_due: textField(o.invoice2_due),
  }
}

export function todayIso(on = new Date()): string {
  const y = on.getFullYear()
  const m = String(on.getMonth() + 1).padStart(2, '0')
  const d = String(on.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}

export function addCalendarDays(iso: string, days: number): string | null {
  const date = parseIsoDate(iso)
  if (!date) return null
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function daysBetween(earlier: string, later: string): number | null {
  const from = parseIsoDate(earlier)
  const to = parseIsoDate(later)
  if (!from || !to) return null
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

export function formatLongDate(iso: string): string {
  const date = parseIsoDate(iso)
  if (!date) return iso
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function resolveContractedPayer(
  job: Pick<Job, 'client_name' | 'client_organization_name' | 'site_address'>,
  account: AccountPayer | null,
): ContractedPayer {
  const legalName = account?.legal_name.trim() ?? ''
  if (legalName) {
    return {
      name: legalName,
      address: (account?.billing_address ?? '').trim(),
      abn: (account?.abn ?? '').trim(),
      source: 'account',
    }
  }
  const organisation = (job.client_organization_name ?? '').trim()
  if (organisation) {
    return { name: organisation, address: '', abn: '', source: 'organisation' }
  }
  return {
    name: (job.client_name ?? '').trim(),
    address: (job.site_address ?? '').trim(),
    abn: '',
    source: 'person',
  }
}

export function payerSourceHint(source: PayerSource, matchesSeed: boolean): string {
  if (!matchesSeed) return 'Entered on this page.'
  if (source === 'account') return 'Taken from the trade account legal name and billing address.'
  if (source === 'organisation') return 'Taken from the organisation on the job. Enter the billing address.'
  return 'Taken from the client name. Confirm this is the address for the letter.'
}

function invoiceLabel(which: string, number: string): string {
  const trimmed = number.trim()
  return trimmed ? `${which} (${trimmed})` : which
}

/** Invoices the statement still shows a balance on. Paid invoices are omitted. */
export function overdueInvoiceOptions(statement: StatementOfAccountsCapture): OverdueInvoiceOption[] {
  const figures = statementFigures(statement)
  const options: OverdueInvoiceOption[] = []
  if (statement.invoice1_amount != null) {
    const remaining = figures.has_invoice2 ? figures.original_owing_inc : figures.owing_inc
    if (remaining > 0.004) {
      options.push({
        key: 'invoice1',
        label: invoiceLabel('Invoice 1', statement.original_invoice_number),
        remainingInc: remaining,
      })
    }
  }
  if (figures.has_invoice2 && figures.invoice2_owing_inc > 0.004) {
    options.push({
      key: 'invoice2',
      label: invoiceLabel('Invoice 2', statement.new_invoice_number),
      remainingInc: figures.invoice2_owing_inc,
    })
  }
  return options
}

function money(amount: number, chargesGst: boolean): string {
  return chargesGst ? `${formatAud(amount)} including GST` : formatAud(amount)
}

function dayCount(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}

function oneLine(value: string): string {
  return value.split('\n').map(part => part.trim()).filter(Boolean).join(', ')
}

function reminderParagraphs(draft: Omit<PaymentReminderDraft, 'paragraphs'>): string[] {
  const lateWord = draft.lateInvoices.length === 1 ? 'invoice is' : 'invoices are'
  const lines = [
    `This reminder refers to the Statement of Accounts for ${draft.siteAddress || 'the property'}.`,
    `The following ${lateWord} late.`,
    ...draft.lateInvoices.map(invoice =>
      `${invoice.label} is late by ${money(invoice.amountInc, draft.chargesGst)}. It was submitted on ${formatLongDate(invoice.submitted)} and the agreed payment due date was ${formatLongDate(invoice.due)}. It is ${dayCount(invoice.daysLate)} late.`,
    ),
    `The late balance is ${money(draft.lateTotalInc, draft.chargesGst)}.`,
    `Please pay that balance by ${formatLongDate(draft.payBy)}.`,
    `If the balance remains unpaid on ${formatLongDate(draft.demandOn)}, a letter of demand will be sent to ${draft.payerName} at ${oneLine(draft.payerAddress)}.`,
  ]
  if (draft.guarantor) {
    lines.push(
      `A letter of demand will also be sent to ${draft.guarantor.name}, who personally guaranteed this payment (${draft.guarantor.reference}), at ${oneLine(draft.guarantor.address)}.`,
    )
  }
  lines.push(
    `If the balance remains unpaid on ${formatLongDate(draft.finalOn)}, a final demand will be issued and legal action will be commenced to recover the debt.`,
  )
  return lines
}

export function paymentReminderResult(
  siteAddress: string,
  capture: PaymentOverdueCapture,
  statement: StatementOfAccountsCapture,
  today = todayIso(),
): PaymentReminderResult {
  const figures = statementFigures(statement)
  const options = overdueInvoiceOptions(statement)
  const byKey = new Map(options.map(option => [option.key, option]))
  const letterDate = capture.letter_date || today
  const issues: string[] = []
  const selected: Array<'invoice1' | 'invoice2'> = []
  if (capture.invoice1_late) selected.push('invoice1')
  if (capture.invoice2_late) selected.push('invoice2')
  if (selected.length === 0) {
    issues.push(options.length === 0
      ? 'The statement has no invoice balance to mark late.'
      : 'Mark which invoice is late.')
  }

  const lateInvoices: LateInvoiceLine[] = []
  for (const key of selected) {
    const option = byKey.get(key)
    const which = key === 'invoice1' ? 'Invoice 1' : 'Invoice 2'
    if (!option) {
      issues.push(`${which} has no balance on the statement.`)
      continue
    }
    const submitted = key === 'invoice1' ? capture.invoice1_submitted : capture.invoice2_submitted
    const due = key === 'invoice1' ? capture.invoice1_due : capture.invoice2_due
    if (!parseIsoDate(submitted)) issues.push(`Enter the date ${option.label} was submitted.`)
    if (!parseIsoDate(due)) issues.push(`Enter the agreed payment due date for ${option.label}.`)
    if (parseIsoDate(submitted) && parseIsoDate(due) && daysBetween(submitted, due)! < 0) {
      issues.push(`The agreed due date for ${option.label} is before the date it was submitted.`)
    }
    const late = parseIsoDate(due) && parseIsoDate(letterDate) ? daysBetween(due, letterDate) : null
    if (late != null && late <= 0) issues.push(`${option.label} is not late on the letter date.`)
    if (parseIsoDate(submitted) && parseIsoDate(due) && late != null && late > 0) {
      lateInvoices.push({
        key,
        label: option.label,
        submitted,
        due,
        daysLate: late,
        amountInc: option.remainingInc,
      })
    }
  }

  if (!parseIsoDate(letterDate)) issues.push('Enter the date of this letter.')
  if (!capture.payer_name.trim()) issues.push('Enter the contracted payer.')
  if (!capture.payer_address.trim()) issues.push('Enter the address the letter of demand will be sent to.')

  const guarantorBits = [capture.guarantor_name, capture.guarantor_address, capture.guarantee_reference]
  const guarantorStarted = guarantorBits.some(part => part.trim())
  if (guarantorStarted && guarantorBits.some(part => !part.trim())) {
    issues.push('Enter the guarantor’s name, address, and what the guarantee refers to.')
  }

  if (issues.length > 0) return { ok: false, issues }

  const payBy = addCalendarDays(letterDate, 14)!
  const demandOn = addCalendarDays(letterDate, 21)!
  const finalOn = addCalendarDays(letterDate, 28)!
  const lateTotalInc = Math.round(lateInvoices.reduce((sum, invoice) => sum + invoice.amountInc, 0) * 100) / 100
  const guarantor = guarantorStarted
    ? {
        name: capture.guarantor_name.trim(),
        address: capture.guarantor_address.trim(),
        reference: capture.guarantee_reference.trim(),
      }
    : null
  const base = {
    siteAddress: siteAddress.trim(),
    letterDate,
    payerName: capture.payer_name.trim(),
    payerAddress: capture.payer_address.trim(),
    payerAbn: capture.payer_abn.trim(),
    guarantor,
    statementLines: figures.lines,
    chargesGst: figures.gst_mode !== 'no_gst',
    lateInvoices,
    lateTotalInc,
    payBy,
    demandOn,
    finalOn,
  }
  return { ok: true, draft: { ...base, paragraphs: reminderParagraphs(base) } }
}

export function buildPaymentReminderContent(job: Job, reference: string): PaymentReminderContent {
  const capture = normalizePaymentOverdueCapture(job.assessment_data?.payment_overdue)
  const statement = normalizeStatementCapture(job.assessment_data?.statement_of_accounts)
  const result = paymentReminderResult(job.site_address || '', capture, statement)
  if (!result.ok) {
    return {
      title: 'Payment Reminder',
      reference,
      site_address: job.site_address || '',
      letter_date: capture.letter_date,
      payer_name: capture.payer_name,
      payer_address: capture.payer_address,
      payer_abn: capture.payer_abn,
      guarantor_name: '',
      guarantor_address: '',
      guarantee_reference: '',
      statement_lines: [],
      charges_gst: false,
      late_invoices: [],
      late_total_inc: 0,
      pay_by: '',
      demand_on: '',
      final_on: '',
      paragraphs: [],
      error: result.issues[0] ?? 'This reminder could not be generated.',
    }
  }
  const draft = result.draft
  return {
    title: 'Payment Reminder',
    reference,
    site_address: draft.siteAddress,
    letter_date: draft.letterDate,
    payer_name: draft.payerName,
    payer_address: draft.payerAddress,
    payer_abn: draft.payerAbn,
    guarantor_name: draft.guarantor?.name ?? '',
    guarantor_address: draft.guarantor?.address ?? '',
    guarantee_reference: draft.guarantor?.reference ?? '',
    statement_lines: draft.statementLines,
    charges_gst: draft.chargesGst,
    late_invoices: draft.lateInvoices.map(invoice => ({
      label: invoice.label,
      submitted: invoice.submitted,
      due: invoice.due,
      days_late: invoice.daysLate,
      amount_inc: invoice.amountInc,
    })),
    late_total_inc: draft.lateTotalInc,
    pay_by: draft.payBy,
    demand_on: draft.demandOn,
    final_on: draft.finalOn,
    paragraphs: draft.paragraphs,
    error: '',
  }
}
