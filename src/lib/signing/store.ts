/*
 * lib/signing/store.ts
 *
 * Database and delivery work for signing requests: finding a request from the
 * client's link, building the signed copy, storing its PDF, and everything that
 * follows a signature (emails, job status, the pay step).
 *
 * A signature does not create the Xero invoice. Staff check the signed request
 * first and create the invoice from the quote in Documents (see
 * /api/signing/[id]); until then the client's page shows no payment details.
 *
 * Server only. The rules themselves are in core.ts; the fields in slots.ts.
 */
import twilio from 'twilio'
import type { createServiceClient } from '@/lib/supabase'
import { sendQuoteAcceptedEmail } from '@/lib/email'
import { openedAlertSms, type OpenedAlertInput } from '@/lib/signing/alerts'
import { formatToTwilioE164 } from '@/lib/phone'
import { jobPayState } from '@/lib/xero/payments'
import { loadBankDetails } from '@/lib/paymentDetails'
import { depositAmount, money, paymentReference, payStage, percentLabel, staffCheckNote } from '@/lib/signing/pay'
import type { PayPanel } from '@/lib/signing/pay'
import {
  docketHtml,
  hashSigningTokenSafe,
  insertAtBodyEnd,
  signedDateLabel,
} from '@/lib/signing/core'
import { readSignerDetails } from '@/lib/signing/details'
import { acceptedItems, itemLine, listLine } from '@/lib/signing/items'
import type { ItemDecision } from '@/lib/signing/items'
import { fillSignSlots } from '@/lib/signing/slots'
import { renderPdf } from '@/lib/signing/pdf'
import { sendSignedCopyEmail, sendSignedCopyToOfficeEmail, sendSigningDeclinedEmail, sendSigningOpenedEmail } from '@/lib/signing/email'

type ServiceClient = ReturnType<typeof createServiceClient>

export const SIGNED_BUCKET = 'signed-documents'

export interface SigningRequestRow {
  id: string
  org_id: string
  job_id: string
  document_id: string | null
  token_hash: string
  status: 'sent' | 'viewed' | 'signed' | 'declined' | 'voided'
  document_type: string
  document_title: string
  reference: string | null
  quote_total: number | null
  frozen_html: string
  doc_sha256: string
  trading_name: string | null
  brand_label: string
  from_address: string
  reply_to: string | null
  /** Null when staff sent the link themselves and gave no email. */
  to_email: string | null
  to_name: string
  subject: string
  message: string
  sent_at: string
  sent_by: string | null
  sent_by_name: string | null
  expires_at: string
  first_viewed_at: string | null
  consented_at: string | null
  signed_at: string | null
  signer_name: string | null
  /** What the signer gave on the Your details step (lib/signing/details.ts). Null on requests signed before that step. */
  signer_details: unknown
  signature_png: string | null
  signature_method: 'drawn' | 'typed' | null
  signer_ip: string | null
  signer_user_agent: string | null
  declined_at: string | null
  decline_reason: string | null
  voided_at: string | null
  voided_by: string | null
  signed_pdf_path: string | null
  delivered_at: string | null
  delivery_error: string | null
  /** email = the system emailed the link. link = staff sent the link and passcode themselves. */
  delivery_method: 'email' | 'link'
  passcode: string | null
  passcode_attempts: number
  passcode_verified_at: string | null
  passcode_locked_at: string | null
  /** Share of quote_total asked for on the pay step after signing. Null = no pay step. */
  deposit_percent: number | null
  /** When staff checked the signed request and created the invoice. Null = still waiting for that check. */
  invoice_confirmed_at: string | null
  invoice_confirmed_by: string | null
  /** The Xero contact the invoice was raised to at the check. */
  xero_contact_id: string | null
  /** Hash of the second link, made for the ready-to-pay message staff send. */
  pay_token_hash: string | null
}

/**
 * What the staff screens get. Leaves out the document HTML, the signature image
 * and the link hash: none are needed to show status, and the first two are big.
 * The passcode is included so staff can repeat it to the client.
 */
export const SIGNING_SUMMARY_COLUMNS =
  'id, job_id, document_id, status, document_type, document_title, reference, brand_label, from_address, reply_to, ' +
  'to_email, to_name, subject, message, sent_at, sent_by_name, expires_at, first_viewed_at, signed_at, signer_name, ' +
  'declined_at, decline_reason, voided_at, delivered_at, delivery_error, delivery_method, passcode, passcode_locked_at, ' +
  'quote_total, deposit_percent, invoice_confirmed_at, signer_details, xero_contact_id'

/**
 * A summary row as one member of staff may see it. Money, and what the signer
 * gave about themselves (date of birth, home address), are only for staff who
 * are shown money: they are the ones who do the check.
 */
export function staffSummary<T extends object>(row: T, financials: boolean): T {
  if (financials) return row
  const items = (row as { items?: SigningItemSummary[] }).items
  return {
    ...row,
    quote_total: null,
    signer_details: null,
    ...(items ? { items: items.map(i => ({ ...i, quote_total: null })) } : {}),
  }
}

export function documentLine(row: Pick<SigningRequestRow, 'document_title' | 'reference'>): string {
  return `${row.document_title}${row.reference ? ` ${row.reference}` : ''}`
}

// ── The quotes on a link ─────────────────────────────────────────────────────

/**
 * One quote on a link (signing_request_items). A link can carry several; the
 * client accepts or declines each and signs once. The quote's HTML is not
 * loaded with it (see loadItemHtml): it is large, and most callers need only
 * one quote's.
 */
export interface SigningItemRow {
  /** Null when the items table is not there yet and this was made from the request itself. */
  id: string | null
  request_id: string
  /** Order on the link, from 0. */
  position: number
  document_id: string | null
  document_type: string
  document_title: string
  reference: string | null
  /** Inc GST. */
  quote_total: number | null
  doc_sha256: string
  decision: ItemDecision
  signed_pdf_path: string | null
}

const ITEM_COLUMNS =
  'id, request_id, position, document_id, document_type, document_title, reference, quote_total, doc_sha256, decision, signed_pdf_path'

function decisionFromStatus(status: string): ItemDecision {
  return status === 'signed' ? 'accepted' : status === 'declined' ? 'declined' : 'pending'
}

/** A link's one quote, read from the request itself: how every link was stored before it could carry several. */
function itemFromRequest(row: SigningRequestRow): SigningItemRow {
  return {
    id: null,
    request_id: row.id,
    position: 0,
    document_id: row.document_id,
    document_type: row.document_type,
    document_title: row.document_title,
    reference: row.reference,
    quote_total: row.quote_total,
    doc_sha256: row.doc_sha256,
    decision: decisionFromStatus(row.status),
    signed_pdf_path: row.signed_pdf_path,
  }
}

/**
 * The quotes on a link, in order. Never empty and never throws: if the items
 * cannot be read (or the table is not there yet), the link has the one quote
 * held on the request.
 */
export async function loadItems(supabase: ServiceClient, row: SigningRequestRow): Promise<SigningItemRow[]> {
  const { data, error } = await supabase
    .from('signing_request_items')
    .select(ITEM_COLUMNS)
    .eq('request_id', row.id)
    .order('position', { ascending: true })
  const list = error ? [] : ((data ?? []) as unknown as SigningItemRow[])
  return list.length ? list : [itemFromRequest(row)]
}

/** One quote exactly as it was sent. */
export async function loadItemHtml(supabase: ServiceClient, row: SigningRequestRow, item: SigningItemRow): Promise<string> {
  if (!item.id) return row.frozen_html
  const { data, error } = await supabase.from('signing_request_items').select('frozen_html').eq('id', item.id).maybeSingle()
  const html = (data as { frozen_html?: string } | null)?.frozen_html
  if (error || !html) {
    // The first quote's HTML is also on the request.
    if (item.position === 0) return row.frozen_html
    throw new Error('The quote could not be loaded')
  }
  return html
}

/**
 * Write what the client chose for each quote. Called once, by whoever recorded
 * the signature (or the decline). False when it could not be saved.
 */
export async function saveDecisions(supabase: ServiceClient, items: SigningItemRow[], at: string): Promise<boolean> {
  for (const decision of ['accepted', 'declined'] as const) {
    const ids = items.filter(i => i.id && i.decision === decision).map(i => i.id as string)
    if (!ids.length) continue
    const { error } = await supabase
      .from('signing_request_items')
      .update({ decision, decided_at: at, updated_at: at })
      .in('id', ids)
    if (error) {
      console.error('[signing] saving the quote decisions failed', items[0]?.request_id, error.message)
      return false
    }
  }
  return true
}

/** What the staff screens are given about each quote on a link. */
export interface SigningItemSummary {
  position: number
  document_id: string | null
  document_title: string
  reference: string | null
  quote_total: number | null
  decision: ItemDecision
}

interface SummaryLike {
  id: string
  document_id: string | null
  document_title: string
  reference: string | null
  quote_total: number | null
  status: string
}

/** Summary rows with the quotes on each link. A link with no stored items has the one quote on the request. */
export async function withItemSummaries<T extends SummaryLike>(
  supabase: ServiceClient,
  requests: T[],
): Promise<(T & { items: SigningItemSummary[] })[]> {
  const byRequest = new Map<string, SigningItemSummary[]>()
  if (requests.length) {
    const { data, error } = await supabase
      .from('signing_request_items')
      .select('request_id, position, document_id, document_title, reference, quote_total, decision')
      .in('request_id', requests.map(r => r.id))
      .order('position', { ascending: true })
    if (!error) {
      for (const raw of (data ?? []) as unknown as (SigningItemSummary & { request_id: string })[]) {
        const { request_id, ...item } = raw
        byRequest.set(request_id, [...(byRequest.get(request_id) ?? []), item])
      }
    }
  }
  return requests.map(r => ({
    ...r,
    items: byRequest.get(r.id) ?? [{
      position: 0,
      document_id: r.document_id,
      document_title: r.document_title,
      reference: r.reference,
      quote_total: r.quote_total,
      decision: decisionFromStatus(r.status),
    }],
  }))
}

/**
 * Where the signer's own copy goes: the address the request was sent to, else
 * the email the signer gave in their details. Null only on a request sent by
 * text and signed before the Your details step.
 */
export function signerEmail(row: Pick<SigningRequestRow, 'to_email' | 'signer_details'>): string | null {
  return row.to_email || readSignerDetails(row.signer_details)?.email || null
}

export async function findSigningRequestByToken(
  supabase: ServiceClient,
  token: string,
): Promise<SigningRequestRow | null> {
  const hash = hashSigningTokenSafe(token)
  if (!hash) return null
  // A request can have two links: the one first sent, and the one in the
  // ready-to-pay message. The hash is hex, so it is safe inside the filter.
  const either = await supabase
    .from('signing_requests')
    .select('*')
    .or(`token_hash.eq.${hash},pay_token_hash.eq.${hash}`)
    .limit(1)
    .maybeSingle()
  if (!either.error) return (either.data as SigningRequestRow | null) ?? null
  // The second link's column is not there yet: the first link must still open.
  const { data } = await supabase.from('signing_requests').select('*').eq('token_hash', hash).maybeSingle()
  return (data as SigningRequestRow | null) ?? null
}

/**
 * A quote with the signer's signature, name and date in its fields. `html` is
 * the quote as it was sent (loadItemHtml); the one signature goes on every
 * quote the signer accepted, so the caller passes only accepted quotes.
 */
export function signedDocumentHtml(row: SigningRequestRow, html: string): string {
  if (row.status !== 'signed' || !row.signature_png || !row.signer_name || !row.signed_at) {
    throw new Error('This document has not been signed')
  }
  return fillSignSlots(html, {
    signaturePng: row.signature_png,
    name: row.signer_name,
    dateLabel: signedDateLabel(row.signed_at),
  })
}

/**
 * A signed quote followed by the signature docket: what the PDF is made from.
 * When the link carried several quotes the docket lists them all with what the
 * signer chose, and is the same on each signed copy.
 */
export function signedCopyHtml(row: SigningRequestRow, items: SigningItemRow[], item: SigningItemRow, html: string): string {
  const accepted = acceptedItems(items)
  return insertAtBodyEnd(
    signedDocumentHtml(row, html),
    docketHtml({
      requestId: row.id,
      brandLabel: row.brand_label,
      documentTitle: item.document_title,
      reference: item.reference,
      docSha256: item.doc_sha256,
      quotes: items.map(i => ({
        title: i.document_title,
        reference: i.reference,
        totalLabel: i.quote_total != null ? money(Number(i.quote_total)) : null,
        docSha256: i.doc_sha256,
        accepted: accepted.includes(i),
      })),
      fromAddress: row.from_address,
      sentByName: row.sent_by_name,
      toName: row.to_name,
      toEmail: row.to_email,
      deliveryMethod: row.delivery_method === 'link' ? 'link' : 'email',
      passcodeVerifiedAt: row.passcode_verified_at,
      signerName: row.signer_name!,
      details: readSignerDetails(row.signer_details),
      signatureMethod: row.signature_method ?? 'drawn',
      signaturePng: row.signature_png!,
      sentAt: row.sent_at,
      firstViewedAt: row.first_viewed_at,
      consentedAt: row.consented_at,
      signedAt: row.signed_at!,
      signerIp: row.signer_ip,
      signerUserAgent: row.signer_user_agent,
    }),
  )
}

export function signedPdfFilename(row: { document_title: string; reference: string | null }): string {
  const base = (row.reference?.trim() || row.document_title.trim() || 'Quote')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'Quote'} - signed.pdf`
}

/**
 * The signed PDF of one accepted quote: from storage when it is already there,
 * otherwise rendered now and stored. A signed copy can always be produced
 * again from the record, so a failed upload is logged and the PDF is still
 * returned. A declined quote has no signed copy.
 */
export async function ensureSignedPdf(
  supabase: ServiceClient,
  row: SigningRequestRow,
  items: SigningItemRow[],
  item: SigningItemRow,
): Promise<Buffer> {
  if (!acceptedItems(items).includes(item)) throw new Error('This quote was not accepted, so it has no signed copy')
  if (item.signed_pdf_path) {
    const { data } = await supabase.storage.from(SIGNED_BUCKET).download(item.signed_pdf_path)
    if (data) return Buffer.from(await data.arrayBuffer())
  }
  const html = await loadItemHtml(supabase, row, item)
  const pdf = await renderPdf(signedCopyHtml(row, items, item, html))
  // A link with one quote keeps the path it always had.
  const name = items.length === 1 ? row.id : `${row.id}-${item.position + 1}`
  const path = `${row.org_id}/${row.job_id}/${name}.pdf`
  const { error } = await supabase.storage
    .from(SIGNED_BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (error) {
    console.error('[signing] storing signed PDF failed', row.id, error.message)
  } else if (item.signed_pdf_path !== path) {
    if (item.id) await supabase.from('signing_request_items').update({ signed_pdf_path: path }).eq('id', item.id)
    if (items.length === 1) await supabase.from('signing_requests').update({ signed_pdf_path: path }).eq('id', row.id)
  }
  return pdf
}

/** Attachment names for several signed copies: two quotes with the same reference must not collide. */
function attachmentNames(items: { document_title: string; reference: string | null }[]): string[] {
  const seen = new Map<string, number>()
  return items.map(item => {
    const name = signedPdfFilename(item)
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    return count === 1 ? name : name.replace(/\.pdf$/, ` (${count}).pdf`)
  })
}

/**
 * Email the signed copy to the client, with the brand inbox on BCC. It goes to
 * the address the request was sent to, else to the email the signer gave in
 * their details. With neither (a link sent by text, signed before the Your
 * details step), it goes to the office inbox to pass on. If the PDF cannot be made, the email still goes with a
 * download link when there is one, so nobody is left with nothing. The outcome
 * is written on the row so staff can see a copy that did not go and send it
 * again.
 *
 * `links` are the client's own addresses, known only at the moment of signing
 * (the link is never stored). With them, the email also names the deposit that
 * comes next, when one was asked for. A later re-send by staff passes null: it
 * has no link to give, and the deposit may have been paid since.
 */
export async function deliverSignedCopy(
  supabase: ServiceClient,
  row: SigningRequestRow,
  links: { page: string; pdf: string } | null,
): Promise<{ ok: true; attached: boolean } | { ok: false; error: string }> {
  const items = await loadItems(supabase, row)
  const accepted = acceptedItems(items)
  const declined = items.filter(i => !accepted.includes(i))
  const signedLine = listLine(accepted.map(itemLine)) || documentLine(row)
  // With several signed copies, the client's page is where each can be downloaded.
  const downloadUrl = links ? (accepted.length > 1 ? links.page : links.pdf) : null
  const due = depositAmount(row.quote_total, row.deposit_percent)
  const deposit = links && due != null && row.deposit_percent != null
    ? { amountLabel: money(due), percentLabel: percentLabel(Number(row.deposit_percent)) }
    : null
  const names = attachmentNames(accepted)
  const pdfs: { filename: string; content: Buffer }[] = []
  let pdfError = ''
  for (const [i, item] of accepted.entries()) {
    try {
      pdfs.push({ filename: names[i], content: await ensureSignedPdf(supabase, row, items, item) })
    } catch (err) {
      pdfError = err instanceof Error ? err.message : 'PDF could not be made'
      console.error('[signing] signed PDF failed', row.id, item.position, err)
    }
  }
  // Every signed copy, or none: an email with one of two attached would read as complete.
  const complete = accepted.length > 0 && pdfs.length === accepted.length
  const attached = complete ? pdfs : []

  const fail = async (error: string) => {
    await supabase
      .from('signing_requests')
      .update({ delivery_error: error.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', row.id)
    return { ok: false as const, error }
  }

  if (!complete && !downloadUrl) return fail(`Signed PDF could not be made: ${pdfError || 'no accepted quote found'}`)

  const office = row.reply_to || process.env.NOTIFY_EMAIL || null
  const copyTo = signerEmail(row)
  const notes: string[] = []
  try {
    if (copyTo) {
      const sent = await sendSignedCopyEmail({
        from: row.from_address,
        replyTo: row.reply_to,
        to: copyTo,
        bcc: office,
        toName: row.signer_name || row.to_name,
        brandLabel: row.brand_label,
        documentLine: signedLine,
        declinedLine: listLine(declined.map(itemLine)),
        signedCount: Math.max(1, accepted.length),
        pdfs: attached,
        downloadUrl,
        deposit,
      })
      if (sent.usedSharedAddress) {
        notes.push(`Sent under the ${row.brand_label} name from the shared address, because the brand address was refused.`)
      }
    } else {
      if (!office) return fail('There is no client email on this request and no office inbox set to send the signed copy to.')
      await sendSignedCopyToOfficeEmail({
        to: office,
        brandLabel: row.brand_label,
        jobId: row.job_id,
        documentLine: signedLine,
        signerName: row.signer_name || row.to_name,
        pdfs: attached,
      })
      notes.push(`No client email was given, so the signed copy went to ${office} to pass on.`)
    }
  } catch (err) {
    console.error('[signing] signed copy email failed', row.id, err)
    return fail(err instanceof Error ? err.message : 'Email could not be sent')
  }

  if (!complete) notes.push(`The PDF could not be attached (${pdfError}); a download link was sent instead.`)
  await supabase
    .from('signing_requests')
    .update({
      delivered_at: new Date().toISOString(),
      delivery_error: notes.length ? notes.join(' ').slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
  return { ok: true, attached: complete }
}

const POST_ACCEPTANCE = new Set(['accepted', 'scheduled', 'underway', 'completed', 'report_sent', 'paid'])

/**
 * A signature is an acceptance: record it the same way the quote link and the
 * portal do, so the job moves to Accepted. The Xero invoice is built from these
 * records, but only once staff have checked the signed request.
 * One record for each quote the signer accepted, and none for a quote they
 * declined, so a declined quote is never invoiced.
 * `recorded` is false when every accepted quote already had an acceptance on file.
 */
export async function recordAcceptance(
  supabase: ServiceClient,
  row: SigningRequestRow,
  accepted: SigningItemRow[],
): Promise<{ recorded: boolean; jobType: string; siteAddress: string }> {
  const { data: job } = await supabase
    .from('jobs')
    .select('id, status, client_email, job_type, site_address')
    .eq('id', row.job_id)
    .maybeSingle()

  let recorded = false
  for (const item of accepted) {
    if (!item.document_id) continue
    const { error } = await supabase.from('quote_acceptances').insert({
      org_id: row.org_id,
      account_id: null,
      contact_id: null,
      job_id: row.job_id,
      document_id: item.document_id,
      contact_name: row.signer_name || row.to_name,
      contact_email: signerEmail(row) ?? '',
      quote_total: item.quote_total,
      quote_reference: item.reference || item.document_title,
      terms_version: 'e-signature',
      ip: (row.signer_ip ?? '').slice(0, 100),
      user_agent: (row.signer_user_agent ?? '').slice(0, 500),
    })
    if (!error) recorded = true
    else if (!(error.code === '23505' || /duplicate key/i.test(error.message))) {
      console.error('[signing] recording acceptance failed', row.id, item.position, error.message)
    }
  }

  if (job && !POST_ACCEPTANCE.has(job.status as string)) {
    await supabase
      .from('jobs')
      .update({
        status: 'accepted',
        updated_at: new Date().toISOString(),
        ...(row.to_email && !(job.client_email as string | null)?.trim() ? { client_email: row.to_email } : {}),
      })
      .eq('id', row.job_id)
  }

  return {
    recorded,
    jobType: (job?.job_type as string | null) ?? '',
    siteAddress: (job?.site_address as string | null) ?? '',
  }
}

/**
 * Everything slow that follows a signature. Run it with after(), not in the
 * response. The signed copy goes to the client and staff are told to check it.
 * Nothing is sent to Xero here: the invoice is created by a person, after the
 * check. Neither step throws.
 */
export async function afterSigned(
  supabase: ServiceClient,
  row: SigningRequestRow,
  items: SigningItemRow[],
  info: { jobType: string; siteAddress: string },
  links: { page: string; pdf: string },
): Promise<void> {
  await Promise.all([
    deliverSignedCopy(supabase, row, links).catch(err => {
      console.error('[signing] signed copy failed', row.id, err)
    }),
    tellStaffSigned(row, items, info),
  ])
}

/**
 * The staff alert. `items` are the quotes on the link with what the signer
 * chose; the total on the row is already the total of the accepted ones.
 */
async function tellStaffSigned(
  row: SigningRequestRow,
  items: SigningItemRow[],
  info: { jobType: string; siteAddress: string },
): Promise<void> {
  const clientName = row.signer_name || row.to_name
  const accepted = acceptedItems(items)
  const declined = items.filter(i => !accepted.includes(i))
  const reference = listLine(accepted.map(i => i.reference || i.document_title)) || row.reference || row.document_title
  const declinedNote = declined.length
    ? ` Declined on the same link, and not to be invoiced: ${listLine(declined.map(itemLine))}.`
    : ''
  try {
    await sendQuoteAcceptedEmail({
      jobId: row.job_id,
      clientName,
      siteAddress: info.siteAddress,
      jobType: info.jobType,
      reference,
      total: row.quote_total ?? 0,
      contactEmail: signerEmail(row) ?? undefined,
      checkNote: staffCheckNote(row.quote_total, row.deposit_percent) + declinedNote,
    })
  } catch (err) {
    console.error('[signing] staff email failed', row.id, err)
  }

  const total = row.quote_total == null
    ? ''
    : ` $${Number(row.quote_total).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`
  const due = depositAmount(row.quote_total, row.deposit_percent)
  const depositText = due != null && row.deposit_percent != null
    ? ` Deposit to ask for ${money(due)} (${percentLabel(Number(row.deposit_percent))}).`
    : ''
  await staffSms(
    row.id,
    `Quote signed: ${clientName}${row.to_email ? ` (${row.to_email})` : ''} — ${reference}${total}${info.siteAddress ? ` — ${info.siteAddress}` : ''}.${declined.length ? ` Declined: ${listLine(declined.map(i => i.reference || i.document_title))}.` : ''}${depositText} Not invoiced yet: check it and create the invoice. ${jobUrl(row.job_id)}`,
  )
}

function jobUrl(jobId: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net').replace(/\/+$/, '')}/jobs/${jobId}`
}

/** A text to the notify phone. Skipped when Twilio or the phone is not set up. Never throws. */
async function staffSms(rowId: string, body: string): Promise<void> {
  const notifyPhone = process.env.NOTIFY_PHONE?.trim()
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const fromNum = process.env.TWILIO_PHONE_NUMBER?.trim()
  const to = notifyPhone ? formatToTwilioE164(notifyPhone) : null
  if (!(sid && authToken && fromNum && to)) return
  try {
    await twilio(sid, authToken).messages.create({ from: fromNum, to, body })
  } catch (err) {
    console.error('[signing] staff sms failed', rowId, err)
  }
}

/**
 * Tell the team the first time a client opens their link: a text to the notify
 * phone and an email to the brand's reply address (else the notify address).
 * Called once per link, by the request that recorded the first view.
 */
export async function afterOpened(supabase: ServiceClient, row: SigningRequestRow): Promise<void> {
  const [items, job] = await Promise.all([
    loadItems(supabase, row).catch(() => [] as SigningItemRow[]),
    supabase.from('jobs').select('site_address').eq('id', row.job_id).maybeSingle(),
  ])
  const alert: OpenedAlertInput = {
    clientName: row.to_name,
    clientEmail: row.to_email,
    documentLine: listLine(items.map(i => i.reference || i.document_title)) || documentLine(row),
    total: row.quote_total == null ? null : Number(row.quote_total),
    siteAddress: ((job.data as { site_address?: string | null } | null)?.site_address ?? '').trim(),
    jobUrl: jobUrl(row.job_id),
  }
  const to = row.reply_to || process.env.NOTIFY_EMAIL
  await Promise.all([
    to
      ? sendSigningOpenedEmail({ to, brandLabel: row.brand_label, ...alert }).catch(err => {
          console.error('[signing] opened notice failed', row.id, err)
        })
      : Promise.resolve(),
    staffSms(row.id, openedAlertSms(alert)),
  ])
}

// ── Pay step ─────────────────────────────────────────────────────────────────

/**
 * What the pay step shows for a signed request: the deposit, whether the
 * client may be shown how to pay yet (staff have checked it and the invoice is
 * approved in Xero), the bank details from Settings, and what has been paid.
 * Null when the request is not signed or no deposit was asked for. Never
 * throws; Xero being unreachable only means the invoice is as last known.
 */
export async function loadPayPanel(supabase: ServiceClient, row: SigningRequestRow): Promise<PayPanel | null> {
  const deposit = depositAmount(row.quote_total, row.deposit_percent)
  if (row.status !== 'signed' || deposit == null || row.deposit_percent == null || row.quote_total == null) return null

  const [bank, pay, items, signed] = await Promise.all([
    loadBankDetails(supabase, row.org_id),
    jobPayState(supabase, row.org_id, row.job_id),
    loadItems(supabase, row),
    supabase
      .from('signing_requests')
      .select('quote_total, deposit_percent')
      .eq('org_id', row.org_id)
      .eq('job_id', row.job_id)
      .eq('status', 'signed'),
  ])

  // Payments land on the job's one invoice, so "received" is measured against
  // the deposits of every signed quote on the job, not just this one.
  const others = (signed.data ?? []) as { quote_total: number | null; deposit_percent: number | null }[]
  const summed = others.reduce((sum, r) => sum + (depositAmount(r.quote_total, r.deposit_percent) ?? 0), 0)
  const jobDeposits = Math.round(Math.max(summed, deposit) * 100) / 100

  // A voided or deleted invoice is no longer something to pay or to count.
  const live = pay.status !== 'VOIDED' && pay.status !== 'DELETED'
  const stage = payStage({
    confirmed: Boolean(row.invoice_confirmed_at),
    xeroConnected: pay.xeroConnected,
    invoiceStatus: pay.status,
  })
  return {
    brandLabel: row.brand_label,
    stage,
    percent: Number(row.deposit_percent),
    deposit,
    total: Number(row.quote_total),
    // The reference of a quote they accepted: it is on the signed copy they hold.
    reference: paymentReference(
      acceptedItems(items).find(i => i.reference?.trim())?.reference ?? row.reference,
      row.signer_name || row.to_name,
    ),
    bank: bank.details,
    cardUrl: live ? pay.payUrl : null,
    invoiceNumber: live ? pay.invoiceNumber : '',
    paid: live ? pay.amountPaid : 0,
    paidOn: live ? pay.paidOn : null,
    jobDeposits,
  }
}

/** Tell the team a client declined the link: every quote on it. */
export async function afterDeclined(row: SigningRequestRow, items: SigningItemRow[]): Promise<void> {
  const to = row.reply_to || process.env.NOTIFY_EMAIL
  if (!to) return
  try {
    await sendSigningDeclinedEmail({
      to,
      brandLabel: row.brand_label,
      jobId: row.job_id,
      documentLine: listLine(items.map(itemLine)) || documentLine(row),
      clientName: row.to_name,
      clientEmail: row.to_email,
      reason: row.decline_reason,
    })
  } catch (err) {
    console.error('[signing] declined notice failed', row.id, err)
  }
}
