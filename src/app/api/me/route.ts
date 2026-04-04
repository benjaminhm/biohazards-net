/*
 * app/api/me/route.ts
 *
 * Returns the current authenticated user's identity and permissions.
 * Called on mount by UserProvider (lib/userContext.tsx) to bootstrap
 * the client-side user context used for all capability checks.
 *
 * Response shape: { userId, name, role, capabilities, org_id, has_org, org }
 *   - capabilities: the raw custom capabilities from org_users (not merged yet)
 *     — userContext merges with defaults client-side
 *   - has_org: false means the user is authenticated but not yet in any org
 *     (they'll be redirected to /pending)
 */
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { data: orgUser } = await supabase
    .from('org_users')
    .select('role, org_id, capabilities, person_id, orgs(name, slug)')
    .eq('clerk_user_id', userId)
    .single()

  const clerk = await clerkClient()
  let name = ''
  try {
    const user = await clerk.users.getUser(userId)
    name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress || ''
  } catch { name = '' }

  // 'owner' and 'admin' both get full admin access — 'owner' is the initial
  // role assigned when a company is first created on the platform.
  // 'manager' is passed through as-is for the middle tier.
  const role = (orgUser?.role === 'admin' || orgUser?.role === 'owner')
    ? 'admin'
    : orgUser?.role === 'manager'
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    org: (orgUser as any)?.orgs ?? null,
  })
}
