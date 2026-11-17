/*
 * app/api/tracking/auth/code/route.ts
 *
 * POST { contact, code } — swap the texted or emailed code for the session cookie.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { normalisePortalCode } from '@/lib/portalAuth'
import { isSecureRequest } from '@/lib/portalSession'
import { trackingTradingNameFromRequest } from '@/lib/tracking/header'
import { parseTrackingIdentity } from '@/lib/tracking/identity'
import { codeFailureMessage, consumeCode } from '@/lib/tracking/server'
import { signTrackingToken, trackingCookieHeader } from '@/lib/tracking/session'

export async function POST(req: Request) {
  const tradingName = trackingTradingNameFromRequest(req)
  if (!tradingName) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { contact?: unknown; code?: unknown } = {}
  try {
    body = await req.json()
  } catch {}
  const identity = parseTrackingIdentity(body.contact)
  const code = normalisePortalCode(body.code)
  if (!identity || code.length !== 6) {
    return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })
  }

  const result = await consumeCode(createServiceClient(), identity.value, tradingName, code)
  if (!result.ok) return NextResponse.json({ error: codeFailureMessage(result.reason) }, { status: 401 })

  const token = await signTrackingToken({ identity: identity.value, tradingName })
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', trackingCookieHeader(token, isSecureRequest(req)))
  return res
}
