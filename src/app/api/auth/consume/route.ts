/*
 * POST /api/auth/consume
 *
 * Exchange a magic-link token for a staff session cookie.
 * POST rather than GET so email scanners cannot burn the single-use token.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  consumeStaffLogin,
  staffSignInFailureMessage,
  supabaseStaffTokenStore,
} from '@/lib/staffLogin'
import {
  isSecureStaffRequest,
  signStaffToken,
  staffCookieHeader,
} from '@/lib/staffSession'

export async function POST(req: Request) {
  let token = ''
  try {
    const body = await req.json()
    token = typeof body?.token === 'string' ? body.token : ''
  } catch {
    return NextResponse.json({ error: staffSignInFailureMessage('invalid') }, { status: 400 })
  }

  const result = await consumeStaffLogin(supabaseStaffTokenStore(createServiceClient()), token)
  if (!result.ok) {
    return NextResponse.json({ error: staffSignInFailureMessage(result.reason) }, { status: 401 })
  }

  const jwt = await signStaffToken({ userId: result.userId, email: result.email })
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', staffCookieHeader(jwt, isSecureStaffRequest(req)))
  return res
}
