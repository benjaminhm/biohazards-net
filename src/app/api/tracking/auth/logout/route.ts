/*
 * app/api/tracking/auth/logout/route.ts
 *
 * POST — clear the tracking session cookie.
 */
import { NextResponse } from 'next/server'
import { isSecureRequest } from '@/lib/portalSession'
import { clearTrackingCookieHeader } from '@/lib/tracking/session'

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', clearTrackingCookieHeader(isSecureRequest(req)))
  return res
}
