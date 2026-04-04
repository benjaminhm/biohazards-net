/*
 * app/api/admin/actions/nudge/route.ts
 *
 * POST /api/admin/actions/nudge — send an AI-generated reminder to a team
 * member asking them to complete their profile (or other action type).
 *
 * Flow:
 *   1. Fetch person + company name from DB
 *   2. Use Claude Haiku to generate a short, personalised message
 *   3. If person has email → send via Resend
 *      If no email but has phone → send via Twilio SMS
 *   4. Return { ok, channel: 'email' | 'sms', preview: message }
 *
 * Admin only — double-checked server-side.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'
import twilio from 'twilio'
import { FROM_EMAIL } from '@/lib/email'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const resend = new Resend(process.env.RESEND_API_KEY!)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })

  // Verify admin
  const { data: orgUser } = await supabase
    .from('org_users')
    .select('role')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .single()

  if (!orgUser || orgUser.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { person_id, type, missing } = await req.json()
  if (!person_id) return NextResponse.json({ error: 'person_id required' }, { status: 400 })

  // Fetch person
  const { data: person } = await supabase
    .from('people')
    .select('name, email, phone')
    .eq('id', person_id)
    .eq('org_id', orgId)
    .single()

  if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 })

  // Fetch company name
  const { data: company } = await supabase
    .from('company_profile')
    .select('name')
    .eq('org_id', orgId)
    .single()

  const companyName = company?.name ?? 'your employer'
  const firstName = person.name.split(' ')[0]
  const missingList = (missing as string[] | undefined)?.join(', ') ?? 'some profile details'

  // Generate message with Claude Haiku
  let messageBody = ''
  try {
    const prompt = type === 'incomplete_profile'
      ? `Write a short, friendly reminder SMS/email message to ${firstName} who works for ${companyName}.
         Ask them to complete their profile on the biohazards.net app — they are missing: ${missingList}.
         Keep it under 80 words. Warm but professional. No subject line. No placeholders.
         Sign off as "${companyName} Admin". Return only the message text, nothing else.`
      : `Write a short, friendly reminder to ${firstName} from ${companyName} regarding: ${type}.
         Keep it under 80 words. Professional and direct. Return only the message text.`

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })

    messageBody = (response.content[0] as { text: string }).text.trim()
  } catch {
    // Fallback message if AI fails
    messageBody = `Hi ${firstName}, this is a reminder from ${companyName} to please update your profile on the biohazards.net app. You're missing: ${missingList}. Thanks!`
  }

  // Send via email if available, otherwise SMS
  const hasEmail = person.email?.trim()
  const hasPhone = person.phone?.trim()

  if (hasEmail) {
    await resend.emails.send({
      from: `biohazards.net <${FROM_EMAIL}>`,
      to: person.email!,
      subject: `Action needed — please complete your profile`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <div style="background:#FF6B35;height:3px;border-radius:2px;margin-bottom:24px"></div>
          <p style="font-size:15px;color:#111;line-height:1.7;white-space:pre-wrap;">${messageBody}</p>
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #eee">
            <a href="https://app.biohazards.net"
               style="display:inline-block;padding:11px 20px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px">
              Open App →
            </a>
          </div>
          <p style="margin-top:16px;font-size:11px;color:#bbb">biohazards.net</p>
        </div>
      `,
    })
    return NextResponse.json({ ok: true, channel: 'email', preview: messageBody })
  }

  if (hasPhone) {
    await twilioClient.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: person.phone!,
      body: messageBody,
    })
    return NextResponse.json({ ok: true, channel: 'sms', preview: messageBody })
  }

  return NextResponse.json({ error: 'No email or phone on file to send reminder' }, { status: 422 })
}
