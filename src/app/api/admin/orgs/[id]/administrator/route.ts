/*
 * POST /api/admin/orgs/[id]/administrator
 *
 * Creates a people profile for the organisation’s primary administrator and
 * issues an app invite (same /invite/[token] flow as team members).
 * Platform admin only.
 */
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

function isPlatformAdmin(userId: string | null): boolean {
  if (!userId) return false
  const ids = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return ids.includes(userId)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!isPlatformAdmin(userId ?? null)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: orgId } = await params
  const body = await req.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email are required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: org, error: orgErr } = await supabase.from('orgs').select('id, name').eq('id', orgId).single()
  if (orgErr || !org) {
    return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
  }

  const { data: dup } = await supabase
    .from('people')
    .select('id')
    .eq('org_id', orgId)
    .ilike('email', email)
    .maybeSingle()

  if (dup) {
    return NextResponse.json({ error: 'A profile with this email already exists for this organisation' }, { status: 409 })
  }

  const { data: person, error: personErr } = await supabase
    .from('people')
    .insert({
      org_id: orgId,
      name,
      email,
      phone: phone || null,
      role: 'employee',
      status: 'active',
    })
    .select()
    .single()

  if (personErr) {
    return NextResponse.json({ error: personErr.message }, { status: 500 })
  }

  const token = randomBytes(32).toString('hex')
  const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: invite, error: inviteErr } = await supabase
    .from('invites')
    .insert({
      org_id: orgId,
      role: 'admin',
      person_id: person.id,
      invited_by: userId,
      token,
      expires_at,
    })
    .select()
    .single()

  if (inviteErr) {
    await supabase.from('people').delete().eq('id', person.id)
    return NextResponse.json({ error: inviteErr.message }, { status: 500 })
  }

  const invite_url = `https://app.biohazards.net/invite/${invite.token}`

  return NextResponse.json(
    { org, person, invite_token: invite.token, invite_url },
    { status: 201 }
  )
}
