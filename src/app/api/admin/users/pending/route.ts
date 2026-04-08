/*
 * app/api/admin/users/pending/route.ts
 *
 * GET  /api/admin/users/pending — list Clerk users who have no org_users row yet
 * POST /api/admin/users/pending — assign a user to an org (platform super-admin only)
 *
 * POST behaviour:
 *   - No existing org_users for this Clerk user → insert membership.
 *   - Already in the same org → update role only.
 *   - Already in a different org → 409 + { code: 'NEEDS_MOVE_CONFIRMATION', existing_org }
 *     unless body.confirm_move is true, then existing active memberships are
 *     deactivated and a new active membership is created.
 *
 * Restricted to PLATFORM_ADMIN_CLERK_IDS (super-admin only).
 */
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { ALPHA_ORG_SLUG, PLATFORM_ROLES, isPlatformOperator } from '@/lib/platformAdmin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function orgFromJoin(row: any): { name: string; slug: string | null } {
  const o = row.orgs
  const org = Array.isArray(o) ? o[0] : o
  return { name: org?.name ?? 'Unknown organisation', slug: org?.slug ?? null }
}

export async function GET() {
  const { userId } = await auth()
  if (!(await isPlatformOperator(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { data: orgUsers } = await supabase.from('org_users').select('clerk_user_id')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignedIds = new Set((orgUsers ?? []).map((u: any) => u.clerk_user_id))

  const clerk = await clerkClient()
  const { data: allUsers } = await clerk.users.getUserList({ limit: 100 })

  const pending = allUsers
    .filter(u => !assignedIds.has(u.id))
    .map(u => ({
      clerk_user_id: u.id,
      email: u.emailAddresses[0]?.emailAddress ?? '',
      name: ([u.firstName, u.lastName].filter(Boolean).join(' ')) || (u.emailAddresses[0]?.emailAddress ?? 'Unknown'),
      image_url: u.imageUrl,
      created_at: new Date(u.createdAt).toISOString(),
    }))

  return NextResponse.json({ users: pending })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!(await isPlatformOperator(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    clerk_user_id: string
    org_id: string
    role: string
    confirm_move?: boolean
  }
  const { clerk_user_id, org_id, role, confirm_move } = body
  if (!clerk_user_id || !org_id || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: existingRows, error: exErr } = await supabase
    .from('org_users')
    .select('id, org_id, orgs(name, slug)')
    .eq('clerk_user_id', clerk_user_id)

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })

  const existing = existingRows ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alphaOrgRows = existing.filter((r: any) => (Array.isArray(r.orgs) ? r.orgs[0] : r.orgs)?.slug === ALPHA_ORG_SLUG)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blockingRows = existing.filter((r: any) => (Array.isArray(r.orgs) ? r.orgs[0] : r.orgs)?.slug !== ALPHA_ORG_SLUG)
  const normalizedRole = role.trim().toLowerCase()
  const isPlatformRole = PLATFORM_ROLES.includes(normalizedRole as (typeof PLATFORM_ROLES)[number])

  if (isPlatformRole) {
    const { data: alphaOrg } = await supabase
      .from('orgs')
      .select('id')
      .eq('slug', ALPHA_ORG_SLUG)
      .maybeSingle()
    if (!alphaOrg?.id || alphaOrg.id !== org_id) {
      return NextResponse.json({ error: `Platform roles can only be assigned in ${ALPHA_ORG_SLUG}` }, { status: 400 })
    }
  }

  // Fresh user — insert
  if (existing.length === 0) {
    const { error } = await supabase.from('org_users').insert({
      clerk_user_id,
      org_id,
      role,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'inserted' })
  }

  if (isPlatformRole) {
    const existingAlphaRow = alphaOrgRows.find(r => r.org_id === org_id)
    const platformErr = existingAlphaRow
      ? (await supabase.from('org_users').update({ role: normalizedRole, is_active: true }).eq('id', existingAlphaRow.id)).error
      : (await supabase.from('org_users').insert({
          clerk_user_id,
          org_id,
          role: normalizedRole,
          is_active: true,
          person_id: null,
          capabilities: {},
        })).error
    if (platformErr) return NextResponse.json({ error: platformErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, action: existingAlphaRow ? 'updated_platform_role' : 'added_platform_role' })
  }

  // Same org — role change only
  const sameOrgRow = blockingRows.find(r => r.org_id === org_id)
  if (sameOrgRow) {
    const { error } = await supabase.from('org_users').update({ role }).eq('id', sameOrgRow.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'updated_role' })
  }

  // Different org — need explicit move confirmation
  if (blockingRows.length > 0 && !confirm_move) {
    const first = blockingRows[0]
    const { name, slug } = orgFromJoin(first)
    return NextResponse.json(
      {
        error:
          'This user is already assigned to another organisation. They cannot hold positions in two organisations at once.',
        code: 'NEEDS_MOVE_CONFIRMATION',
        existing_org: {
          id: first.org_id,
          name,
          slug,
        },
      },
      { status: 409 }
    )
  }

  // Move: deactivate active memberships for this user, then activate target org
  if (blockingRows.length > 0) {
    const { error: deactivateErr } = await supabase
      .from('org_users')
      .update({ is_active: false })
      .eq('clerk_user_id', clerk_user_id)
      .eq('is_active', true)
      .neq('org_id', alphaOrgRows[0]?.org_id ?? '')
    if (deactivateErr) return NextResponse.json({ error: deactivateErr.message }, { status: 500 })
  }

  const { data: existingTarget } = await supabase
    .from('org_users')
    .select('id')
    .eq('clerk_user_id', clerk_user_id)
    .eq('org_id', org_id)
    .maybeSingle()

  const insErr = existingTarget
    ? (await supabase.from('org_users').update({ role, is_active: true }).eq('id', existingTarget.id)).error
    : (await supabase.from('org_users').insert({
        clerk_user_id,
        org_id,
        role,
        person_id: null,
        capabilities: {},
      })).error
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, action: 'moved' })
}
