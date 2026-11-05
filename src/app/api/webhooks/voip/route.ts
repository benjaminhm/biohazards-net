/*
 * POST /api/webhooks/voip
 *
 * Receives a call from the VoIP provider (VoIPline "Inbound call recording"
 * webhook) when the recording is ready. Stores the raw payload, replies at
 * once, then runs the call pipeline (transcribe → clean → head agent → file
 * agent) after the response. Retries with the same call id are ignored, unless
 * the earlier event had no recording and this one does.
 *
 * Auth: VOIP_WEBHOOK_SECRET as VoIPline's `X-Pbx-Token` header (its "Secret
 *       Token" field), `Authorization: Bearer <secret>`, or `?key=<secret>`.
 * Org:  the dialled number in voip_numbers, else VOIP_DEFAULT_ORG_ID.
 *
 * Internal only — nothing here contacts the caller.
 */
import { NextResponse, after } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase'
import { parseVoipPayload, readWebhookBody } from '@/lib/calls/payload'
import { processCall } from '@/lib/calls/pipeline'

export const maxDuration = 300

function sameSecret(given: string, secret: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}

function authorised(req: Request): boolean {
  const secret = process.env.VOIP_WEBHOOK_SECRET ?? ''
  if (!secret) return false
  const pbxToken = req.headers.get('x-pbx-token') ?? ''
  if (pbxToken && sameSecret(pbxToken, secret)) return true
  const header = req.headers.get('authorization') ?? ''
  if (header.startsWith('Bearer ') && sameSecret(header.slice(7), secret)) return true
  const key = new URL(req.url).searchParams.get('key') ?? ''
  return key !== '' && sameSecret(key, secret)
}

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await readWebhookBody(req)
  const call = parseVoipPayload(payload)
  if (Object.keys(payload).length === 0) return NextResponse.json({ error: 'Empty payload' }, { status: 400 })

  const supabase = createServiceClient()
  let orgId = process.env.VOIP_DEFAULT_ORG_ID ?? ''
  if (call.called_number) {
    const { data } = await supabase.from('voip_numbers').select('org_id').eq('number', call.called_number).maybeSingle()
    if (data?.org_id) orgId = data.org_id as string
  }
  if (!orgId) return NextResponse.json({ error: `No organisation for number ${call.called_number || '(none)'}` }, { status: 422 })

  const providerCallId =
    call.provider_call_id ||
    createHash('sha256').update(`${call.caller_number}|${call.started_at}|${call.recording_url}|${call.transcript.slice(0, 200)}`).digest('hex').slice(0, 32)

  const { data: inserted, error } = await supabase
    .from('inbound_calls')
    .upsert(
      {
        org_id: orgId,
        provider: 'voipline',
        provider_call_id: providerCallId,
        caller_number: call.caller_number,
        called_number: call.called_number,
        started_at: call.started_at,
        duration_s: call.duration_s,
        recording_url: call.recording_url,
        payload_raw: payload,
      },
      { onConflict: 'provider,provider_call_id', ignoreDuplicates: true },
    )
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let callId = inserted?.[0]?.id as string | undefined
  if (!callId) {
    // VoIPline sends one event per trigger with the same unique_call_id; only a
    // later event carrying the recording can start an earlier record's pipeline.
    if (!call.recording_url && !call.transcript) return NextResponse.json({ ok: true, duplicate: true })
    const { data: upgraded } = await supabase
      .from('inbound_calls')
      .update({
        recording_url: call.recording_url,
        duration_s: call.duration_s,
        payload_raw: payload,
        status: 'received',
        error: null,
        error_stage: null,
        updated_at: new Date().toISOString(),
      })
      .eq('provider', 'voipline')
      .eq('provider_call_id', providerCallId)
      .eq('recording_url', '')
      .is('transcript_raw', null)
      .is('filed', null)
      .select('id')
    callId = upgraded?.[0]?.id as string | undefined
    if (!callId) return NextResponse.json({ ok: true, duplicate: true })
  }

  const id = callId
  after(() => processCall(id))
  return NextResponse.json({ ok: true, call_id: callId }, { status: 202 })
}
