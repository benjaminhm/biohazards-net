/*
 * lib/platformAdmin.ts
 *
 * Shared helpers for PLATFORM_ADMIN_CLERK_IDS — platform operators who can use
 * /admin, /platform, /api/admin/*, and tenant impersonation for support/debug.
 */

export function getPlatformAdminIds(): string[] {
  return (process.env.PLATFORM_ADMIN_CLERK_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

export const ALPHA_ORG_SLUG = 'biohazards-net'
export const PLATFORM_ROLES = ['platform_owner', 'platform_admin'] as const

export function isPlatformAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false
  return getPlatformAdminIds().includes(userId)
}

export async function hasAlphaPlatformRole(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  const { createServiceClient } = await import('@/lib/supabase')
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('org_users')
    .select('id, role, orgs!inner(slug)')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .eq('orgs.slug', ALPHA_ORG_SLUG)
    .in('role', [...PLATFORM_ROLES])
    .limit(1)

  if (error) return false
  return !!(data && data.length > 0)
}

export async function isPlatformOperator(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  if (isPlatformAdmin(userId)) return true
  return hasAlphaPlatformRole(userId)
}
