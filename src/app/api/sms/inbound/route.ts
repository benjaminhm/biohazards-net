import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import twilio from 'twilio'

export async function POST(req: Request) {
  // Validate request is genuinely from Twilio
  const twilioSignature = req.headers.get('x-twilio-signature') ?? ''
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/sms/inbound`
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))

  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    twilioSignature,
    url,
    params
  )

  // In dev skip validation; in prod enforce it
  if (process.env.NODE_ENV === 'production' && !valid) {
    return new Response('Forbidden', { status: 403 })
  }

  const from  = params.From  ?? ''
  const to    = params.To    ?? ''
  const body2 = params.Body  ?? ''
  const sid   = params.MessageSid ?? null

  if (!from || !body2) {
    return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }

  const supabase = createServiceClient()

  // Find org by Twilio number
  // We store the org's Twilio number in env — single tenant for now
  // Match inbound from_number to a job's client_phone
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, org_id, client_phone')
    .ilike('client_phone', `%${from.replace('+', '').replace(/\s/g, '')}%`)
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
