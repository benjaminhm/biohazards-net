/*
 * app/api/admin/users/route.ts
 *
 * GET /api/admin/users — list all org_users rows across the entire platform,
 * enriched with name, email, and avatar from Clerk.
 *
 * Restricted to PLATFORM_ADMIN_CLERK_IDS (super-admin only).
 *
 * Used by the platform admin dashboard to see who is on the platform and
 * which org they belong to. Supabase join `orgs(name, slug)` gives org context.
 * Clerk enrichment is done in parallel with Promise.all() — one call per user.
 * Unknown/deleted Clerk users fall back to empty name/email rather than failing.
 */
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { isPlatformOperator } from '@/lib/platformAdmin'

function emailFromClerkUser(user: {
  primaryEmailAddress: { emailAddress: string } | null
  emailAddresses: { emailAddress: string }[]
}): string {
  return (
    user.primaryEmailAddress?.emailAddress?.trim() ||
    user.emailAddresses?.find(e => e.emailAddress)?.emailAddress?.trim() ||
    ''
  )
}

export async function GET() {
  const { userId } = await auth()
  if (!(await isPlatformOperator(userId))) {
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
        const email = emailFromClerkUser(user)
        const name =
          user.fullName?.trim() ||
          [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
          email ||
          'Unknown'
        return {
          ...ou,
          email,
          name,
          image_url: user.imageUrl,
        }
      } catch {
        return { ...ou, email: '', name: 'Unknown', image_url: '' }
      }
    })
  )

  return NextResponse.json({ users: enriched })
}
