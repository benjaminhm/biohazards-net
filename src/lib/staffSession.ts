/*
 * lib/staffSession.ts
 *
 * Session for the staff app. Signed httpOnly cookie (JWT HS256), same shape as
 * the accounts portal cookie in lib/portalSession.ts. Host-only: no Domain
 * attribute, so it is never sent to the accounts host.
 *
 * Requires STAFF_SESSION_SECRET (min 32 chars) in env.
 */
import { SignJWT, jwtVerify } from 'jose'
import type { NextRequest } from 'next/server'

export const STAFF_COOKIE = 'bh_staff'

const JWT_TYP = 'bh_staff'

/** Re-auth means waiting on another email, so the session is long-lived. */
export const STAFF_SESSION_DAYS = 30

function getSecretKey(): Uint8Array {
  const s = process.env.STAFF_SESSION_SECRET ?? ''
  if (s.length < 32) {
    throw new Error('STAFF_SESSION_SECRET must be set and at least 32 characters')
  }
  return new TextEncoder().encode(s)
}

function getSecretKeyOptional(): Uint8Array | null {
  const s = process.env.STAFF_SESSION_SECRET ?? ''
  if (s.length < 32) return null
  return new TextEncoder().encode(s)
}

export interface StaffClaims {
  userId: string
  email: string
}

export async function signStaffToken(claims: StaffClaims): Promise<string> {
  const secret = getSecretKey()
  return new SignJWT({
    typ: JWT_TYP,
    email: claims.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${STAFF_SESSION_DAYS}d`)
    .sign(secret)
}

export async function verifyStaffToken(token: string): Promise<StaffClaims | null> {
  const secret = getSecretKeyOptional()
  if (!secret) return null
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.typ !== JWT_TYP) return null
    const userId = payload.sub
    const email = payload.email as string | undefined
    if (!userId || !email) return null
    return { userId, email }
  } catch {
    return null
  }
}

function cookieValueFromHeader(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return undefined
}

export async function getStaffSessionFromRequest(req: Request): Promise<StaffClaims | null> {
  const raw = cookieValueFromHeader(req.headers.get('cookie'), STAFF_COOKIE)
  if (!raw) return null
  return verifyStaffToken(decodeURIComponent(raw))
}

export async function getStaffSessionFromNextRequest(
  request: NextRequest
): Promise<StaffClaims | null> {
  const raw = request.cookies.get(STAFF_COOKIE)?.value
  if (!raw) return null
  return verifyStaffToken(raw)
}

export function staffCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${STAFF_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${STAFF_SESSION_DAYS * 24 * 60 * 60}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearStaffCookieHeader(secure: boolean): string {
  const parts = [`${STAFF_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/** http on localhost, https everywhere else — drives the Secure attribute. */
export function isSecureStaffRequest(req: Request): boolean {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false
  return true
}
