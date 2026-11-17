/*
 * lib/tracking/session.ts
 *
 * Session for the client photo feed (tracking.<brand>.com.au). Same shape as
 * the accounts portal session (lib/portalSession.ts) but its own cookie and
 * token type, so neither can be used as the other. The cookie is host-only.
 *
 * The session names a person (their mobile or email) and a brand, not a job:
 * the jobs they may see are looked up on every request, so removing a viewer
 * or turning a job's feed off takes effect at once.
 */
import { SignJWT, jwtVerify } from 'jose'
import { isTradingNameId } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'

export const TRACKING_COOKIE = 'bh_tracking'

const JWT_TYP = 'bh_tracking'

export const TRACKING_SESSION_DAYS = 30

function secretKey(): Uint8Array | null {
  const s = process.env.PORTAL_SESSION_SECRET ?? ''
  return s.length >= 32 ? new TextEncoder().encode(s) : null
}

export interface TrackingClaims {
  identity: string
  tradingName: TradingNameId
}

export async function signTrackingToken(claims: TrackingClaims): Promise<string> {
  const secret = secretKey()
  if (!secret) throw new Error('PORTAL_SESSION_SECRET must be set and at least 32 characters')
  return new SignJWT({ typ: JWT_TYP, trading_name: claims.tradingName })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.identity)
    .setIssuedAt()
    .setExpirationTime(`${TRACKING_SESSION_DAYS}d`)
    .sign(secret)
}

export async function verifyTrackingToken(token: string): Promise<TrackingClaims | null> {
  const secret = secretKey()
  if (!secret) return null
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.typ !== JWT_TYP || !payload.sub) return null
    const tradingName = payload.trading_name
    if (!isTradingNameId(tradingName)) return null
    return { identity: payload.sub, tradingName }
  } catch {
    return null
  }
}

function cookieValue(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return undefined
}

/** The signed-in person, when the session belongs to this host's brand. */
export async function trackingSessionFromRequest(
  req: Request,
  tradingName: TradingNameId
): Promise<TrackingClaims | null> {
  const raw = cookieValue(req.headers.get('cookie'), TRACKING_COOKIE)
  if (!raw) return null
  const claims = await verifyTrackingToken(decodeURIComponent(raw))
  return claims && claims.tradingName === tradingName ? claims : null
}

export function trackingCookieHeader(token: string, secure: boolean): string {
  const maxAge = TRACKING_SESSION_DAYS * 24 * 60 * 60
  const parts = [
    `${TRACKING_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    // Expires as well as Max-Age: iOS home-screen web apps otherwise drop the cookie.
    `Expires=${new Date(Date.now() + maxAge * 1000).toUTCString()}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearTrackingCookieHeader(secure: boolean): string {
  const parts = [`${TRACKING_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}
