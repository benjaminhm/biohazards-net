/*
 * lib/org.ts
 *
 * Which organisation a signed-in member of staff belongs to.
 *
 * There is one company, and the answer only ever comes from the person's own
 * membership (org_users). It never comes from the address the request was made
 * to or from a request header: both are chosen by whoever sends the request.
 * Until Nov 2026 a [name].biohazards.net address named the organisation, which
 * handed its data to anyone who asked, signed in or not.
 */
import { resolveActiveMembership } from '@/lib/membership'

export interface OrgResult {
  orgId: string | null
  orgSlug: string | null
}

/**
 * The organisation of the signed-in person, or nulls when nobody is signed in,
 * they have no membership, or their organisation is inactive.
 *
 * `req` is unused and kept so the many callers stay as they are.
 */
export async function getOrgId(_req: Request, clerkUserId: string | null): Promise<OrgResult> {
  if (!clerkUserId) return { orgId: null, orgSlug: null }
  const resolved = await resolveActiveMembership(clerkUserId)
  if (!resolved.membership?.org?.is_active) return { orgId: null, orgSlug: null }
  return { orgId: resolved.membership.org_id, orgSlug: resolved.membership.org.slug }
}
