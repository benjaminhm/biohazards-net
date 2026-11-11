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
      <div style="margin: 24px 0 0;">${button(data.signUrl, 'Review and sign')}</div>
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
    `Review and sign: ${data.signUrl}`,
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
  documentLine: string
  pdf: Buffer | null
  pdfFilename: string
  /** Used when the PDF could not be attached. */
  downloadUrl: string | null
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
  const where = data.pdf
    ? 'Your signed copy is attached to this email as a PDF. The last page is the signature docket, which records when and how it was signed.'
    : 'You can download your signed copy using the button below. The last page is the signature docket, which records when and how it was signed.'
  const html = shell(
    data.brandLabel,
    'Signed copy for your records',
    `
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
        Hi ${esc(first)}, thank you for signing <strong>${esc(data.documentLine)}</strong>.
      </p>
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">${esc(where)}</p>
      ${!data.pdf && data.downloadUrl ? `<div style="margin: 8px 0 16px;">${button(data.downloadUrl, 'Download signed copy')}</div>` : ''}
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0;">
        We will be in touch about next steps. If you have any questions, just reply to this email.
      </p>
    `,
  )
  const text = [
    `Hi ${first}, thank you for signing ${data.documentLine}.`,
    '',
    where,
    ...(!data.pdf && data.downloadUrl ? ['', data.downloadUrl] : []),
    '',
    'We will be in touch about next steps. If you have any questions, just reply to this email.',
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
    ...(data.pdf ? { attachments: [{ filename: data.pdfFilename, content: data.pdf }] } : {}),
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
  pdf: Buffer | null
  pdfFilename: string
}): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const where = data.pdf
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
    ...(data.pdf ? { attachments: [{ filename: data.pdfFilename, content: data.pdf }] } : {}),
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
