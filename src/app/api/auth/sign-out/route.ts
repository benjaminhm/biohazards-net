/*
 * POST /api/auth/sign-out
 *
 * Clear the staff session cookie.
 */
import { NextResponse } from 'next/server'
import { clearStaffCookieHeader, isSecureStaffRequest } from '@/lib/staffSession'

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', clearStaffCookieHeader(isSecureStaffRequest(req)))
  return res
}
