/*
 * POST /api/agent/drafts/[id]  { action: 'approve' | 'reject' }
 *
 * Approving applies the agent's change to the job, logs it to agent_actions
 * and posts an "approved by" line in the job's chat history.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { approveDraft, rejectDraft } from '@/lib/agent/drafts'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { action?: unknown }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 })
  }
  const who = { orgId: g.orgId, userId: g.userId, firstName: await getStaffFirstName(g.userId) }
  const r = body.action === 'approve' ? await approveDraft(g.supabase, who, id) : await rejectDraft(g.supabase, who, id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 })
  return NextResponse.json({ draft: r.draft })
}
