/*
 * app/api/sms/send/route.ts
 *
 * POST /api/sms/send — send an outbound SMS via Twilio and store it in messages.
 *
 * Verifies the job belongs to the current org before sending — prevents a user
 * sending messages impersonating another org's Twilio number.
 * Outbound messages are marked read_at = now() immediately because the sender
 * already knows the content; only inbound messages start as unread.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { formatToTwilioE164 } from '@/lib/phone'

/** Twilio Node SDK throws RestException-like objects with code, message, status. */
function formatTwilioSendError(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { code?: number; message?: string; status?: number; moreInfo?: string }
    const msg = o.message ?? ''
    const code = o.code
    const status = o.status

    if (status === 401 || msg === 'Authenticate' || code === 20003) {
      return (
        'Twilio authentication failed. In Twilio Console → Account, copy Account SID and Auth Token, ' +
        'set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env.local, then restart `npm run dev`.'
      )
    }
    if (code === 21212 || /invalid.*from|from.*invalid/i.test(msg)) {
      return (
        'Twilio rejected the From number. TWILIO_PHONE_NUMBER must be an SMS-capable number on this ' +
        'Twilio account (E.164, e.g. +61412345678).'
      )
    }
    if (code === 21608 || /unverified/i.test(msg)) {
      return (
        'Trial accounts can only text verified numbers. Verify the destination in Twilio Console, or upgrade the account.'
      )
    }
    if (msg) return code ? `${msg} (Twilio ${code})` : msg
  }
  if (err instanceof Error) return err.message
  return 'Failed to send SMS'
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org context' }, { status: 400 })

  const { job_id, to_number, body } = await req.json()
  if (!job_id || !to_number || !body?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const toE164 = formatToTwilioE164(String(to_number))
  if (!toE164) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }

  // Verify job belongs to org
  const { data: job } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', job_id)
    .eq('org_id', orgId)
    .single()

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const token = process.env.TWILIO_AUTH_TOKEN?.trim()
  const fromNum = process.env.TWILIO_PHONE_NUMBER?.trim()
  if (!sid || !token || !fromNum) {
    return NextResponse.json(
      {
        error:
          'Twilio env missing. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env.local and restart the dev server.',
      },
      { status: 500 }
    )
  }

  const client = twilio(sid, token)

  let twilioSid: string | null = null
  try {
    const msg = await client.messages.create({
      from: fromNum,
      to: toE164,
      body: body.trim(),
    })
    twilioSid = msg.sid
  } catch (err: unknown) {
    return NextResponse.json({ error: formatTwilioSendError(err) }, { status: 500 })
  }

  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      org_id: orgId,
      job_id,
      direction: 'outbound',
      from_number: fromNum,
      to_number: toE164,
      body: body.trim(),
      twilio_sid: twilioSid,
      read_at: new Date().toISOString(), // outbound always marked read
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message })
}
