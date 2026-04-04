/*
 * app/api/public/reviews/route.ts
 *
 * GET /api/public/reviews — returns all published platform reviews.
 * Fully public — no auth required. Used by biohazards.net marketing site.
 *
 * Returns: id, rating, body, reviewer_name, org name, created_at
 * Never returns org_id or internal fields.
 */
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('platform_reviews')
    .select('id, rating, body, reviewer_name, created_at, orgs(name)')
    .eq('is_published', true)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reviews = (data ?? []).map((r: any) => ({
    id: r.id,
    rating: r.rating,
    body: r.body,
    reviewer_name: r.reviewer_name,
    org_name: Array.isArray(r.orgs) ? r.orgs[0]?.name : r.orgs?.name,
    created_at: r.created_at,
  }))

  return NextResponse.json({ reviews })
}
