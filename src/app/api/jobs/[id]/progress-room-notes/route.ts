import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { getClerkFirstName } from '@/lib/clerkDisplayName'

const MAX_NOTE = 50_000

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
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: jobId } = await params
    const supabase = createServiceClient()
    if (!(await assertJob(supabase, jobId, orgId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const { data, error } = await supabase
      .from('progress_room_notes')
      .select('*')
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .order('room_name', { ascending: true })
    if (error) throw error
    return NextResponse.json({ notes: data ?? [] })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not load progress room notes' },
      { status: 500 }
    )
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Organisation unavailable' }, { status: 403 })
    const { id: jobId } = await params
    const body = (await req.json()) as { room_name?: string; note?: string }
    const roomName = (body.room_name ?? '').trim()
    if (!roomName) return NextResponse.json({ error: 'Room is required' }, { status: 400 })
    const note = String(body.note ?? '').slice(0, MAX_NOTE)

    const supabase = createServiceClient()
    if (!(await assertJob(supabase, jobId, orgId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const first = await getClerkFirstName(userId)
    const now = new Date().toISOString()

    const { data: existing } = await supabase
      .from('progress_room_notes')
      .select('id, created_by_user_id, created_by_first_name, created_at')
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .eq('room_name', roomName)
      .maybeSingle()

    const payload = {
      org_id: orgId,
      job_id: jobId,
      room_name: roomName,
      note,
      updated_at: now,
      updated_by_user_id: userId,
      updated_by_first_name: first,
      created_by_user_id: existing?.created_by_user_id ?? userId,
      created_by_first_name: existing?.created_by_first_name ?? first,
      created_at: existing?.created_at ?? now,
    }

    const { data, error } = await supabase
      .from('progress_room_notes')
      .upsert(payload, { onConflict: 'org_id,job_id,room_name' })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ note: data })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not save progress room note' },
      { status: 500 }
    )
  }
}
