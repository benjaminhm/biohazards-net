/*
 * app/api/jobs/route.ts
 *
 * GET  /api/jobs          — list all jobs for the current org
 * POST /api/jobs          — create a new job (status defaults to 'lead')
 *
 * GET supports ?upcoming=true to fetch the next 10 scheduled jobs in
 * chronological order (used by the field schedule view).
 * All queries are scoped by org_id to enforce tenancy isolation.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function GET(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const upcoming = searchParams.get('upcoming') === 'true'
    const supabase = createServiceClient()

    let query = supabase.from('jobs').select('*').eq('org_id', orgId)

    if (upcoming) {
      query = query
        .not('scheduled_at', 'is', null)
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(10)
    } else {
      query = query.order('created_at', { ascending: false })
    }

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ jobs: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { client_name, client_phone, client_email, site_address, job_type, urgency } = body

    if (!client_name || !site_address || !job_type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        client_name,
        client_phone: client_phone ?? '',
        client_email: client_email ?? '',
        site_address,
        job_type,
        urgency: urgency ?? 'standard',
        status: 'lead',
        notes: '',
        assessment_data: null,
        org_id: orgId,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ job: data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
