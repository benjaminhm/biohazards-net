/*
 * app/api/admin/orgs/route.ts
 *
 * GET  /api/admin/orgs — list all orgs on the platform with their user counts.
 * POST /api/admin/orgs — provision a new org (name + slug required).
 *
 * Both methods are restricted to PLATFORM_ADMIN_CLERK_IDS — this is a
 * super-admin surface for Biohazards.net staff, not for org-level admins.
 *
 * The GET response flattens the Supabase join: org_users(count) is an array
 * from PostgREST and needs to be unwrapped to a plain number.
 *
 * POST defaults plan to 'solo' and seat_limit to 1 if not provided — caller
 * can override these via the request body.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'

function isPlatformAdmin(userId: string | null): boolean {
  if (!userId) return false
  const adminIds = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return adminIds.includes(userId)
}

export async function GET() {
  try {
    const { userId } = await auth()
    if (!isPlatformAdmin(userId ?? null)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()

    // Fetch orgs with user counts via a join
    const { data: orgs, error: orgsError } = await supabase
      .from('orgs')
      .select('*, org_users(count)')
      .order('created_at', { ascending: false })

    if (orgsError) throw orgsError

    const result = (orgs ?? []).map((org) => {
      const countArr = org.org_users as { count: number }[] | null
      const userCount = Array.isArray(countArr) && countArr.length > 0 ? countArr[0].count : 0
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { org_users, ...rest } = org
      return { ...rest, user_count: userCount }
    })

    return NextResponse.json({ orgs: result })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    if (!isPlatformAdmin(userId ?? null)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { name, slug, plan, seat_limit } = await req.json()
    if (!name || !slug) {
      return NextResponse.json({ error: 'Missing name or slug' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('orgs')
      .insert({ name, slug, plan: plan ?? 'solo', seat_limit: seat_limit ?? 1 })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ org: data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
