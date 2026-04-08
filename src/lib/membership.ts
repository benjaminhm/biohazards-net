import { createServiceClient } from '@/lib/supabase'

export type MembershipRole =
  | 'admin'
  | 'manager'
  | 'team_lead'
  | 'member'
  | 'client'
  | 'property_manager'
  | 'body_corp'
  | 'platform_owner'
  | 'platform_admin'

export interface ActiveMembership {
  id: string
  clerk_user_id: string
  org_id: string
  role: MembershipRole | string
  capabilities: Record<string, unknown> | null
  person_id: string | null
  created_at: string
  org: {
    id: string
    name: string
    slug: string
    features: Record<string, boolean> | null
    is_active: boolean
  } | null
}

export interface ActiveMembershipResult {
  membership: ActiveMembership | null
  hasConflict: boolean
}

function mapRole(role: string | null | undefined): MembershipRole | 'member' {
  if (!role) return 'member'
  const normalized = role.trim().toLowerCase()
  if (normalized === 'owner') return 'admin'
  if (normalized === 'operator' || normalized === 'field') return 'member'
  if (
    normalized === 'admin' ||
    normalized === 'manager' ||
    normalized === 'team_lead' ||
    normalized === 'member' ||
    normalized === 'client' ||
    normalized === 'property_manager' ||
    normalized === 'body_corp' ||
    normalized === 'platform_owner' ||
    normalized === 'platform_admin'
  ) return normalized
  return 'member'
}

export async function resolveActiveMembership(clerkUserId: string): Promise<ActiveMembershipResult> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('org_users')
    .select('id, clerk_user_id, org_id, role, capabilities, person_id, created_at, orgs(id, name, slug, features, is_active)')
    .eq('clerk_user_id', clerkUserId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error || !data || data.length === 0) return { membership: null, hasConflict: false }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = data as any[]
  const activeRows = rows.filter(r => {
    const org = Array.isArray(r.orgs) ? r.orgs[0] : r.orgs
    return !!org?.is_active
  })
  const primary = (activeRows[0] ?? rows[0]) as Record<string, unknown>
  const orgRaw = Array.isArray(primary.orgs) ? primary.orgs[0] : primary.orgs

  const membership: ActiveMembership = {
    id: String(primary.id),
    clerk_user_id: String(primary.clerk_user_id),
    org_id: String(primary.org_id),
    role: mapRole((primary.role as string) ?? 'member'),
    capabilities: (primary.capabilities as Record<string, unknown> | null) ?? null,
    person_id: (primary.person_id as string | null) ?? null,
    created_at: String(primary.created_at),
    org: orgRaw
      ? {
          id: String(orgRaw.id),
          name: String(orgRaw.name),
          slug: String(orgRaw.slug),
          features: (orgRaw.features as Record<string, boolean> | null) ?? null,
          is_active: Boolean(orgRaw.is_active),
        }
      : null,
  }

  return { membership, hasConflict: activeRows.length > 1 }
}

export async function auditMembershipEvent(input: {
  actor_clerk_id: string
  subject_clerk_id: string
  action: 'role_change' | 'org_transfer' | 'membership_link'
  from_org_id?: string | null
  to_org_id?: string | null
  from_role?: string | null
  to_role?: string | null
  note?: string | null
}) {
  const supabase = createServiceClient()
  await supabase.from('membership_audit').insert(input)
}

