/*
 * lib/org.ts
 *
 * Tenant resolution for authenticated API routes. Reads org context from
 * request headers set by middleware (x-org-slug or x-org-host) and maps
 * them to an org_id from the orgs table.
 *
 * The middleware injects these headers before any API handler runs:
 *   x-org-host  — set when request comes from a custom domain
 *   x-org-slug  — set when request comes from a subdomain (or 'app' for main)
 *
 * When slug is 'app' (the platform's own subdomain), org is resolved by
 * looking up the user's org_users membership record — one user, one org.
 */
import { createServiceClient } from '@/lib/supabase'
import { verifyImpersonationFromRequest } from '@/lib/impersonation'
import { resolveActiveMembership } from '@/lib/membership'

export interface OrgResult {
  orgId: string | null
  orgSlug: string | null
}

/**
 * Resolve org_id from a request.
 * - Reads `x-org-slug` header
 * - If slug exists and is not 'app' → query orgs WHERE slug = ? AND is_active = true
 * - If slug is 'app' or missing → query org_users WHERE clerk_user_id = clerkUserId, join orgs
 */
export async function getOrgId(req: Request, clerkUserId: string | null): Promise<OrgResult> {
  const slug       = req.headers.get('x-org-slug')
  const customHost = req.headers.get('x-org-host')

  // Custom domain (e.g. app.brisbanebiohazardcleaning.com.au)
  if (customHost) {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('orgs')
      .select('id, slug')
      .eq('custom_domain', customHost)
      .eq('is_active', true)
      .single()
    if (error || !data) return { orgId: null, orgSlug: null }
    return { orgId: data.id as string, orgSlug: data.slug as string }
  }

  // Subdomain slug (e.g. brisbanebiohazardcleaning.biohazards.net)
  if (slug && slug !== 'app') {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('orgs')
      .select('id, slug')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()
    if (error || !data) return { orgId: null, orgSlug: null }
    return { orgId: data.id as string, orgSlug: data.slug as string }
  }

  // app.biohazards.net — platform-admin impersonation (training / debugging) or membership
  if (!clerkUserId) return { orgId: null, orgSlug: null }

  const imp = await verifyImpersonationFromRequest(req, clerkUserId)
  if (imp) {
    const supabase = createServiceClient()
    const { data: org } = await supabase
      .from('orgs')
      .select('id, slug')
      .eq('id', imp.orgId)
      .eq('is_active', true)
      .maybeSingle()
    if (org) return { orgId: org.id as string, orgSlug: org.slug as string }
  }

  return getOrgResultForUser(clerkUserId)
}

/* Supabase returns orgs as array or object depending on join type —
   normalise to a single object here. */
async function getOrgResultForUser(clerkUserId: string): Promise<OrgResult> {
  const resolved = await resolveActiveMembership(clerkUserId)
  if (!resolved.membership?.org?.is_active) return { orgId: null, orgSlug: null }
  return { orgId: resolved.membership.org_id, orgSlug: resolved.membership.org.slug }
}

/**
 * Get a full org row by slug, or null if not found / inactive.
 */
export async function getOrgBySlug(slug: string) {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('orgs')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (error || !data) return null
  return data
}

/**
 * Get the org_id for a Clerk user from their org_users membership row.
 */
export async function getOrgIdForUser(clerkUserId: string): Promise<string | null> {
  const resolved = await resolveActiveMembership(clerkUserId)
  return resolved.membership?.org_id ?? null
}
