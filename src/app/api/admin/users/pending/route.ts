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
  const { data: orgUsers } = await supabase.from('org_users').select('clerk_user_id')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignedIds = new Set((orgUsers ?? []).map((u: any) => u.clerk_user_id))

  const clerk = await clerkClient()
  const { data: allUsers } = await clerk.users.getUserList({ limit: 100 })

  const pending = allUsers
    .filter(u => !assignedIds.has(u.id))
    .map(u => ({
      clerk_user_id: u.id,
      email: u.emailAddresses[0]?.emailAddress ?? '',
      name: ([u.firstName, u.lastName].filter(Boolean).join(' ')) || (u.emailAddresses[0]?.emailAddress ?? 'Unknown'),
      image_url: u.imageUrl,
      created_at: new Date(u.createdAt).toISOString(),
    }))

  return NextResponse.json({ users: pending })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId || !PLATFORM_ADMIN_IDS.includes(userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { clerk_user_id, org_id, role } = await req.json()
  if (!clerk_user_id || !org_id || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = createServiceClient()
  const { error } = await supabase.from('org_users').insert({ clerk_user_id, org_id, role })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
