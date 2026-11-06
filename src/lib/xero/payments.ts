/*
 * lib/xero/payments.ts
 *
 * What has been paid on the job's Xero invoice, for the Statement of Accounts
 * deposit. Read only: one GET of the invoice. Nothing is written to Xero.
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
