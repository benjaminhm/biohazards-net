/*
 * POST /api/accounts/[id]/reopen
 *
 * Hand a submitted trade account application back to the client to correct.
 *
 * Clearing application_submitted_at is what unlocks the portal form, so this is
 * the only route that may clear it — the client cannot unlock their own
 * submission. The reopen is stamped separately rather than by blanking the
 * submission columns silently, so the account page can still show that they did
 * submit and that we sent it back.
 */
import { NextResponse } from 'next/server'
import { requireAccountsAdmin } from '@/lib/accountsAdmin'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireAccountsAdmin(req)
  if ('response' in ctx) return ctx.response
  const { supabase, orgId, userId } = ctx

  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('client_accounts')
    .update({
      application_submitted_at: null,
      application_submitted_by_contact_id: null,
      application_reopened_at: now,
      application_reopened_by_user_id: userId,
      updated_at: now,
      updated_by_user_id: userId,
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .not('application_submitted_at', 'is', null)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    return NextResponse.json(
      { error: 'This application is not currently submitted.' },
      { status: 409 }
    )
  }

  return NextResponse.json({ ok: true, reopened_at: now })
}
