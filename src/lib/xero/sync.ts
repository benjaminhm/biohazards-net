/*
 * lib/xero/sync.ts
 *
 * Keeps one DRAFT ACCREC invoice in Xero per job, with one line per accepted
 * quote. Called (in after()) whenever a quote is accepted or an accepted quote
 * is saved again.
 *
 *   - No invoice yet: find or create the Xero contact, create the draft.
 *   - Invoice still DRAFT in Xero: replace its lines with the accepted quotes.
 *   - Invoice approved, paid or voided in Xero: change nothing, log a
 *     needs_review agent action so staff adjust it in Xero by hand.
 *
 * The invoice is only ever a draft; staff approve and send it from Xero
 * (and request the deposit there). Every Xero write is logged to agent_actions.
 * Never throws: failures are stored on the row and logged.
 */
import type { createServiceClient } from '@/lib/supabase'
import { logAgentAction } from '@/lib/agentActions'
import { isAcceptableQuoteType } from '@/lib/acceptableQuotes'
import { loadXeroConnection, xeroConfigured, xeroRequest, type XeroConnection } from '@/lib/xero/client'
import {
  buildInvoiceLines,
  contactFromJob,
  draftInvoiceBody,
  linesHash,
  xeroSettings,
  type AcceptedQuote,
  type ContactInput,
} from '@/lib/xero/invoice'

type Supabase = ReturnType<typeof createServiceClient>

export type XeroSyncTrigger = 'quote_accepted' | 'portal_quote_accepted' | 'quote_edited'

export type XeroSyncResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'created' | 'updated' | 'unchanged' | 'needs_review'; invoiceId: string }
  | { outcome: 'failed'; error: string }

const LOCK_MS = 120_000
const LOCK_WAIT_MS = 5_000
const LOCK_TRIES = 12

interface JobInvoiceRow {
  job_id: string
  xero_invoice_id: string | null
  xero_invoice_number: string
  xero_contact_id: string
  xero_status: string
  lines_hash: string
}

interface XeroInvoice {
  InvoiceID: string
  InvoiceNumber?: string
  Status: string
  Total?: number
  LineItems?: { Description?: string; Quantity?: number; UnitAmount?: number; LineAmount?: number }[]
}

interface XeroContact {
  ContactID: string
  Name?: string
  EmailAddress?: string
  ContactStatus?: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function acquireLock(supabase: Supabase, jobId: string, orgId: string): Promise<JobInvoiceRow | null> {
  await supabase
    .from('xero_job_invoices')
    .upsert({ job_id: jobId, org_id: orgId }, { onConflict: 'job_id', ignoreDuplicates: true })
  for (let i = 0; i < LOCK_TRIES; i++) {
    const now = new Date()
    const { data } = await supabase
      .from('xero_job_invoices')
      .update({ sync_lock_until: new Date(now.getTime() + LOCK_MS).toISOString() })
      .eq('job_id', jobId)
      .or(`sync_lock_until.is.null,sync_lock_until.lt."${now.toISOString()}"`)
      .select('job_id, xero_invoice_id, xero_invoice_number, xero_contact_id, xero_status, lines_hash')
    if (data?.length) return data[0] as JobInvoiceRow
    await sleep(LOCK_WAIT_MS)
  }
  return null
}

async function releaseLock(supabase: Supabase, jobId: string, patch: Record<string, unknown>) {
  await supabase
    .from('xero_job_invoices')
    .update({ ...patch, sync_lock_until: null, updated_at: new Date().toISOString() })
    .eq('job_id', jobId)
}

async function acceptedQuotes(supabase: Supabase, jobId: string): Promise<AcceptedQuote[]> {
  const { data: acceptances } = await supabase
    .from('quote_acceptances')
    .select('document_id, accepted_at')
    .eq('job_id', jobId)
    .not('document_id', 'is', null)
    .order('accepted_at', { ascending: true })
  const ids = [...new Set((acceptances ?? []).map(a => a.document_id as string))]
  if (!ids.length) return []
  const { data: docs } = await supabase.from('documents').select('id, type, content').in('id', ids)
  const byId = new Map((docs ?? []).map(d => [d.id as string, d]))
  return ids.flatMap(id => {
    const d = byId.get(id)
    if (!d || !isAcceptableQuoteType(d.type)) return []
    return [{ document_id: id, type: d.type as string, content: (d.content ?? {}) as Record<string, unknown> }]
  })
}

async function findOrCreateContact(
  supabase: Supabase,
  conn: XeroConnection,
  input: ContactInput,
  ctx: { orgId: string; jobId: string; trigger: XeroSyncTrigger },
): Promise<string> {
  const pick = (list: XeroContact[], match: (c: XeroContact) => boolean) =>
    list.find(c => match(c) && c.ContactStatus !== 'ARCHIVED') ?? list.find(match)

  for (const term of [input.email, input.name].filter(Boolean)) {
    const res = await xeroRequest<{ Contacts?: XeroContact[] }>(
      supabase, conn, 'GET', `/Contacts?searchTerm=${encodeURIComponent(term)}`,
    )
    const list = res.Contacts ?? []
    const lower = term.toLowerCase()
    const hit = term === input.email
      ? pick(list, c => (c.EmailAddress ?? '').toLowerCase() === lower)
      : pick(list, c => (c.Name ?? '').trim().toLowerCase() === lower)
    if (hit) return hit.ContactID
  }

  const contact: Record<string, unknown> = { Name: input.name }
  if (input.email) contact.EmailAddress = input.email
  if (input.phone) contact.Phones = [{ PhoneType: 'MOBILE', PhoneNumber: input.phone }]
  const created = await xeroRequest<{ Contacts?: XeroContact[] }>(
    supabase, conn, 'PUT', '/Contacts', { Contacts: [contact] },
    { idempotencyKey: `contact-${ctx.jobId}` },
  )
  const id = created.Contacts?.[0]?.ContactID
  if (!id) throw new Error('Xero did not return the new contact')
  await logAgentAction(supabase, {
    org_id: ctx.orgId,
    job_id: ctx.jobId,
    agent: 'xero_sync',
    trigger: ctx.trigger,
    action: 'xero_contact_created',
    target_table: 'xero:Contacts',
    target_id: id,
    after: contact,
    note: `Created Xero contact "${input.name}".`,
  })
  return id
}

const money = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function expectedTotal(quotes: AcceptedQuote[]): number | null {
  let sum = 0
  for (const q of quotes) {
    const t = Number(q.content.total)
    if (!Number.isFinite(t)) return null
    sum += t
  }
  return Math.round(sum * 100) / 100
}

function totalNote(invoice: XeroInvoice, quotes: AcceptedQuote[]): string {
  const expected = expectedTotal(quotes)
  if (expected == null || typeof invoice.Total !== 'number') return ''
  if (Math.abs(invoice.Total - expected) < 0.05) return ''
  return ` Xero total ${money(invoice.Total)} differs from the accepted quotes (${money(expected)}); check GST rounding.`
}

export async function syncJobInvoice(supabase: Supabase, jobId: string, trigger: XeroSyncTrigger): Promise<XeroSyncResult> {
  const { data: job } = await supabase
    .from('jobs')
    .select('id, org_id, job_code, client_name, client_organization_name, client_email, client_phone')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return { outcome: 'skipped', reason: 'job not found' }
  const orgId = job.org_id as string

  const quotes = await acceptedQuotes(supabase, jobId)
  if (!quotes.length) return { outcome: 'skipped', reason: 'no accepted quotes' }
  if (!xeroConfigured()) return { outcome: 'skipped', reason: 'Xero app keys not set' }
  const conn = await loadXeroConnection(supabase, orgId)
  if (!conn) return { outcome: 'skipped', reason: 'Xero not connected' }

  const row = await acquireLock(supabase, jobId, orgId)
  if (!row) return { outcome: 'skipped', reason: 'another sync is still running' }

  const settings = xeroSettings(conn.settings)
  const { lines, unpriced } = buildInvoiceLines(quotes, settings)
  const hash = linesHash(lines)
  const documentIds = quotes.map(q => q.document_id)
  const reference = (job.job_code as string | null)?.trim() || jobId.slice(0, 8)
  const unpricedNote = unpriced.length ? ` ${unpriced.length} accepted quote(s) have no total and were left off.` : ''
  const log = (action: string, extra: Partial<Parameters<typeof logAgentAction>[1]>) =>
    logAgentAction(supabase, {
      org_id: orgId,
      job_id: jobId,
      agent: 'xero_sync',
      trigger,
      action,
      target_table: 'xero:Invoices',
      ...extra,
    })

  try {
    if (!lines.length) {
      await releaseLock(supabase, jobId, { last_error: 'Accepted quotes have no totals' })
      await log('xero_invoice_skipped', { status: 'needs_review', note: `No invoice lines: the accepted quotes have no subtotal or total.` })
      return { outcome: 'skipped', reason: 'no priced quotes' }
    }

    if (!row.xero_invoice_id) {
      const contactId = row.xero_contact_id || await findOrCreateContact(supabase, conn, contactFromJob(job), { orgId, jobId, trigger })
      const body = draftInvoiceBody({ contactId, reference, lines, settings, now: new Date() })
      const res = await xeroRequest<{ Invoices?: XeroInvoice[] }>(
        supabase, conn, 'PUT', '/Invoices', { Invoices: [body] },
        { idempotencyKey: `invoice-${jobId}-${hash}` },
      )
      const inv = res.Invoices?.[0]
      if (!inv?.InvoiceID) throw new Error('Xero did not return the new invoice')
      await releaseLock(supabase, jobId, {
        xero_invoice_id: inv.InvoiceID,
        xero_invoice_number: inv.InvoiceNumber ?? '',
        xero_contact_id: contactId,
        xero_status: inv.Status,
        document_ids: documentIds,
        lines_hash: hash,
        total: inv.Total ?? null,
        last_error: '',
        last_synced_at: new Date().toISOString(),
      })
      await log('xero_invoice_created', {
        target_id: inv.InvoiceID,
        after: body,
        note: `Draft invoice ${inv.InvoiceNumber ?? ''} created in Xero for ${reference} with ${lines.length} line(s).${unpricedNote}${totalNote(inv, quotes)}`.replace(/\s+/g, ' ').trim(),
      })
      return { outcome: 'created', invoiceId: inv.InvoiceID }
    }

    const invoiceId = row.xero_invoice_id
    if (row.lines_hash === hash) {
      await releaseLock(supabase, jobId, { document_ids: documentIds })
      return { outcome: 'unchanged', invoiceId }
    }

    const current = (await xeroRequest<{ Invoices?: XeroInvoice[] }>(supabase, conn, 'GET', `/Invoices/${invoiceId}`)).Invoices?.[0]
    if (!current) throw new Error(`Invoice ${invoiceId} not found in Xero`)
    const before = current.LineItems?.map(l => ({ Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount })) ?? []
    const number = current.InvoiceNumber || row.xero_invoice_number

    if (current.Status !== 'DRAFT') {
      await releaseLock(supabase, jobId, { xero_status: current.Status, document_ids: documentIds, lines_hash: hash, last_synced_at: new Date().toISOString() })
      await log('xero_invoice_change_blocked', {
        target_id: invoiceId,
        status: 'needs_review',
        before,
        after: lines,
        note: `Accepted quotes on ${reference} changed after invoice ${number} was ${current.Status.toLowerCase()} in Xero, so it was not changed. Adjust it in Xero (or raise a credit note).${unpricedNote}`,
      })
      return { outcome: 'needs_review', invoiceId }
    }

    const res = await xeroRequest<{ Invoices?: XeroInvoice[] }>(
      supabase, conn, 'POST', `/Invoices/${invoiceId}`,
      { Invoices: [{ InvoiceID: invoiceId, LineAmountTypes: 'Exclusive', LineItems: lines }] },
    )
    const inv = res.Invoices?.[0] ?? current
    await releaseLock(supabase, jobId, {
      xero_status: inv.Status,
      xero_invoice_number: inv.InvoiceNumber ?? number,
      document_ids: documentIds,
      lines_hash: hash,
      total: inv.Total ?? null,
      last_error: '',
      last_synced_at: new Date().toISOString(),
    })
    await log('xero_invoice_updated', {
      target_id: invoiceId,
      before,
      after: lines,
      note: `Draft invoice ${number} lines replaced with ${lines.length} accepted quote(s).${unpricedNote}${totalNote(inv, quotes)}`,
    })
    return { outcome: 'updated', invoiceId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[xero] sync failed', jobId, message)
    await releaseLock(supabase, jobId, { last_error: message.slice(0, 1000) })
    await log('xero_sync_failed', { status: 'failed', target_id: row.xero_invoice_id ?? '', note: message.slice(0, 1000) })
    return { outcome: 'failed', error: message }
  }
}
