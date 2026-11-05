/*
 * lib/calls/websiteEnquiry.ts
 *
 * Website enquiries from Netlify Forms' outgoing webhook. The submission is
 * turned into a plain "Label: value" text and goes through the same head agent
 * and file agent as a phone call (it starts at the extract stage; there is no
 * audio to transcribe or speech to clean).
 *
 * Netlify signs each webhook with the site's JWS secret: X-Webhook-Signature is
 * an HS256 JWT whose payload is { iss: "netlify", sha256: <hex of the body> }.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { normalizeTwilioNumber } from '@/lib/phone'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sameText(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest()
  const y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}

/** True when the signature was made with `secret` over exactly this body. */
export function verifyNetlifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false
  const [header, payload, sig] = signature.split('.')
  if (!header || !payload || !sig) return false
  const expected = base64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest())
  if (!sameText(sig, expected)) return false
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { iss?: string; sha256?: string }
    const bodyHash = createHash('sha256').update(rawBody).digest('hex')
    return claims.iss === 'netlify' && typeof claims.sha256 === 'string' && sameText(claims.sha256, bodyHash)
  } catch {
    return false
  }
}

export interface NetlifySubmission {
  id?: string
  form_name?: string
  site_url?: string
  created_at?: string
  data?: Record<string, unknown>
  ordered_human_fields?: { title?: string; name?: string; value?: unknown }[]
}

/** Browser and form plumbing that Netlify adds to `data`; not part of the enquiry. */
const NOISE = new Set(['ip', 'user_agent', 'referrer', 'form-name', 'form_name', 'bot-field', 'g-recaptcha-response'])

function fields(s: NetlifySubmission): { label: string; key: string; value: string }[] {
  const ordered = (s.ordered_human_fields ?? []).map(f => ({
    label: String(f.title ?? f.name ?? ''),
    key: String(f.name ?? f.title ?? ''),
    value: typeof f.value === 'string' ? f.value.trim() : f.value == null ? '' : String(f.value),
  }))
  const list = ordered.length
    ? ordered
    : Object.entries(s.data ?? {}).map(([k, v]) => ({ label: k, key: k, value: typeof v === 'string' ? v.trim() : v == null ? '' : String(v) }))
  return list.filter(f => f.value && !NOISE.has(f.key.toLowerCase()))
}

/** The enquiry as text for the head agent. */
export function enquiryText(s: NetlifySubmission): string {
  const lines = fields(s).map(f => `${f.label}: ${f.value}`)
  return [`Website enquiry form${s.form_name ? ` "${s.form_name}"` : ''}. The client wrote:`, ...lines].join('\n')
}

/** The phone number the client typed, in E.164 when it parses. */
export function enquiryPhone(s: NetlifySubmission): string {
  const f = fields(s).find(x => /phone|mobile|tel|contact.?number/i.test(`${x.key} ${x.label}`))
  if (!f) return ''
  const t = f.value.replace(/[\s()-]/g, '')
  const e164 = /^61\d{9}$/.test(t) ? `+${t}` : t
  return normalizeTwilioNumber(e164) ?? e164
}
