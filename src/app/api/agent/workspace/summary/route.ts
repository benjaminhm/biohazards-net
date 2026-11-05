/*
 * GET /api/agent/workspace/summary — per-job markers for the workspace job
 * list: { jobs: { [jobId]: { pending_drafts, unread } } }.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { workspaceMarkers } from '@/lib/agent/workspaceAgent'

export async function GET(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  return NextResponse.json({ jobs: await workspaceMarkers(g.supabase, g.orgId, g.userId) })
}
