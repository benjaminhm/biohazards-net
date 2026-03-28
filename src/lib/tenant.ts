import { createServiceClient } from './supabase'
import { CompanyProfile } from './types'

const PLATFORM_DOMAIN = 'biohazards.net'

/**
 * Resolve a CompanyProfile from an incoming hostname.
 * Checks custom_domain first, then subdomain.
 * Falls back to the single platform profile if no match.
 */
export async function getTenantByHost(host: string): Promise<CompanyProfile | null> {
  const db = createServiceClient()

  // Strip port if present
  const cleanHost = host.split(':')[0]

  // Check for exact custom domain match (e.g. app.hazmatpro.com.au)
  const { data: byDomain } = await db
    .from('company_profile')
    .select('*')
    .eq('custom_domain', cleanHost)
    .single()

  if (byDomain) return byDomain

  // Check for subdomain match (e.g. sydney.biohazards.net)
  if (cleanHost.endsWith(`.${PLATFORM_DOMAIN}`)) {
    const sub = cleanHost.replace(`.${PLATFORM_DOMAIN}`, '')
    // Ignore platform subdomains
    if (sub !== 'app' && sub !== 'www') {
      const { data: bySub } = await db
        .from('company_profile')
        .select('*')
        .eq('subdomain', sub)
        .single()

      if (bySub) return bySub
    }
  }

  // Fall back to the platform's own profile (single row)
  const { data: fallback } = await db
    .from('company_profile')
    .select('*')
    .limit(1)
    .single()

  return fallback ?? null
}

/**
 * Get the public app URL for a tenant.
 * Used for accept links in PDFs and emails.
 */
export function getTenantAppUrl(profile: CompanyProfile): string {
  if (profile.custom_domain) return `https://${profile.custom_domain}`
  if (profile.subdomain) return `https://${profile.subdomain}.${PLATFORM_DOMAIN}`
  return process.env.NEXT_PUBLIC_APP_URL || `https://app.${PLATFORM_DOMAIN}`
}
