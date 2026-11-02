/*
 * app/api/me/route.ts
 *
 * Returns the current staff user's identity and org membership.
 * Called on mount by UserProvider (lib/userContext.tsx).
 *
 * The display name is the linked person's name. The owner account, which has
 * no person row, keeps STAFF_DISPLAY_NAME. The user id is org_users.clerk_user_id.
 */
import { auth } from '@/lib/staffAuth'
import { NextResponse } from 'next/server'
import { resolveActiveMembership } from '@/lib/membership'
import { staffDisplayName } from '@/lib/staffLogin'
import { createServiceClient } from '@/lib/supabase'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const resolved = await resolveActiveMembership(userId)
  const orgUser = resolved.membership
  let name = staffDisplayName()
  if (orgUser?.person_id) {
    const supabase = createServiceClient()
    const { data: person } = await supabase
      .from('people')
      .select('name')
      .eq('id', orgUser.person_id)
      .maybeSingle()
    const personName = typeof person?.name === 'string' ? person.name.trim() : ''
    if (personName) name = personName
  }

  const role = (orgUser?.role === 'admin' || orgUser?.role === 'owner')
    ? 'admin'
    : (orgUser?.role === 'manager' || orgUser?.role === 'team_lead')
      ? 'manager'
      : 'member'

  return NextResponse.json({
    userId,
    name,
    role,
    capabilities: orgUser?.capabilities ?? {},
    org_id: orgUser?.org_id ?? null,
    has_org: !!orgUser,
    person_id: orgUser?.person_id ?? null,
    org: orgUser?.org
      ? {
          name: orgUser.org.name,
          slug: orgUser.org.slug,
          features: orgUser.org.features ?? {},
        }
      : null,
    membership_conflict: resolved.hasConflict,
  })
}
