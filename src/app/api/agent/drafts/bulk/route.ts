/*
 * POST /api/agent/drafts/bulk  { action: 'approve' | 'reject', ids?: string[], job_id?: string }
 *
 * Accept all / Reject all. With job_id and no ids, acts on every pending draft
 * on that job. Each draft is applied on its own; failures are returned, not thrown.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { decideMany, listPendingDrafts } from '@/lib/agent/drafts'

export async function POST(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; ids?: unknown; job_id?: unknown }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 })
  }
  let ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : []
  if (!ids.length && typeof body.job_id === 'string') {
    ids = (await listPendingDrafts(g.supabase, g.orgId, body.job_id)).map(d => d.id)
  }
  if (!ids.length) return NextResponse.json({ error: 'Nothing to decide' }, { status: 400 })
  if (ids.length > 100) return NextResponse.json({ error: 'Too many at once' }, { status: 400 })
  const who = { orgId: g.orgId, userId: g.userId, firstName: await getStaffFirstName(g.userId) }
  const r = await decideMany(g.supabase, who, ids, body.action === 'approve')
  return NextResponse.json(r)
}
