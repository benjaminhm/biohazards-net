/*
 * lib/signing/core.ts
 *
 * The rules for sending a quote to a client to sign, with no database or
 * network in them so they can be tested directly: link tokens, who the email is
 * from, what the client may submit, and the signature docket.
 *
 * Server only (Node crypto). The signature fields themselves live in slots.ts.
 */
import { createHash, randomBytes } from 'node:crypto'
import { tradingNameOption } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'

export const SIGNING_LINK_DAYS = 30
export const SIGNATURE_MAX_BYTES = 400_000
export const SIGNER_NAME_MAX = 120
export const DECLINE_REASON_MAX = 1000
export const MESSAGE_MAX = 4000
export const SUBJECT_MAX = 200
const BRISBANE = 'Australia/Brisbane'

export type SigningStatus = 'sent' | 'viewed' | 'signed' | 'declined' | 'voided'

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** The token goes in the client's link; only its hash is stored. */
export function newSigningToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: sha256Hex(token) }
}

export function isSigningTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

/** Hash of a token from a link, or null when it is not even the right shape. */
export function hashSigningTokenSafe(token: string): string | null {
  return isSigningTokenShape(token) ? sha256Hex(token) : null
}

export function signingExpiry(from: Date): Date {
  return new Date(from.getTime() + SIGNING_LINK_DAYS * 24 * 60 * 60 * 1000)
}

/** What the client's link can do right now. */
export type LinkState = 'open' | 'signed' | 'declined' | 'voided' | 'expired'

export function linkState(row: { status: string; expires_at: string }, now: Date): LinkState {
  if (row.status === 'signed') return 'signed'
  if (row.status === 'declined') return 'declined'
  if (row.status === 'voided') return 'voided'
  const expires = new Date(row.expires_at).getTime()
  if (Number.isNaN(expires) || expires <= now.getTime()) return 'expired'
  return 'open'
}

export function isEmail(value: string): boolean {
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(value)
}

// ── Who the email is from ────────────────────────────────────────────────────

export interface SenderEnv {
  RESEND_FROM_ACCOUNTS?: string
  RESEND_FROM_EMAIL?: string
}

export interface ResolvedSender {
  brandLabel: string
  /** Full From header, e.g. `Forensic Cleaning QLD <admin@forensiccleaningqld.com.au>`. */
  from: string
  fromEmail: string
  /** Where the client's reply goes. Null when neither the brand nor Settings has an email. */
  replyTo: string | null
  /** True when the From address is the brand's own, not the shared fallback. */
  usesBrandAddress: boolean
}

/**
 * A quote always goes out under the job's trading name. The address follows the
 * same order as the trade portal (lib/portal/email.ts): the override while a
 * brand domain is unverified in Resend, then the brand's own address, then the
 * shared address. The display name is the brand either way, and replies go to
 * the brand's inbox (or the Settings email) rather than the shared address.
 */
export function resolveSender(
  tradingName: TradingNameId,
  env: SenderEnv,
  companyEmail: string | null | undefined,
): ResolvedSender {
  const option = tradingNameOption(tradingName)
  const brandLabel = option?.label ?? 'Biohazard Cleaning QLD'
  const brandEmail = option?.email?.trim() || ''
  const fromEmail =
    env.RESEND_FROM_ACCOUNTS?.trim() ||
    brandEmail ||
    env.RESEND_FROM_EMAIL?.trim() ||
    'onboarding@resend.dev'
  const settingsEmail = (companyEmail ?? '').trim()
  const replyTo = brandEmail || (isEmail(settingsEmail) ? settingsEmail : '') || null
  return {
    brandLabel,
    from: `${brandLabel} <${fromEmail}>`,
    fromEmail,
    replyTo,
    usesBrandAddress: Boolean(brandEmail) && fromEmail === brandEmail,
  }
}

// ── Default wording for the send window (staff edit it before sending) ───────

export function defaultSubject(brandLabel: string, title: string, reference: string | null): string {
  const ref = reference?.trim()
  return `${title}${ref ? ` ${ref}` : ''} from ${brandLabel} — please review and sign`
}

export function defaultMessage(data: {
  clientName: string
  title: string
  siteAddress: string | null
  staffFirstName: string
  brandLabel: string
}): string {
  const first = data.clientName.trim().split(/\s+/)[0] || 'there'
  const site = data.siteAddress?.trim()
  return [
    `Hi ${first},`,
    '',
    `Please find our ${data.title.toLowerCase()}${site ? ` for ${site}` : ''}.`,
    '',
    'You can read it and sign online using the button below. Once you have signed, a copy is emailed to you for your records.',
    '',
    'If you have any questions, just reply to this email.',
    '',
    'Kind regards,',
    ...(data.staffFirstName.trim() ? [data.staffFirstName.trim()] : []),
    data.brandLabel,
  ].join('\n')
}

/** The staff member's message as email paragraphs, exactly as typed. */
export function messageToHtml(message: string): string {
  return message
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => `<p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">${esc(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// ── What the client may submit ───────────────────────────────────────────────

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Null when the value is a real PNG data URL of a sane size, otherwise why not. */
export function signaturePngError(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'Add your signature'
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) return 'Signature image is not valid'
  if (value.length > SIGNATURE_MAX_BYTES * 1.4) return 'Signature image is too large'
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.length > SIGNATURE_MAX_BYTES) return 'Signature image is too large'
  if (bytes.length < 100) return 'Add your signature'
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return 'Signature image is not valid'
  return null
}

export function cleanSignerName(value: unknown): string {
  if (typeof value !== 'string') return ''
  // Control characters out, runs of whitespace to one space.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function signerNameError(name: string): string | null {
  if (name.length < 2) return 'Enter your full name'
  if (name.length > SIGNER_NAME_MAX) return 'Name is too long'
  return null
}

// ── Dates on the document and docket ─────────────────────────────────────────

/** The date written in the document's Date field, e.g. "11 November 2026". */
export function signedDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: BRISBANE,
  })
}

/** Docket timestamps: Brisbane time, stated as such. */
export function docketTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const text = d.toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: BRISBANE,
  })
  return `${text} AEST`
}

// ── Signature docket ─────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface DocketData {
  requestId: string
  brandLabel: string
  documentTitle: string
  reference: string | null
  docSha256: string
  fromAddress: string
  sentByName: string | null
  toName: string
  toEmail: string
  signerName: string
  signatureMethod: 'drawn' | 'typed'
  signaturePng: string
  sentAt: string
  firstViewedAt: string | null
  consentedAt: string | null
  signedAt: string
  signerIp: string | null
  signerUserAgent: string | null
}

/**
 * The page added to the end of the signed copy: what was signed, by whom, and
 * the trail of how it got there. Sits outside `.sow-root`, so it carries its
 * own styles and always starts a new page.
 */
export function docketHtml(d: DocketData): string {
  const row = (label: string, value: string) =>
    `<tr><th>${esc(label)}</th><td>${value}</td></tr>`
  const text = (value: string | null | undefined) => esc((value ?? '').trim() || '—')
  const how = d.signatureMethod === 'typed' ? 'Typed and adopted by the signer' : 'Drawn by the signer'
  return `
  <section class="sign-docket">
    <style>
      .sign-docket {
        break-before: page; page-break-before: always;
        font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #111; background: #fff; box-sizing: border-box;
        max-width: 210mm; margin: 24px auto 0; padding: 14mm 12mm;
      }
      .sign-docket h2 { font-size: 16pt; font-weight: 600; margin: 0 0 2px; }
      .sign-docket .sd-sub { font-size: 9pt; color: #555; margin: 0 0 16px; }
      .sign-docket h3 {
        font-size: 8pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
        color: #555; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #ddd;
      }
      .sign-docket table { width: 100%; border-collapse: collapse; }
      .sign-docket th, .sign-docket td {
        font-size: 9pt; text-align: left; vertical-align: top; padding: 4px 0; font-weight: 400;
      }
      .sign-docket th { width: 34%; color: #555; padding-right: 12px; }
      .sign-docket td { word-break: break-word; }
      .sign-docket .sd-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8pt; }
      .sign-docket .sd-sig {
        border: 1px solid #ddd; border-radius: 6px; padding: 8px 12px; display: inline-block; min-width: 60mm;
      }
      .sign-docket .sd-sig img { display: block; max-height: 22mm; max-width: 80mm; }
      .sign-docket .sd-note { font-size: 8pt; color: #555; line-height: 1.5; margin-top: 18px; }
      @media print { .sign-docket { max-width: none; margin: 0; padding: 0; } }
    </style>
    <h2>Signature docket</h2>
    <p class="sd-sub">Record of electronic signing · ${esc(d.brandLabel)}</p>

    <h3>Document</h3>
    <table>
      ${row('Document', text(d.documentTitle))}
      ${row('Reference', text(d.reference))}
      ${row('Docket ID', `<span class="sd-mono">${esc(d.requestId)}</span>`)}
      ${row('Document fingerprint (SHA-256)', `<span class="sd-mono">${esc(d.docSha256)}</span>`)}
    </table>

    <h3>Sent</h3>
    <table>
      ${row('Sent by', text(d.sentByName ? `${d.sentByName}, ${d.brandLabel}` : d.brandLabel))}
      ${row('Sent from', text(d.fromAddress))}
      ${row('Sent to', text(`${d.toName} <${d.toEmail}>`))}
      ${row('Sent', esc(docketTime(d.sentAt)))}
    </table>

    <h3>Signer</h3>
    <table>
      ${row('Name', text(d.signerName))}
      ${row('Email', text(d.toEmail))}
      ${row('Identity check', 'Private signing link emailed to the address above')}
      ${row('Signature', `<div class="sd-sig"><img src="${esc(d.signaturePng)}" alt="Signature"></div>`)}
      ${row('Signature type', esc(how))}
    </table>

    <h3>Trail</h3>
    <table>
      ${row('Document opened', esc(docketTime(d.firstViewedAt)))}
      ${row('Agreed to sign electronically', esc(docketTime(d.consentedAt)))}
      ${row('Signed', esc(docketTime(d.signedAt)))}
      ${row('IP address', text(d.signerIp))}
      ${row('Device', text(d.signerUserAgent))}
    </table>

    <p class="sd-note">
      The fingerprint identifies the document exactly as it was sent for signing, before the
      signature, name and date were added. Times are Brisbane time (AEST, UTC+10).
    </p>
  </section>`
}

/** Insert HTML at the end of the page body (before the photo viewer when there is one). */
export function insertAtBodyEnd(html: string, extra: string): string {
  const zoom = html.lastIndexOf('<div class="sow-photo-zoom" id="sow-photo-zoom">')
  const at = zoom >= 0 ? zoom : html.lastIndexOf('</body>')
  if (at < 0) return html + extra
  return html.slice(0, at) + extra + html.slice(at)
}
