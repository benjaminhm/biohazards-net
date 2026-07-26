/*
 * POST /api/portal/auth/request
 *
 * Ask for a magic link. Public — this is the front door of the accounts portal.
 *
 * The response is always the same generic success, whatever happens: an attacker
 * must not be able to use this endpoint to discover which email addresses hold a
 * trade account with us. Rate limiting is counted before the email is resolved so
 * unknown addresses are throttled too.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getPortalTenant, PORTAL_TRADING_NAME_HEADER } from '@/lib/portalTenant'
import {
  clientIpFromRequest,
  findPortalLoginTarget,
  isPortalLoginRateLimited,
  issuePortalLoginToken,
  userAgentFromRequest,
  TOKEN_TTL_MINUTES,
} from '@/lib/portalAuth'
import { sendPortalMagicLinkEmail } from '@/lib/portal/email'

/** Same body for every outcome — see the note above. */
const GENERIC_OK = {
  ok: true,
  message: 'If that email is on a trade account with us, a sign-in link is on its way.',
}

export async function POST(req: Request) {
  const tenant = await getPortalTenant(req.headers.get(PORTAL_TRADING_NAME_HEADER))
  if (!tenant) {
    return NextResponse.json({ error: 'Accounts portal is not configured' }, { status: 404 })
  }

  let email = ''
  try {
    const body = await req.json()
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const ip = clientIpFromRequest(req)
  const userAgent = userAgentFromRequest(req)

  if (await isPortalLoginRateLimited(supabase, email, ip)) {
    return NextResponse.json(
      { error: 'Too many sign-in requests. Please wait a few minutes and try again.' },
      { status: 429 }
    )
  }

  const target = await findPortalLoginTarget(supabase, tenant.orgId, tenant.tradingName, email)
  if (!target) return NextResponse.json(GENERIC_OK)

  const token = await issuePortalLoginToken(supabase, target, ip, userAgent)
  if (!token) return NextResponse.json(GENERIC_OK)

  const origin = new URL(req.url).origin
  try {
    await sendPortalMagicLinkEmail({
      tradingName: tenant.tradingName,
      to: target.contactEmail,
      contactName: target.contactName,
      loginUrl: `${origin}/portal/login/${token}`,
      expiresInMinutes: TOKEN_TTL_MINUTES,
    })
  } catch (err) {
    // Do not leak delivery failure to the caller — it would confirm the address
    // exists. Log it so a broken Resend domain is visible in runtime logs.
    console.error('[portal-magic-link] send failed', err)
  }

  return NextResponse.json(GENERIC_OK)
}
