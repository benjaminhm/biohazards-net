/*
 * The text and email links behind "Text from phone" and "Email from phone"
 * on a document's screen bar.
 *
 * Scanning the QR opens Messages or Mail with the client and the short link
 * message filled in. Nothing is sent until the phone's send button is tapped,
 * and the code carries the link, not a file. The code is drawn here, when the
 * bar is built, because the email subject is the document title.
 */
import { create } from 'qrcode'
import { formatToTwilioE164 } from '@/lib/phone'

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
