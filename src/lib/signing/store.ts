/*
 * lib/signing/store.ts
 *
 * Database and delivery work for signing requests: finding a request from the
 * client's link, building the signed copy, storing its PDF, and everything that
 * follows a signature (emails, job status, Xero).
 *
 * Server only. The rules themselves are in core.ts; the fields in slots.ts.
 */
import twilio from 'twilio'
import type { createServiceClient } from '@/lib/supabase'
import { sendQuoteAcceptedEmail } from '@/lib/email'
import { formatToTwilioE164 } from '@/lib/phone'
import { syncJobInvoice } from '@/lib/xero/sync'
import {
  docketHtml,
  hashSigningTokenSafe,
  insertAtBodyEnd,
  signedDateLabel,
} from '@/lib/signing/core'
import { fillSignSlots } from '@/lib/signing/slots'
import { renderPdf } from '@/lib/signing/pdf'
import { sendSignedCopyEmail, sendSignedCopyToOfficeEmail, sendSigningDeclinedEmail } from '@/lib/signing/email'

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
}

/**
 * What the staff screens get. Leaves out the document HTML, the signature image
 * and the link hash: none are needed to show status, and the first two are big.
 * The passcode is included so staff can repeat it to the client.
 */
export const SIGNING_SUMMARY_COLUMNS =
  'id, job_id, document_id, status, document_type, document_title, reference, brand_label, from_address, reply_to, ' +
  'to_email, to_name, subject, message, sent_at, sent_by_name, expires_at, first_viewed_at, signed_at, signer_name, ' +
  'declined_at, decline_reason, voided_at, delivered_at, delivery_error, delivery_method, passcode, passcode_locked_at'

export function documentLine(row: Pick<SigningRequestRow, 'document_title' | 'reference'>): string {
  return `${row.document_title}${row.reference ? ` ${row.reference}` : ''}`
}

export async function findSigningRequestByToken(
  supabase: ServiceClient,
  token: string,
): Promise<SigningRequestRow | null> {
  const hash = hashSigningTokenSafe(token)
  if (!hash) return null
  const { data } = await supabase.from('signing_requests').select('*').eq('token_hash', hash).maybeSingle()
  return (data as SigningRequestRow | null) ?? null
}

/** The document with the signer's signature, name and date in its fields. */
export function signedDocumentHtml(row: SigningRequestRow): string {
  if (row.status !== 'signed' || !row.signature_png || !row.signer_name || !row.signed_at) {
    throw new Error('This document has not been signed')
  }
  return fillSignSlots(row.frozen_html, {
    signaturePng: row.signature_png,
    name: row.signer_name,
    dateLabel: signedDateLabel(row.signed_at),
  })
}

/** The signed document followed by its signature docket: what the PDF is made from. */
export function signedCopyHtml(row: SigningRequestRow): string {
  return insertAtBodyEnd(
    signedDocumentHtml(row),
    docketHtml({
      requestId: row.id,
      brandLabel: row.brand_label,
      documentTitle: row.document_title,
      reference: row.reference,
      docSha256: row.doc_sha256,
      fromAddress: row.from_address,
      sentByName: row.sent_by_name,
      toName: row.to_name,
      toEmail: row.to_email,
      deliveryMethod: row.delivery_method === 'link' ? 'link' : 'email',
      passcodeVerifiedAt: row.passcode_verified_at,
      signerName: row.signer_name!,
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

export function signedPdfFilename(row: Pick<SigningRequestRow, 'document_title' | 'reference'>): string {
  const base = (row.reference?.trim() || row.document_title.trim() || 'Quote')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'Quote'} - signed.pdf`
}

/**
 * The signed PDF: from storage when it is already there, otherwise rendered now
 * and stored. A signed copy can always be produced again from the row, so a
 * failed upload is logged and the PDF is still returned.
 */
export async function ensureSignedPdf(supabase: ServiceClient, row: SigningRequestRow): Promise<Buffer> {
  if (row.signed_pdf_path) {
    const { data } = await supabase.storage.from(SIGNED_BUCKET).download(row.signed_pdf_path)
    if (data) return Buffer.from(await data.arrayBuffer())
  }
  const pdf = await renderPdf(signedCopyHtml(row))
  const path = `${row.org_id}/${row.job_id}/${row.id}.pdf`
  const { error } = await supabase.storage
    .from(SIGNED_BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (error) {
    console.error('[signing] storing signed PDF failed', row.id, error.message)
  } else if (row.signed_pdf_path !== path) {
    await supabase.from('signing_requests').update({ signed_pdf_path: path }).eq('id', row.id)
  }
  return pdf
}

/**
 * Email the signed copy to the client, with the brand inbox on BCC. With no
 * client email on the request (a link sent by text), it goes to the office
 * inbox to pass on. If the PDF cannot be made, the email still goes with a
 * download link when there is one, so nobody is left with nothing. The outcome
 * is written on the row so staff can see a copy that did not go and send it
 * again.
 */
export async function deliverSignedCopy(
  supabase: ServiceClient,
  row: SigningRequestRow,
  downloadUrl: string | null,
): Promise<{ ok: true; attached: boolean } | { ok: false; error: string }> {
  let pdf: Buffer | null = null
  let pdfError = ''
  try {
    pdf = await ensureSignedPdf(supabase, row)
  } catch (err) {
    pdfError = err instanceof Error ? err.message : 'PDF could not be made'
    console.error('[signing] signed PDF failed', row.id, err)
  }

  const fail = async (error: string) => {
    await supabase
      .from('signing_requests')
      .update({ delivery_error: error.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', row.id)
    return { ok: false as const, error }
  }

  if (!pdf && !downloadUrl) return fail(`Signed PDF could not be made: ${pdfError}`)

  const office = row.reply_to || process.env.NOTIFY_EMAIL || null
  const notes: string[] = []
  try {
    if (row.to_email) {
      const sent = await sendSignedCopyEmail({
        from: row.from_address,
        replyTo: row.reply_to,
        to: row.to_email,
        bcc: office,
        toName: row.signer_name || row.to_name,
        brandLabel: row.brand_label,
        documentLine: documentLine(row),
        pdf,
        pdfFilename: signedPdfFilename(row),
        downloadUrl,
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
        documentLine: documentLine(row),
        signerName: row.signer_name || row.to_name,
        pdf,
        pdfFilename: signedPdfFilename(row),
      })
      notes.push(`No client email was given, so the signed copy went to ${office} to pass on.`)
    }
  } catch (err) {
    console.error('[signing] signed copy email failed', row.id, err)
    return fail(err instanceof Error ? err.message : 'Email could not be sent')
  }

  if (!pdf) notes.push(`The PDF could not be attached (${pdfError}); a download link was sent instead.`)
  await supabase
    .from('signing_requests')
    .update({
      delivered_at: new Date().toISOString(),
      delivery_error: notes.length ? notes.join(' ').slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
  return { ok: true, attached: Boolean(pdf) }
}

const POST_ACCEPTANCE = new Set(['accepted', 'scheduled', 'underway', 'completed', 'report_sent', 'paid'])

/**
 * A signature is an acceptance: record it the same way the quote link and the
 * portal do, so the job moves to Accepted and its Xero invoice is built from it.
 * Returns false when this document already had an acceptance on file.
 */
export async function recordAcceptance(
  supabase: ServiceClient,
  row: SigningRequestRow,
): Promise<{ recorded: boolean; jobType: string; siteAddress: string }> {
  const { data: job } = await supabase
    .from('jobs')
    .select('id, status, client_email, job_type, site_address')
    .eq('id', row.job_id)
    .maybeSingle()

  let recorded = false
  if (row.document_id) {
    const { error } = await supabase.from('quote_acceptances').insert({
      org_id: row.org_id,
      account_id: null,
      contact_id: null,
      job_id: row.job_id,
      document_id: row.document_id,
      contact_name: row.signer_name || row.to_name,
      contact_email: row.to_email ?? '',
      quote_total: row.quote_total,
      quote_reference: row.reference || row.document_title,
      terms_version: 'e-signature',
      ip: (row.signer_ip ?? '').slice(0, 100),
      user_agent: (row.signer_user_agent ?? '').slice(0, 500),
    })
    if (!error) recorded = true
    else if (!(error.code === '23505' || /duplicate key/i.test(error.message))) {
      console.error('[signing] recording acceptance failed', row.id, error.message)
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

/** Everything slow that follows a signature. Run it with after(), not in the response. */
export async function afterSigned(
  supabase: ServiceClient,
  row: SigningRequestRow,
  info: { jobType: string; siteAddress: string },
  downloadUrl: string,
): Promise<void> {
  await deliverSignedCopy(supabase, row, downloadUrl)

  const clientName = row.signer_name || row.to_name
  const reference = row.reference || row.document_title
  try {
    await sendQuoteAcceptedEmail({
      jobId: row.job_id,
      clientName,
      siteAddress: info.siteAddress,
      jobType: info.jobType,
      reference,
      total: row.quote_total ?? 0,
      contactEmail: row.to_email ?? undefined,
    })
  } catch (err) {
    console.error('[signing] staff email failed', row.id, err)
  }

  const notifyPhone = process.env.NOTIFY_PHONE?.trim()
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const fromNum = process.env.TWILIO_PHONE_NUMBER?.trim()
  const to = notifyPhone ? formatToTwilioE164(notifyPhone) : null
  if (sid && authToken && fromNum && to) {
    const money = row.quote_total == null
      ? ''
      : ` $${Number(row.quote_total).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`
    try {
      await twilio(sid, authToken).messages.create({
        from: fromNum,
        to,
        body: `Quote signed: ${clientName}${row.to_email ? ` (${row.to_email})` : ''} — ${reference}${money}${info.siteAddress ? ` — ${info.siteAddress}` : ''}.`,
      })
    } catch (err) {
      console.error('[signing] staff sms failed', row.id, err)
    }
  }

  try {
    await syncJobInvoice(supabase, row.job_id, 'quote_accepted')
  } catch (err) {
    console.error('[signing] xero sync failed', row.id, err)
  }
}

/** Tell the team a client declined. */
export async function afterDeclined(row: SigningRequestRow): Promise<void> {
  const to = row.reply_to || process.env.NOTIFY_EMAIL
  if (!to) return
  try {
    await sendSigningDeclinedEmail({
      to,
      brandLabel: row.brand_label,
      jobId: row.job_id,
      documentLine: documentLine(row),
      clientName: row.to_name,
      clientEmail: row.to_email,
      reason: row.decline_reason,
    })
  } catch (err) {
    console.error('[signing] declined notice failed', row.id, err)
  }
}
