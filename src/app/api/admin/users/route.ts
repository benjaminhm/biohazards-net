import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

const PLATFORM_ADMIN_IDS = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)

export async function GET() {
  const { userId } = await auth()
  if (!userId || !PLATFORM_ADMIN_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { data: orgUsers } = await supabase
    .from('org_users')
    .select('*, orgs(name, slug)')
    .order('created_at', { ascending: true })

  if (!orgUsers || orgUsers.length === 0) return NextResponse.json({ users: [] })

  const clerk = await clerkClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enriched = await Promise.all(
    orgUsers.map(async (ou: any) => {
      try {
        const user = await clerk.users.getUser(ou.clerk_user_id)
        return {
          ...ou,
          email: user.emailAddresses[0]?.emailAddress ?? '',
          name: ([user.firstName, user.lastName].filter(Boolean).join(' ')) || (user.emailAddresses[0]?.emailAddress ?? 'Unknown'),
          image_url: user.imageUrl,
        }
      } catch {
        return { ...ou, email: '', name: 'Unknown', image_url: '' }
      }
    })
  )

  return NextResponse.json({ users: enriched })
}
