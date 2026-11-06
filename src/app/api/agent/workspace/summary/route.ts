/*
 * GET /api/agent/workspace/summary — per-job markers for the workspace job
 * list: { jobs: { [jobId]: { pending_drafts, unread } }, new_jobs: DraftRow[] }.
 * new_jobs are head-agent proposals waiting for Create / Discard.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { workspaceMarkers } from '@/lib/agent/workspaceAgent'
import { listNewJobDrafts } from '@/lib/agent/drafts'

export async function GET(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const [jobs, newJobs] = await Promise.all([
    workspaceMarkers(g.supabase, g.orgId, g.userId),
    listNewJobDrafts(g.supabase, g.orgId),
  ])
  return NextResponse.json({ jobs, new_jobs: newJobs })
}
