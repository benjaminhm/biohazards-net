/*
 * app/api/jobs/[id]/team/[personId]/route.ts
 *
 * DELETE /api/jobs/[id]/team/[personId] — remove a person from a job's team.
 * Scoped by org_id to prevent cross-tenant removal.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

async function getOrgId(userId: string) {
  const supabase = createServiceClient()
  const { data } = await supabase.from('org_users').select('org_id').eq('clerk_user_id', userId).single()
  return data?.org_id ?? null
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; personId: string }> }) {
  const { id: jobId, personId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = await getOrgId(userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('job_assignments')
    .delete()
    .eq('job_id', jobId)
    .eq('person_id', personId)
    .eq('org_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
