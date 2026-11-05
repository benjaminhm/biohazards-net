/*
 * GET /api/xero/callback
 *
 * Xero's OAuth redirect. Checks the state cookie set by /api/xero/connect,
 * exchanges the code, stores the encrypted tokens for the admin's org, then
 * returns to /settings with ?xero=connected or ?xero=error.
 */
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireXeroAdmin } from '@/lib/xero/admin'
import { completeXeroConnection } from '@/lib/xero/client'

const STATE_COOKIE = 'xero_oauth_state'

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const back = (status: string, reason?: string) => {
    const target = new URL('/settings', url)
    target.searchParams.set('xero', status)
    if (reason) target.searchParams.set('reason', reason.slice(0, 200))
    const res = NextResponse.redirect(target)
    res.cookies.set(STATE_COOKIE, '', { path: '/api/xero', maxAge: 0 })
    return res
  }

  const guard = await requireXeroAdmin()
  if ('response' in guard) return guard.response

  if (url.searchParams.get('error')) return back('error', url.searchParams.get('error') ?? '')

  const state = url.searchParams.get('state') ?? ''
  const cookie = req.headers.get('cookie') ?? ''
  const expected = cookie.split(/;\s*/).find(c => c.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1) ?? ''
  if (!state || !expected || !sameState(state, expected)) return back('error', 'Connection expired, please try again')

  const code = url.searchParams.get('code')
  if (!code) return back('error', 'Xero did not return an authorisation code')

  try {
    await completeXeroConnection(createServiceClient(), guard.orgId, code, guard.userId)
  } catch (err) {
    console.error('[xero] connect failed', err)
    return back('error', err instanceof Error ? err.message : 'Connection failed')
  }
  return back('connected')
}
