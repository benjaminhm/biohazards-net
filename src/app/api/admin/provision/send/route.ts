/*
 * app/api/admin/provision/send/route.ts
 *
 * POST /api/admin/provision/send
 *
 * Sends a provisioned org's invite link to the new administrator via
 * email (Resend, from platform@biohazards.net) or SMS (Twilio).
 *
 * Platform admin only — guarded by PLATFORM_ADMIN_CLERK_IDS.
 *
 * Body: {
 *   channel:     'email' | 'sms'
 *   invite_url:  string
 *   org_name:    string
 *   admin_name:  string
 *   admin_email?: string   (required when channel='email')
 *   admin_phone?: string   (required when channel='sms')
 *   org_id?: string        (optional — for audit log)
 *   person_id?: string     (optional — for audit log)
 * }
 */
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import twilio from 'twilio'
import { formatToTwilioE164 } from '@/lib/phone'
import { createServiceClient } from '@/lib/supabase'

const resend = new Resend(process.env.RESEND_API_KEY!)
const FROM   = process.env.RESEND_FROM_PLATFORM
            || process.env.RESEND_FROM_TEAM
            || process.env.RESEND_FROM_EMAIL
            || 'onboarding@resend.dev'

function isPlatformAdmin(userId: string | null): boolean {
  if (!userId) return false
  const ids = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return ids.includes(userId)
}

async function logSend(opts: {
  orgId: string | null
  personId: string | null
  channel: 'email' | 'sms'
  recipient: string
  orgName: string
  adminName: string
  inviteUrl: string
  providerId: string | null
  actorClerkId: string
}) {
  const supabase = createServiceClient()
  await supabase.from('platform_invite_send_log').insert({
    org_id: opts.orgId,
    person_id: opts.personId,
    channel: opts.channel,
    recipient: opts.recipient,
    org_name: opts.orgName,
    admin_name: opts.adminName,
    invite_url: opts.inviteUrl,
    provider_id: opts.providerId,
    actor_clerk_id: opts.actorClerkId,
  })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!isPlatformAdmin(userId ?? null)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const {
    channel,
    invite_url,
    org_name,
    admin_name,
    admin_email,
    admin_phone,
    org_id: bodyOrgId,
    person_id: bodyPersonId,
  } = body as {
    channel?: string
    invite_url?: string
    org_name?: string
    admin_name?: string
    admin_email?: string
    admin_phone?: string
    org_id?: string | null
    person_id?: string | null
  }

  const orgId = typeof bodyOrgId === 'string' && bodyOrgId.trim() ? bodyOrgId.trim() : null
  const personId = typeof bodyPersonId === 'string' && bodyPersonId.trim() ? bodyPersonId.trim() : null

  if (!channel || !invite_url || !org_name || !admin_name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const firstName = admin_name.split(' ')[0]

  // ── Email ────────────────────────────────────────────────────────────────
  if (channel === 'email') {
    if (!admin_email) {
      return NextResponse.json({ error: 'admin_email required for email channel' }, { status: 400 })
    }

    const emailResult = await resend.emails.send({
      from: `biohazards.net <${FROM}>`,
      to: admin_email,
      subject: `You're invited to manage ${org_name} on biohazards.net`,
      html: `
        <div style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
          <div style="border-top:4px solid #FF6B35;padding-top:20px;margin-bottom:28px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#FF6B35;margin-bottom:4px;">biohazards.net</div>
            <h1 style="font-size:22px;font-weight:800;color:#111;margin:0;">Welcome, ${firstName}!</h1>
          </div>
          <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 24px;">
            Your company <strong>${org_name}</strong> has been set up on biohazards.net.
            Click the button below to sign in and get started as administrator.
          </p>
          <a href="${invite_url}"
             style="display:inline-block;padding:14px 28px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;margin-bottom:28px;">
            Accept Invite &amp; Sign In →
          </a>
          <div style="background:#f9f9f9;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
            <div style="font-size:11px;color:#999;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Or copy this link</div>
            <div style="font-size:12px;color:#555;word-break:break-all;font-family:monospace;">${invite_url}</div>
          </div>
          <p style="font-size:12px;color:#aaa;margin:0;">This invite expires in 30 days. · biohazards.net</p>
        </div>
      `,
    })

    if (emailResult.error) {
      console.error('[provision/send] Resend error:', emailResult.error)
      return NextResponse.json(
        { error: emailResult.error.message ?? 'Email provider rejected the send' },
        { status: 502 }
      )
    }

    try {
      await logSend({
        orgId,
        personId,
        channel: 'email',
        recipient: admin_email,
        orgName: org_name,
        adminName: admin_name,
        inviteUrl: invite_url,
        providerId: emailResult.data?.id ?? null,
        actorClerkId: userId!,
      })
    } catch (e) {
      console.error('[provision/send] log insert failed:', e)
    }

    return NextResponse.json({ ok: true, channel: 'email', id: emailResult.data?.id })
  }

  // ── SMS ──────────────────────────────────────────────────────────────────
  if (channel === 'sms') {
    if (!admin_phone) {
      return NextResponse.json({ error: 'admin_phone required for sms channel' }, { status: 400 })
    }

    const toE164 = formatToTwilioE164(String(admin_phone))
    if (!toE164) {
      return NextResponse.json({ error: 'Invalid admin_phone' }, { status: 400 })
    }

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

    const sms = await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!,
      to:   toE164,
      body: `Hi ${firstName}, ${org_name} is live on biohazards.net. Sign in here: ${invite_url}`,
    })

    try {
      await logSend({
        orgId,
        personId,
        channel: 'sms',
        recipient: toE164,
        orgName: org_name,
        adminName: admin_name,
        inviteUrl: invite_url,
        providerId: sms.sid ?? null,
        actorClerkId: userId!,
      })
    } catch (e) {
      console.error('[provision/send] log insert failed:', e)
    }

    return NextResponse.json({ ok: true, channel: 'sms' })
  }

  return NextResponse.json({ error: 'channel must be "email" or "sms"' }, { status: 400 })
}
