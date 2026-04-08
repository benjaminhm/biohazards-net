/*
 * app/api/people/[id]/access/route.ts
 *
 * Manages the org_users record for a people profile — i.e. the app access
 * and capabilities of a team member.
 *
 * GET  /api/people/[id]/access — returns the linked org_users row (role + capabilities)
 * PATCH /api/people/[id]/access — update role and/or capabilities for this person
 *
 * Both endpoints require the requesting user to be an org admin.
 *
 * Role demotion guard: if demoting to 'member', we verify at least one other
 * admin remains in the org to prevent accidental lockout.
 *
 * Note: the GET endpoint looks up by person_id first. If the org_users row has
 * not been linked (person_id is null), there is no fallback via Clerk email
 * without a full Clerk API call — returns null in that case.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { NextResponse } from 'next/server'

// GET: return org_users record for this person (matched by person_id or email)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  // Requester must be admin
  const { data: me } = await supabase
    .from('org_users').select('role').eq('clerk_user_id', userId).eq('org_id', orgId).single()
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch the person
  const { data: person } = await supabase.from('people').select('id, email').eq('id', id).eq('org_id', orgId).single()
  if (!person) return NextResponse.json({ access: null })

  // Try to find linked org_users: by person_id first, then email fallback
  let orgUserRow = null
  const { data: byPersonId } = await supabase
    .from('org_users').select('id, role, capabilities').eq('person_id', id).eq('org_id', orgId).single()
  if (byPersonId) {
    orgUserRow = byPersonId
  } else if (person.email) {
    // Fallback: match by Clerk email — requires a join via clerk_user_id
    // We can't directly query Clerk, so just return null if no person_id link
  }

  return NextResponse.json({ access: orgUserRow })
}

// PATCH: update role and/or capabilities for this person's org_users record
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  // Requester must be admin
  const { data: me } = await supabase
    .from('org_users').select('role').eq('clerk_user_id', userId).eq('org_id', orgId).single()
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { role, capabilities } = await req.json()

  // Only run the demotion guard if this person is currently an admin AND we're
  // changing them to a lower role. Saving a member/manager who was never admin
  // must never trigger this check.
  if (role === 'member' || role === 'manager' || role === 'team_lead') {
    const { data: current } = await supabase
      .from('org_users')
      .select('role')
      .eq('person_id', id)
      .eq('org_id', orgId)
      .single()

    if (current?.role === 'admin') {
      const { count } = await supabase
        .from('org_users')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('role', 'admin')
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'Cannot remove the last administrator. Assign another admin first.' }, { status: 400 })
      }
    }
  }

  const updates: Record<string, unknown> = {}
  if (role !== undefined) updates.role = role
  if (capabilities !== undefined) updates.capabilities = capabilities

  const { data, error } = await supabase
    .from('org_users')
    .update(updates)
    .eq('person_id', id)
    .eq('org_id', orgId)
    .select('id, role, capabilities')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ access: data })
}
