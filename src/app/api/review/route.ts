/*
 * app/api/review/route.ts
 *
 * GET  /api/review — returns the org's submitted review (or null if none yet)
 * POST /api/review — submit a review for the org (one per org, upsert)
 *
 * Only org admins can submit. Used by the review card on the company dashboard.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ review: null })

  const { data } = await supabase
    .from('platform_reviews')
    .select('id, rating, body, reviewer_name, created_at')
    .eq('org_id', orgId)
    .single()

  return NextResponse.json({ review: data ?? null })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })

  // Only admins can submit
  const { data: orgUser } = await supabase
    .from('org_users')
    .select('role')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .single()

  if (!orgUser || orgUser.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { rating, body, reviewer_name } = await req.json()

  if (!rating || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be 1–5' }, { status: 400 })
  }

  // Upsert — one review per org
  const { data, error } = await supabase
    .from('platform_reviews')
    .upsert(
      { org_id: orgId, rating, body: body || null, reviewer_name: reviewer_name || null },
      { onConflict: 'org_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ review: data })
}
