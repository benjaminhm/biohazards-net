/*
 * POST /api/pack/[token] — what the client's statement pack page reports.
 *
 *   { action: 'unlock', code }   the passcode for a link staff sent themselves
 *   { action: 'view' }           a document in the pack was opened in a browser
 *
 * Public: the token in the path is the credential. Five wrong passcodes lock
 * the link, same as quote links.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { UNLOCK_SECONDS, isUnlocked, passcodeAttempt, unlockCookieName, unlockCookieValue } from '@/lib/signing/core'
import { packLinkState } from '@/lib/documentPack'
import { findPackByToken } from '@/lib/documentPackStore'

const LOCKED_MESSAGE = 'The wrong passcode was entered too many times, so this link has been locked. Please contact us for a new link.'

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const raw = await req.text()
  if (raw.length > 2000) return NextResponse.json({ error: 'Invalid request' }, { status: 413 })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const pack = await findPackByToken(supabase, token)
  if (!pack) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })

  const now = new Date()
  const nowIso = now.toISOString()
  const state = packLinkState(pack, now)
  if (state === 'locked') return NextResponse.json({ error: LOCKED_MESSAGE, locked: true }, { status: 423 })
  if (state !== 'open') {
    return NextResponse.json(
      { error: state === 'expired' ? 'This link has expired. Please contact us for a new one.' : 'This link is no longer in use. Please contact us for a new one.' },
      { status: 409 },
    )
  }

  if (body.action === 'unlock') {
    if (!pack.passcode) return NextResponse.json({ ok: true })
    const result = passcodeAttempt(
      { passcode: pack.passcode, passcode_attempts: pack.passcode_attempts, passcode_verified_at: pack.passcode_verified_at },
      body.code,
      now,
    )
    // Only counts if nobody else's try landed in between, so tries cannot be raced past the limit.
    const { data: saved, error } = await supabase
      .from('document_packs')
      .update({ ...result.patch, updated_at: nowIso })
      .eq('id', pack.id)
      .eq('passcode_attempts', pack.passcode_attempts)
      .is('passcode_locked_at', null)
      .select('id')
      .maybeSingle()
    if (error || !saved) return NextResponse.json({ error: 'Could not check the passcode. Please try again.' }, { status: 409 })
    if (!result.ok) {
      if (result.locked) return NextResponse.json({ error: LOCKED_MESSAGE, locked: true }, { status: 423 })
      const left = result.triesLeft
      return NextResponse.json({ error: `That passcode is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` }, { status: 401 })
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set(unlockCookieName(token), unlockCookieValue(token, pack.passcode), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: UNLOCK_SECONDS,
    })
    return res
  }

  if (!isUnlocked(req.headers.get('cookie'), token, pack.passcode)) {
    return NextResponse.json({ error: 'Please enter your passcode first. Reload this page to do that.' }, { status: 401 })
  }

  if (body.action === 'view') {
    await supabase
      .from('document_packs')
      .update({
        ...(pack.first_viewed_at ? {} : { first_viewed_at: nowIso }),
        status: 'viewed',
        last_viewed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', pack.id)
      .neq('status', 'voided')
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
