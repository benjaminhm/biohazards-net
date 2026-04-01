import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { data: orgUser } = await supabase
    .from('org_users')
    .select('role, org_id, orgs(name, slug)')
    .eq('clerk_user_id', userId)
    .single()

  const clerk = await clerkClient()
  let name = ''
  try {
    const user = await clerk.users.getUser(userId)
    name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.emailAddresses[0]?.emailAddress || ''
  } catch { name = '' }

  return NextResponse.json({
    userId,
    name,
    role: orgUser?.role ?? 'owner',
    org_id: orgUser?.org_id ?? null,
    has_org: !!orgUser,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    org: (orgUser as any)?.orgs ?? null,
  })
}
