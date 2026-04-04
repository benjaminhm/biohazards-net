/*
 * app/api/admin/actions/nudge/route.ts
 *
 * POST /api/admin/actions/nudge — send an AI-generated profile completion
 * reminder to a team member.
 *
 * Flow:
 *   1. Fetch person + company name from DB
 *   2. Build a field-specific context so Claude knows exactly what's missing
 *      and why each field matters (full name for ID/payroll, phone for
 *      on-site coordination, address for WHS records)
 *   3. Claude Haiku writes a short, warm, specific message
 *   4. If person has email → Resend from team@biohazards.net
 *      If no email but has phone → Twilio SMS fallback
 *   5. Return { ok, channel, preview }
 *
 * Admin only.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'
import twilio from 'twilio'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const resend    = new Resend(process.env.RESEND_API_KEY!)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)

const FROM_TEAM = process.env.RESEND_FROM_TEAM || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

// Human-readable explanation of why each field matters
const FIELD_CONTEXT: Record<string, string> = {
  name:    'their full legal name (required for payroll and compliance records)',
  phone:   'a mobile phone number (needed for on-site coordination and emergency contact)',
  email:   'an email address (needed for job notifications and important documents)',
  address: 'a home or postal address (required for WHS records)',
  abn:     'their ABN (required for subcontractor invoicing)',
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })

  // Verify admin
  const { data: orgUser } = await supabase
    .from('org_users').select('role')
    .eq('clerk_user_id', userId).eq('org_id', orgId).single()

  if (!orgUser || orgUser.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { person_id, type, missing } = await req.json()
  if (!person_id) return NextResponse.json({ error: 'person_id required' }, { status: 400 })

  // Fetch person (include all profile fields so AI can see what's actually there)
  const { data: person } = await supabase
    .from('people')
    .select('name, email, phone, address, abn')
    .eq('id', person_id).eq('org_id', orgId).single()

  if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 })

  // Fetch company name
  const { data: company } = await supabase
    .from('company_profile').select('name').eq('org_id', orgId).single()

  const companyName = company?.name ?? 'your employer'
  const firstName   = person.name?.split(' ')[0] || 'Hi'
  const missingFields = (missing as string[] | undefined) ?? []

  // Build field-specific context for the AI
  const fieldDetails = missingFields
    .map(f => `- ${FIELD_CONTEXT[f] ?? f}`)
    .join('\n')

  // Generate message with Claude Sonnet for quality
  let messageBody = ''
  try {
    const prompt = `You are writing a short staff reminder email on behalf of ${companyName}, a biohazard cleaning company in Australia.

The recipient is ${firstName}, a team member whose staff profile is incomplete.

What is missing and why it matters:
${fieldDetails}

Write the email body only (no subject line, no headers). It should:
- Open with "Hi ${firstName},"
- Sound like it was written by a real person — warm, direct, not corporate
- Weave in the reason each missing item matters naturally in one or two sentences (don't bullet-point them)
- Be specific about what they need to do ("tap the button below to open your profile")
- Stay under 90 words
- Close with a friendly sign-off from "${companyName} Team"

Do not use phrases like "I hope this email finds you well", "please be advised", or "kindly". Write naturally.
Return only the email body, nothing else.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })

    messageBody = (response.content[0] as { text: string }).text.trim()
  } catch {
    const fallbackList = missingFields.map(f => FIELD_CONTEXT[f] ?? f).join(', ')
    messageBody = `Hi ${firstName}, could you please complete your staff profile on the ${companyName} app? We still need ${fallbackList}. Thanks, ${companyName} Team`
  }

  const hasEmail = person.email?.trim()
  const hasPhone = person.phone?.trim()

  // Send via email
  if (hasEmail) {
    const missingItems = missingFields
      .map(f => `<li style="margin-bottom:6px;color:#444;">${FIELD_CONTEXT[f] ?? f}</li>`)
      .join('')

    await resend.emails.send({
      from: `${companyName} <${FROM_TEAM}>`,
      to: person.email!,
      subject: `Please complete your staff profile — ${companyName}`,
      html: `
        <div style="font-family:-apple-system,system-ui,sans-serif;max-width:500px;margin:0 auto;padding:32px 24px;">
          <div style="background:#FF6B35;height:3px;border-radius:2px;margin-bottom:28px;"></div>

          <p style="font-size:15px;color:#111;line-height:1.75;margin:0 0 24px;white-space:pre-wrap;">${messageBody}</p>

          <div style="background:#f9f9f9;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#999;margin-bottom:10px;">
              Missing from your profile
            </div>
            <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;">
              ${missingItems}
            </ul>
          </div>

          <a href="https://app.biohazards.net/team/${person_id}"
             style="display:inline-block;padding:12px 22px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:7px;font-weight:700;font-size:14px;">
            Complete My Profile →
          </a>

          <p style="margin-top:28px;font-size:11px;color:#bbb;border-top:1px solid #eee;padding-top:16px;">
            ${companyName} · biohazards.net
          </p>
        </div>
      `,
    })
    return NextResponse.json({ ok: true, channel: 'email', preview: messageBody })
  }

  // SMS fallback
  if (hasPhone) {
    await twilioClient.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: person.phone!,
      body: messageBody,
    })
    return NextResponse.json({ ok: true, channel: 'sms', preview: messageBody })
  }

  return NextResponse.json({ error: 'No email or phone on file' }, { status: 422 })
}
