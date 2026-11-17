/*
 * lib/tracking/identity.ts
 *
 * What a client signs in with: their mobile (E.164) or, as a fallback, their
 * email (lower case). The same string is stored on job_viewers, so matching a
 * sign-in to the jobs they may see is an exact comparison.
 */
import { formatToTwilioE164 } from '@/lib/phone'

export type TrackingIdentity =
  | { kind: 'mobile'; value: string }
  | { kind: 'email'; value: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  return value.length <= 320 && EMAIL_RE.test(value) ? value : null
}

/** Australian mobiles only: a code cannot be texted to a landline. */
export function normaliseMobile(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/[\s()-]/g, '')
  const local = digits.match(/^(?:\+?61|0)(4\d{8})$/)
  if (local) return `+61${local[1]}`
  const e164 = formatToTwilioE164(raw)
  return e164 && /^\+614\d{8}$/.test(e164) ? e164 : null
}

export function parseTrackingIdentity(raw: unknown): TrackingIdentity | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  if (raw.includes('@')) {
    const email = normaliseEmail(raw)
    return email ? { kind: 'email', value: email } : null
  }
  const mobile = normaliseMobile(raw)
  return mobile ? { kind: 'mobile', value: mobile } : null
}

/** "+61412345678" as "0412 345 678", for showing a number back to its owner. */
export function displayMobile(e164: string): string {
  const m = e164.match(/^\+61(4\d{2})(\d{3})(\d{3})$/)
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164
}
