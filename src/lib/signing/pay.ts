/*
 * lib/signing/pay.ts
 *
 * The rules for the pay step that follows a signature: how much the deposit
 * is, what bank details may be saved, when the client may be shown how to pay,
 * and when a deposit counts as received. No database or network in here, so it
 * can be tested directly.
 *
 * Signing does not open the pay step. A person checks the signed request and
 * creates the invoice, sets the deposit and approves it in Xero; only then are
 * card and bank transfer shown, together.
 *
 * The app takes no payments itself. The client pays by bank transfer, or by
 * card on Xero's own invoice page, and what has been paid is read from Xero.
 */

/** What every quote's payment terms ask for today. Staff can change it per link. */
export const DEFAULT_DEPOSIT_PERCENT = 50

/** Amounts within half a cent are the same amount. */
const CENT = 0.005

export type DepositPercentResult =
  | { ok: true; percent: number | null }
  | { ok: false; error: string }

/** The deposit percentage staff chose. Empty or 0 means no pay step. */
export function parseDepositPercent(value: unknown): DepositPercentResult {
  if (value == null || value === '') return { ok: true, percent: null }
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { ok: false, error: 'Enter the deposit as a percentage between 1 and 100, or leave it empty for no deposit.' }
  }
  const percent = Math.round(n * 100) / 100
  return { ok: true, percent: percent > 0 ? percent : null }
}

/** The deposit in dollars and cents, or null when there is nothing to ask for. */
export function depositAmount(total: unknown, percent: unknown): number | null {
  const t = Number(total)
  const p = Number(percent)
  if (total == null || percent == null || !Number.isFinite(t) || !Number.isFinite(p) || t <= 0 || p <= 0) return null
  const amount = Math.round(t * p) / 100
  return amount > 0 ? amount : null
}

export function money(n: number): string {
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function percentLabel(percent: number): string {
  return `${Number(percent.toFixed(2))}%`
}

/** "2026-11-12" as "12 November 2026". Empty when it is not a date. */
export function longDate(isoDay: string | null | undefined): string {
  if (!isoDay || !/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) return ''
  const d = new Date(`${isoDay}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * What staff do next, for the signed alert. Nothing is invoiced by the
 * signature itself: a person checks it first.
 */
export function staffCheckNote(total: unknown, percent: unknown): string {
  const next = 'Nothing has been invoiced yet. Open the job, check who signed and what they accepted on the quote in Documents, then create the invoice from there.'
  const due = depositAmount(total, percent)
  if (due == null) return next
  return `${next} Deposit to ask for: ${money(due)} (${percentLabel(Number(percent))}). The client sees no payment details until the invoice is approved in Xero.`
}

// ── When the client may be shown how to pay ──────────────────────────────────

/**
 *   preparing  waiting for the staff check, or for the invoice to be approved
 *              in Xero: the client is told it is being prepared, and is shown
 *              no payment details
 *   ready      card and bank transfer are shown together
 *   contact    the invoice was voided or deleted in Xero: the brand follows up
 */
export type PayStage = 'preparing' | 'ready' | 'contact'

export function payStage(input: {
  /** Staff have checked the signed request. */
  confirmed: boolean
  xeroConnected: boolean
  /** Xero's invoice status; empty when there is no invoice. */
  invoiceStatus: string
}): PayStage {
  if (!input.confirmed) return 'preparing'
  // Without Xero there is no invoice to wait for: the check alone opens the pay step.
  if (!input.xeroConnected) return 'ready'
  if (input.invoiceStatus === 'VOIDED' || input.invoiceStatus === 'DELETED') return 'contact'
  if (input.invoiceStatus === 'AUTHORISED' || input.invoiceStatus === 'PAID') return 'ready'
  return 'preparing'
}

// ── What staff see under a signed quote ──────────────────────────────────────

/** Where the job's Xero invoice is up to, as the staff screens are given it. */
export interface StaffInvoiceView {
  xeroConnected: boolean
  number: string
  /** Xero's status: DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, DELETED. Empty when there is no invoice. */
  status: string
  amountPaid: number
  paidOn: string | null
  payLinkLive: boolean
}

export interface SignedNext {
  /** One line: where it is up to and what to do next. Empty when there is nothing to say. */
  text: string
  tone: 'plain' | 'todo' | 'good'
  /** The staff check has not been done: show it. */
  needsCheck: boolean
  /** Checked and Xero is connected, but there is no invoice: offer to create it. */
  canCreateInvoice: boolean
  /** The client can pay now: offer the ready-to-pay message. */
  canSendPayMessage: boolean
}

/**
 * The one next step on a signed request, in order: check it and create the
 * invoice, set the deposit and approve it in Xero, tell the client they can
 * pay, deposit received. `invoice` is null for staff who are not shown money.
 */
export function signedNext(input: {
  confirmed: boolean
  total: number | null
  percent: number | null
  invoice: StaffInvoiceView | null
}): SignedNext {
  const none = { tone: 'plain' as const, needsCheck: false, canCreateInvoice: false, canSendPayMessage: false }
  const { invoice } = input
  if (!invoice) {
    return { ...none, text: input.confirmed ? '' : 'Waiting for the office to check this and create the invoice.' }
  }
  const due = depositAmount(input.total, input.percent)
  const asked = due != null ? `${money(due)} (${percentLabel(Number(input.percent))})` : ''
  if (!input.confirmed) {
    return {
      ...none,
      tone: 'todo',
      needsCheck: true,
      text: `Not invoiced yet. Check who signed and what they accepted, then ${invoice.xeroConnected ? 'create the invoice in Xero' : 'mark it as checked'}.${asked ? ' The client sees no payment details until then.' : ''}`,
    }
  }
  const name = invoice.number ? `invoice ${invoice.number}` : 'the invoice'
  const Name = name[0].toUpperCase() + name.slice(1)
  if (!invoice.xeroConnected) {
    return {
      ...none,
      canSendPayMessage: due != null,
      text: asked
        ? `Checked. Deposit asked: ${asked}. Xero is not connected, so there is no invoice; the client's page shows the bank details.`
        : 'Checked. Xero is not connected, so no invoice was created.',
    }
  }
  if (invoice.status === 'VOIDED' || invoice.status === 'DELETED') {
    return { ...none, text: `${Name} was voided in Xero${asked ? ", so the client's page shows no way to pay" : ''}.` }
  }
  if (due != null && invoice.amountPaid >= due - CENT) {
    const on = invoice.paidOn ? ` (${invoice.paidOn.split('-').reverse().join('/')})` : ''
    return { ...none, tone: 'good', text: `Deposit received: ${money(invoice.amountPaid)} paid on ${name}${on}. Asked for ${asked}.` }
  }
  if (invoice.status === 'PAID') return { ...none, tone: 'good', text: `${Name} is paid in full.` }
  if (!invoice.status || invoice.status === 'CLAIMED') {
    return { ...none, tone: 'todo', canCreateInvoice: true, text: 'Checked, but the Xero invoice has not been created yet.' }
  }
  if (invoice.status === 'AUTHORISED') {
    if (due == null) return { ...none, text: `${Name} is approved in Xero.` }
    const received = invoice.amountPaid > CENT ? `${money(invoice.amountPaid)} received so far.` : 'Nothing received yet.'
    return {
      ...none,
      canSendPayMessage: true,
      text: `Deposit asked: ${asked}. ${Name} is approved, and the client's page now shows how to pay${invoice.payLinkLive ? ', by card or bank transfer' : ''}. ${received}`,
    }
  }
  return {
    ...none,
    tone: 'todo',
    text: due != null
      ? `Deposit to ask for: ${asked}. Next: in Xero, set the deposit request to ${percentLabel(Number(input.percent))} on draft ${name} and approve it. The client's page then shows how to pay.`
      : `Draft ${name} is in Xero. Approve it there when you are ready.`,
  }
}

// ── Bank details ─────────────────────────────────────────────────────────────

export interface BankDetails {
  accountName: string
  /** Six digits, written 123-456. */
  bsb: string
  /** Digits only. */
  accountNumber: string
}

export type BankDetailsResult =
  | { ok: true; details: BankDetails | null }
  | { ok: false; error: string }

/**
 * Bank details as an admin typed them. All three empty clears them; otherwise
 * all three are needed, so a client is never shown half an account.
 */
export function cleanBankDetails(input: unknown): BankDetailsResult {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '')
  const accountName = text(o.accountName)
  const bsbDigits = text(o.bsb).replace(/[\s-]/g, '')
  const accountDigits = text(o.accountNumber).replace(/[\s-]/g, '')
  if (!accountName && !bsbDigits && !accountDigits) return { ok: true, details: null }
  if (accountName.length < 2 || accountName.length > 80) return { ok: false, error: 'Enter the account name (up to 80 characters).' }
  if (!/^\d{6}$/.test(bsbDigits)) return { ok: false, error: 'The BSB is six digits, for example 064-000.' }
  if (!/^\d{4,10}$/.test(accountDigits)) return { ok: false, error: 'The account number is 4 to 10 digits.' }
  return {
    ok: true,
    details: { accountName, bsb: `${bsbDigits.slice(0, 3)}-${bsbDigits.slice(3)}`, accountNumber: accountDigits },
  }
}

/**
 * What the client writes on a bank transfer. The quote's own reference, which
 * is printed on the document they hold; their name when the quote has none.
 * Never the job's 4-digit code: that code is what the photo capture page takes,
 * so it is not something to hand to a client. Banks cut long references, so it
 * is kept to 18 characters.
 */
export function paymentReference(reference: string | null | undefined, signerName: string | null | undefined): string {
  const tidy = (s: string | null | undefined) => (s ?? '').replace(/[^A-Za-z0-9 ./-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (tidy(reference) || tidy(signerName).toUpperCase() || 'DEPOSIT').slice(0, 18).trim()
}

// ── What the client's pay step shows ─────────────────────────────────────────

export interface PayPanel {
  brandLabel: string
  /** Whether the client may be shown how to pay yet. */
  stage: PayStage
  percent: number
  /** This quote's deposit, inc GST. */
  deposit: number
  /** This quote's total, inc GST. */
  total: number
  /** What the client puts on a bank transfer so it can be matched. */
  reference: string
  /** Null until an admin saves bank details in Settings. */
  bank: BankDetails | null
  /** Xero's online invoice. Null until the invoice is approved in Xero. */
  cardUrl: string | null
  invoiceNumber: string
  /** Paid so far on the job's invoice in Xero. */
  paid: number
  /** YYYY-MM-DD of the latest payment. */
  paidOn: string | null
  /**
   * Deposits asked for across every signed quote on the job. Payments land on
   * the job's one invoice, so that is what "received" is measured against.
   */
  jobDeposits: number
}

/** True once Xero shows at least the deposits asked for on this job as paid. */
export function depositSettled(p: Pick<PayPanel, 'paid' | 'jobDeposits'>): boolean {
  return p.paid > CENT && p.paid >= p.jobDeposits - CENT
}

/**
 * Part of this quote's deposit has arrived. Only stated when this is the only
 * signed quote on the job; with several, one invoice total cannot say which
 * quote a part payment was for.
 */
export function depositPartPaid(p: Pick<PayPanel, 'paid' | 'jobDeposits' | 'deposit'>): { received: number; remaining: number } | null {
  if (p.paid <= CENT || depositSettled(p)) return null
  if (Math.abs(p.jobDeposits - p.deposit) > CENT) return null
  return { received: p.paid, remaining: Math.round((p.deposit - p.paid) * 100) / 100 }
}
