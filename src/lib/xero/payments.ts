/*
 * lib/xero/payments.ts
 *
 * What has been paid on the job's Xero invoice. Used twice:
 *   - jobInvoicePaid: the Statement of Accounts deposit.
 *   - jobPayState: the pay step on a client's signed document (status, what has
 *     been paid, and Xero's online pay link once the invoice is approved).
 * Read only. Nothing is written to Xero.
 */
import type { createServiceClient } from '@/lib/supabase'
import { loadXeroConnection, xeroConfigured, xeroRequest } from './client'

type Supabase = ReturnType<typeof createServiceClient>

export interface XeroInvoicePaid {
  invoice_number: string
  /** Total paid so far. */
  amount_paid: number
  /** YYYY-MM-DD of the latest payment. Null when Xero gives none. */
  paid_on: string | null
}

export type XeroDepositResult =
  | { connected: false }
  | { connected: true; invoice: XeroInvoicePaid | null }

interface XeroInvoiceBody {
  InvoiceNumber?: string
  AmountPaid?: number
  Payments?: { Date?: string; Amount?: number }[]
}

/** Xero dates come as "/Date(1730851200000+0000)/" or ISO. */
export function xeroDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim())
  if (iso) return iso[1]
  const ms = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(raw)
  if (!ms) return null
  const date = new Date(Number(ms[1]))
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

/** Null when nothing has been paid. */
export function invoicePaid(invoice: XeroInvoiceBody | null | undefined): XeroInvoicePaid | null {
  const paid = Math.round(Number(invoice?.AmountPaid ?? 0) * 100) / 100
  if (!invoice || !Number.isFinite(paid) || paid <= 0) return null
  const dates = (invoice.Payments ?? []).map(p => xeroDate(p.Date)).filter((d): d is string => d != null).sort()
  return { invoice_number: invoice.InvoiceNumber ?? '', amount_paid: paid, paid_on: dates.at(-1) ?? null }
}

// ── Pay step on the client's document link ───────────────────────────────────

export interface JobPayState {
  /** Xero is set up for the organisation. False means no invoice or card link will ever appear. */
  xeroConnected: boolean
  invoiceId: string | null
  invoiceNumber: string
  /** Xero's status (DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, DELETED). Empty when there is no invoice yet. */
  status: string
  /** Total paid so far on the job's invoice. */
  amountPaid: number
  /** YYYY-MM-DD of the latest payment. */
  paidOn: string | null
  /** Xero's online invoice, where the client can pay. Only exists once the invoice is approved. */
  payUrl: string | null
}

/** A client reloading or the page checking again must not call Xero every time. */
const PAY_CACHE_MS = 60_000
/** The client's page waits this long for Xero, then shows what was last known. */
const XERO_WAIT_MS = 5_000

/** Only a real Xero https address is ever given to a client as a pay link. */
export function xeroPayUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:') return null
    if (url.hostname !== 'xero.com' && !url.hostname.endsWith('.xero.com')) return null
    return url.toString()
  } catch {
    return null
  }
}

function waitFor<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Xero took too long to answer')), ms)
    work.then(
      value => { clearTimeout(timer); resolve(value) },
      err => { clearTimeout(timer); reject(err) },
    )
  })
}

/**
 * Where the job's Xero invoice is up to, for the pay step: its status, what has
 * been paid, and the online pay link once the invoice is approved. Read only;
 * nothing is written to Xero. The answer is kept on xero_job_invoices for a
 * minute. Never throws: if Xero cannot be reached, the last known answer is
 * returned, so the client still sees the amount and the bank details.
 */
export async function jobPayState(supabase: Supabase, orgId: string, jobId: string, now = new Date()): Promise<JobPayState> {
  const none = (xeroConnected: boolean): JobPayState => ({
    xeroConnected, invoiceId: null, invoiceNumber: '', status: '', amountPaid: 0, paidOn: null, payUrl: null,
  })
  if (!xeroConfigured()) return none(false)
  let conn: Awaited<ReturnType<typeof loadXeroConnection>>
  try {
    conn = await loadXeroConnection(supabase, orgId)
  } catch {
    return none(false)
  }
  if (!conn) return none(false)

  const { data } = await supabase
    .from('xero_job_invoices')
    .select('*')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  const row = data as Record<string, unknown> | null
  const invoiceId = typeof row?.xero_invoice_id === 'string' && row.xero_invoice_id ? row.xero_invoice_id : null
  if (!row || !invoiceId) return none(true)

  const known: JobPayState = {
    xeroConnected: true,
    invoiceId,
    invoiceNumber: typeof row.xero_invoice_number === 'string' ? row.xero_invoice_number : '',
    status: typeof row.xero_status === 'string' ? row.xero_status : '',
    amountPaid: Math.max(0, Math.round(Number(row.amount_paid ?? 0) * 100) / 100) || 0,
    paidOn: xeroDate(row.paid_on),
    payUrl: xeroPayUrl(row.online_invoice_url),
  }
  const checkedAt = typeof row.pay_checked_at === 'string' ? Date.parse(row.pay_checked_at) : NaN
  if (Number.isFinite(checkedAt) && now.getTime() - checkedAt < PAY_CACHE_MS) return known

  try {
    const res = await waitFor(
      xeroRequest<{ Invoices?: (XeroInvoiceBody & { Status?: string; AmountDue?: number })[] }>(
        supabase, conn, 'GET', `/Invoices/${encodeURIComponent(invoiceId)}`,
      ),
      XERO_WAIT_MS,
    )
    const invoice = res.Invoices?.[0]
    if (!invoice) return known
    const status = invoice.Status ?? known.status
    const paid = invoicePaid(invoice)

    // The pay link only exists for an approved invoice that still has something owing.
    let payUrl: string | null = null
    if (status === 'AUTHORISED') {
      payUrl = known.payUrl
      if (!payUrl) {
        const online = await waitFor(
          xeroRequest<{ OnlineInvoices?: { OnlineInvoiceUrl?: string }[] }>(
            supabase, conn, 'GET', `/Invoices/${encodeURIComponent(invoiceId)}/OnlineInvoice`,
          ),
          XERO_WAIT_MS,
        )
        payUrl = xeroPayUrl(online.OnlineInvoices?.[0]?.OnlineInvoiceUrl)
      }
    }

    const fresh: JobPayState = {
      xeroConnected: true,
      invoiceId,
      invoiceNumber: invoice.InvoiceNumber || known.invoiceNumber,
      status,
      amountPaid: paid?.amount_paid ?? 0,
      paidOn: paid?.paid_on ?? null,
      payUrl,
    }
    const { error } = await supabase
      .from('xero_job_invoices')
      .update({
        xero_status: fresh.status,
        xero_invoice_number: fresh.invoiceNumber,
        amount_paid: fresh.amountPaid,
        amount_due: typeof invoice.AmountDue === 'number' ? invoice.AmountDue : null,
        paid_on: fresh.paidOn,
        online_invoice_url: fresh.payUrl,
        pay_checked_at: now.toISOString(),
      })
      .eq('job_id', jobId)
      .eq('org_id', orgId)
    if (error) console.error('[xero] saving pay state failed', jobId, error.message)
    return fresh
  } catch (err) {
    console.error('[xero] reading pay state failed', jobId, err instanceof Error ? err.message : err)
    return known
  }
}

export async function jobInvoicePaid(supabase: Supabase, orgId: string, jobId: string): Promise<XeroDepositResult> {
  if (!xeroConfigured()) return { connected: false }
  const conn = await loadXeroConnection(supabase, orgId)
  if (!conn) return { connected: false }
  const { data } = await supabase
    .from('xero_job_invoices')
    .select('xero_invoice_id')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  const id = (data as { xero_invoice_id?: string | null } | null)?.xero_invoice_id
  if (!id) return { connected: true, invoice: null }
  const res = await xeroRequest<{ Invoices?: XeroInvoiceBody[] }>(supabase, conn, 'GET', `/Invoices/${encodeURIComponent(id)}`)
  return { connected: true, invoice: invoicePaid(res.Invoices?.[0]) }
}
