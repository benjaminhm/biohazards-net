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

function publicOrigin(req: Request): string {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'app.biohazards.net')
    .split(',')[0]
    .trim()
  const proto = (req.headers.get('x-forwarded-proto') ?? 'https').split(',')[0].trim()
  return `${proto}://${host}`
}

async function readToken(req: Request): Promise<{ token: string; redirect: boolean }> {
  const type = req.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    const body = await req.json()
    return { token: typeof body?.token === 'string' ? body.token : '', redirect: false }
  }
  const form = await req.formData()
  const token = form.get('token')
  return { token: typeof token === 'string' ? token : '', redirect: true }
}

export async function POST(req: Request) {
  let token = ''
  let redirect = false
  try {
    const read = await readToken(req)
    token = read.token
    redirect = read.redirect
  } catch {
    return NextResponse.json({ error: staffSignInFailureMessage('invalid') }, { status: 400 })
  }

  const fail = (reason: 'invalid' | 'expired' | 'used') => {
    if (!redirect) {
      const status = reason === 'invalid' && !token ? 400 : 401
      return NextResponse.json({ error: staffSignInFailureMessage(reason) }, { status })
    }
    const back = new URL('/login', publicOrigin(req))
    back.searchParams.set('error', reason)
    return NextResponse.redirect(back, 303)
  }

  if (!token) return fail('invalid')

  const result = await consumeStaffLogin(supabaseStaffTokenStore(createServiceClient()), token)
  if (!result.ok) return fail(result.reason)

  const jwt = await signStaffToken({ userId: result.userId, email: result.email })
  const res = redirect
    ? NextResponse.redirect(new URL('/', publicOrigin(req)), 303)
    : NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', staffCookieHeader(jwt, isSecureStaffRequest(req)))
  return res
}
