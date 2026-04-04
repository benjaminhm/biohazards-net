/*
 * app/api/admin/provision/route.ts
 *
 * POST /api/admin/provision — atomically provision a new company on the platform.
 *   1. Creates the org record
 *   2. Creates the admin's person profile in the people table
 *   3. Creates an invite token pre-linked to that person and org (expires 30 days)
 *
 * Returns { org, person, invite_token, invite_url } so the platform admin can
 * immediately copy and send the invite link.
 *
 * Platform admin only — guarded by PLATFORM_ADMIN_CLERK_IDS env var.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

function isPlatformAdmin(userId: string | null): boolean {
  if (!userId) return false
  const adminIds = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return adminIds.includes(userId)
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!isPlatformAdmin(userId ?? null)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const {
    org_name,
    org_slug,
    plan = 'solo',
    seat_limit = 5,
    admin_name,
    admin_email,
    admin_phone,
  } = body

  if (!org_name || !org_slug || !admin_name || !admin_email) {
    return NextResponse.json(
      { error: 'org_name, org_slug, admin_name, and admin_email are required' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  // 1. Create org
  const { data: org, error: orgErr } = await supabase
    .from('orgs')
    .insert({ name: org_name, slug: org_slug, plan, seat_limit })
    .select()
    .single()

  if (orgErr) {
    return NextResponse.json({ error: orgErr.message }, { status: 500 })
  }

  // 2. Create admin person profile in this org
  const { data: person, error: personErr } = await supabase
    .from('people')
    .insert({
      name: admin_name,
      email: admin_email,
      phone: admin_phone ?? null,
      org_id: org.id,
    })
    .select()
    .single()

  if (personErr) {
    // Roll back org if person creation fails
    await supabase.from('orgs').delete().eq('id', org.id)
    return NextResponse.json({ error: personErr.message }, { status: 500 })
  }

  // 3. Create invite token (30-day expiry)
  const token = randomBytes(32).toString('hex')
  const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: invite, error: inviteErr } = await supabase
    .from('invites')
    .insert({
      org_id: org.id,
      role: 'admin',
      person_id: person.id,
      invited_by: userId,
      token,
      expires_at,
    })
    .select()
    .single()

  if (inviteErr) {
    return NextResponse.json({ error: inviteErr.message }, { status: 500 })
  }

  const invite_url = `https://app.biohazards.net/invite/${invite.token}`

  return NextResponse.json({ org, person, invite_token: invite.token, invite_url }, { status: 201 })
}
