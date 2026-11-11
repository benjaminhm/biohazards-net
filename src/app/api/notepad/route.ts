/*
 * /api/notepad — the signed-in staff member's private notepad.
 *
 *   GET            { body, updated_at }   empty body and null until the first save
 *   PUT { body }   saves the whole pad, returns { updated_at }
 *
 * One row per (org_id, owner_user_id) in staff_notepads (migration 067).
 * Every query filters by both, so nobody reads or writes another person's pad.
 * Desk staff only: the proxy keeps technicians off this route (lib/staffDesk).
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'
import { notepadBodyError } from '@/lib/notepad'

async function padOwner(req: Request): Promise<{ userId: string; orgId: string } | NextResponse> {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No active organisation' }, { status: 403 })
  return { userId, orgId }
}

export async function GET(req: Request) {
  const owner = await padOwner(req)
  if (owner instanceof NextResponse) return owner

  const { data, error } = await createServiceClient()
    .from('staff_notepads')
    .select('body, updated_at')
    .eq('org_id', owner.orgId)
    .eq('owner_user_id', owner.userId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    body: (data?.body as string | undefined) ?? '',
    updated_at: (data?.updated_at as string | undefined) ?? null,
  })
}

export async function PUT(req: Request) {
  const owner = await padOwner(req)
  if (owner instanceof NextResponse) return owner

  const payload = (await req.json().catch(() => null)) as { body?: unknown } | null
  const body = payload?.body
  const problem = notepadBodyError(body)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  // Read updated_at back so GET and PUT hand the client the same timestamp text.
  const { data, error } = await createServiceClient()
    .from('staff_notepads')
    .upsert(
      { org_id: owner.orgId, owner_user_id: owner.userId, body, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,owner_user_id' },
    )
    .select('updated_at')
    .single()
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Could not save the notepad.' }, { status: 500 })
  }

  return NextResponse.json({ updated_at: data.updated_at as string })
}
