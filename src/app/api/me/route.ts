/*
 * app/api/me/route.ts
 *
 * Returns the current staff user's identity and org membership.
 * Called on mount by UserProvider (lib/userContext.tsx).
 *
 * The display name comes from STAFF_DISPLAY_NAME. The user id is the existing
 * org_users.clerk_user_id, so membership lookup is unchanged.
 */
import { auth } from '@/lib/staffAuth'
import { NextResponse } from 'next/server'
import { resolveActiveMembership } from '@/lib/membership'
import { staffDisplayName } from '@/lib/staffLogin'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const resolved = await resolveActiveMembership(userId)
  const orgUser = resolved.membership
  const name = staffDisplayName()

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
