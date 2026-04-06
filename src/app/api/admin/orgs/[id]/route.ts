/*
 * app/api/admin/orgs/[id]/route.ts
 *
 * PATCH  /api/admin/orgs/[id] — update an org's plan, seat_limit, features, or is_active flag.
 * DELETE /api/admin/orgs/[id] — soft-delete an org by setting is_active = false.
 * JSON body (required): { "confirm_name": "<exact org name>" } — must match orgs.name
 * character-for-character (case-sensitive). Prevents accidental deactivation.
 *
 * Both methods are restricted to PLATFORM_ADMIN_CLERK_IDS (super-admin only).
 *
 * PATCH accepts a partial body — only the provided fields are applied, so
 * callers can change just the plan without touching seat_limit, etc.
 *
 * DELETE is non-destructive: is_active = false hides the org from the platform
 * admin UI and prevents login, but all data is preserved for recovery.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'

function isPlatformAdmin(userId: string | null): boolean {
  if (!userId) return false
  const adminIds = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return adminIds.includes(userId)
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!isPlatformAdmin(userId ?? null)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const supabase = createServiceClient()

    const [
      { data: org, error: orgErr },
      { data: people },
      { data: orgUsers },
      { data: invites },
    ] = await Promise.all([
      supabase.from('orgs').select('*').eq('id', id).single(),
      supabase.from('people').select('*').eq('org_id', id).order('name'),
      supabase.from('org_users').select('*').eq('org_id', id),
      supabase.from('invites').select('*').eq('org_id', id).order('created_at', { ascending: false }),
    ])

    if (orgErr || !org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      org,
      people: people ?? [],
      org_users: orgUsers ?? [],
      invites: invites ?? [],
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!isPlatformAdmin(userId ?? null)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const { plan, seat_limit, features, is_active } = body

    const update: Record<string, unknown> = {}
    if (plan !== undefined) update.plan = plan
    if (seat_limit !== undefined) update.seat_limit = seat_limit
    if (features !== undefined) update.features = features
    if (is_active !== undefined) update.is_active = is_active

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('orgs')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ org: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!isPlatformAdmin(userId ?? null)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const supabase = createServiceClient()

    const body = await req.json().catch(() => ({}))
    const confirm_name = typeof body.confirm_name === 'string' ? body.confirm_name : ''
    if (!confirm_name) {
      return NextResponse.json(
        { error: 'confirm_name is required (exact organisation name, case-sensitive).' },
        { status: 400 }
      )
    }

    const { data: orgRow, error: fetchErr } = await supabase.from('orgs').select('id, name').eq('id', id).single()
    if (fetchErr || !orgRow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (confirm_name !== orgRow.name) {
      return NextResponse.json(
        { error: 'Organisation name does not match. Check spelling and capital letters.' },
        { status: 400 }
      )
    }

    // Soft-delete: set is_active = false (data retained for recovery)
    const { data, error } = await supabase
      .from('orgs')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ org: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
