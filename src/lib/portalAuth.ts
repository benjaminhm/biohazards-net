/*
 * lib/portalAuth.ts
 *
 * Sign-in credentials for the commercial accounts portal.
 *
 * One credential, delivered two ways. The email carries a magic link and a
 * six-digit code, both backed by the same row, so using either burns both. A
 * client whose mail gateway rewrites URLs — Safe Links, Mimecast — or whose
 * policy forbids clicking links in external mail types the code into a browser
 * they opened themselves instead.
 *
 * Only SHA-256 hashes are stored, so a leaked table cannot be replayed as a
 * login — true of the 32-byte token, but only loosely of the code, whose million
 * candidates fall to a brute force instantly. What keeps six digits safe is
 * MAX_CODE_ATTEMPTS and the fact that a code is worthless without the address it
 * was sent to, not its length.
 *
 * Credentials are single-use. The link points at a confirm page
 * (/portal/login/[token]) which POSTs to consume — a GET that consumed the token
 * would be burned by email-scanner prefetch before the recipient ever clicked.
 *
 * There is no rate-limit infrastructure in this app, so the limits here are
 * enforced by counting rows in client_portal_login_tokens.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobTradingName } from '@/lib/types'

/** Long enough that guessing is hopeless, short enough to survive email clients. */
const TOKEN_BYTES = 32

export type PortalLoginPurpose = 'self_service' | 'staff_invite'

/*
 * An hour, not fifteen minutes: a corporate quarantine can hold a message for
 * hours before anyone releases it, and a credential that dies first turns the
 * client's first interaction with us into an error page.
 */
export const SELF_SERVICE_TTL_MINUTES = 60

/*
 * A week for an invite we sent unprompted. Onboarding waits on the client being
 * at their desk, and making them ask for a second link to do a job we started is
 * a poor introduction.
 */
export const INVITE_TTL_MINUTES = 60 * 24 * 7

export function ttlMinutesFor(purpose: PortalLoginPurpose): number {
  return purpose === 'staff_invite' ? INVITE_TTL_MINUTES : SELF_SERVICE_TTL_MINUTES
}

/** Per-email and per-IP ceilings over a rolling hour. */
const MAX_PER_EMAIL_PER_HOUR = 5
const MAX_PER_IP_PER_HOUR = 20

/**
 * Wrong guesses allowed against one code before the row is dead.
 *
 * Six digits is only a million combinations, so this cap — not the length — is
 * what makes a typeable code safe. Paired with MAX_PER_EMAIL_PER_HOUR an
 * attacker who knows the address gets 25 guesses an hour.
 */
const MAX_CODE_ATTEMPTS = 5

export function generatePortalToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex')
}

/** Six digits, leading zeros kept, from a CSPRNG rather than Math.random. */
export function generatePortalCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Digits only, so "123 456" and "123-456" from an email still work. */
export function normalisePortalCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\D/g, '') : ''
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

interface LoginAccountRow {
  id: string
  legal_name: string
  trading_name: string
  status: string
}

/*
 * Load the account a contact belongs to.
 *
 * Deliberately a second query rather than a PostgREST embed. There are now three
 * foreign keys between client_account_contacts and client_accounts — the
 * contact's account_id, plus terms_accepted_by_contact_id and
 * application_submitted_by_contact_id pointing back — and an embed across an
 * ambiguous pair errors instead of returning rows. Both call sites read no rows
 * as "no active contact", so that surfaced as silently unsent magic links and
 * "this account is no longer active" on an otherwise valid link. Sign-in is the
 * only way into the portal; it must not rest on relationship inference that a
 * later migration can change.
 */
async function loadLoginAccount(
  supabase: SupabaseClient,
  accountId: string
): Promise<LoginAccountRow | null> {
  const { data } = await supabase
    .from('client_accounts')
    .select('id, legal_name, trading_name, status')
    .eq('id', accountId)
    .maybeSingle()

  return (data as LoginAccountRow | null) ?? null
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
    .select('id, name, email, status, account_id')
    .eq('org_id', orgId)
    .eq('status', 'active')
    // Exact match, not ilike: `%` and `_` are wildcards in ilike, so an address
    // like `%@company.com.au` would match every contact at that company and let
    // an attacker trigger login emails they cannot read.
    // Contact emails are always stored lowercased by the /api/accounts routes.
    .eq('email', normalised)
    .limit(1)

  if (error || !data?.length) return null

  const row = data[0] as {
    id: string
    name: string
    email: string
    account_id: string
  }

  const account = await loadLoginAccount(supabase, row.account_id)
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

export interface IssuedPortalLogin {
  /** Goes in the link. */
  token: string
  /** Shown in the email for the client to type. */
  code: string
  purpose: PortalLoginPurpose
  ttlMinutes: number
}

/**
 * Issue one credential row and return both of its raw forms for the email body.
 *
 * Link and code share a row so that using either burns both — two rows would let
 * a client sign in with the code after the link had already been consumed.
 */
export async function issuePortalLogin(
  supabase: SupabaseClient,
  target: PortalLoginTarget,
  ip: string,
  userAgent: string,
  purpose: PortalLoginPurpose = 'self_service'
): Promise<IssuedPortalLogin | null> {
  const token = generatePortalToken()
  const code = generatePortalCode()
  const ttlMinutes = ttlMinutesFor(purpose)
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()

  const { error } = await supabase.from('client_portal_login_tokens').insert({
    org_id: target.orgId,
    account_id: target.accountId,
    contact_id: target.contactId,
    token_hash: hashPortalToken(token),
    code_hash: hashPortalToken(code),
    purpose,
    email_at_issue: target.contactEmail.trim().toLowerCase(),
    expires_at: expiresAt,
    requested_ip: ip,
    requested_user_agent: userAgent,
  })

  if (error) return null
  return { token, code, purpose, ttlMinutes }
}

export type ConsumeFailure = 'invalid' | 'expired' | 'used' | 'inactive'

export interface ConsumeSuccess {
  orgId: string
  accountId: string
  contactId: string
  contactEmail: string
  tradingName: JobTradingName
}

type ConsumeResult = { ok: true; session: ConsumeSuccess } | { ok: false; reason: ConsumeFailure }

/**
 * Wording for a failed sign-in, in one place so the link and code paths cannot
 * describe the same failure differently.
 *
 * Deliberately vague about whether the email is on an account: the login form
 * refuses to confirm that, and these messages must not undo it.
 */
export function signInFailureMessage(reason: ConsumeFailure, channel: 'link' | 'code'): string {
  const thing = channel === 'code' ? 'code' : 'sign-in link'
  switch (reason) {
    case 'expired':
      return `That ${thing} has expired. Please request a new one.`
    case 'used':
      return `That ${thing} has already been used. Please request a new one.`
    case 'inactive':
      return 'This account is no longer active. Please contact us.'
    default:
      return channel === 'code'
        ? 'That code is not valid or has expired. Please check the email or request a new one.'
        : 'That sign-in link is not valid. Please request a new one.'
  }
}

interface LoginRow {
  id: string
  org_id: string
  account_id: string
  contact_id: string
}

const CREDENTIAL_COLUMNS =
  'id, org_id, account_id, contact_id, token_hash, code_hash, code_attempts, expires_at, consumed_at'

/**
 * Burn a validated credential row and mint the session.
 *
 * Shared by the link and code paths so the two can never drift on what a
 * successful sign-in requires. Everything before this point differs — a token
 * matches one row directly, a code has to be searched for and rate-limited —
 * but from here they are the same operation.
 */
async function burnAndMint(supabase: SupabaseClient, row: LoginRow): Promise<ConsumeResult> {
  // The conditional update is the real guard against two simultaneous requests,
  // or a click and a typed code racing each other.
  const { data: burned } = await supabase
    .from('client_portal_login_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()

  if (!burned) return { ok: false, reason: 'used' }

  // Re-check status at consume time: staff may have disabled the contact or the
  // account since the credential was sent, and an invite is valid for a week.
  const { data: contact } = await supabase
    .from('client_account_contacts')
    .select('id, email, status, account_id')
    .eq('id', row.contact_id)
    .maybeSingle()

  if (!contact || contact.status !== 'active') return { ok: false, reason: 'inactive' }

  const account = await loadLoginAccount(supabase, contact.account_id as string)
  if (!account || account.status !== 'active') return { ok: false, reason: 'inactive' }

  await supabase
    .from('client_account_contacts')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', row.contact_id)

  return {
    ok: true,
    session: {
      orgId: row.org_id,
      accountId: row.account_id,
      contactId: row.contact_id,
      contactEmail: (contact.email as string) ?? '',
      tradingName: account.trading_name as JobTradingName,
    },
  }
}

/** Validate and burn a magic-link token. */
export async function consumePortalLoginToken(
  supabase: SupabaseClient,
  rawToken: string
): Promise<ConsumeResult> {
  const trimmed = (rawToken ?? '').trim()
  if (!/^[0-9a-f]{64}$/.test(trimmed)) return { ok: false, reason: 'invalid' }

  const hash = hashPortalToken(trimmed)

  const { data: row, error } = await supabase
    .from('client_portal_login_tokens')
    .select(CREDENTIAL_COLUMNS)
    .eq('token_hash', hash)
    .maybeSingle()

  if (error || !row) return { ok: false, reason: 'invalid' }
  if (!hashesMatch(row.token_hash as string, hash)) return { ok: false, reason: 'invalid' }
  if (row.consumed_at) return { ok: false, reason: 'used' }
  if (new Date(row.expires_at as string).getTime() < Date.now()) return { ok: false, reason: 'expired' }

  return burnAndMint(supabase, row as unknown as LoginRow)
}

/**
 * Validate and burn a six-digit code.
 *
 * The code is only a credential in combination with the email it was sent to,
 * which is what keeps six digits sufficient: an attacker must already know the
 * address, and then gets MAX_CODE_ATTEMPTS guesses per issued code.
 *
 * Live credentials for one email are searched rather than looked up, because
 * unlike a token hash the code cannot be used as a key — a client who requested
 * two links should be able to use the code from either.
 */
export async function consumePortalLoginCode(
  supabase: SupabaseClient,
  orgId: string,
  tradingName: JobTradingName,
  email: string,
  rawCode: string
): Promise<ConsumeResult> {
  const normalisedEmail = (email ?? '').trim().toLowerCase()
  const code = normalisePortalCode(rawCode)
  if (!normalisedEmail || code.length !== 6) return { ok: false, reason: 'invalid' }

  const hash = hashPortalToken(code)

  const { data: rows } = await supabase
    .from('client_portal_login_tokens')
    .select(CREDENTIAL_COLUMNS)
    .eq('org_id', orgId)
    .eq('email_at_issue', normalisedEmail)
    .is('consumed_at', null)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(MAX_PER_EMAIL_PER_HOUR)

  const live = (rows ?? []) as unknown as Array<
    LoginRow & { code_hash: string; code_attempts: number }
  >

  if (!live.length) return { ok: false, reason: 'invalid' }

  const match = live.find(
    r => r.code_hash && r.code_attempts < MAX_CODE_ATTEMPTS && hashesMatch(r.code_hash, hash)
  )

  if (!match) {
    // Charge the wrong guess against every live credential for this email, so
    // requesting more codes cannot buy more attempts.
    for (const r of live) {
      if (r.code_attempts >= MAX_CODE_ATTEMPTS) continue
      await supabase
        .from('client_portal_login_tokens')
        .update({ code_attempts: r.code_attempts + 1 })
        .eq('id', r.id)
    }
    return { ok: false, reason: 'invalid' }
  }

  const result = await burnAndMint(supabase, match)

  // A code issued on one brand's portal must not sign anyone in on another's,
  // the same rule findPortalLoginTarget applies to the link path.
  if (result.ok && result.session.tradingName !== tradingName) {
    return { ok: false, reason: 'invalid' }
  }

  return result
}
