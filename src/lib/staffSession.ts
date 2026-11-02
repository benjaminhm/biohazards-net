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

/**
 * Re-auth means waiting on another email, so the session is long-lived.
 * Thirty days. That is past the 7-day home-screen requirement.
 */
export const STAFF_SESSION_DAYS = 30

/** Seconds in that window. */
export const STAFF_SESSION_MAX_AGE = STAFF_SESSION_DAYS * 24 * 60 * 60

/**
 * Rewrite the cookie on a normal 200 once it is an hour old. That extends the
 * window while the app is in use, and re-saves it with an Expires date so iOS
 * home-screen web apps keep it after the standalone process is killed.
 */
export const STAFF_SESSION_REFRESH_AFTER_SECONDS = 60 * 60

export function staffSessionIsStale(issuedAt: number, now = Date.now()): boolean {
  if (!issuedAt) return true
  return now / 1000 - issuedAt >= STAFF_SESSION_REFRESH_AFTER_SECONDS
}

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
  /** Unix seconds from the JWT `iat` claim. 0 when the token has none. */
  issuedAt: number
}

export async function signStaffToken(claims: Pick<StaffClaims, 'userId' | 'email'>): Promise<string> {
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
    return {
      userId,
      email,
      issuedAt: typeof payload.iat === 'number' ? payload.iat : 0,
    }
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

/**
 * Persistent cookie. Home-screen web apps on iOS drop a cookie that has no
 * expiry when the standalone process is killed, and some WebKit builds ignore
 * Max-Age unless Expires is also an HTTP-date (UTC). Date.toString() is not
 * valid here — the parenthesised timezone makes Safari treat it as a session
 * cookie.
 */
export function staffCookieHeader(token: string, secure: boolean, now = Date.now()): string {
  const expires = new Date(now + STAFF_SESSION_MAX_AGE * 1000).toUTCString()
  const parts = [
    `${STAFF_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${STAFF_SESSION_MAX_AGE}`,
    `Expires=${expires}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearStaffCookieHeader(secure: boolean): string {
  const parts = [
    `${STAFF_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/** Localhost and private LAN addresses used for phone testing. */
export function isDevHost(hostHeader: string | null): boolean {
  const hostNoPort = (hostHeader ?? '').split(',')[0].trim().split(':')[0].toLowerCase()
  if (
    hostNoPort === 'localhost' ||
    hostNoPort === '127.0.0.1' ||
    hostNoPort === '0.0.0.0' ||
    hostNoPort === '::1'
  ) {
    return true
  }
  const parts = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostNoPort)
  if (!parts) return false
  const a = Number(parts[1])
  const b = Number(parts[2])
  if (a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

/**
 * Origin the browser used. `next dev --hostname 0.0.0.0` puts 0.0.0.0 in
 * request.url, which a phone cannot open and which would mark the cookie Secure.
 */
export function browserOrigin(requestUrl: string, hostHeader: string | null, forwardedProto: string | null): string {
  const host = (hostHeader ?? '').split(',')[0].trim()
  let proto = (forwardedProto ?? '').split(',')[0].trim()
  if (!proto) {
    try {
      proto = new URL(requestUrl).protocol.replace(':', '')
    } catch {
      proto = 'http'
    }
  }
  if (!host) {
    try {
      return new URL(requestUrl).origin
    } catch {
      return 'http://localhost:3000'
    }
  }
  return `${proto}://${host}`
}

/** The one staff sign-in host. The email, not a second login, decides admin or technician. */
export const STAFF_LOGIN_ORIGIN = 'https://login.biohazards.net'

const STAFF_APP_HOSTS = new Set(['app.biohazards.net', 'login.biohazards.net'])

/** Hosts that serve the staff app. A LAN address is dev, not this set. */
export function isStaffAppHost(hostHeader: string | null): boolean {
  const hostNoPort = (hostHeader ?? '').split(',')[0].trim().split(':')[0].toLowerCase()
  return STAFF_APP_HOSTS.has(hostNoPort)
}

/**
 * Where a magic link should open. Phone testing keeps the LAN host.
 * The live app and the login host both email https://login.biohazards.net.
 */
export function magicLinkOrigin(requestUrl: string, hostHeader: string | null, forwardedProto: string | null): string {
  const origin = browserOrigin(requestUrl, hostHeader, forwardedProto)
  let hostname = ''
  try {
    hostname = new URL(origin).hostname.toLowerCase()
  } catch {
    return origin
  }
  if (isDevHost(hostname)) return origin
  if (isStaffAppHost(hostname)) return STAFF_LOGIN_ORIGIN
  return origin
}

/** http on localhost and the LAN, https on public hosts — drives the Secure attribute. */
export function isSecureStaffRequest(req: Request): boolean {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  return !isDevHost(host)
}
