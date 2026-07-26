/*
 * POST /api/portal/terms/accept
 *
 * Record the account's acceptance of the current standing Terms & Conditions.
 * This is the master agreement that makes later one-click quote acceptance
 * meaningful, so the contact, timestamp, IP and user agent are all recorded.
 *
 * Body: { version } — the version the client was actually shown. If the
 * published version has moved on since the page loaded, the request is rejected
 * rather than silently recording acceptance of wording they never read.
 */
import { NextResponse } from 'next/server'
import { requirePortalContext } from '@/lib/portalScope'
import { portalTermsFor } from '@/lib/portal/terms'
import { clientIpFromRequest, userAgentFromRequest } from '@/lib/portalAuth'

export async function POST(req: Request) {
  const ctx = await requirePortalContext(req)
  if ('response' in ctx) return ctx.response

  let version = ''
  try {
    const body = await req.json()
    version = typeof body?.version === 'string' ? body.version : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const terms = portalTermsFor(ctx.account.trading_name)
  if (version !== terms.version) {
    return NextResponse.json(
      { error: 'These terms have been updated. Please reload the page and read the current version.' },
      { status: 409 }
    )
  }

  const { error } = await ctx.supabase
    .from('client_accounts')
    .update({
      terms_version: terms.version,
      terms_accepted_at: new Date().toISOString(),
      terms_accepted_by_contact_id: ctx.contact.id,
      terms_accepted_ip: clientIpFromRequest(req),
      terms_accepted_user_agent: userAgentFromRequest(req),
      updated_at: new Date().toISOString(),
    })
    .eq('id', ctx.accountId)
    .eq('org_id', ctx.orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, version: terms.version })
}
