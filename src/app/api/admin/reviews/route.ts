/*
 * app/api/admin/reviews/route.ts
 *
 * GET /api/admin/reviews — list all submitted platform reviews with org names.
 * Platform admin only.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

function isPlatformAdmin(userId: string | null): boolean {
  if (!userId) return false
  const adminIds = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return adminIds.includes(userId)
}

export async function GET() {
  const { userId } = await auth()
  if (!isPlatformAdmin(userId ?? null)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('platform_reviews')
    .select('*, orgs(name, slug)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reviews: data ?? [] })
}
