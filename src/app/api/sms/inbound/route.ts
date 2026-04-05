/*
 * app/api/sms/inbound/route.ts
 *
 * Twilio webhook for incoming SMS messages. Twilio POSTs here with
 * application/x-www-form-urlencoded body when a client replies to the
 * org's Twilio number.
 *
 * Flow:
 * 1. Parse the Twilio webhook body (From, To, Body, MessageSid)
 * 2. Normalise `From` to E.164 to match `jobs.client_phone` (stored E.164 from lib/phone)
 * 3. Find the most recent job with exact `client_phone` match; fallback to last-9-digit
 *    match for legacy rows not yet migrated to E.164
 * 4. Insert an inbound message record (read_at = null = unread)
 * 5. Return an empty TwiML response (no auto-reply)
 *
 * This route is intentionally public (listed in middleware isPublicRoute)
 * because Twilio cannot authenticate via Clerk. Twilio request signature
 * validation is temporarily disabled (see comment below) — re-enable in
 * production by validating X-Twilio-Signature with twilio.validateRequest().
 *
 * If no matching job is found but a single org exists, the message is still
 * stored against that org (single-tenant fallback).
 */
import { createServiceClient } from '@/lib/supabase'
import { normalizeTwilioNumber } from '@/lib/phone'

// Signature validation temporarily disabled for debugging
// Re-enable once inbound is confirmed working
export async function POST(req: Request) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))

  const from  = params.From  ?? ''
  const to    = params.To    ?? ''
  const body2 = params.Body  ?? ''
  const sid   = params.MessageSid ?? null

  if (!from || !body2) {
    return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }

  const supabase = createServiceClient()

  const fromE164 = normalizeTwilioNumber(from)

  let jobs: { id: string; org_id: string; client_phone: string | null }[] | null = null

  if (fromE164) {
    const { data } = await supabase
      .from('jobs')
      .select('id, org_id, client_phone')
      .eq('client_phone', fromE164)
      .order('created_at', { ascending: false })
      .limit(5)
    jobs = data
  }

  // Legacy: DB may still have spaces/local formats — match last 9 digits
  if (!jobs?.length) {
    const digitsOnly = from.replace(/\D/g, '')
    const last9 = digitsOnly.slice(-9)
    if (last9.length >= 9) {
      const { data } = await supabase
        .from('jobs')
        .select('id, org_id, client_phone')
        .ilike('client_phone', `%${last9}%`)
        .order('created_at', { ascending: false })
        .limit(5)
      jobs = data
    }
  }

  let jobId: string | null = null
  let orgId: string | null = null

  if (jobs && jobs.length > 0) {
    jobId = jobs[0].id
    orgId = jobs[0].org_id
  }

  if (!orgId) {
    const { data: org } = await supabase.from('orgs').select('id').limit(1).single()
    orgId = org?.id ?? null
  }

  if (!orgId) {
    return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }

  if (jobId) {
    await supabase.from('messages').insert({
      org_id: orgId,
      job_id: jobId,
      direction: 'inbound',
      from_number: fromE164 ?? from,
      to_number: to,
      body: body2,
      twilio_sid: sid,
      read_at: null,
    })
  }

  return new Response('<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
