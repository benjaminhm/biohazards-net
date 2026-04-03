/*
 * app/api/jobs/[id]/team/route.ts
 *
 * GET  /api/jobs/[id]/team — list people assigned to this job (with person details)
 * POST /api/jobs/[id]/team — assign a person to a job
 *
 * Uses the job_assignments join table. Returns 409 on duplicate assignment
 * (Postgres unique constraint code 23505).
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

async function getOrgId(userId: string) {
  const supabase = createServiceClient()
  const { data } = await supabase.from('org_users').select('org_id').eq('clerk_user_id', userId).single()
  return data?.org_id ?? null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = await getOrgId(userId)
  if (!orgId) return NextResponse.json({ assignments: [] })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('job_assignments')
    .select('*, people(id, name, role, phone, email, status)')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assignments: data ?? [] })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = await getOrgId(userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const { person_id } = await req.json()
  if (!person_id) return NextResponse.json({ error: 'person_id required' }, { status: 400 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('job_assignments')
    .insert({ job_id: jobId, person_id, org_id: orgId })
    .select('*, people(id, name, role, phone, email, status)')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Already assigned' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ assignment: data })
}
