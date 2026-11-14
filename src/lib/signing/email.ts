/*
 * lib/signing/email.ts
 *
 * The emails around sending a quote for signature.
 *
 * Per docs/ai-product-principles.md there are two kinds here and they are kept
 * apart:
 *   - The invitation is staff-composed. A person reads and edits the wording in
 *     the send window and presses Send; nothing here writes it for them.
 *   - The signed copy and the declined notice are transactional: fixed wording,
 *     triggered by what the client did.
 * No AI is involved in any of them.
 */
import { openedAlertSubject, openedAlertText, type OpenedAlertInput } from '@/lib/signing/alerts'
import { Resend } from 'resend'
import { messageToHtml } from '@/lib/signing/core'

const resend = new Resend(process.env.RESEND_API_KEY)

interface SendPayload {
  from: string
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string
  bcc?: string
  attachments?: { filename: string; content: Buffer }[]
}

/** Resend reports a rejected send in `error` rather than throwing, so check it. */
async function send(payload: SendPayload): Promise<void> {
  const { error } = await resend.emails.send(payload)
  if (error) {
    throw new Error(`${error.name ?? 'Resend error'}: ${error.message ?? 'send rejected'}`)
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function shell(brandLabel: string, heading: string, body: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
      <div style="border-top: 4px solid #FF6B35; padding-top: 24px; margin-bottom: 28px;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FF6B35; margin-bottom: 6px;">
          ${esc(brandLabel)}
        </div>
        <h1 style="font-size: 22px; font-weight: 700; color: #111; margin: 0;">${esc(heading)}</h1>
      </div>
      ${body}
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #aaa;">
        ${esc(brandLabel)}
      </div>
    </div>
  `
}

function button(href: string, label: string): string {
  return `
    <a href="${esc(href)}" style="display: inline-block; background: #FF6B35; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 8px;">
      ${esc(label)} &rarr;
    </a>
  `
}

export interface SigningInviteEmail {
  from: string
  replyTo: string | null
  to: string
  subject: string
  /** Written or approved by the staff member in the send window. */
  message: string
  brandLabel: string
  documentLine: string
  signUrl: string
  expiresLabel: string
}

export async function sendSigningInviteEmail(data: SigningInviteEmail): Promise<void> {
  const html = shell(
    data.brandLabel,
    data.documentLine,
    `
      ${messageToHtml(data.message)}
      <div style="margin: 24px 0 0;">${button(data.signUrl, 'View document')}</div>
      <p style="font-size: 13px; color: #555; line-height: 1.6; margin: 24px 0 0; word-break: break-all;">
        If the button does not work, copy this link into your browser:<br>${esc(data.signUrl)}
      </p>
      <p style="font-size: 13px; color: #777; line-height: 1.6; margin: 16px 0 0;">
        This link is private to you, so please do not forward it. It can be used until ${esc(data.expiresLabel)}.
      </p>
    `,
  )
  const text = [
    data.message.trim(),
    '',
    `View your document: ${data.signUrl}`,
    '',
    `This link is private to you, so please do not forward it. It can be used until ${data.expiresLabel}.`,
    '',
    data.brandLabel,
  ].join('\n')

  await send({
    from: data.from,
    to: data.to,
    subject: data.subject,
    html,
    text,
    ...(data.replyTo ? { replyTo: data.replyTo } : {}),
  })
}

export interface SignedCopyEmail {
  from: string
  replyTo: string | null
  to: string
  /** The brand inbox gets the same email, so the signed copy is filed there too. */
  bcc: string | null
  toName: string
  brandLabel: string
  /** What was signed: one quote, or each accepted quote ("A and B"). */
  documentLine: string
  /** Quotes on the same link that the signer declined. Empty when there were none. */
  declinedLine: string
  /** How many quotes were signed. */
  signedCount: number
  /** One signed PDF for each accepted quote. Empty when they could not be made. */
  pdfs: { filename: string; content: Buffer }[]
  /** Used when the PDFs could not be attached. */
  downloadUrl: string | null
  /**
   * The deposit that comes next. The email only names it: nothing can be paid
   * until staff have checked the signed document and approved the invoice, and
   * a person tells the client when that is. Null when no deposit was asked
   * for, or when this is a later re-send (it may have been paid since).
   */
  deposit: { amountLabel: string; percentLabel: string } | null
}

/**
 * The signed copy is the client's record, so it must not be lost to a sending
 * problem. If the brand's own address is refused (its domain is not verified
 * with the mail provider), it is sent once more under the same brand name from
 * the shared address, with replies still going to the brand inbox. The
 * invitation never does this: there a person approved the From line they saw.
 */
export async function sendSignedCopyEmail(data: SignedCopyEmail): Promise<{ usedSharedAddress: boolean }> {
  const first = data.toName.trim().split(/\s+/)[0] || 'there'
  const hasPdf = data.pdfs.length > 0
  const several = data.signedCount > 1
  const docket = several
    ? 'The last page of each is the signature docket, which records when and how it was signed and what you chose for each quote.'
    : 'The last page is the signature docket, which records when and how it was signed.'
  const where = hasPdf
    ? `${several ? 'Your signed copies are attached to this email as PDFs, one for each quote you accepted.' : 'Your signed copy is attached to this email as a PDF.'} ${docket}`
    : `You can download your signed ${several ? 'copies' : 'copy'} using the button below. ${docket}`
  const declinedLine = data.declinedLine
    ? `Not signed, because you declined: ${data.declinedLine}.`
    : ''
  const depositLine = data.deposit
    ? `The next step is your deposit of ${data.deposit.amountLabel} (${data.deposit.percentLabel}). There is nothing to pay yet: we are checking the details and preparing your invoice, and will let you know when it is ready.`
    : ''
  const closing = data.deposit
    ? 'If you have any questions, just reply to this email.'
    : 'We will be in touch about next steps. If you have any questions, just reply to this email.'
  const html = shell(
    data.brandLabel,
    'Signed copy for your records',
    `
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
        Hi ${esc(first)}, thank you for signing <strong>${esc(data.documentLine)}</strong>.
      </p>
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">${esc(where)}</p>
      ${!hasPdf && data.downloadUrl ? `<div style="margin: 8px 0 16px;">${button(data.downloadUrl, several ? 'Download signed copies' : 'Download signed copy')}</div>` : ''}
      ${declinedLine ? `
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
        ${esc(declinedLine)}
      </p>` : ''}
      ${data.deposit ? `
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
        ${esc(depositLine)}
      </p>` : ''}
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0;">
        ${esc(closing)}
      </p>
    `,
  )
  const text = [
    `Hi ${first}, thank you for signing ${data.documentLine}.`,
    '',
    where,
    ...(!hasPdf && data.downloadUrl ? ['', data.downloadUrl] : []),
    ...(declinedLine ? ['', declinedLine] : []),
    ...(data.deposit ? ['', depositLine] : []),
    '',
    closing,
    '',
    data.brandLabel,
  ].join('\n')

  const payload = {
    to: data.to,
    subject: `Signed: ${data.documentLine}`,
    html,
    text,
    ...(data.replyTo ? { replyTo: data.replyTo } : {}),
    ...(data.bcc && data.bcc.toLowerCase() !== data.to.toLowerCase() ? { bcc: data.bcc } : {}),
    ...(hasPdf ? { attachments: data.pdfs } : {}),
  }
  try {
    await send({ from: data.from, ...payload })
    return { usedSharedAddress: false }
  } catch (err) {
    const shared = `${data.brandLabel} <${sharedAddress()}>`
    if (shared === data.from) throw err
    console.error('[signing] brand address refused, using the shared address', err)
    await send({ from: shared, ...payload })
    return { usedSharedAddress: true }
  }
}

function sharedAddress(): string {
  return process.env.RESEND_FROM_ACCOUNTS || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
}

/**
 * Internal: the signed copy for the office to pass on, when the link was sent
 * by text and there is no client email to send it to. Not sent to the client.
 */
export async function sendSignedCopyToOfficeEmail(data: {
  to: string
  brandLabel: string
  jobId: string
  documentLine: string
  signerName: string
  /** One signed PDF for each accepted quote. Empty when they could not be made. */
  pdfs: { filename: string; content: Buffer }[]
}): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const where = data.pdfs.length
    ? 'The signed copy is attached. No client email was given when the link was created, so it has not been emailed to them.'
    : 'No client email was given when the link was created, so the signed copy has not been emailed to them. The PDF could not be attached; download it from the quote in Documents.'
  const html = shell(
    data.brandLabel,
    'Quote signed',
    `
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
        ${esc(data.signerName)} signed <strong>${esc(data.documentLine)}</strong>.
      </p>
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 24px;">${esc(where)}</p>
      ${button(`${appUrl}/jobs/${data.jobId}`, 'Open job')}
    `,
  )
  await send({
    from: `biohazards.net <${sharedAddress()}>`,
    to: data.to,
    subject: `Signed: ${data.documentLine} — ${data.signerName}`,
    html,
    text: `${data.signerName} signed ${data.documentLine}.\n\n${where}\n\n${appUrl}/jobs/${data.jobId}`,
    ...(data.pdfs.length ? { attachments: data.pdfs } : {}),
  })
}

/** Internal notice to the team the first time a client opens their link. Not sent to the client. */
export async function sendSigningOpenedEmail(data: { to: string; brandLabel: string } & OpenedAlertInput): Promise<void> {
  const total = data.total == null
    ? ''
    : ` (${data.total.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })} inc GST)`
  const who = `${data.clientName.trim() || 'The client'}${data.clientEmail ? ` (${data.clientEmail})` : ''}`
  const html = shell(
    data.brandLabel,
    'Quote opened',
    `
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
        ${esc(who)} opened <strong>${esc(data.documentLine)}</strong>${esc(total)}. It is not signed yet.
      </p>
      ${data.siteAddress ? `<p style="font-size: 14px; color: #555; margin: 0 0 24px;">${esc(data.siteAddress)}</p>` : ''}
      ${button(data.jobUrl, 'Open job')}
    `,
  )
  await send({
    from: `biohazards.net <${sharedAddress()}>`,
    to: data.to,
    subject: openedAlertSubject(data),
    html,
    text: openedAlertText(data),
  })
}

/** Internal notice to the team when a client declines. Not sent to the client. */
export async function sendSigningDeclinedEmail(data: {
  to: string
  brandLabel: string
  jobId: string
  documentLine: string
  clientName: string
  clientEmail: string | null
  reason: string | null
}): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const fromEmail = sharedAddress()
  const reason = data.reason?.trim() || 'No reason given.'
  const who = `${data.clientName}${data.clientEmail ? ` (${data.clientEmail})` : ''}`
  const html = shell(
    data.brandLabel,
    'Quote declined',
    `
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
        ${esc(who)} declined to sign <strong>${esc(data.documentLine)}</strong>.
      </p>
      <div style="background: #f9f9f9; border-radius: 10px; padding: 16px 20px; margin-bottom: 24px; font-size: 14px; color: #333; line-height: 1.6; white-space: pre-wrap;">${esc(reason)}</div>
      ${button(`${appUrl}/jobs/${data.jobId}`, 'Open job')}
    `,
  )
  await send({
    from: `biohazards.net <${fromEmail}>`,
    to: data.to,
    subject: `Quote declined — ${data.clientName} — ${data.documentLine}`,
    html,
    text: `${who} declined to sign ${data.documentLine}.\n\n${reason}\n\n${appUrl}/jobs/${data.jobId}`,
  })
}
