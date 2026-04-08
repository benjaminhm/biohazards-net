/*
 * app/api/me/route.ts
 *
 * Returns the current authenticated user's identity and permissions.
 * Called on mount by UserProvider (lib/userContext.tsx) to bootstrap
 * the client-side user context used for all capability checks.
 *
 * Response shape: { userId, name, role, capabilities, org_id, has_org, org }
 *   - When platform admin is impersonating a tenant, impersonating: true and
 *     org reflects the target org (JWT cookie — see lib/impersonation.ts).
 */
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { verifyImpersonationFromRequest } from '@/lib/impersonation'
import { resolveActiveMembership } from '@/lib/membership'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const imp = await verifyImpersonationFromRequest(req, userId)
  if (imp) {
    const clerk = await clerkClient()
    let name = ''
    try {
      const user = await clerk.users.getUser(userId)
      name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress || ''
    } catch { name = '' }

    const supabase = createServiceClient()
    const { data: org } = await supabase
      .from('orgs')
      .select('id, name, slug, features')
      .eq('id', imp.orgId)
      .eq('is_active', true)
      .maybeSingle()

    if (org) {
      return NextResponse.json({
        userId,
        name,
        role: 'admin',
        capabilities: {},
        org_id: org.id,
        has_org: true,
        person_id: null,
        org: {
          name: org.name,
          slug: org.slug,
          features: (org.features && typeof org.features === 'object' ? org.features : {}) as Record<string, boolean>,
        },
        impersonating: true,
        impersonation_read_only: imp.readOnly,
      })
    }
  }

  const resolved = await resolveActiveMembership(userId)
  const orgUser = resolved.membership

  const clerk = await clerkClient()
  let name = ''
  try {
    const user = await clerk.users.getUser(userId)
    name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress || ''
  } catch { name = '' }

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
    impersonating: false,
    impersonation_read_only: false,
  })
}
