/*
 * lib/portalScope.ts
 *
 * The single authorisation gate for every /api/portal/* route.
 *
 * Staff routes scope queries by org_id alone (see lib/org.ts). Portal routes
 * must scope by org_id AND client_account_id, because a trade contact may only
 * ever see jobs their own account is linked to. Every portal query goes through
 * a context produced here so that pairing is never forgotten.
 *
 * The cookie carries the account id, but status is re-read from the database on
 * every request: a 30-day session must stop working the moment staff suspend the
 * account or disable the contact.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getPortalSessionFromRequest } from '@/lib/portalSession'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientAccount, ClientAccountContact } from '@/lib/types'

export type PortalAccount = Pick<
  ClientAccount,
  | 'id'
  | 'org_id'
  | 'trading_name'
  | 'legal_name'
  | 'trading_as'
  | 'abn'
  | 'billing_email'
  | 'billing_address'
  | 'phone'
  | 'status'
  | 'terms_version'
  | 'terms_accepted_at'
>

export type PortalContact = Pick<
  ClientAccountContact,
  'id' | 'org_id' | 'account_id' | 'name' | 'email' | 'title' | 'can_accept_quotes' | 'status'
>

export interface PortalContext {
  supabase: SupabaseClient
  orgId: string
  accountId: string
  account: PortalAccount
  contact: PortalContact
}

const ACCOUNT_COLUMNS =
  'id, org_id, trading_name, legal_name, trading_as, abn, billing_email, billing_address, phone, status, terms_version, terms_accepted_at'

const CONTACT_COLUMNS = 'id, org_id, account_id, name, email, title, can_accept_quotes, status'

/**
 * Resolve the portal context, or a Response to return immediately.
 *
 * Usage:
 *   const ctx = await requirePortalContext(req)
 *   if ('response' in ctx) return ctx.response
 */
export async function requirePortalContext(
  req: Request
): Promise<PortalContext | { response: NextResponse }> {
  const session = await getPortalSessionFromRequest(req)
  if (!session) {
    return { response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }
  }

  const supabase = createServiceClient()

  const { data: contact } = await supabase
    .from('client_account_contacts')
    .select(CONTACT_COLUMNS)
    .eq('id', session.contactId)
    .eq('org_id', session.orgId)
    .eq('account_id', session.accountId)
    .maybeSingle()

  if (!contact || contact.status !== 'active') {
    return { response: NextResponse.json({ error: 'Access revoked' }, { status: 401 }) }
  }

  const { data: account } = await supabase
    .from('client_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', session.accountId)
    .eq('org_id', session.orgId)
    .maybeSingle()

  if (!account) {
    return { response: NextResponse.json({ error: 'Access revoked' }, { status: 401 }) }
  }
  if (account.status !== 'active') {
    return {
      response: NextResponse.json(
        { error: 'This account is not currently active. Please contact us.' },
        { status: 403 }
      ),
    }
  }

  return {
    supabase,
    orgId: session.orgId,
    accountId: session.accountId,
    account: account as PortalAccount,
    contact: contact as PortalContact,
  }
}

/**
 * Confirm a job belongs to this account. Returns the job row or null.
 * Every job-scoped portal read goes through here — never trust a job id from
 * the URL.
 */
export async function loadPortalJob(
  ctx: PortalContext,
  jobId: string,
  columns: string
): Promise<Record<string, unknown> | null> {
  const { data } = await ctx.supabase
    .from('jobs')
    .select(columns)
    .eq('id', jobId)
    .eq('org_id', ctx.orgId)
    .eq('client_account_id', ctx.accountId)
    .maybeSingle()
  // The column list is a runtime string, so Supabase cannot infer a row shape.
  return (data as Record<string, unknown> | null) ?? null
}

/**
 * Load a document the account is allowed to see: released to the portal, and on
 * a job linked to this account.
 */
export async function loadPortalDocument(
  ctx: PortalContext,
  documentId: string
): Promise<{ doc: Record<string, unknown>; job: Record<string, unknown> } | null> {
  const { data: doc } = await ctx.supabase
    .from('documents')
    .select('id, job_id, org_id, type, content, created_at, released_to_portal_at')
    .eq('id', documentId)
    .eq('org_id', ctx.orgId)
    .not('released_to_portal_at', 'is', null)
    .maybeSingle()

  if (!doc) return null

  const job = await loadPortalJob(
    ctx,
    doc.job_id as string,
    'id, client_account_id, trading_name, site_address, client_name, status'
  )
  if (!job) return null

  return { doc: doc as Record<string, unknown>, job }
}
