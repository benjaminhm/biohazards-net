/*
 * The text and email links behind "Text from phone" and "Email from phone".
 *
 * Scanning the QR opens Messages or Mail on the phone, addressed to the client
 * with the message filled in. Nothing is sent until the phone's send button is
 * tapped, and the code carries a message, not a file.
 *
 *   Document screen bar   the short "here is your document" message
 *                         (textHandoffUrl, emailHandoffUrl)
 *   Link ready boxes      the message in the box, as staff edited it
 *                         (textMessageHandoff, emailMessageHandoff)
 */
import { create } from 'qrcode'
import { formatToTwilioE164 } from '@/lib/phone'
import { phonePasscode } from '@/lib/signing/phone'

/** First word of the client name, matching the Email and Text Link buttons. */
export function handoffFirstName(clientName: string | undefined): string {
  return (clientName ?? '').split(' ')[0] ?? ''
}

export function textHandoffBody(firstName: string, link: string): string {
  return `Hi ${firstName}, here is your document: ${link}`
}

export function emailHandoffBody(firstName: string, link: string): string {
  return `Hi ${firstName},\n\nPlease find your document at the link below:\n\n${link}\n\nKind regards`
}

export interface PhoneHandoffLink {
  /** sms: or mailto: URL encoded in the QR. */
  url: string
  /** The number or email the caption shows. */
  to: string
}

/**
 * Text handoff. `?&body` opens Messages on iPhone and the text app on Android.
 * No link when the job phone does not parse as a number.
 */
/** sms: link for a number that is already E.164. `?&body` opens on iPhone and Android. */
export function smsHandoffUrl(e164: string, body: string): string {
  return `sms:${e164}?&body=${encodeURIComponent(body)}`
}

export function textHandoffUrl(phone: string | undefined, firstName: string, link: string): PhoneHandoffLink | null {
  const to = formatToTwilioE164(phone)
  if (!to) return null
  return { to, url: smsHandoffUrl(to, textHandoffBody(firstName, link)) }
}

/** Email handoff. No link when the job has no email address. */
export function emailHandoffUrl(
  email: string | undefined,
  subject: string,
  firstName: string,
  link: string,
): PhoneHandoffLink | null {
  const to = (email ?? '').trim()
  if (!to) return null
  const url = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailHandoffBody(firstName, link))}`
  return { to, url }
}

/**
 * The number to text, in + form: an Australian number however it was typed
 * ("0412 345 678", "+61 412 345 678", the 9 digits kept on a signing link),
 * or a number already written with its country code. Null for anything else.
 */
export function handoffNumber(typed: string | null | undefined): string | null {
  const t = (typed ?? '').trim()
  const nine = phonePasscode(t)
  if (nine) return `+61${nine}`
  const plain = t.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{6,14}$/.test(plain) && !plain.startsWith('+61') ? plain : null
}

/** Text handoff for a message staff wrote. No link without a number to text. */
export function textMessageHandoff(phone: string | null | undefined, message: string): PhoneHandoffLink | null {
  const to = handoffNumber(phone)
  if (!to) return null
  return { to, url: smsHandoffUrl(to, message) }
}

/** Email handoff for a message staff wrote. No link without an email address. */
export function emailMessageHandoff(
  email: string | null | undefined,
  subject: string,
  message: string,
): PhoneHandoffLink | null {
  const to = (email ?? '').trim()
  if (!/^\S+@\S+\.\S+$/.test(to)) return null
  return { to, url: `mailto:${to}?subject=${encodeURIComponent(subject.trim())}&body=${encodeURIComponent(message)}` }
}

/** Longest link drawn as a QR. Past this the code is too fine to scan off a screen. */
export const HANDOFF_QR_MAX_CHARS = 1000

export function handoffFitsQr(url: string): boolean {
  return url.length <= HANDOFF_QR_MAX_CHARS
}

/** A scannable QR for a handoff URL, with a white quiet zone. */
export function handoffQrSvg(url: string): string {
  const qr = create(url, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const cells: string[] = []
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.modules.get(row, col)) cells.push(`<rect x="${col}" y="${row}" width="1" height="1"/>`)
    }
  }
  const span = n + 4
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${span} ${span}" width="240" height="240" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect x="-2" y="-2" width="${span}" height="${span}" fill="#fff"/><g fill="#111">${cells.join('')}</g></svg>`
}
