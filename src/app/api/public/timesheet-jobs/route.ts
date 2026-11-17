/*
 * app/api/public/timesheet-jobs/route.ts
 *
 * GET /api/public/timesheet-jobs — open jobs for the staff timesheet app's job picker.
 * Server-to-server only: the caller sends `Authorization: Bearer <TIMESHEET_JOBS_SECRET>`,
 * and the org comes from TIMESHEET_JOBS_ORG_SLUG, never from the request.
 *
 * Returns job code, site address, coordinates and job type only. Never client details.
 * Answers 404 until both env vars are set.
 */
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

/** Jobs quieter than this drop off the list, so it stays short enough to scroll on a phone. */
const RECENT_DAYS = 60

function authorised(req: Request, secret: string) {
  const sent = Buffer.from(req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '')
  const want = Buffer.from(secret)
  return sent.length === want.length && timingSafeEqual(sent, want)
}

export async function GET(req: Request) {
  const secret = process.env.TIMESHEET_JOBS_SECRET
  const slug = process.env.TIMESHEET_JOBS_ORG_SLUG
  if (!secret || !slug) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!authorised(req, secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { data: org } = await supabase.from('orgs').select('id').eq('slug', slug).maybeSingle()
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
  const { data, error } = await supabase
    .from('jobs')
    .select('job_code, site_address, site_lat, site_lng, job_type, status, updated_at')
    .eq('org_id', org.id)
    .is('archived_at', null)
    .not('job_code', 'is', null)
    .neq('status', 'paid')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const jobs = (data ?? [])
    .filter(j => String(j.job_code ?? '').trim() && String(j.site_address ?? '').trim())
    .map(j => ({
      code: String(j.job_code).trim(),
      address: String(j.site_address).trim(),
      lat: typeof j.site_lat === 'number' ? j.site_lat : null,
      lng: typeof j.site_lng === 'number' ? j.site_lng : null,
      job_type: j.job_type ?? null,
    }))
  return NextResponse.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } })
}
