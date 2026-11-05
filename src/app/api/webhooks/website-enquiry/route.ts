/*
 * POST /api/webhooks/website-enquiry
 *
 * Netlify Forms outgoing webhook ("New form submission"). Verifies Netlify's
 * JWS signature (NETLIFY_FORMS_SECRET), stores the submission as an inbound
 * contact, and runs the head agent and file agent on it after the response —
 * the same pipeline as a phone call, from the extract stage.
 *
 * Env: NETLIFY_FORMS_SECRET (the webhook's JWS secret token), VOIP_DEFAULT_ORG_ID.
 * Internal only — nothing here replies to the client.
 */
import { NextResponse, after } from 'next/server'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase'
import { processCall } from '@/lib/calls/pipeline'
import { enquiryPhone, enquiryText, verifyNetlifySignature, type NetlifySubmission } from '@/lib/calls/websiteEnquiry'

export const maxDuration = 300

export async function POST(req: Request) {
  const rawBody = await req.text()
  const secret = process.env.NETLIFY_FORMS_SECRET ?? ''
  if (!verifyNetlifySignature(rawBody, req.headers.get('x-webhook-signature') ?? '', secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let submission: NetlifySubmission
  try {
    submission = JSON.parse(rawBody) as NetlifySubmission
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = process.env.VOIP_DEFAULT_ORG_ID ?? ''
  if (!orgId) return NextResponse.json({ error: 'VOIP_DEFAULT_ORG_ID is not set' }, { status: 500 })

  const text = enquiryText(submission)
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('inbound_calls')
    .upsert(
      {
        org_id: orgId,
        provider: 'netlify_form',
        provider_call_id: submission.id || createHash('sha256').update(rawBody).digest('hex').slice(0, 32),
        caller_number: enquiryPhone(submission),
        started_at: submission.created_at ?? null,
        // Kept under one key so the payload reader never takes form fields for a transcript.
        payload_raw: { source: 'website_form', submission },
        transcript_raw: text,
        transcript_source: 'form',
        transcript_clean: text,
        clean_changes: [],
        clean_unclear: [],
        status: 'cleaned',
      },
      { onConflict: 'provider,provider_call_id', ignoreDuplicates: true },
    )
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const callId = data?.[0]?.id as string | undefined
  if (!callId) return NextResponse.json({ ok: true, duplicate: true })
  after(() => processCall(callId, 'extract'))
  return NextResponse.json({ ok: true, call_id: callId }, { status: 202 })
}
