import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// GET /api/invites/[token] — public info about an invite (for the claim page)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('invites')
    .select('id, role, label, claimed_by, expires_at, orgs(name, slug)')
    .eq('token', token)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Invalid invite' }, { status: 404 })

  if (data.claimed_by) {
    return NextResponse.json({ error: 'This invite has already been used' }, { status: 410 })
  }

  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This invite has expired' }, { status: 410 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org = Array.isArray(data.orgs) ? data.orgs[0] : (data.orgs as any)

  return NextResponse.json({
    role: data.role,
    label: data.label,
    org_name: org?.name ?? 'Unknown Organisation',
    org_slug: org?.slug ?? null,
  })
}

// POST /api/invites/[token] — claim the invite (requires auth)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  // Fetch invite
  const { data: invite, error: fetchErr } = await supabase
    .from('invites')
    .select('id, org_id, role, claimed_by, expires_at')
    .eq('token', token)
    .single()

  if (fetchErr || !invite) return NextResponse.json({ error: 'Invalid invite' }, { status: 404 })
  if (invite.claimed_by)   return NextResponse.json({ error: 'Already claimed' }, { status: 410 })
  if (new Date(invite.expires_at) < new Date()) return NextResponse.json({ error: 'Expired' }, { status: 410 })

  // Check if user is already in an org
  const { data: existing } = await supabase
    .from('org_users')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'You are already a member of an organisation' }, { status: 409 })
  }

  // Create org_users record
  const { error: insertErr } = await supabase
    .from('org_users')
    .insert({ clerk_user_id: userId, org_id: invite.org_id, role: invite.role })

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Mark invite as claimed
  await supabase
    .from('invites')
    .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
    .eq('id', invite.id)

  // Get org slug for redirect
  const { data: org } = await supabase
    .from('orgs')
    .select('slug')
    .eq('id', invite.org_id)
    .single()

  return NextResponse.json({ ok: true, org_slug: org?.slug ?? null, role: invite.role })
}
