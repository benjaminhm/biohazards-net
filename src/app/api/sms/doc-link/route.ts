/*
 * app/api/sms/doc-link/route.ts
 *
 * POST /api/sms/doc-link — send a human-reviewed transactional SMS (quote or
 * document link) using the job's approved Twilio Alphanumeric Sender ID (e.g.
 * 'FCQ' for Forensic Cleaning QLD) and log it in `messages`.
 *
 * The Sender ID is ALWAYS resolved server-side from `jobs.trading_name` — never
 * from the request body. Alphanumeric Sender IDs are one-way (no replies);
 * two-way staff SMS stays on `/api/sms/send` (`TWILIO_PHONE_NUMBER`).
 *
 * Human-in-the-loop (docs/ai-product-principles.md): staff review/edit the
 * exact message and recipient mobile number and explicitly confirm before this
 * route is called.
 */
import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { formatToTwilioE164 } from '@/lib/phone'
import { isTradingNameId, tradingNameLabel } from '@/lib/tradingNames'
import { formatTwilioSendError, resolveBrandSmsSenderId } from '@/lib/twilioSender'

const MAX_SMS_BODY_LENGTH = 1600

export async function POST(req: Request) {
  const guard = await guardFullAccessStaff(req)
  if (!guard.ok) return guard.response
  const { supabase, orgId } = guard

  let payload: Record<string, unknown>
  try {
    payload = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const jobId = typeof payload.job_id === 'string' ? payload.job_id.trim() : ''
  const rawTo = typeof payload.to_number === 'string' ? payload.to_number.trim() : ''
  const cleanBody = typeof payload.body === 'string' ? payload.body.trim() : ''

  if (!jobId) {
    return NextResponse.json({ error: 'Missing job_id' }, { status: 400 })
  }
  if (!rawTo) {
    return NextResponse.json({ error: 'Enter a mobile number to text.' }, { status: 400 })
  }
  if (!cleanBody) {
    return NextResponse.json({ error: 'Message cannot be empty.' }, { status: 400 })
  }
  if (cleanBody.length > MAX_SMS_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Message is too long for SMS (max ${MAX_SMS_BODY_LENGTH} characters).` },
      { status: 400 },
    )
  }

  const toE164 = formatToTwilioE164(rawTo)
  if (!toE164) {
    return NextResponse.json(
      { error: 'Enter a valid mobile number (e.g. 0412 345 678).' },
      { status: 400 },
    )
  }

  const { data: jobRow } = await supabase
    .from('jobs')
    .select('id, trading_name')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()

  const job = jobRow as { id: string; trading_name: string | null } | null
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const tradingName = isTradingNameId(job.trading_name) ? job.trading_name : null
  const senderId = resolveBrandSmsSenderId(tradingName)
  if (!senderId) {
    const brand = tradingNameLabel(tradingName) ?? 'this brand'
    return NextResponse.json(
      { error: `Branded SMS Sender ID is not approved for ${brand} yet.` },
      { status: 409 },
    )
  }

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const token = process.env.TWILIO_AUTH_TOKEN?.trim()
  if (!sid || !token) {
    return NextResponse.json(
      { error: 'Twilio credentials are not configured on the server.' },
      { status: 500 },
    )
  }

  const client = twilio(sid, token)
  let twilioSid: string
  try {
    const msg = await client.messages.create({
      from: senderId,
      to: toE164,
      body: cleanBody,
    })
    twilioSid = msg.sid
  } catch (err: unknown) {
    return NextResponse.json({ error: formatTwilioSendError(err, senderId) }, { status: 502 })
  }

  const { data: message, error: logError } = await supabase
    .from('messages')
    .insert({
      org_id: orgId,
      job_id: job.id,
      direction: 'outbound',
      from_number: senderId,
      to_number: toE164,
      body: cleanBody,
      twilio_sid: twilioSid,
      read_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (logError) {
    // SMS was already delivered to Twilio — report success so staff do not resend.
    return NextResponse.json({
      ok: true,
      sid: twilioSid,
      from: senderId,
      to: toE164,
      warning: 'SMS sent, but could not be logged in the Messages tab.',
    })
  }

  return NextResponse.json({
    ok: true,
    sid: twilioSid,
    from: senderId,
    to: toE164,
    message,
  })
}
