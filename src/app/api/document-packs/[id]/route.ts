/*
 * PATCH /api/document-packs/[id] { action: 'void' } — cancel a statement pack
 * link, so it can no longer be opened. Full-access staff who are shown money.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { seesFinancials } from '@/lib/agent/jobSnapshot'
import { listPacks } from '@/lib/documentPackStore'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  if (!seesFinancials(g.role as Parameters<typeof seesFinancials>[0])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { action?: unknown }
  if (body.action !== 'void') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  const nowIso = new Date().toISOString()
  const { data: pack, error } = await g.supabase
    .from('document_packs')
    .update({ status: 'voided', voided_at: nowIso, voided_by: g.userId, updated_at: nowIso })
    .eq('id', id)
    .eq('org_id', g.orgId)
    .neq('status', 'voided')
    .select('job_id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pack) return NextResponse.json({ error: 'That link was not found, or is already cancelled.' }, { status: 404 })
  return NextResponse.json({ packs: await listPacks(g.supabase, g.orgId, (pack as { job_id: string }).job_id) })
}
