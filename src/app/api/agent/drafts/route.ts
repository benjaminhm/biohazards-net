/*
 * GET /api/agent/drafts?job_id=<id> — pending agent drafts on one job.
 * Used by the workspace right panel and the Classic job page banner.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { listPendingDrafts } from '@/lib/agent/drafts'

export async function GET(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const jobId = new URL(req.url).searchParams.get('job_id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
  const drafts = await listPendingDrafts(g.supabase, g.orgId, jobId)
  return NextResponse.json({ drafts })
}
