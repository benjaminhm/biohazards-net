/*
 * app/api/jobs/[id]/route.ts
 *
 * GET    /api/jobs/[id]  — fetch a single job + its photos in parallel
 * PATCH  /api/jobs/[id]  — partial update (status, fields, assessment_data, etc.)
 * DELETE /api/jobs/[id]  — hard delete the job record
 *
 * Every operation enforces org_id scoping (.eq('org_id', orgId)) so a user
 * in org A cannot access jobs in org B even if they know the UUID.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()

    const [jobRes, photosRes] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', id).eq('org_id', orgId).single(),
      supabase.from('photos').select('*').eq('job_id', id).order('uploaded_at', { ascending: false }),
    ])

    if (jobRes.error) throw jobRes.error
    return NextResponse.json({ job: jobRes.data, photos: photosRes.data ?? [] })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('jobs')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ job: data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()
    const { error } = await supabase.from('jobs').delete().eq('id', id).eq('org_id', orgId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
