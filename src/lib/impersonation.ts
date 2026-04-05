/*
 * lib/impersonation.ts
 *
 * Platform-admin tenant impersonation for training and debugging on live orgs.
 * Signed httpOnly cookie (JWT HS256) — never trust client-set headers.
 *
 * Requires IMPERSONATION_SECRET (min 32 chars) in env.
 */
import { SignJWT, jwtVerify } from 'jose'
import type { NextRequest } from 'next/server'
import { isPlatformAdmin } from '@/lib/platformAdmin'

export const IMPERSONATION_COOKIE = 'bh_impersonation'

const JWT_TYP = 'bh_imp'

function getSecretKey(): Uint8Array {
  const s = process.env.IMPERSONATION_SECRET ?? ''
  if (s.length < 32) {
    throw new Error('IMPERSONATION_SECRET must be set and at least 32 characters')
  }
  return new TextEncoder().encode(s)
}

/** Safe for verify paths where missing secret should not throw */
function getSecretKeyOptional(): Uint8Array | null {
  const s = process.env.IMPERSONATION_SECRET ?? ''
  if (s.length < 32) return null
  return new TextEncoder().encode(s)
}

export interface ImpersonationClaims {
  orgId: string
  orgSlug: string
  orgName: string
  readOnly: boolean
}

export async function signImpersonationToken(
  actorClerkId: string,
  claims: ImpersonationClaims
): Promise<string> {
  const secret = getSecretKey()
  return new SignJWT({
    typ: JWT_TYP,
    org_id: claims.orgId,
    org_slug: claims.orgSlug,
    org_name: claims.orgName,
    ro: claims.readOnly,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(actorClerkId)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(secret)
}

export async function verifyImpersonationToken(
  token: string,
  clerkUserId: string | null
): Promise<ImpersonationClaims | null> {
  const secret = getSecretKeyOptional()
  if (!secret || !clerkUserId) return null
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.typ !== JWT_TYP || payload.sub !== clerkUserId) return null
    if (!isPlatformAdmin(clerkUserId)) return null
    const orgId = payload.org_id as string | undefined
    const orgSlug = payload.org_slug as string | undefined
    const orgName = (payload.org_name as string | undefined) ?? ''
    if (!orgId || !orgSlug) return null
    return {
      orgId,
      orgSlug,
      orgName,
      readOnly: !!payload.ro,
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

/** Resolve impersonation from Request (API routes). */
export async function verifyImpersonationFromRequest(
  req: Request,
  clerkUserId: string | null
): Promise<ImpersonationClaims | null> {
  const raw = cookieValueFromHeader(req.headers.get('cookie'), IMPERSONATION_COOKIE)
  if (!raw) return null
  return verifyImpersonationToken(decodeURIComponent(raw), clerkUserId)
}

/** Middleware: read-only flag for blocking mutating /api/* calls. */
export async function getImpersonationReadOnlyFromRequest(
  request: NextRequest,
  userId: string | null
): Promise<boolean> {
  if (!userId) return false
  const raw = request.cookies.get(IMPERSONATION_COOKIE)?.value
  if (!raw) return false
  const claims = await verifyImpersonationToken(raw, userId)
  return claims?.readOnly ?? false
}
