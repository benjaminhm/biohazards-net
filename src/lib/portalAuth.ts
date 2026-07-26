/*
 * lib/portalAuth.ts
 *
 * Magic-link issue / consume for the commercial accounts portal.
 *
 * Only the SHA-256 hash of a token is stored. The raw value exists solely in the
 * email, so a database leak cannot be replayed as a login.
 *
 * Tokens are single-use and short-lived. The link in the email points at a
 * confirm page (/portal/login/[token]) which POSTs to consume — a GET that
 * consumed the token would be burned by email-scanner prefetch before the
 * recipient ever clicked.
 *
 * There is no rate-limit infrastructure in this app, so the limits here are
 * enforced by counting rows in client_portal_login_tokens.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobTradingName } from '@/lib/types'

/** Long enough that guessing is hopeless, short enough to survive email clients. */
const TOKEN_BYTES = 32

export const TOKEN_TTL_MINUTES = 15

/** Per-email and per-IP ceilings over a rolling hour. */
const MAX_PER_EMAIL_PER_HOUR = 5
const MAX_PER_IP_PER_HOUR = 20

export function generatePortalToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex')
}

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time compare of two hex hashes of equal length. */
function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/** Client IP as seen through Vercel's proxy. */
export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 100)
  return (req.headers.get('x-real-ip') ?? '').slice(0, 100)
}

export function userAgentFromRequest(req: Request): string {
  return (req.headers.get('user-agent') ?? '').slice(0, 500)
}

export interface PortalLoginTarget {
  orgId: string
  accountId: string
  contactId: string
  contactName: string
  contactEmail: string
  accountLegalName: string
  tradingName: JobTradingName
}

/**
 * Find the active contact for an email within an org+brand.
 * Returns null for unknown emails, disabled contacts, and non-active accounts —
 * callers must not distinguish these to the user (account enumeration).
 */
export async function findPortalLoginTarget(
  supabase: SupabaseClient,
  orgId: string,
  tradingName: JobTradingName,
  email: string
): Promise<PortalLoginTarget | null> {
  const normalised = email.trim().toLowerCase()
  if (!normalised) return null

  const { data, error } = await supabase
    .from('client_account_contacts')
    .select(
      'id, name, email, status, account_id, client_accounts!inner(id, org_id, legal_name, trading_name, status)'
    )
    .eq('org_id', orgId)
    .eq('status', 'active')
    // Exact match, not ilike: `%` and `_` are wildcards in ilike, so an address
    // like `%@company.com.au` would match every contact at that company and let
    // an attacker trigger login emails they cannot read.
    // Contact emails are always stored lowercased by the /api/accounts routes.
    .eq('email', normalised)
    .limit(1)

  if (error || !data?.length) return null

  const row = data[0] as unknown as {
    id: string
    name: string
    email: string
    account_id: string
    client_accounts:
      | { id: string; org_id: string; legal_name: string; trading_name: string; status: string }
      | { id: string; org_id: string; legal_name: string; trading_name: string; status: string }[]
  }

  // Supabase returns an embedded row as object or array depending on the join.
  const account = Array.isArray(row.client_accounts) ? row.client_accounts[0] : row.client_accounts
  if (!account) return null
  if (account.status !== 'active') return null
  if (account.trading_name !== tradingName) return null

  return {
    orgId,
    accountId: account.id,
    contactId: row.id,
    contactName: row.name,
    contactEmail: row.email,
    accountLegalName: account.legal_name,
    tradingName: account.trading_name as JobTradingName,
  }
}

/**
 * True when this email or IP has already asked for too many links this hour.
 * Counted before a target is resolved so unknown emails are throttled too.
 */
export async function isPortalLoginRateLimited(
  supabase: SupabaseClient,
  email: string,
  ip: string
): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const normalised = email.trim().toLowerCase()

  if (normalised) {
    const { count } = await supabase
      .from('client_portal_login_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('email_at_issue', normalised)
      .gte('created_at', since)
    if ((count ?? 0) >= MAX_PER_EMAIL_PER_HOUR) return true
  }

  if (ip) {
    const { count } = await supabase
      .from('client_portal_login_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('requested_ip', ip)
      .gte('created_at', since)
    if ((count ?? 0) >= MAX_PER_IP_PER_HOUR) return true
  }

  return false
}

/** Issue a token row and return the raw token for the email body. */
export async function issuePortalLoginToken(
  supabase: SupabaseClient,
  target: PortalLoginTarget,
  ip: string,
  userAgent: string
): Promise<string | null> {
  const token = generatePortalToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString()

  const { error } = await supabase.from('client_portal_login_tokens').insert({
    org_id: target.orgId,
    account_id: target.accountId,
    contact_id: target.contactId,
    token_hash: hashPortalToken(token),
    email_at_issue: target.contactEmail.trim().toLowerCase(),
    expires_at: expiresAt,
    requested_ip: ip,
    requested_user_agent: userAgent,
  })

  if (error) return null
  return token
}

export type ConsumeFailure = 'invalid' | 'expired' | 'used' | 'inactive'

export interface ConsumeSuccess {
  orgId: string
  accountId: string
  contactId: string
  contactEmail: string
  tradingName: JobTradingName
}

/**
 * Validate and burn a token. Marks consumed_at with a conditional update so two
 * simultaneous requests cannot both succeed.
 */
export async function consumePortalLoginToken(
  supabase: SupabaseClient,
  rawToken: string
): Promise<{ ok: true; session: ConsumeSuccess } | { ok: false; reason: ConsumeFailure }> {
  const trimmed = (rawToken ?? '').trim()
  if (!/^[0-9a-f]{64}$/.test(trimmed)) return { ok: false, reason: 'invalid' }

  const hash = hashPortalToken(trimmed)

  const { data: row, error } = await supabase
    .from('client_portal_login_tokens')
    .select('id, org_id, account_id, contact_id, token_hash, expires_at, consumed_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (error || !row) return { ok: false, reason: 'invalid' }
  if (!hashesMatch(row.token_hash as string, hash)) return { ok: false, reason: 'invalid' }
  if (row.consumed_at) return { ok: false, reason: 'used' }
  if (new Date(row.expires_at as string).getTime() < Date.now()) return { ok: false, reason: 'expired' }

  const { data: burned } = await supabase
    .from('client_portal_login_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()

  if (!burned) return { ok: false, reason: 'used' }

  // Re-check status at consume time: staff may have disabled the contact or the
  // account in the 15 minutes since the link was sent.
  const { data: contact } = await supabase
    .from('client_account_contacts')
    .select('id, email, status, account_id, client_accounts!inner(id, trading_name, status)')
    .eq('id', row.contact_id)
    .maybeSingle()

  if (!contact || contact.status !== 'active') return { ok: false, reason: 'inactive' }

  const acc = contact.client_accounts as unknown
  const account = (Array.isArray(acc) ? acc[0] : acc) as
    | { id: string; trading_name: string; status: string }
    | undefined
  if (!account || account.status !== 'active') return { ok: false, reason: 'inactive' }

  await supabase
    .from('client_account_contacts')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', row.contact_id)

  return {
    ok: true,
    session: {
      orgId: row.org_id as string,
      accountId: row.account_id as string,
      contactId: row.contact_id as string,
      contactEmail: (contact.email as string) ?? '',
      tradingName: account.trading_name as JobTradingName,
    },
  }
}
