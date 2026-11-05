/*
 * GET  /api/calls — recent inbound calls for the org, newest first, with the
 *                   linked job code. Staff with the full job file only.
 * POST /api/calls — { transcript, caller_number? } runs a pasted transcript
 *                   through the same pipeline (testing, or calls taken on a mobile).
 */
import { NextResponse, after } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { normalizeTwilioNumber } from '@/lib/phone'
import { processCall } from '@/lib/calls/pipeline'

export const maxDuration = 300

export async function POST(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => ({}))) as { transcript?: string; caller_number?: string }
  const transcript = (body.transcript ?? '').trim()
  if (transcript.length < 20) return NextResponse.json({ error: 'Paste the call transcript.' }, { status: 400 })
  if (transcript.length > 200_000) return NextResponse.json({ error: 'Transcript is too long.' }, { status: 400 })
  const caller = normalizeTwilioNumber(body.caller_number ?? '') ?? ''
  const { data, error } = await g.supabase
    .from('inbound_calls')
    .insert({
      org_id: g.orgId,
      provider: 'manual',
      provider_call_id: crypto.randomUUID(),
      caller_number: caller,
      started_at: new Date().toISOString(),
      payload_raw: { transcript, caller_number: caller, entered_by: g.userId },
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const callId = data.id as string
  after(() => processCall(callId))
  return NextResponse.json({ ok: true, call_id: callId }, { status: 202 })
}

export async function GET(req: Request) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const { data, error } = await g.supabase
    .from('inbound_calls')
    .select('id, caller_number, called_number, started_at, duration_s, status, error, error_stage, job_id, validation, extraction, created_at, jobs(job_code, client_name)')
    .eq('org_id', g.orgId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ calls: data ?? [] })
}
