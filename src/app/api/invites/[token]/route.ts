/*
 * app/api/invites/[token]/route.ts
 *
 * Public GET + authenticated POST for the invite claim flow.
 *
 * GET  — returns invite metadata (role, org name) for the /invite/[token] page
 *   to show before the user signs in. Returns 410 if already claimed or expired.
 *
 * POST — claims the invite (requires Clerk auth). Handles two cases:
 *   1. User already in same org → links person profile if invite carries person_id
 *   2. New user → creates org_users record and marks invite claimed
 *
 * An invite cannot be used to join a second org if the user is already in one.
 * Supabase's orgs join is normalised before use because PostgREST can return
 * the related row as either an array or object depending on join cardinality.
 */
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

  // Fetch invite (include person_id so we can link profiles)
  const { data: invite, error: fetchErr } = await supabase
    .from('invites')
    .select('id, org_id, role, claimed_by, expires_at, person_id')
    .eq('token', token)
    .single()

  if (fetchErr || !invite) return NextResponse.json({ error: 'Invalid invite' }, { status: 404 })
  if (invite.claimed_by)   return NextResponse.json({ error: 'Already claimed' }, { status: 410 })
  if (new Date(invite.expires_at) < new Date()) return NextResponse.json({ error: 'Expired' }, { status: 410 })

  // Check if user already belongs to an org
  const { data: existing } = await supabase
    .from('org_users')
    .select('id, org_id')
    .eq('clerk_user_id', userId)
    .single()

  if (existing) {
    if (existing.org_id !== invite.org_id) {
      // Different org — genuinely can't join two orgs
      return NextResponse.json({ error: 'You are already a member of a different organisation' }, { status: 409 })
    }
    // Same org — just link the person profile if the invite carries one
    if (invite.person_id) {
      await supabase
        .from('org_users')
        .update({ person_id: invite.person_id })
        .eq('id', existing.id)
    }
    // Mark invite claimed and return
    await supabase
      .from('invites')
      .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
      .eq('id', invite.id)

    const { data: org } = await supabase.from('orgs').select('slug').eq('id', invite.org_id).single()
    return NextResponse.json({ ok: true, org_slug: org?.slug ?? null, role: existing.org_id })
  }

  // New user — create org_users record
  const { error: insertErr } = await supabase
    .from('org_users')
    .insert({
      clerk_user_id: userId,
      org_id: invite.org_id,
      role: invite.role,
      person_id: invite.person_id ?? null,
    })

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
