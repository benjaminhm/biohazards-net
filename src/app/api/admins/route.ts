/*
 * app/api/admins/route.ts
 *
 * GET    /api/admins — list all admin users for the org (enriched with Clerk names)
 * DELETE /api/admins — demote an admin to member (org admin only)
 *
 * Names come from Clerk because org_users only stores clerk_user_id, not PII.
 * Enrichment is done with Promise.all() — one Clerk API call per admin in parallel.
 *
 * Last-admin guard: if demoting would leave zero admins, returns 400.
 */
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { NextResponse } from 'next/server'

// GET: list all admins for the org (with names from Clerk)
export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  const { data: rows } = await supabase
    .from('org_users')
    .select('id, clerk_user_id, role')
    .eq('org_id', orgId)
    .eq('role', 'admin')

  if (!rows?.length) return NextResponse.json({ admins: [] })

  const clerk = await clerkClient()
  const admins = await Promise.all(rows.map(async row => {
    try {
      const user = await clerk.users.getUser(row.clerk_user_id)
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress || 'Unknown'
      const email = user.emailAddresses[0]?.emailAddress ?? ''
      return { id: row.id, clerk_user_id: row.clerk_user_id, name, email }
    } catch {
      return { id: row.id, clerk_user_id: row.clerk_user_id, name: 'Unknown', email: '' }
    }
  }))

  return NextResponse.json({ admins })
}

// DELETE: demote an admin to member (last-admin protected)
export async function DELETE(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  // Requester must be admin
  const { data: me } = await supabase
    .from('org_users').select('role').eq('clerk_user_id', userId).eq('org_id', orgId).single()
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { orgUserId } = await req.json()

  // Count admins — must keep at least one
  const { count } = await supabase
    .from('org_users').select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('role', 'admin')
  if ((count ?? 0) <= 1) {
    return NextResponse.json({ error: 'Cannot remove the last administrator.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('org_users').update({ role: 'member' }).eq('id', orgUserId).eq('org_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
