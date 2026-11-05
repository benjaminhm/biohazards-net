/*
 * GET /api/xero/connect
 *
 * Admin only. Starts Xero OAuth: sets a one-time state cookie and redirects to
 * Xero's consent screen. Xero returns to /api/xero/callback.
 */
import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireXeroAdmin } from '@/lib/xero/admin'
import { xeroAuthorizeUrl, xeroConfigured } from '@/lib/xero/client'

const XERO_STATE_COOKIE = 'xero_oauth_state'

export async function GET(req: Request) {
  const guard = await requireXeroAdmin()
  if ('response' in guard) return guard.response
  if (!xeroConfigured()) {
    return NextResponse.redirect(new URL('/settings?xero=not_configured', req.url))
  }

  const state = randomBytes(24).toString('hex')
  const res = NextResponse.redirect(xeroAuthorizeUrl(state))
  res.cookies.set(XERO_STATE_COOKIE, state, {
    httpOnly: true,
    secure: new URL(req.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/xero',
    maxAge: 600,
  })
  return res
}
