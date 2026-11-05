/*
 * POST /api/calls/[id]/reprocess  { from?: 'transcribe' | 'clean' | 'extract' | 'file' }
 *
 * Re-run the call pipeline from a stage, keeping the earlier stages' output.
 * A call already filed is re-filed into the same job: empty fields and missing
 * quotes are filled, nothing on file is overwritten, no second job is created.
 */
import { NextResponse, after } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { CALL_STAGES, processCall, type CallStage } from '@/lib/calls/pipeline'

export const maxDuration = 300

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { from?: string }
  const from = (CALL_STAGES as readonly string[]).includes(body.from ?? '') ? (body.from as CallStage) : 'transcribe'

  const { data: call } = await g.supabase.from('inbound_calls').select('id').eq('id', id).eq('org_id', g.orgId).maybeSingle()
  if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404 })

  await g.supabase.from('inbound_calls').update({ status: 'received', error: null, error_stage: null }).eq('id', id)
  after(() => processCall(id, from))
  return NextResponse.json({ ok: true, from }, { status: 202 })
}
