/*
 * POST /api/auth/request
 *
 * Ask for a staff magic link. The response is the same whether or not the
 * address is allowed to sign in.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { clientIpFromRequest, userAgentFromRequest } from '@/lib/portalAuth'
import { sendStaffMagicLinkEmail } from '@/lib/portal/email'
import { issueStaffLogin, supabaseStaffTokenStore } from '@/lib/staffLogin'
import { lookupStaffIdentityByEmail } from '@/lib/staffIdentity'
import { magicLinkOrigin } from '@/lib/staffSession'

/** LAN testing keeps the phone's host. The live app always emails login.biohazards.net. */
function publicOrigin(req: Request): string {
  return magicLinkOrigin(
    req.url,
    req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
    req.headers.get('x-forwarded-proto'),
  )
}

const GENERIC_OK = {
  ok: true,
  message: 'If that email can sign in, a link is on its way.',
}

export async function POST(req: Request) {
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
  const issued = await issueStaffLogin(
    supabaseStaffTokenStore(supabase),
    email,
    clientIpFromRequest(req),
    userAgentFromRequest(req),
    lookupStaffIdentityByEmail
  )

  if (issued.status === 'limited') {
    return NextResponse.json(
      { error: 'Too many sign-in requests. Please wait a few minutes and try again.' },
      { status: 429 }
    )
  }

  if (issued.status === 'issued') {
    const origin = publicOrigin(req)
    try {
      await sendStaffMagicLinkEmail({
        to: issued.email,
        loginUrl: `${origin}/login/${issued.token}`,
        expiresInMinutes: issued.ttlMinutes,
      })
    } catch (err) {
      console.error('[staff-magic-link] send failed', err)
    }
  }

  return NextResponse.json(GENERIC_OK)
}
