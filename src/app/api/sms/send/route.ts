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

  // Verify job belongs to org
  const { data: job } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', job_id)
    .eq('org_id', orgId)
    .single()

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  )

  let twilioSid: string | null = null
  try {
    const msg = await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: to_number,
      body: body.trim(),
    })
    twilioSid = msg.sid
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send SMS'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      org_id: orgId,
      job_id,
      direction: 'outbound',
      from_number: process.env.TWILIO_PHONE_NUMBER!,
      to_number,
      body: body.trim(),
      twilio_sid: twilioSid,
      read_at: new Date().toISOString(), // outbound always marked read
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message })
}
