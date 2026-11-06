/*
 * POST /api/jobs/[id]/flags/[flagId]  { action: 'resolve' }
 *
 * Unpins a flag from the job and notes who resolved it in the job's chat.
 * Same staff roles as the full job file.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { resolveFlag } from '@/lib/agent/flags'
import { postMessage } from '@/lib/agent/drafts'

export async function POST(req: Request, { params }: { params: Promise<{ id: string; flagId: string }> }) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const { id, flagId } = await params
  const body = (await req.json().catch(() => ({}))) as { action?: unknown }
  if (body.action !== 'resolve') return NextResponse.json({ error: "action must be 'resolve'" }, { status: 400 })
  const { data: flag } = await g.supabase
    .from('job_flags')
    .select('id, message')
    .eq('id', flagId)
    .eq('job_id', id)
    .eq('org_id', g.orgId)
    .maybeSingle()
  if (!flag) return NextResponse.json({ error: 'Flag not found' }, { status: 404 })
  if (!(await resolveFlag(g.supabase, g.orgId, id, flagId, g.userId))) {
    return NextResponse.json({ error: 'Already resolved' }, { status: 409 })
  }
  const firstName = await getStaffFirstName(g.userId)
  await postMessage(g.supabase, {
    org_id: g.orgId, thread_id: g.userId, job_id: id, speaker: 'system', author: firstName,
    content: { text: `${firstName || 'Staff'} resolved the flag: ${flag.message as string}` },
  })
  return NextResponse.json({ ok: true })
}
