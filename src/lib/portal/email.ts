/*
 * lib/portal/email.ts
 *
 * Emails for the commercial accounts portal.
 *
 * Both the magic link and the account invite are transactional and sent from the
 * trading brand's own address, so a Forensic Cleaning QLD account never receives
 * mail branded Brisbane Biohazard Cleaning. Per docs/ai-product-principles.md
 * these are strictly transactional loops, not composed client comms.
 *
 * The sending domain must be verified in Resend for the brand address to work.
 * RESEND_FROM_ACCOUNTS is the fallback while a brand domain is unverified.
 */
import { Resend } from 'resend'
import { tradingNameOption } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'

const resend = new Resend(process.env.RESEND_API_KEY)

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fromAddress(tradingName: TradingNameId): string {
  const option = tradingNameOption(tradingName)
  const address =
    option?.email ||
    process.env.RESEND_FROM_ACCOUNTS ||
    process.env.RESEND_FROM_EMAIL ||
    'onboarding@resend.dev'
  return `${option?.label ?? 'Accounts'} <${address}>`
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
        ${esc(brandLabel)} · Trade accounts
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

export interface PortalMagicLinkEmail {
  tradingName: TradingNameId
  to: string
  contactName: string
  loginUrl: string
  expiresInMinutes: number
}

export async function sendPortalMagicLinkEmail(data: PortalMagicLinkEmail) {
  const option = tradingNameOption(data.tradingName)
  const brandLabel = option?.label ?? 'Accounts'
  const firstName = data.contactName.trim().split(/\s+/)[0] || 'there'

  const html = shell(
    brandLabel,
    'Your sign-in link',
    `
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 20px;">
        Hi ${esc(firstName)}, here is your link to sign in to your trade account.
      </p>
      ${button(data.loginUrl, 'Sign in')}
      <p style="font-size: 13px; color: #777; line-height: 1.6; margin: 24px 0 0;">
        This link works once and expires in ${data.expiresInMinutes} minutes.
        If you did not request it, you can ignore this email &mdash; nobody can access
        your account without opening the link.
      </p>
    `
  )

  await resend.emails.send({
    from: fromAddress(data.tradingName),
    to: data.to,
    subject: `Your ${brandLabel} sign-in link`,
    html,
  })
}

export interface PortalInviteEmail {
  tradingName: TradingNameId
  to: string
  contactName: string
  accountName: string
  loginUrl: string
}

/** First-time invite. Same link mechanism, framed as an introduction. */
export async function sendPortalInviteEmail(data: PortalInviteEmail) {
  const option = tradingNameOption(data.tradingName)
  const brandLabel = option?.label ?? 'Accounts'
  const firstName = data.contactName.trim().split(/\s+/)[0] || 'there'

  const html = shell(
    brandLabel,
    'Your trade account is ready',
    `
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
        Hi ${esc(firstName)}, we have set up a trade account for
        <strong>${esc(data.accountName)}</strong>.
      </p>
      <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 20px;">
        From here you can review and accept quotes, download completion reports and
        certificates, and keep your company and billing details up to date. There is no
        password &mdash; we email you a sign-in link whenever you need one.
      </p>
      ${button(data.loginUrl, 'Set up your account')}
      <p style="font-size: 13px; color: #777; line-height: 1.6; margin: 24px 0 0;">
        You will be asked to review our trade terms the first time you sign in. This link
        works once; you can request a new one any time from the sign-in page.
      </p>
    `
  )

  await resend.emails.send({
    from: fromAddress(data.tradingName),
    to: data.to,
    subject: `Your ${brandLabel} trade account`,
    html,
  })
}

export interface PortalQuoteAcceptedNotification {
  tradingName: TradingNameId
  jobId: string
  accountName: string
  contactName: string
  contactEmail: string
  siteAddress: string
  reference: string
  total: number | null
  termsVersion: string
  acceptedAt: string
}

/**
 * Internal alert when a trade account accepts a quote in the portal. Goes to
 * staff, not the client — the client already saw the confirmation on screen.
 */
export async function sendPortalQuoteAcceptedEmail(data: PortalQuoteAcceptedNotification) {
  const to = process.env.ACCOUNTS_EMAIL || process.env.NOTIFY_EMAIL
  if (!to) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const option = tradingNameOption(data.tradingName)
  const brandLabel = option?.label ?? 'Accounts'
  const total =
    data.total == null
      ? 'See quote'
      : `$${Number(data.total).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`

  const row = (label: string, value: string) => `
    <div style="margin-bottom: 12px;">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">${esc(label)}</div>
      <div style="font-size: 14px; color: #333;">${esc(value)}</div>
    </div>
  `

  const html = shell(
    brandLabel,
    'Quote accepted in trade portal',
    `
      <div style="background: #f9f9f9; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px;">
        ${row('Account', data.accountName)}
        ${row('Accepted by', `${data.contactName} (${data.contactEmail})`)}
        ${row('Site', data.siteAddress)}
        ${row('Reference', data.reference)}
        ${row('Terms version', data.termsVersion)}
        <div>
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 2px;">Quote total</div>
          <div style="font-size: 22px; font-weight: 700; color: #FF6B35;">${esc(total)}</div>
        </div>
      </div>
      <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0 0 24px;">
        The job status is now <strong>Accepted</strong> and it is ready to schedule.
        The acceptance is recorded against the account with the contact, timestamp and IP.
      </p>
      ${button(`${appUrl}/jobs/${data.jobId}`, 'Open job')}
    `
  )

  await resend.emails.send({
    from: fromAddress(data.tradingName),
    to,
    subject: `Quote accepted — ${data.accountName} — ${data.reference}`,
    html,
  })
}
