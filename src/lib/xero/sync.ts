/*
 * lib/xero/sync.ts
 *
 * Keeps one DRAFT ACCREC invoice in Xero per job, with one line per accepted
 * quote. Called when staff confirm a signed document link, when a quote is
 * accepted from the emailed accept box or the trade portal, and when an
 * accepted quote is saved again.
 *
 * A quote signed on a document link is not invoiced by the signature. A person
 * checks who signed and what they accepted first, then creates the invoice
 * (trigger 'staff_confirmed'). Until then the job's invoice is held: no other
 * trigger creates or changes it.
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
  staffCheckHold,
  xeroContactBody,
  xeroSettings,
  type AcceptedQuote,
  type ContactInput,
  type SignedLink,
} from '@/lib/xero/invoice'

type Supabase = ReturnType<typeof createServiceClient>

export type XeroSyncTrigger = 'quote_accepted' | 'portal_quote_accepted' | 'quote_edited' | 'staff_confirmed'

/**
 * Who the invoice is made out to, as staff chose at the check: a contact
 * already in Xero, or a new one created from the signer's details (`key` makes
 * a repeated press create it once).
 */
export type ContactChoice = { use: string } | { create: ContactInput; key: string }

export interface XeroSyncOptions {
  /** With 'staff_confirmed': the signed document link staff have just checked. */
  requestId?: string
  /**
   * With 'staff_confirmed': the contact staff chose. Left out, a new invoice
   * goes to the contact found or made from the job's client, as before, and an
   * existing invoice keeps the contact it has.
   */
  contact?: ContactChoice
}

/** Why a sync was skipped while a signed link waits for its staff check. */
export const AWAITING_STAFF_CHECK = 'awaiting staff check'

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

/**
 * The signed document links on a job, and whether each has had its staff check.
 * If this cannot be read, nothing is held: the caller carries on as it did
 * before links had a check.
 */
async function signedLinks(supabase: Supabase, jobId: string): Promise<SignedLink[]> {
  const { data, error } = await supabase
    .from('signing_requests')
    .select('id, document_id, invoice_confirmed_at')
    .eq('job_id', jobId)
    .eq('status', 'signed')
  if (error) {
    console.error('[xero] reading signed links failed', jobId, error.message)
    return []
  }
  const links = (data ?? []) as { id: string; document_id: string | null; invoice_confirmed_at: string | null }[]
  // A link can carry several quotes; the ones it accepted are its quotes. A
  // link with no stored quotes has the one on the request itself.
  const accepted = new Map<string, string[]>()
  if (links.length) {
    const { data: items, error: itemsError } = await supabase
      .from('signing_request_items')
      .select('request_id, document_id, decision')
      .in('request_id', links.map(l => l.id))
    if (!itemsError) {
      const rows = (items ?? []) as { request_id: string; document_id: string | null; decision: string }[]
      const counts = new Map<string, number>()
      for (const item of rows) counts.set(item.request_id, (counts.get(item.request_id) ?? 0) + 1)
      for (const item of rows) {
        // On a link with one quote, signing is accepting it.
        const isAccepted = item.decision === 'accepted' || (counts.get(item.request_id) === 1 && item.decision !== 'declined')
        const list = accepted.get(item.request_id) ?? []
        if (isAccepted && item.document_id) list.push(item.document_id)
        accepted.set(item.request_id, list)
      }
    }
  }
  return links.map(r => ({
    id: r.id,
    confirmed: Boolean(r.invoice_confirmed_at),
    documentIds: accepted.get(r.id) ?? (r.document_id ? [r.document_id] : []),
  }))
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
  return createContact(supabase, conn, input, `contact-${ctx.jobId}`, ctx)
}

async function createContact(
  supabase: Supabase,
  conn: XeroConnection,
  input: ContactInput,
  idempotencyKey: string,
  ctx: { orgId: string; jobId: string; trigger: XeroSyncTrigger },
): Promise<string> {
  const contact = xeroContactBody(input)
  let created: { Contacts?: XeroContact[] }
  try {
    created = await xeroRequest<{ Contacts?: XeroContact[] }>(
      supabase, conn, 'PUT', '/Contacts', { Contacts: [contact] }, { idempotencyKey },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Xero keeps contact names unique, so a second "create new" with a name it has is refused.
    if (/already assigned to another contact/i.test(message)) {
      throw new Error(`Xero already has a contact named "${input.name}". Choose that contact instead of creating a new one`)
    }
    throw err
  }
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

/** The contact staff chose at the check: one already in Xero, or a new one made now. */
async function chosenContact(
  supabase: Supabase,
  conn: XeroConnection,
  choice: ContactChoice,
  ctx: { orgId: string; jobId: string; trigger: XeroSyncTrigger },
): Promise<string> {
  if ('use' in choice) return choice.use
  return createContact(supabase, conn, choice.create, `contact-${choice.key}`, ctx)
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

export async function syncJobInvoice(
  supabase: Supabase,
  jobId: string,
  trigger: XeroSyncTrigger,
  options: XeroSyncOptions = {},
): Promise<XeroSyncResult> {
  const { data: job } = await supabase
    .from('jobs')
    .select('id, org_id, job_code, client_name, client_organization_name, client_email, client_phone')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return { outcome: 'skipped', reason: 'job not found' }
  const orgId = job.org_id as string

  // A signed link waiting for its staff check holds the invoice.
  const check = staffCheckHold(
    await signedLinks(supabase, jobId),
    trigger === 'staff_confirmed' ? options.requestId ?? '' : null,
  )
  if (check.hold) return { outcome: 'skipped', reason: AWAITING_STAFF_CHECK }

  const quotes = (await acceptedQuotes(supabase, jobId)).filter(q => !check.leaveOut.includes(q.document_id))
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

    const ctx = { orgId, jobId, trigger }
    const chosen = options.contact
    if (!row.xero_invoice_id) {
      const contactId = chosen
        ? await chosenContact(supabase, conn, chosen, ctx)
        : row.xero_contact_id || await findOrCreateContact(supabase, conn, contactFromJob(job), ctx)
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
    const linesSame = row.lines_hash === hash
    // Choosing the contact the invoice already has changes nothing.
    const contactSame = !chosen || ('use' in chosen && chosen.use === row.xero_contact_id)
    if (linesSame && contactSame) {
      await releaseLock(supabase, jobId, { document_ids: documentIds })
      return { outcome: 'unchanged', invoiceId }
    }

    const current = (await xeroRequest<{ Invoices?: XeroInvoice[] }>(supabase, conn, 'GET', `/Invoices/${invoiceId}`)).Invoices?.[0]
    if (!current) throw new Error(`Invoice ${invoiceId} not found in Xero`)
    const before = current.LineItems?.map(l => ({ Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount })) ?? []
    const number = current.InvoiceNumber || row.xero_invoice_number

    if (current.Status !== 'DRAFT') {
      await releaseLock(supabase, jobId, { xero_status: current.Status, document_ids: documentIds, lines_hash: hash, last_synced_at: new Date().toISOString() })
      const what = linesSame ? 'A different contact was chosen for' : 'Accepted quotes changed on'
      await log('xero_invoice_change_blocked', {
        target_id: invoiceId,
        status: 'needs_review',
        before,
        after: lines,
        note: `${what} ${reference} after invoice ${number} was ${current.Status.toLowerCase()} in Xero, so it was not changed. Adjust it in Xero (or raise a credit note).${unpricedNote}`,
      })
      return { outcome: 'needs_review', invoiceId }
    }

    // Only now, with a draft that can take it, is a new contact made in Xero.
    const contactId = contactSame || !chosen ? null : await chosenContact(supabase, conn, chosen, ctx)
    const res = await xeroRequest<{ Invoices?: XeroInvoice[] }>(
      supabase, conn, 'POST', `/Invoices/${invoiceId}`,
      { Invoices: [{
        InvoiceID: invoiceId,
        ...(contactId ? { Contact: { ContactID: contactId } } : {}),
        LineAmountTypes: 'Exclusive',
        LineItems: lines,
      }] },
    )
    const inv = res.Invoices?.[0] ?? current
    await releaseLock(supabase, jobId, {
      xero_status: inv.Status,
      xero_invoice_number: inv.InvoiceNumber ?? number,
      ...(contactId ? { xero_contact_id: contactId } : {}),
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
      note: `Draft invoice ${number} ${linesSame ? 'kept its lines' : `lines replaced with ${lines.length} accepted quote(s)`}${contactId ? ' and is now made out to the contact chosen at the check' : ''}.${unpricedNote}${totalNote(inv, quotes)}`,
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
