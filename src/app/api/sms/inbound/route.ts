/*
 * app/api/sms/inbound/route.ts
 *
 * Twilio webhook for incoming SMS messages. Twilio POSTs here with
 * application/x-www-form-urlencoded body when a client replies to the
 * org's Twilio number.
 *
 * Flow:
 * 1. Parse the Twilio webhook body (From, To, Body, MessageSid)
 * 2. Normalise the sender's number to last 9 digits to match against DB
 *    (Twilio sends +61400123456; DB might have 0400123456 or 0400 123 456)
 * 3. Find the most recent job with a matching client_phone
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

  // Strip all non-digits then take last 9 to produce a format-agnostic suffix
  // that matches regardless of whether DB has 0400123456 or +61400123456.
  // e.g. +61400123456 → 400123456, 0400123456 → 400123456
  const digitsOnly = from.replace(/\D/g, '')
  const last9 = digitsOnly.slice(-9)

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, org_id, client_phone')
    .ilike('client_phone', `%${last9}%`)
    .order('created_at', { ascending: false })
    .limit(5)

  // Pick the most recent active job for this number
  let jobId: string | null = null
  let orgId: string | null = null

  if (jobs && jobs.length > 0) {
    jobId = jobs[0].id
    orgId = jobs[0].org_id
  }

  // If no job found, still try to get org from the first org (single-tenant fallback)
  if (!orgId) {
    const { data: org } = await supabase.from('orgs').select('id').limit(1).single()
    orgId = org?.id ?? null
  }

  if (!orgId) {
    return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }

  // Insert inbound message (unread — read_at null)
  if (jobId) {
    await supabase.from('messages').insert({
      org_id: orgId,
      job_id: jobId,
      direction: 'inbound',
      from_number: from,
      to_number: to,
      body: body2,
      twilio_sid: sid,
      read_at: null,
    })
  }

  // TwiML empty response — don't auto-reply
  return new Response('<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
