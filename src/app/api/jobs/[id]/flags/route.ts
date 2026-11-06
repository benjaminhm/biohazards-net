/*
 * GET /api/jobs/[id]/flags — open staff flags pinned on the job, newest first.
 * Same staff roles as the full job file.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { listOpenFlags } from '@/lib/agent/flags'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const { id } = await params
  const { data: job } = await g.supabase.from('jobs').select('id').eq('id', id).eq('org_id', g.orgId).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json({ flags: await listOpenFlags(g.supabase, g.orgId, id) })
}
