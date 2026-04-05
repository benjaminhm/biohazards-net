/*
 * app/api/sms/direct/route.ts
 *
 * POST /api/sms/direct — send a one-off SMS not tied to any job.
 * Used for sending invite links or admin notifications via SMS.
 *
 * Restricted to org admins only (role check against org_users).
 * Unlike /api/sms/send, this does NOT store a message record because
 * there is no job to associate it with.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { formatToTwilioE164 } from '@/lib/phone'

// Send a one-off SMS not tied to a job (e.g. invite links)
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org context' }, { status: 400 })

  // Must be admin
  const { data: orgUser } = await supabase
    .from('org_users')
    .select('role')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .single()

  if (!orgUser || orgUser.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { to_number, body } = await req.json()
  if (!to_number || !body?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const toE164 = formatToTwilioE164(String(to_number))
  if (!toE164) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }

  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  )

  try {
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: toE164,
      body: body.trim(),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send SMS'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
