/*
 * lib/portalTenant.ts
 *
 * Resolve which org and trading brand an accounts-portal request belongs to,
 * before any session exists (the login form needs this to find a contact).
 *
 * lib/org.ts cannot be used here: it resolves a tenant from x-org-host or Clerk
 * membership, and the accounts host sets neither. The brand comes from the host
 * via middleware's x-portal-trading-name header; the org comes from
 * ACCOUNTS_PORTAL_ORG_SLUG, following the same env-gating pattern as
 * JOB_INBOUND_EMAIL_ORG_SLUGS.
 */
import { createServiceClient } from '@/lib/supabase'
import { isTradingNameId, tradingNameOption } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'

export interface PortalTenant {
  orgId: string
  orgSlug: string
  tradingName: TradingNameId
  brandLabel: string
  brandEmail: string
}

export const PORTAL_TRADING_NAME_HEADER = 'x-portal-trading-name'

/** Trading brand for this request, from the accounts host. */
export function portalTradingNameFromHeaders(headerValue: string | null): TradingNameId | null {
  return isTradingNameId(headerValue) ? headerValue : null
}

/**
 * Resolve the tenant for an accounts-portal request, or null when the portal is
 * not configured for this host (missing env, unknown brand, inactive org).
 */
export async function getPortalTenant(
  headerValue: string | null,
  companyEmailFallback?: string | null
): Promise<PortalTenant | null> {
  const tradingName = portalTradingNameFromHeaders(headerValue)
  if (!tradingName) return null

  const slug = (process.env.ACCOUNTS_PORTAL_ORG_SLUG ?? '').trim()
  if (!slug) return null

  const supabase = createServiceClient()
  const { data: org } = await supabase
    .from('orgs')
    .select('id, slug')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()

  if (!org) return null

  const option = tradingNameOption(tradingName)

  return {
    orgId: org.id as string,
    orgSlug: org.slug as string,
    tradingName,
    brandLabel: option?.label ?? 'Accounts',
    brandEmail: option?.email ?? companyEmailFallback ?? '',
  }
}

/** Convenience wrapper for API routes, which read the header off the Request. */
export function portalTradingNameFromRequest(req: Request): TradingNameId | null {
  return portalTradingNameFromHeaders(req.headers.get(PORTAL_TRADING_NAME_HEADER))
}
