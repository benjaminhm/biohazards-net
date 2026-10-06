/*
 * POST /api/portal/auth/code
 *
 * Exchange an email plus the six-digit code from the sign-in email for a portal
 * session cookie. Public, and the other half of /consume.
 *
 * This exists because the link often does not survive the trip. Corporate mail
 * gateways rewrite every URL they scan, and plenty of company policies tell
 * staff not to click links in mail from outside the business at all — for those
 * clients the magic link is unusable and the code is the only way in.
 *
 * The code alone is not a credential: it is checked against the address it was
 * sent to, which is what keeps six digits sufficient. lib/portalAuth caps wrong
 * guesses per issued code, and issuance is already rate limited per email.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getPortalTenant, PORTAL_TRADING_NAME_HEADER } from '@/lib/portalTenant'
import { consumePortalLoginCode, normalisePortalCode, signInFailureMessage } from '@/lib/portalAuth'
import { isSecureRequest, portalCookieHeader, signPortalToken } from '@/lib/portalSession'

export async function POST(req: Request) {
  const tenant = await getPortalTenant(req.headers.get(PORTAL_TRADING_NAME_HEADER))
  if (!tenant) {
    return NextResponse.json({ error: 'Accounts portal is not configured' }, { status: 404 })
  }

  let email = ''
  let code = ''
  try {
    const body = await req.json()
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    code = normalisePortalCode(body?.code)
  } catch {
    return NextResponse.json({ error: signInFailureMessage('invalid', 'code') }, { status: 400 })
  }

  if (!email || code.length !== 6) {
    return NextResponse.json(
      { error: 'Enter your email address and the 6-digit code from the email.' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()
  const result = await consumePortalLoginCode(
    supabase,
    tenant.orgId,
    tenant.tradingName,
    email,
    code
  )

  if (!result.ok) {
    return NextResponse.json({ error: signInFailureMessage(result.reason, 'code') }, { status: 401 })
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
