/*
 * GET /api/agent/workspace/agents?job=<id> — the document agents under one job
 * in the workspace list: { file_agent: { pending_drafts, unread }, agents: [{
 * type, label, doc_label, state, applicable, pending_drafts, unread, health,
 * health_messages }] }. One request per expanded job.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { jobAgentsSummary } from '@/lib/agent/workspaceAgent'

const UUID = /^[0-9a-f-]{36}$/i

export async function GET(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const jobId = new URL(req.url).searchParams.get('job') ?? ''
  if (!UUID.test(jobId)) return NextResponse.json({ error: 'job is required' }, { status: 400 })
  const summary = await jobAgentsSummary(g.supabase, g.orgId, g.userId, jobId, g.role)
  if (!summary) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json(summary)
}
