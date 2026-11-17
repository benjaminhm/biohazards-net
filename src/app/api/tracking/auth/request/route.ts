/*
 * app/api/tracking/auth/request/route.ts
 *
 * POST { contact } — a mobile or email. When that person follows a job on this
 * brand, a 6-digit code is texted (or emailed). The reply is the same either
 * way, so the form cannot be used to find out who is a client.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { clientIpFromRequest } from '@/lib/portalAuth'
import { sendTrackingCodeEmail } from '@/lib/portal/email'
import { SHARED_TRACKING_HOST, tradingNameLabel, trackingBaseUrl, tradingNameOption } from '@/lib/tradingNames'
import { trackingIsShared, trackingTradingNameFromRequest } from '@/lib/tracking/header'
import { parseTrackingIdentity } from '@/lib/tracking/identity'
import { CODE_TTL_MINUTES, isCodeRateLimited, issueCode, textCode, viewerJobs } from '@/lib/tracking/server'

export async function POST(req: Request) {
  const tradingName = trackingTradingNameFromRequest(req)
  if (!tradingName) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let contact: unknown = null
  try {
    contact = (await req.json())?.contact
  } catch {}
  const identity = parseTrackingIdentity(contact)
  if (!identity) {
    return NextResponse.json({ error: 'Enter your mobile number (04…) or email address.' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const ip = clientIpFromRequest(req)
  if (await isCodeRateLimited(supabase, identity.value, ip)) {
    return NextResponse.json({ error: 'Too many codes asked for. Wait an hour and try again.' }, { status: 429 })
  }

  const code = await issueCode(supabase, identity.value, tradingName, ip)
  const shared = trackingIsShared(req)
  const jobs = await viewerJobs(supabase, identity.value, tradingName, shared)
  if (jobs.length) {
    const host = shared ? SHARED_TRACKING_HOST : tradingNameOption(tradingName)?.trackingHost
    try {
      if (identity.kind === 'mobile') {
        const brand = shared ? '' : `${tradingNameLabel(tradingName) ?? ''} `
        await textCode(
          identity.value,
          `Your ${brand}code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.${host ? `\n\n@${host} #${code}` : ''}`
        )
      } else {
        await sendTrackingCodeEmail({
          tradingName,
          to: identity.value,
          code,
          trackingUrl: shared ? `https://${SHARED_TRACKING_HOST}` : trackingBaseUrl(tradingName),
          expiresInMinutes: CODE_TTL_MINUTES,
        })
      }
    } catch (err) {
      console.error('[tracking] code send failed', err)
      return NextResponse.json({ error: 'The code could not be sent. Try again in a minute.' }, { status: 502 })
    }
  }

  return NextResponse.json({ ok: true, kind: identity.kind })
}
