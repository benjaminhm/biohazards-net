/*
 * lib/email.ts
 *
 * Transactional email helpers using the Resend SDK.
 * Currently handles a single notification type: quote accepted by client.
 * The email goes to the internal NOTIFY_EMAIL address (not the client) so
 * the team is alerted immediately when an online quote acceptance arrives.
 *
 * Note: the from address uses the Resend onboarding sandbox domain. Update
 * to a verified sending domain before going to production.
 */
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://biohazards-net.vercel.app'
export const FROM_EMAIL = process.env.RESEND_FROM_ACCOUNTS || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

export interface QuoteAcceptedData {
  jobId: string
  clientName: string
  siteAddress: string
  jobType: string
  reference: string
  total: number
  contactEmail?: string
  /** What staff need to do about the deposit (signed quotes with a pay step). Plain text. */
  depositNote?: string
  /**
   * Set for a quote signed on a document link: nothing is invoiced until a
   * person has checked it, so the alert asks for that instead of saying the
   * job is ready to schedule. Plain text.
   */
  checkNote?: string
  /**
   * The job's invoice inside Xero, when there is one to link to. Not set for a
   * quote signed on a document link: no invoice exists until staff have
   * checked it, and the link to Xero is on that check in Documents instead.
   */
  xeroInvoiceUrl?: string
}

/** The staff alert's HTML. What the client typed (name, email) is escaped. */
export function quoteAcceptedEmailHtml(data: QuoteAcceptedData): string {
  const jobUrl = `${APP_URL}/jobs/${data.jobId}`
  // en-AU locale formats numbers with commas and two decimal places (e.g. $4,500.00)
  const fmt = (n: number) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Only ever a link into Xero itself.
  const xeroUrl = data.xeroInvoiceUrl?.startsWith('https://go.xero.com/') ? data.xeroInvoiceUrl : ''

  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
      <div style="border-top: 4px solid #FF6B35; padding-top: 24px; margin-bottom: 32px;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FF6B35; margin-bottom: 6px;">
          Biohazard Cleaning QLD
        </div>
        <h1 style="font-size: 24px; font-weight: 700; color: #111; margin: 0;">
          ${data.checkNote ? 'Quote signed: check and create the invoice' : 'Quote Accepted ✓'}
        </h1>
      </div>

      <div style="background: #f9f9f9; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px;">
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">Client</div>
          <div style="font-size: 16px; font-weight: 600; color: #111;">${esc(data.clientName)}</div>
        </div>
        ${data.contactEmail ? `<div style="margin-bottom: 12px;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">Email they entered</div>
          <div style="font-size: 14px; color: #333;">${esc(data.contactEmail)}</div>
        </div>` : ''}
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">Site</div>
          <div style="font-size: 14px; color: #333;">${esc(data.siteAddress)}</div>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">Reference</div>
          <div style="font-size: 14px; color: #333;">${esc(data.reference)}</div>
        </div>
        <div>
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">Quote Total</div>
          <div style="font-size: 22px; font-weight: 700; color: #FF6B35;">${fmt(data.total)}</div>
        </div>
      </div>

      <div style="margin-bottom: 32px;">
        <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0;">
          Job status has been updated to <strong>Accepted</strong>.
          ${data.checkNote ? esc(data.checkNote) : 'Ready to schedule — open the job to proceed.'}
        </p>
        ${data.depositNote ? `<p style="font-size: 14px; color: #555; line-height: 1.6; margin: 12px 0 0;">
          ${esc(data.depositNote)}
        </p>` : ''}
      </div>

      <a href="${jobUrl}" style="display: inline-block; background: #FF6B35; color: white; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 8px; margin: 0 8px 8px 0;">
        ${data.checkNote ? 'Open job to check' : 'Open Job'} →
      </a>
      ${xeroUrl ? `<a href="${esc(xeroUrl)}" style="display: inline-block; background: #ffffff; color: #111; text-decoration: none; font-weight: 700; font-size: 15px; padding: 13px 27px; border-radius: 8px; border: 1px solid #c9c9c9; margin: 0 0 8px 0;">
        Open invoice in Xero →
      </a>` : ''}

      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #aaa;">
        Biohazard Cleaning QLD · biohazards.net
        <!-- TWILIO SMS: add SMS notification here when ready -->
      </div>
    </div>
  `
}

/**
 * Send the internal alert when a client accepts a quote: from the emailed
 * accept box, or by signing on a document link (then it asks staff to check
 * the signed request and create the invoice). Links back to the job.
 */
export async function sendQuoteAcceptedEmail(data: QuoteAcceptedData) {
  const html = quoteAcceptedEmailHtml(data)
  const { error } = await resend.emails.send({
    from: `biohazards.net <${FROM_EMAIL}>`,
    to: NOTIFY_EMAIL,
    subject: `${data.checkNote ? 'Quote signed, check and invoice' : 'Quote Accepted'} — ${data.clientName} — ${data.reference}`,
    html,
  })
  if (error) throw new Error(error.message || 'Staff email failed')
}

export async function sendQuoteAcceptedClientEmail(data: {
  to: string
  clientName: string
  siteAddress: string
  reference: string
  total: number | null
  brandLabel: string
}) {
  const fmt = (n: number) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`
  const total = data.total == null ? '' : fmt(data.total)
  const safe = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
      <div style="border-top: 4px solid #FF6B35; padding-top: 24px; margin-bottom: 24px;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FF6B35; margin-bottom: 6px;">
          ${safe(data.brandLabel)}
        </div>
        <h1 style="font-size: 24px; font-weight: 700; color: #111; margin: 0;">We have your acceptance</h1>
      </div>
      <p style="font-size: 15px; color: #333; line-height: 1.6;">
        Thank you${data.clientName ? `, ${safe(data.clientName)}` : ''}. We have recorded your acceptance
        of <strong>${safe(data.reference || 'this quote')}</strong>${data.siteAddress ? ` for ${safe(data.siteAddress)}` : ''}${total ? ` (${total})` : ''}.
      </p>
      <p style="font-size: 14px; color: #555; line-height: 1.6;">We will be in touch to book the work.</p>
    </div>`
  const { error } = await resend.emails.send({
    from: `${data.brandLabel} <${FROM_EMAIL}>`,
    to: data.to,
    subject: `Accepted — ${data.reference || 'your quote'}`,
    html,
  })
  if (error) throw new Error(error.message || 'Client email failed')
}
