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

export function isPlatformAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false
  return getPlatformAdminIds().includes(userId)
}
