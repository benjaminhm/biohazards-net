/*
 * GET /api/calls/[id] — one inbound call with every stage output and the
 * agent actions it triggered.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const { id } = await params
  const [{ data: call }, { data: actions }] = await Promise.all([
    g.supabase.from('inbound_calls').select('*, jobs(job_code, client_name)').eq('id', id).eq('org_id', g.orgId).maybeSingle(),
    g.supabase
      .from('agent_actions')
      .select('id, agent, action, target_table, target_id, target_path, before, after, note, status, created_at')
      .eq('org_id', g.orgId)
      .eq('trigger', `inbound_call:${id}`)
      .order('created_at', { ascending: true }),
  ])
  if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  return NextResponse.json({ call, actions: actions ?? [] })
}
