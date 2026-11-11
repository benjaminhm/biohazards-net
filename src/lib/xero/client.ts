/*
 * lib/xero/client.ts
 *
 * Xero OAuth 2.0 (authorization code) and an Accounting API caller that
 * refreshes the access token when it is about to expire. One Xero
 * organisation (tenant) per app org, stored in xero_connections.
 *
 * Apps created after 2 March 2026 must use granular scopes; the broad
 * accounting.transactions scope is not available to them.
 */
import type { createServiceClient } from '@/lib/supabase'
import { decryptToken, encryptToken } from '@/lib/xero/crypto'
import { isStaffAppHost } from '@/lib/staffSession'

type Supabase = ReturnType<typeof createServiceClient>

export const XERO_SCOPES = 'openid profile email offline_access accounting.contacts accounting.invoices'

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize'
const TOKEN_URL = 'https://identity.xero.com/connect/token'
const REVOKE_URL = 'https://identity.xero.com/connect/revocation'
const CONNECTIONS_URL = 'https://api.xero.com/connections'
const API_BASE = 'https://api.xero.com/api.xro/2.0'

export function xeroConfigured(): boolean {
  return Boolean(process.env.XERO_CLIENT_ID?.trim() && process.env.XERO_CLIENT_SECRET?.trim() && process.env.XERO_TOKEN_KEY?.trim())
}

/**
 * Where Xero sends the admin back after they approve. It has to be the staff
 * host they are working on (login.biohazards.net or app.biohazards.net): their
 * sign-in and the one-time state cookie live on that host, so a return to the
 * other one arrives signed out. Only those two hosts are ever used, whatever
 * the request says, and each one's address must be registered in the Xero
 * developer app.
 */
export function xeroRedirectUriFor(
  host: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.XERO_REDIRECT_URI?.trim()
  if (explicit) return explicit
  const hostNoPort = (host ?? '').split(',')[0].trim().split(':')[0].toLowerCase()
  if (isStaffAppHost(hostNoPort)) return `https://${hostNoPort}/api/xero/callback`
  const app = (env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net').replace(/\/+$/, '')
  return `${app}/api/xero/callback`
}

export function xeroRedirectUri(req?: Request): string {
  return xeroRedirectUriFor(req ? req.headers.get('x-forwarded-host') ?? req.headers.get('host') : null)
}

export function xeroAuthorizeUrl(state: string, redirectUri: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.XERO_CLIENT_ID?.trim() ?? '',
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
  })
  return `${AUTHORIZE_URL}?${q.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
}

function basicAuth(): string {
  const id = process.env.XERO_CLIENT_ID?.trim() ?? ''
  const secret = process.env.XERO_CLIENT_SECRET?.trim() ?? ''
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`
}

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  const body = await res.json().catch(() => ({})) as Partial<TokenResponse> & { error?: string }
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new Error(`Xero token request failed (${res.status}${body.error ? `: ${body.error}` : ''})`)
  }
  return body as TokenResponse
}

interface XeroTenant {
  tenantId: string
  tenantName: string
  tenantType: string
  createdDateUtc?: string
}

/** Exchange the callback code and store the connection for this org. */
export async function completeXeroConnection(
  supabase: Supabase,
  orgId: string,
  code: string,
  connectedBy: string,
  /** The same address the consent screen was opened with; Xero checks they match. */
  redirectUri: string,
): Promise<{ tenantName: string }> {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  const res = await fetch(CONNECTIONS_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
  const tenants = (await res.json().catch(() => [])) as XeroTenant[]
  const orgs = (Array.isArray(tenants) ? tenants : []).filter(t => t.tenantType === 'ORGANISATION')
  if (!orgs.length) throw new Error('No Xero organisation was authorised')
  // Most recently authorised first; that is the one the user just picked.
  orgs.sort((a, b) => (b.createdDateUtc ?? '').localeCompare(a.createdDateUtc ?? ''))
  const tenant = orgs[0]

  const { data: existing } = await supabase.from('xero_connections').select('settings').eq('org_id', orgId).maybeSingle()
  const { error } = await supabase.from('xero_connections').upsert({
    org_id: orgId,
    tenant_id: tenant.tenantId,
    tenant_name: tenant.tenantName ?? '',
    access_token_enc: encryptToken(tokens.access_token),
    refresh_token_enc: encryptToken(tokens.refresh_token),
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    scopes: tokens.scope ?? XERO_SCOPES,
    settings: existing?.settings ?? {},
    connected_by: connectedBy,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Saving Xero connection failed: ${error.message}`)
  return { tenantName: tenant.tenantName ?? '' }
}

export interface XeroConnection {
  org_id: string
  tenant_id: string
  tenant_name: string
  access_token_enc: string
  refresh_token_enc: string
  expires_at: string
  settings: unknown
}

export async function loadXeroConnection(supabase: Supabase, orgId: string): Promise<XeroConnection | null> {
  const { data } = await supabase
    .from('xero_connections')
    .select('org_id, tenant_id, tenant_name, access_token_enc, refresh_token_enc, expires_at, settings')
    .eq('org_id', orgId)
    .maybeSingle()
  return (data as XeroConnection | null) ?? null
}

async function accessToken(supabase: Supabase, conn: XeroConnection): Promise<string> {
  if (new Date(conn.expires_at).getTime() - Date.now() > 120_000) return decryptToken(conn.access_token_enc)
  const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decryptToken(conn.refresh_token_enc) })
  const update = {
    access_token_enc: encryptToken(tokens.access_token),
    refresh_token_enc: encryptToken(tokens.refresh_token),
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('xero_connections').update(update).eq('org_id', conn.org_id)
  if (error) throw new Error(`Saving refreshed Xero token failed: ${error.message}`)
  Object.assign(conn, update)
  return tokens.access_token
}

export class XeroApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message)
  }
}

/** Pull Xero's validation messages out of an error body. */
export function xeroErrorMessage(body: unknown): string {
  const b = body as {
    Message?: string
    Detail?: string
    Elements?: { ValidationErrors?: { Message?: string }[] }[]
  } | null
  const validation = (b?.Elements ?? []).flatMap(e => e.ValidationErrors ?? []).map(v => v.Message).filter(Boolean)
  return validation.join('; ') || b?.Detail || b?.Message || ''
}

export async function xeroRequest<T>(
  supabase: Supabase,
  conn: XeroConnection,
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  body?: unknown,
  opts: { idempotencyKey?: string } = {},
): Promise<T> {
  const token = await accessToken(supabase, conn)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Xero-tenant-id': conn.tenant_id,
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = xeroErrorMessage(json)
    throw new XeroApiError(`Xero ${method} ${path.split('?')[0]} failed (${res.status})${detail ? `: ${detail}` : ''}`, res.status, json)
  }
  return json as T
}

/** Revoke the refresh token at Xero and delete the stored connection. */
export async function disconnectXero(supabase: Supabase, orgId: string): Promise<void> {
  const conn = await loadXeroConnection(supabase, orgId)
  if (conn) {
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: decryptToken(conn.refresh_token_enc) }).toString(),
      })
    } catch (err) {
      console.error('[xero] revoke failed', err)
    }
  }
  await supabase.from('xero_connections').delete().eq('org_id', orgId)
}
