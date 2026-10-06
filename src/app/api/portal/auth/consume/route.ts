/*
 * POST /api/portal/auth/consume
 *
 * Exchange a magic-link token for a portal session cookie.
 *
 * POST rather than GET so that email scanners and link previewers, which follow
 * GET links before the recipient clicks, cannot burn the single-use token. The
 * confirm page at /portal/login/[token] is what calls this.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { consumePortalLoginToken, signInFailureMessage } from '@/lib/portalAuth'
import {
  isSecureRequest,
  portalCookieHeader,
  signPortalToken,
} from '@/lib/portalSession'

export async function POST(req: Request) {
  let token = ''
  try {
    const body = await req.json()
    token = typeof body?.token === 'string' ? body.token : ''
  } catch {
    return NextResponse.json({ error: signInFailureMessage('invalid', 'link') }, { status: 400 })
  }

  const supabase = createServiceClient()
  const result = await consumePortalLoginToken(supabase, token)

  if (!result.ok) {
    return NextResponse.json({ error: signInFailureMessage(result.reason, 'link') }, { status: 401 })
  }

  const jwt = await signPortalToken({
    contactId: result.session.contactId,
    accountId: result.session.accountId,
    orgId: result.session.orgId,
    tradingName: result.session.tradingName,
    email: result.session.contactEmail,
  })

  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', portalCookieHeader(jwt, isSecureRequest(req)))
  return res
}
