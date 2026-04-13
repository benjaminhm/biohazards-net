/*
 * GET  /api/jobs/[id]/progress-notes  — list notes (active, or include archived)
 * POST /api/jobs/[id]/progress-notes  — create note
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getClerkFirstName } from '@/lib/clerkDisplayName'

const MAX_BODY = 50_000

async function assertJob(
  supabase: ReturnType<typeof createServiceClient>,
  jobId: string,
  orgId: string
): Promise<boolean> {
  const { data } = await supabase.from('jobs').select('id').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  return !!data
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organisation inactive or you have no active organisation' },
        { status: 403 }
      )
    }
    const { id: jobId } = await params
    const supabase = createServiceClient()
    if (!(await assertJob(supabase, jobId, orgId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('progress_notes')
      .select('*')
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ notes: data ?? [] })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organisation inactive or you have no active organisation' },
        { status: 403 }
      )
    }
    const { id: jobId } = await params
    const supabase = createServiceClient()
    if (!(await assertJob(supabase, jobId, orgId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = (await req.json()) as { room?: string; body?: string }
    const room = (body.room ?? '').trim()
    const text = (body.body ?? '').trim()
    if (!text.length) {
      return NextResponse.json({ error: 'Note cannot be empty' }, { status: 400 })
    }
    if (text.length > MAX_BODY) {
      return NextResponse.json({ error: `Note must be at most ${MAX_BODY} characters` }, { status: 400 })
    }

    const first = await getClerkFirstName(userId)
    const { data, error } = await supabase
      .from('progress_notes')
      .insert({
        org_id: orgId,
        job_id: jobId,
        room,
        body: text,
        created_by_user_id: userId,
        updated_by_user_id: userId,
        created_by_first_name: first,
        updated_by_first_name: first,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ note: data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
