/*
 * lib/accountsAdmin.ts
 *
 * Staff-side authorisation for managing commercial trade accounts.
 *
 * Trade accounts carry commercial terms, so managing them is restricted to
 * admin / owner / manager. Team leads get the full job file (see the
 * isFullJobFileRole checks in api/jobs/[id]) but not the account relationship.
 */
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { verifyImpersonationFromRequest } from '@/lib/impersonation'
import type { SupabaseClient } from '@supabase/supabase-js'

const ACCOUNT_ADMIN_ROLES = new Set(['admin', 'owner', 'manager'])

export interface AccountsAdminContext {
  supabase: SupabaseClient
  orgId: string
  userId: string
}

/**
 * Resolve the staff context for /api/accounts/*, or a Response to return.
 *
 * Usage:
 *   const ctx = await requireAccountsAdmin(req)
 *   if ('response' in ctx) return ctx.response
 */
export async function requireAccountsAdmin(
  req: Request
): Promise<AccountsAdminContext | { response: NextResponse }> {
  const { userId } = await auth()
  const { orgId } = await getOrgId(req, userId ?? null)

  if (!userId || !orgId) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const supabase = createServiceClient()

  const impersonation = await verifyImpersonationFromRequest(req, userId)
  if (impersonation?.orgId === orgId) {
    return { supabase, orgId, userId }
  }

  const { data: orgUser } = await supabase
    .from('org_users')
    .select('role')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  const role = (orgUser?.role as string | null)?.trim().toLowerCase()
  if (!role || !ACCOUNT_ADMIN_ROLES.has(role)) {
    return {
      response: NextResponse.json(
        { error: 'Only admins and managers can manage trade accounts' },
        { status: 403 }
      ),
    }
  }

  return { supabase, orgId, userId }
}

/** Fields staff may write on an account. Everything else is derived or audit. */
export const EDITABLE_ACCOUNT_FIELDS = [
  'legal_name',
  'trading_as',
  'abn',
  'billing_email',
  'billing_address',
  'phone',
  'notes',
  'status',
] as const

/** Fields staff may write on a contact. */
export const EDITABLE_CONTACT_FIELDS = [
  'name',
  'email',
  'phone',
  'title',
  'is_primary',
  'can_accept_quotes',
  'status',
] as const

/**
 * Keep only permitted keys and coerce to the column types, so a client cannot
 * write org_id, terms_accepted_at or any other audit column by adding it to the
 * request body.
 */
export function pickFields<K extends string>(
  body: Record<string, unknown>,
  allowed: readonly K[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    if (!(key in body)) continue
    const value = body[key]
    if (typeof value === 'boolean' || value === null) {
      out[key] = value
    } else if (typeof value === 'string') {
      out[key] = value.trim()
    } else if (typeof value === 'number') {
      out[key] = String(value)
    }
  }
  return out
}

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/** Domain part of an email, lowercased. Used to suggest a job's account. */
export function emailDomain(email: string | null | undefined): string | null {
  const at = (email ?? '').trim().toLowerCase().lastIndexOf('@')
  if (at < 0) return null
  const domain = (email ?? '').trim().toLowerCase().slice(at + 1)
  return domain || null
}

/*
 * Free mailbox providers never identify an organisation, so they must not be
 * used to suggest that a job belongs to a trade account.
 */
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.com.au',
  'hotmail.com',
  'hotmail.com.au',
  'live.com',
  'live.com.au',
  'yahoo.com',
  'yahoo.com.au',
  'icloud.com',
  'me.com',
  'bigpond.com',
  'bigpond.net.au',
  'optusnet.com.au',
  'tpg.com.au',
  'iinet.net.au',
  'internode.on.net',
  'protonmail.com',
  'proton.me',
])

export function isOrganisationDomain(domain: string | null): boolean {
  return !!domain && !GENERIC_EMAIL_DOMAINS.has(domain)
}
