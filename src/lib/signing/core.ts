/*
 * lib/signing/core.ts
 *
 * The rules for sending a quote to a client to sign, with no database or
 * network in them so they can be tested directly: link tokens, who the email is
 * from, what the client may submit, and the signature docket.
 *
 * Server only (Node crypto). The signature fields themselves live in slots.ts.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { isSigningTokenShape } from '@/lib/signing/hostShape'
import { tradingNameOption, tradingSendingEmail } from '@/lib/tradingNames'
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

export { isSigningTokenShape }

/** Hash of a token from a link, or null when it is not even the right shape. */
export function hashSigningTokenSafe(token: string): string | null {
  return isSigningTokenShape(token) ? sha256Hex(token) : null
}

export function signingExpiry(from: Date): Date {
  return new Date(from.getTime() + SIGNING_LINK_DAYS * 24 * 60 * 60 * 1000)
}

/** What the client's link can do right now. */
export type LinkState = 'open' | 'signed' | 'declined' | 'voided' | 'expired' | 'locked'

export function linkState(
  row: { status: string; expires_at: string; passcode_locked_at?: string | null },
  now: Date,
): LinkState {
  if (row.status === 'voided') return 'voided'
  // Too many wrong passcodes shuts the link whatever else is true of it.
  if (row.passcode_locked_at) return 'locked'
  if (row.status === 'signed') return 'signed'
  if (row.status === 'declined') return 'declined'
  const expires = new Date(row.expires_at).getTime()
  if (Number.isNaN(expires) || expires <= now.getTime()) return 'expired'
  return 'open'
}

// ── Passcode for links staff send themselves ────────────────────────────────

/*
 * Letters and digits that cannot be mistaken for each other when read off a
 * text message or said over the phone (no 0/O, 1/I/L), and no vowels, so a
 * code never spells a word. 28 characters, 4 long: about 600,000 codes, with
 * five tries allowed and the private link needed before any try counts.
 */
export const PASSCODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789'
export const PASSCODE_LENGTH = 4
export const PASSCODE_MAX_ATTEMPTS = 5
/** How long a browser stays let in after the right passcode. */
export const UNLOCK_SECONDS = 12 * 60 * 60

export function newPasscode(): string {
  let code = ''
  for (let i = 0; i < PASSCODE_LENGTH; i++) code += PASSCODE_ALPHABET[randomInt(PASSCODE_ALPHABET.length)]
  return code
}

/** What the client typed, as it is compared: upper case, no spaces or dashes. */
export function normalizePasscode(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
}

function sameText(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256Hex(a), 'hex'), Buffer.from(sha256Hex(b), 'hex'))
}

export type PasscodeResult =
  | { ok: true; patch: { passcode_attempts: number; passcode_verified_at: string } }
  | { ok: false; locked: boolean; triesLeft: number; patch: { passcode_attempts: number; passcode_locked_at?: string } }

/**
 * Judge one passcode try and say what to write back. A right code clears the
 * count; the fifth wrong one in a row locks the link.
 */
export function passcodeAttempt(
  row: { passcode: string; passcode_attempts: number; passcode_verified_at: string | null },
  entered: unknown,
  now: Date,
): PasscodeResult {
  if (sameText(normalizePasscode(entered), row.passcode)) {
    return { ok: true, patch: { passcode_attempts: 0, passcode_verified_at: row.passcode_verified_at ?? now.toISOString() } }
  }
  const attempts = row.passcode_attempts + 1
  const locked = attempts >= PASSCODE_MAX_ATTEMPTS
  return {
    ok: false,
    locked,
    triesLeft: Math.max(0, PASSCODE_MAX_ATTEMPTS - attempts),
    patch: { passcode_attempts: attempts, ...(locked ? { passcode_locked_at: now.toISOString() } : {}) },
  }
}

/** Cookie that remembers this browser entered the right passcode for this link. */
export function unlockCookieName(token: string): string {
  return `bh_doc_${sha256Hex(token).slice(0, 16)}`
}

/** Cannot be worked out from the link alone: it needs the passcode too. */
export function unlockCookieValue(token: string, passcode: string): string {
  return sha256Hex(`unlock:${token}:${passcode}`)
}

/** True when the link has no passcode, or this browser has already entered it. */
export function isUnlocked(cookieHeader: string | null, token: string, passcode: string | null): boolean {
  if (!passcode) return true
  const name = unlockCookieName(token)
  for (const part of (cookieHeader ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at < 0 || part.slice(0, at).trim() !== name) continue
    if (sameText(part.slice(at + 1).trim(), unlockCookieValue(token, passcode))) return true
  }
  return false
}

// ── Where the client's link points ───────────────────────────────────────────

export interface SigningLinks {
  /** The page the client opens. */
  page: string
  /** Their signed copy, once signed. */
  pdf: string
  host: string
}

/**
 * On a brand's document host the address is just the private code, with no
 * "sign" in it; otherwise the link is on the app address.
 */
export function buildSigningLinks(token: string, appUrl: string, documentHost: string | null): SigningLinks {
  if (documentHost) {
    const base = `https://${documentHost}`
    return { page: `${base}/${token}`, pdf: `${base}/${token}/pdf`, host: documentHost }
  }
  const base = appUrl.replace(/\/+$/, '')
  let host = base
  try { host = new URL(base).host } catch { /* keep as written */ }
  return { page: `${base}/sign/${token}`, pdf: `${base}/api/sign/${token}/pdf`, host }
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
 * brand domain is unverified in Resend, then the brand's own address when its
 * domain is verified, then the shared address. The display name is the brand
 * either way, and replies go to the brand's inbox (or, for a brand with none,
 * the Settings email of the job's own organisation) rather than the shared
 * address.
 */
export function resolveSender(
  tradingName: TradingNameId,
  env: SenderEnv,
  companyEmail: string | null | undefined,
): ResolvedSender {
  const option = tradingNameOption(tradingName)
  const brandLabel = option?.label ?? 'Biohazard Cleaning QLD'
  const brandEmail = option?.email?.trim() || ''
  const sendingEmail = tradingSendingEmail(tradingName) ?? ''
  const fromEmail =
    env.RESEND_FROM_ACCOUNTS?.trim() ||
    sendingEmail ||
    env.RESEND_FROM_EMAIL?.trim() ||
    'onboarding@resend.dev'
  const settingsEmail = (companyEmail ?? '').trim()
  const replyTo = brandEmail || (isEmail(settingsEmail) ? settingsEmail : '') || null
  return {
    brandLabel,
    from: `${brandLabel} <${fromEmail}>`,
    fromEmail,
    replyTo,
    usesBrandAddress: Boolean(sendingEmail) && fromEmail === sendingEmail,
  }
}

// ── Default wording for the send window (staff edit it before sending) ───────
//
// What goes to the client invites them to view their document. Signing is the
// next step on the page itself, and paying the deposit the one after, so the
// message does not lead with either.

export function defaultSubject(brandLabel: string, title: string, reference: string | null): string {
  const ref = reference?.trim()
  return `${title}${ref ? ` ${ref}` : ''} from ${brandLabel} — ready to view`
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
    `Please find our quote${site ? ` for ${site}` : ''}: ${data.title}.`,
    '',
    'You can view it online using the button below. If you would like to go ahead, you can accept it on the same page.',
    '',
    'If you have any questions, just reply to this email.',
    '',
    'Kind regards,',
    ...(data.staffFirstName.trim() ? [data.staffFirstName.trim()] : []),
    data.brandLabel,
  ].join('\n')
}

/**
 * The message staff copy into their own text or email when they send the link
 * themselves. Fixed wording, short enough for a text; they can edit it before
 * sending.
 */
export function linkMessage(data: {
  clientName: string
  siteAddress: string | null
  staffFirstName: string
  brandLabel: string
  link: string
  passcode: string
}): string {
  const first = data.clientName.trim().split(/\s+/)[0] || 'there'
  const site = data.siteAddress?.trim()
  return [
    `Hi ${first}, your documents from ${data.brandLabel}${site ? ` for ${site}` : ''} are ready to view here:`,
    data.link,
    '',
    `Passcode: ${data.passcode}`,
    '',
    'Kind regards,',
    data.staffFirstName.trim() || data.brandLabel,
  ].join('\n')
}

/**
 * The message staff copy into their own text or email once they have checked
 * the signed document and the client can pay. Fixed wording; they can edit it
 * before sending, and nothing is sent from the app. It only names the ways to
 * pay that the client's page will actually show.
 */
export function paymentReadyMessage(data: {
  clientName: string
  brandLabel: string
  staffFirstName: string
  /** e.g. "$1,650.00" */
  depositLabel: string
  link: string
  /** Null for a link the system emailed: those have no passcode. */
  passcode: string | null
  card: boolean
  bank: boolean
}): string {
  const first = data.clientName.trim().split(/\s+/)[0] || 'there'
  const ways = data.card && data.bank ? ' by card or bank transfer' : data.card ? ' by card' : data.bank ? ' by bank transfer' : ''
  return [
    `Hi ${first}, thank you for signing. Your deposit of ${data.depositLabel} to ${data.brandLabel} is ready to pay${ways} here:`,
    data.link,
    ...(data.passcode ? ['', `Passcode: ${data.passcode}`] : []),
    '',
    'Kind regards,',
    data.staffFirstName.trim() || data.brandLabel,
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
  /** Null when the link went by text and no email was given. */
  toEmail: string | null
  /** email = the system emailed the link. link = staff sent the link and passcode themselves. */
  deliveryMethod: 'email' | 'link'
  passcodeVerifiedAt: string | null
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
  const byStaff = d.deliveryMethod === 'link'
  const staff = text(d.sentByName ? `${d.sentByName}, ${d.brandLabel}` : d.brandLabel)
  // The docket only claims what the system saw. A link staff sent themselves
  // was not delivered by the system, so it does not say where it was sent.
  const sentRows = byStaff
    ? [
        row('Prepared by', staff),
        row('Given to the signer', 'Private link and passcode, sent to the signer by staff'),
        row('Link created', esc(docketTime(d.sentAt))),
      ]
    : [
        row('Sent by', staff),
        row('Sent from', text(d.fromAddress)),
        row('Sent to', text(`${d.toName} <${d.toEmail ?? ''}>`)),
        row('Sent', esc(docketTime(d.sentAt))),
      ]
  const identity = byStaff
    ? 'Private link, opened with a passcode entered by the signer'
    : 'Private signing link emailed to the address above'
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
      ${sentRows.join('\n      ')}
    </table>

    <h3>Signer</h3>
    <table>
      ${row('Name', text(d.signerName))}
      ${row('Email', text(d.toEmail))}
      ${row('Identity check', identity)}
      ${row('Signature', `<div class="sd-sig"><img src="${esc(d.signaturePng)}" alt="Signature"></div>`)}
      ${row('Signature type', esc(how))}
    </table>

    <h3>Trail</h3>
    <table>
      ${byStaff ? row('Passcode entered', esc(docketTime(d.passcodeVerifiedAt))) : ''}
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
