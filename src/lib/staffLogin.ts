/*
 * lib/staffLogin.ts
 *
 * Single-email magic link for the staff app.
 *
 * STAFF_LOGIN_EMAIL lists the owner addresses that can receive a link, separated
 * by commas. Those sessions stay bound to STAFF_USER_ID so existing job rows
 * do not move. Any other address is resolved by the injected lookup (an active
 * person with phone sign-in). Unknown addresses get the same generic success
 * so this endpoint cannot be used to discover who can sign in.
 *
 * Only a SHA-256 hash is stored. The link is single-use: consume burns the row
 * with a conditional update, and a second use is rejected.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const TOKEN_BYTES = 32

export const STAFF_LOGIN_TTL_MINUTES = 60

const MAX_PER_EMAIL_PER_HOUR = 5
const MAX_PER_IP_PER_HOUR = 20

export function normaliseStaffEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/** Addresses in STAFF_LOGIN_EMAIL. Commas, semicolons, and spaces all separate them. */
export function staffLoginEmails(allowlist = process.env.STAFF_LOGIN_EMAIL): string[] {
  return (allowlist ?? '')
    .split(/[,;\s]+/)
    .map(normaliseStaffEmail)
    .filter(Boolean)
}

/** True only when the address is one of STAFF_LOGIN_EMAIL. Empty allowlist matches nothing. */
export function isStaffEmailAllowlisted(email: string, allowlist = process.env.STAFF_LOGIN_EMAIL): boolean {
  const candidate = normaliseStaffEmail(email)
  if (!candidate) return false
  return staffLoginEmails(allowlist).includes(candidate)
}

export function staffUserId(): string | null {
  const id = (process.env.STAFF_USER_ID ?? '').trim()
  return id || null
}

export function staffDisplayName(): string {
  const configured = (process.env.STAFF_DISPLAY_NAME ?? '').trim()
  if (configured) return configured
  const email = staffLoginEmails()[0] ?? ''
  if (email.includes('@')) return email.split('@')[0] || 'User'
  return 'User'
}

/** First name for note attribution. Falls back to the email local-part. */
export function staffFirstName(): string {
  const name = staffDisplayName()
  return name.split(/\s+/)[0] || 'User'
}

export function generateStaffToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex')
}

export function hashStaffToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

export type StaffConsumeFailure = 'invalid' | 'expired' | 'used'

export function staffSignInFailureMessage(reason: StaffConsumeFailure): string {
  switch (reason) {
    case 'expired':
      return 'That sign-in link has expired. Please request a new one.'
    case 'used':
      return 'That sign-in link has already been used. Please request a new one.'
    default:
      return 'That sign-in link is not valid. Please request a new one.'
  }
}

export interface StaffTokenRow {
  id: string
  email: string
  token_hash: string
  expires_at: string
  consumed_at: string | null
}

export type StaffTokenClass = 'missing' | 'expired' | 'used' | 'ok'

/** Decide whether a stored row can still be burned. Does not touch the database. */
export function classifyStaffToken(row: StaffTokenRow | null, now = Date.now()): StaffTokenClass {
  if (!row) return 'missing'
  if (row.consumed_at) return 'used'
  if (new Date(row.expires_at).getTime() < now) return 'expired'
  return 'ok'
}

export interface StaffTokenStore {
  countRecent(email: string, ip: string, sinceIso: string): Promise<{ byEmail: number; byIp: number }>
  insert(row: {
    email: string
    token_hash: string
    expires_at: string
    requested_ip: string
    requested_user_agent: string
  }): Promise<boolean>
  findByHash(hash: string): Promise<StaffTokenRow | null>
  burnIfFresh(id: string): Promise<boolean>
}

/** Session subject for an email that is allowed to sign in. */
export type StaffIdentityLookup = (email: string) => Promise<{ userId: string } | null>

export type IssueResult =
  | { status: 'issued'; token: string; email: string; ttlMinutes: number }
  | { status: 'ignored' }
  | { status: 'limited' }

/**
 * The owner allowlist wins, and does not consult the lookup. Otherwise the
 * lookup must return exactly one user id. Unknown addresses and a missing
 * owner id return ignored — callers answer with the same generic success.
 */
async function resolveStaffUserId(email: string, lookup?: StaffIdentityLookup): Promise<string | null> {
  if (isStaffEmailAllowlisted(email)) {
    const owner = staffUserId()
    if (owner) return owner
  }
  if (!lookup) return null
  try {
    const found = await lookup(email)
    const id = found?.userId?.trim()
    return id || null
  } catch (err) {
    console.error('[staff-login] identity lookup failed', err)
    return null
  }
}

export async function issueStaffLogin(
  store: StaffTokenStore,
  email: string,
  ip: string,
  userAgent: string,
  lookup?: StaffIdentityLookup
): Promise<IssueResult> {
  const normalised = normaliseStaffEmail(email)
  const recent = await store.countRecent(
    normalised,
    ip,
    new Date(Date.now() - 60 * 60 * 1000).toISOString()
  )
  if (
    (normalised && recent.byEmail >= MAX_PER_EMAIL_PER_HOUR) ||
    (ip && recent.byIp >= MAX_PER_IP_PER_HOUR)
  ) {
    return { status: 'limited' }
  }

  const userId = await resolveStaffUserId(normalised, lookup)
  if (!userId) return { status: 'ignored' }

  const token = generateStaffToken()
  const expiresAt = new Date(Date.now() + STAFF_LOGIN_TTL_MINUTES * 60 * 1000).toISOString()
  const ok = await store.insert({
    email: normalised,
    token_hash: hashStaffToken(token),
    expires_at: expiresAt,
    requested_ip: ip,
    requested_user_agent: userAgent,
  })
  if (!ok) return { status: 'ignored' }
  return { status: 'issued', token, email: normalised, ttlMinutes: STAFF_LOGIN_TTL_MINUTES }
}

export type ConsumeResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: StaffConsumeFailure }

/**
 * Validate and burn a magic-link token.
 *
 * The conditional burn is the guard against two requests racing. An expired
 * row is not burned, so the failure stays "expired" rather than flipping to
 * "used" on a second click.
 */
export async function consumeStaffLogin(
  store: StaffTokenStore,
  rawToken: string,
  lookup?: StaffIdentityLookup
): Promise<ConsumeResult> {
  const trimmed = (rawToken ?? '').trim()
  if (!/^[0-9a-f]{64}$/.test(trimmed)) return { ok: false, reason: 'invalid' }

  const hash = hashStaffToken(trimmed)
  const row = await store.findByHash(hash)
  if (!row || !hashesMatch(row.token_hash, hash)) return { ok: false, reason: 'invalid' }

  const kind = classifyStaffToken(row)
  if (kind === 'used') return { ok: false, reason: 'used' }
  if (kind === 'expired') return { ok: false, reason: 'expired' }
  if (kind !== 'ok') return { ok: false, reason: 'invalid' }

  const userId = await resolveStaffUserId(row.email, lookup)
  if (!userId) return { ok: false, reason: 'invalid' }

  const burned = await store.burnIfFresh(row.id)
  if (!burned) return { ok: false, reason: 'used' }

  return { ok: true, userId, email: row.email }
}

export function supabaseStaffTokenStore(supabase: SupabaseClient): StaffTokenStore {
  return {
    async countRecent(email, ip, sinceIso) {
      let byEmail = 0
      let byIp = 0
      if (email) {
        const { count } = await supabase
          .from('staff_login_tokens')
          .select('id', { count: 'exact', head: true })
          .eq('email', email)
          .gte('created_at', sinceIso)
        byEmail = count ?? 0
      }
      if (ip) {
        const { count } = await supabase
          .from('staff_login_tokens')
          .select('id', { count: 'exact', head: true })
          .eq('requested_ip', ip)
          .gte('created_at', sinceIso)
        byIp = count ?? 0
      }
      return { byEmail, byIp }
    },

    async insert(row) {
      const { error } = await supabase.from('staff_login_tokens').insert(row)
      return !error
    },

    async findByHash(hash) {
      const { data, error } = await supabase
        .from('staff_login_tokens')
        .select('id, email, token_hash, expires_at, consumed_at')
        .eq('token_hash', hash)
        .maybeSingle()
      if (error || !data) return null
      return data as StaffTokenRow
    },

    async burnIfFresh(id) {
      const { data } = await supabase
        .from('staff_login_tokens')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', id)
        .is('consumed_at', null)
        .select('id')
        .maybeSingle()
      return !!data
    },
  }
}
