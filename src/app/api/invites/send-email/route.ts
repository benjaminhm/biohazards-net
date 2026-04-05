/*
 * POST /api/invites/send-email
 *
 * Sends the invite link by email (Resend), from RESEND_FROM_TEAM (e.g. teams@biohazards.net).
 * Org admins only. Invite must belong to the org, be unclaimed, unexpired, and linked to person_id
 * with a non-empty email.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)
const FROM =
  process.env.RESEND_FROM_TEAM ||
  process.env.RESEND_FROM_EMAIL ||
  'onboarding@resend.dev'

function appInviteUrl(token: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net').replace(/\/$/, '')
  return `${base}/invite/${token}`
}

async function logSend(opts: {
  orgId: string
  personId: string
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
    channel: 'email',
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
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email is not configured (RESEND_API_KEY)' }, { status: 503 })
  }

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org context' }, { status: 400 })

  const { data: orgUser } = await supabase
    .from('org_users')
    .select('role')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .single()

  if (!orgUser || orgUser.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { token } = (await req.json()) as { token?: string }
  if (!token?.trim()) {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const { data: invite, error: invErr } = await supabase
    .from('invites')
    .select('id, token, person_id, claimed_by, expires_at')
    .eq('token', token.trim())
    .eq('org_id', orgId)
    .single()

  if (invErr || !invite) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }
  if (invite.claimed_by) {
    return NextResponse.json({ error: 'This invite was already used' }, { status: 400 })
  }
  if (new Date(invite.expires_at) <= new Date()) {
    return NextResponse.json({ error: 'This invite has expired — generate a new one' }, { status: 400 })
  }
  if (!invite.person_id) {
    return NextResponse.json(
      { error: 'This invite is not linked to a team profile; add the person first or use a profile-scoped invite' },
      { status: 400 }
    )
  }

  const { data: person } = await supabase
    .from('people')
    .select('id, name, email')
    .eq('id', invite.person_id)
    .eq('org_id', orgId)
    .single()

  if (!person?.email?.trim()) {
    return NextResponse.json({ error: 'Add an email address on this team profile first' }, { status: 400 })
  }

  const { data: company } = await supabase
    .from('company_profile')
    .select('name')
    .eq('org_id', orgId)
    .single()

  const orgName = company?.name ?? 'biohazards.net'
  const firstName = person.name?.split(' ')[0] || 'there'
  const inviteUrl = appInviteUrl(invite.token)
  const to = person.email.trim()
  const expiresLabel = new Date(invite.expires_at).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  const emailResult = await resend.emails.send({
    from: `biohazards.net <${FROM}>`,
    to,
    subject: `You're invited to join ${orgName} on biohazards.net`,
    html: `
      <div style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
        <div style="border-top:4px solid #FF6B35;padding-top:20px;margin-bottom:28px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#FF6B35;margin-bottom:4px;">biohazards.net</div>
          <h1 style="font-size:22px;font-weight:800;color:#111;margin:0;">Hi ${firstName}!</h1>
        </div>
        <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 24px;">
          <strong>${orgName}</strong> has invited you to join the team app. Use the button below to create your account and open your invite.
        </p>
        <a href="${inviteUrl}"
           style="display:inline-block;padding:14px 28px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;margin-bottom:28px;">
          Accept invite →
        </a>
        <div style="background:#f9f9f9;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
          <div style="font-size:11px;color:#999;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Or copy this link</div>
          <div style="font-size:12px;color:#555;word-break:break-all;font-family:monospace;">${inviteUrl}</div>
        </div>
        <p style="font-size:12px;color:#aaa;margin:0;">This invite expires on ${expiresLabel}. · biohazards.net</p>
      </div>
    `,
  })

  if (emailResult.error) {
    console.error('[invites/send-email] Resend error:', emailResult.error)
    return NextResponse.json(
      { error: emailResult.error.message ?? 'Email provider rejected the send' },
      { status: 502 }
    )
  }

  try {
    await logSend({
      orgId,
      personId: person.id,
      recipient: to,
      orgName,
      adminName: person.name ?? firstName,
      inviteUrl,
      providerId: emailResult.data?.id ?? null,
      actorClerkId: userId,
    })
  } catch (e) {
    console.error('[invites/send-email] log insert failed:', e)
  }

  return NextResponse.json({ ok: true, id: emailResult.data?.id })
}
