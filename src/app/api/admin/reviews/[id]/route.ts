/*
 * app/api/admin/reviews/[id]/route.ts
 *
 * PATCH /api/admin/reviews/[id] — toggle is_published on a platform review.
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!isPlatformAdmin(userId ?? null)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { is_published } = await req.json()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('platform_reviews')
    .update({ is_published })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ review: data })
}
