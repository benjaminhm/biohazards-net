/*
 * POST /api/portal/auth/logout — clear the portal session cookie.
 */
import { NextResponse } from 'next/server'
import { clearPortalCookieHeader, isSecureRequest } from '@/lib/portalSession'

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', clearPortalCookieHeader(isSecureRequest(req)))
  return res
}
