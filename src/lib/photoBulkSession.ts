/*
 * lib/photoBulkSession.ts
 *
 * Sign-in for the bulk photo loader (photo.biohazards.net/bulk). A correct
 * photo PIN sets a signed, httpOnly cookie for 12 hours; each request re-checks
 * the person is still active with a PIN. Wrong PINs are counted per client IP
 * and locked out for a while.
 *
 * The lockout counter lives in server memory, so it is per running instance:
 * it slows guessing but is not a hard global limit.
 */
import { SignJWT, jwtVerify } from 'jose'
import { resolveActivePinPerson, type PinPerson } from '@/lib/photoPin'

export const PHOTO_BULK_COOKIE = 'bh_photo_bulk'
export const PHOTO_BULK_MAX_AGE = 12 * 60 * 60

const JWT_TYP = 'photo-bulk'
const MAX_FAILURES = 5
const LOCKOUT_MS = 15 * 60 * 1000

function secretKey(): Uint8Array {
  const s = process.env.STAFF_SESSION_SECRET ?? ''
  if (s.length < 32) throw new Error('STAFF_SESSION_SECRET must be set and at least 32 characters')
  return new TextEncoder().encode(s)
}

export async function signPhotoBulkToken(person: PinPerson): Promise<string> {
  return new SignJWT({ typ: JWT_TYP, org: person.org_id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(person.person_id)
    .setIssuedAt()
    .setExpirationTime(`${PHOTO_BULK_MAX_AGE}s`)
    .sign(secretKey())
}

function cookieFromRequest(req: Request): string | undefined {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === PHOTO_BULK_COOKIE) return rest.join('=')
  }
  return undefined
}

/** The signed-in person for this request, or null. */
export async function photoBulkPerson(req: Request): Promise<PinPerson | null> {
  const token = cookieFromRequest(req)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey())
    if (payload.typ !== JWT_TYP || !payload.sub || typeof payload.org !== 'string') return null
    return await resolveActivePinPerson(payload.sub, payload.org)
  } catch {
    return null
  }
}

export function photoBulkCookie(token: string, secure: boolean) {
  return {
    name: PHOTO_BULK_COOKIE,
    value: token,
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: PHOTO_BULK_MAX_AGE,
  }
}

const failures = new Map<string, { count: number; until: number }>()

/** Milliseconds left on this client's lockout, or 0. */
export function pinLockoutRemaining(clientKey: string): number {
  const entry = failures.get(clientKey)
  if (!entry || entry.count < MAX_FAILURES) return 0
  const left = entry.until - Date.now()
  if (left <= 0) {
    failures.delete(clientKey)
    return 0
  }
  return left
}

export function recordPinFailure(clientKey: string) {
  const now = Date.now()
  const entry = failures.get(clientKey)
  const fresh = !entry || entry.until <= now
  failures.set(clientKey, { count: fresh ? 1 : entry.count + 1, until: now + LOCKOUT_MS })
  if (failures.size > 5000) {
    for (const [k, v] of failures) if (v.until <= now) failures.delete(k)
  }
}

export function clearPinFailures(clientKey: string) {
  failures.delete(clientKey)
}
