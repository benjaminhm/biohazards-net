/*
 * GET  /api/portal/terms — the current standing terms for this account's brand,
 *                          plus what the account has already accepted
 * POST /api/portal/terms/accept lives in ./accept/route.ts
 */
import { NextResponse } from 'next/server'
import { requirePortalContext } from '@/lib/portalScope'
import { areTermsCurrent, portalTermsFor } from '@/lib/portal/terms'

export async function GET(req: Request) {
  const ctx = await requirePortalContext(req)
  if ('response' in ctx) return ctx.response

  const terms = portalTermsFor(ctx.account.trading_name)

  return NextResponse.json({
    terms: {
      version: terms.version,
      published_at: terms.publishedAt,
      title: terms.title,
      html: terms.html,
    },
    accepted_version: ctx.account.terms_version,
    accepted_at: ctx.account.terms_accepted_at,
    current: areTermsCurrent(ctx.account.trading_name, ctx.account.terms_version),
  })
}
