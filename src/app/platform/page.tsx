/*
 * app/platform/page.tsx
 *
 * Platform admin dashboard — served at platform.biohazards.net
 * Middleware gates this to PLATFORM_ADMIN_CLERK_IDS only and redirects
 * platform.biohazards.net/ → /platform, which lands here.
 *
 * The actual dashboard UI lives in app/admin/page.tsx and is re-exported
 * here so it works under both /admin (legacy) and /platform (new URL).
 */
export { default } from '@/app/admin/page'
