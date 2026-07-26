/*
 * lib/portalSession.ts
 *
 * Session for the commercial accounts portal (accounts.<brand>.com.au).
 * Entirely separate from Clerk, which is staff-only — a trade contact is never
 * a Clerk user. Signed httpOnly cookie (JWT HS256), same shape as
 * lib/impersonation.ts.
 *
 * The cookie is set without a Domain attribute so it stays host-only: it is
 * never sent to app.biohazards.net, and a portal session can never be mistaken
 * for staff auth.
 *
 * Requires PORTAL_SESSION_SECRET (min 32 chars) in env.
 */
import { SignJWT, jwtVerify } from 'jose'
import type { NextRequest } from 'next/server'
import type { JobTradingName } from '@/lib/types'

export const PORTAL_COOKIE = 'bh_portal'

const JWT_TYP = 'bh_portal'

/** Sessions are long-lived because re-auth means waiting on another email. */
export const PORTAL_SESSION_DAYS = 30

function getSecretKey(): Uint8Array {
  const s = process.env.PORTAL_SESSION_SECRET ?? ''
  if (s.length < 32) {
    throw new Error('PORTAL_SESSION_SECRET must be set and at least 32 characters')
  }
  return new TextEncoder().encode(s)
}

/** Safe for verify paths where a missing secret should deny, not throw. */
function getSecretKeyOptional(): Uint8Array | null {
  const s = process.env.PORTAL_SESSION_SECRET ?? ''
  if (s.length < 32) return null
  return new TextEncoder().encode(s)
}

export interface PortalClaims {
  contactId: string
  accountId: string
  orgId: string
  tradingName: JobTradingName
  email: string
}

export async function signPortalToken(claims: PortalClaims): Promise<string> {
  const secret = getSecretKey()
  return new SignJWT({
    typ: JWT_TYP,
    account_id: claims.accountId,
    org_id: claims.orgId,
    trading_name: claims.tradingName,
    email: claims.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.contactId)
    .setIssuedAt()
    .setExpirationTime(`${PORTAL_SESSION_DAYS}d`)
    .sign(secret)
}

export async function verifyPortalToken(token: string): Promise<PortalClaims | null> {
  const secret = getSecretKeyOptional()
  if (!secret) return null
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.typ !== JWT_TYP) return null
    const contactId = payload.sub
    const accountId = payload.account_id as string | undefined
    const orgId = payload.org_id as string | undefined
    const tradingName = payload.trading_name as JobTradingName | undefined
    if (!contactId || !accountId || !orgId || !tradingName) return null
    return {
      contactId,
      accountId,
      orgId,
      tradingName,
      email: (payload.email as string | undefined) ?? '',
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

/** Resolve the portal session from a Request (API routes). */
export async function getPortalSessionFromRequest(req: Request): Promise<PortalClaims | null> {
  const raw = cookieValueFromHeader(req.headers.get('cookie'), PORTAL_COOKIE)
  if (!raw) return null
  return verifyPortalToken(decodeURIComponent(raw))
}

/** Resolve the portal session in middleware (NextRequest cookie jar). */
export async function getPortalSessionFromNextRequest(
  request: NextRequest
): Promise<PortalClaims | null> {
  const raw = request.cookies.get(PORTAL_COOKIE)?.value
  if (!raw) return null
  return verifyPortalToken(raw)
}

/**
 * Serialised Set-Cookie value. No Domain attribute — host-only by design.
 * Secure is omitted on localhost so the cookie works over plain http in dev.
 */
export function portalCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${PORTAL_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${PORTAL_SESSION_DAYS * 24 * 60 * 60}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearPortalCookieHeader(secure: boolean): string {
  const parts = [`${PORTAL_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/** http on localhost, https everywhere else — drives the Secure attribute. */
export function isSecureRequest(req: Request): boolean {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false
  return true
}
