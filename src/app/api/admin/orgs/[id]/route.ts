/*
 * app/api/admin/orgs/[id]/route.ts
 *
 * PATCH  /api/admin/orgs/[id] — update an org's plan, seat_limit, features, or is_active flag.
 * DELETE /api/admin/orgs/[id] — soft-delete an org by setting is_active = false.
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

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!isPlatformAdmin(userId ?? null)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const supabase = createServiceClient()

    // Soft-delete: set is_active = false
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
