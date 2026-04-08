import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { auditMembershipEvent, resolveActiveMembership } from '@/lib/membership'
import { ALPHA_ORG_SLUG, PLATFORM_ROLES, isPlatformOperator } from '@/lib/platformAdmin'

type RoleChangeBody = {
  action: 'role_change'
  target_clerk_user_id: string
  role: string
}

type OrgTransferBody = {
  action: 'org_transfer'
  target_clerk_user_id: string
  to_org_id: string
  role: string
}

function normalizeRole(role: string): string {
  const r = role.trim().toLowerCase()
  if (r === 'owner') return 'admin'
  if (r === 'operator' || r === 'field') return 'member'
  return r
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as RoleChangeBody | OrgTransferBody
  const supabase = createServiceClient()

  if (body.action === 'role_change') {
    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'No org context' }, { status: 400 })
    const me = await resolveActiveMembership(userId)
    if (!me.membership || me.membership.org_id !== orgId || me.membership.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const target = await resolveActiveMembership(body.target_clerk_user_id)
    if (!target.membership || target.membership.org_id !== orgId) {
      return NextResponse.json({ error: 'Target is not an active member of this org' }, { status: 404 })
    }
    const nextRole = normalizeRole(body.role)

    if ((nextRole === 'member' || nextRole === 'manager' || nextRole === 'team_lead') && target.membership.role === 'admin') {
      const { count } = await supabase
        .from('org_users')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('is_active', true)
        .eq('role', 'admin')
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'Cannot demote the last administrator' }, { status: 400 })
      }
    }

    const { error } = await supabase
      .from('org_users')
      .update({ role: nextRole })
      .eq('id', target.membership.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    try {
      await auditMembershipEvent({
        actor_clerk_id: userId,
        subject_clerk_id: body.target_clerk_user_id,
        action: 'role_change',
        from_org_id: target.membership.org_id,
        to_org_id: target.membership.org_id,
        from_role: String(target.membership.role),
        to_role: nextRole,
      })
    } catch {
      // audit is best-effort
    }
    return NextResponse.json({ ok: true })
  }

  if (!(await isPlatformOperator(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const target = await resolveActiveMembership(body.target_clerk_user_id)
  const nextRole = normalizeRole(body.role)
  const isPlatformRole = PLATFORM_ROLES.includes(nextRole as (typeof PLATFORM_ROLES)[number])
  const { data: alphaOrg } = await supabase
    .from('orgs')
    .select('id')
    .eq('slug', ALPHA_ORG_SLUG)
    .maybeSingle()
  if (isPlatformRole && body.to_org_id !== alphaOrg?.id) {
    return NextResponse.json({ error: `Platform roles can only be assigned in ${ALPHA_ORG_SLUG}` }, { status: 400 })
  }
  if (!target.membership) {
    const { error } = await supabase.from('org_users').insert({
      clerk_user_id: body.target_clerk_user_id,
      org_id: body.to_org_id,
      role: nextRole,
      is_active: true,
      capabilities: {},
      person_id: null,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'inserted' })
  }

  if (!isPlatformRole) {
    let deactivate = supabase
      .from('org_users')
      .update({ is_active: false })
      .eq('clerk_user_id', body.target_clerk_user_id)
      .eq('is_active', true)
    if (alphaOrg?.id) deactivate = deactivate.neq('org_id', alphaOrg.id)
    await deactivate
  }

  const existingInTarget = await supabase
    .from('org_users')
    .select('id')
    .eq('clerk_user_id', body.target_clerk_user_id)
    .eq('org_id', body.to_org_id)
    .maybeSingle()

  const transferErr = existingInTarget.data
    ? (await supabase
        .from('org_users')
        .update({ role: nextRole, is_active: true })
        .eq('id', existingInTarget.data.id)).error
    : (await supabase
        .from('org_users')
        .insert({
          clerk_user_id: body.target_clerk_user_id,
          org_id: body.to_org_id,
          role: nextRole,
          is_active: true,
          capabilities: {},
          person_id: target.membership.person_id ?? null,
        })).error

  if (transferErr) return NextResponse.json({ error: transferErr.message }, { status: 500 })

  try {
    await auditMembershipEvent({
      actor_clerk_id: userId,
      subject_clerk_id: body.target_clerk_user_id,
      action: 'org_transfer',
      from_org_id: target.membership.org_id,
      to_org_id: body.to_org_id,
      from_role: String(target.membership.role),
      to_role: nextRole,
    })
  } catch {
    // audit is best-effort
  }

  return NextResponse.json({ ok: true, action: 'transferred' })
}

