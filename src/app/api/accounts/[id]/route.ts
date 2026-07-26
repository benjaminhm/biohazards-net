/*
 * app/api/accounts/[id]/route.ts
 *
 * GET   /api/accounts/[id] — account detail: contacts, linked jobs, and the
 *                            quote acceptances recorded against the account
 * PATCH /api/accounts/[id] — update account details or status
 *
 * The T&Cs columns are not editable here. Acceptance is something the client
 * does in the portal, and staff editing it would destroy the audit value.
 */
import { NextResponse } from 'next/server'
import {
  EDITABLE_ACCOUNT_FIELDS,
  pickFields,
  requireAccountsAdmin,
} from '@/lib/accountsAdmin'
import { areTermsCurrent, portalTermsFor } from '@/lib/portal/terms'
import type { TradingNameId } from '@/lib/tradingNames'

const ACCOUNT_COLUMNS =
  'id, org_id, trading_name, legal_name, trading_as, abn, billing_email, billing_address, phone, notes, status, terms_version, terms_accepted_at, terms_accepted_by_contact_id, terms_accepted_ip, created_at, updated_at'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireAccountsAdmin(req)
  if ('response' in ctx) return ctx.response
  const { supabase, orgId } = ctx

  const { data: account, error } = await supabase
    .from('client_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const [contactsRes, jobsRes, acceptancesRes] = await Promise.all([
    supabase
      .from('client_account_contacts')
      .select('*')
      .eq('org_id', orgId)
      .eq('account_id', id)
      .order('is_primary', { ascending: false })
      .order('name'),
    supabase
      .from('jobs')
      .select('id, status, job_type, site_address, client_name, created_at, scheduled_at')
      .eq('org_id', orgId)
      .eq('client_account_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('quote_acceptances')
      .select('*')
      .eq('org_id', orgId)
      .eq('account_id', id)
      .order('accepted_at', { ascending: false })
      .limit(100),
  ])

  const tradingName = account.trading_name as TradingNameId

  return NextResponse.json({
    account,
    contacts: contactsRes.data ?? [],
    jobs: jobsRes.data ?? [],
    acceptances: acceptancesRes.data ?? [],
    terms_current: areTermsCurrent(tradingName, account.terms_version as string | null),
    terms_version_required: portalTermsFor(tradingName).version,
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireAccountsAdmin(req)
  if ('response' in ctx) return ctx.response
  const { supabase, orgId, userId } = ctx

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const fields = pickFields(body, EDITABLE_ACCOUNT_FIELDS)
  if ('legal_name' in fields && !fields.legal_name) {
    return NextResponse.json({ error: 'Legal name is required' }, { status: 400 })
  }
  if (!Object.keys(fields).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('client_accounts')
    .update({
      ...fields,
      updated_at: new Date().toISOString(),
      updated_by_user_id: userId,
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .select(ACCOUNT_COLUMNS)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  return NextResponse.json({ account: data })
}
