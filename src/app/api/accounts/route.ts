/*
 * app/api/accounts/route.ts
 *
 * GET  /api/accounts       — list commercial trade accounts for the org
 * GET  /api/accounts?brief=1 — trimmed payload for the job-file account picker,
 *                              including the email domains used to suggest a match
 * POST /api/accounts       — create an account
 *
 * Trade accounts are the client-side counterpart to org_users: a company we
 * invoice repeatedly, whose contacts sign in at accounts.<brand>.com.au.
 */
import { NextResponse } from 'next/server'
import {
  EDITABLE_ACCOUNT_FIELDS,
  emailDomain,
  isOrganisationDomain,
  pickFields,
  requireAccountsAdmin,
} from '@/lib/accountsAdmin'
import { ACCOUNT_APPLICATION_COLUMNS } from '@/lib/portal/application'
import { areTermsCurrent } from '@/lib/portal/terms'
import { isTradingNameId } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'

const ACCOUNT_COLUMNS =
  `id, org_id, trading_name, legal_name, trading_as, abn, billing_email, billing_address, phone, notes, status, terms_version, terms_accepted_at, terms_accepted_by_contact_id, created_at, updated_at, ${ACCOUNT_APPLICATION_COLUMNS}` as const

export async function GET(req: Request) {
  const ctx = await requireAccountsAdmin(req)
  if ('response' in ctx) return ctx.response
  const { supabase, orgId } = ctx

  const brief = new URL(req.url).searchParams.get('brief') === '1'

  const { data: accounts, error } = await supabase
    .from('client_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('org_id', orgId)
    .order('legal_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = accounts ?? []
  const ids = rows.map(r => r.id as string)

  const { data: contacts } = ids.length
    ? await supabase
        .from('client_account_contacts')
        .select('id, account_id, name, email, status, is_primary, can_accept_quotes, last_login_at')
        .eq('org_id', orgId)
        .in('account_id', ids)
    : { data: [] }

  const contactsByAccount = new Map<string, typeof contacts>()
  for (const c of contacts ?? []) {
    const list = contactsByAccount.get(c.account_id as string) ?? []
    list.push(c)
    contactsByAccount.set(c.account_id as string, list)
  }

  if (brief) {
    // The picker suggests an account by matching the job's client email domain,
    // so send the domains we know for each account rather than raw addresses.
    return NextResponse.json({
      accounts: rows
        .filter(r => r.status === 'active')
        .map(r => {
          const own = contactsByAccount.get(r.id as string) ?? []
          const domains = new Set<string>()
          for (const email of [r.billing_email as string, ...own.map(c => c.email as string)]) {
            const domain = emailDomain(email)
            if (isOrganisationDomain(domain)) domains.add(domain as string)
          }
          return {
            id: r.id,
            legal_name: r.legal_name,
            trading_as: r.trading_as,
            trading_name: r.trading_name,
            email_domains: [...domains],
          }
        }),
    })
  }

  const { data: jobCounts } = ids.length
    ? await supabase
        .from('jobs')
        .select('client_account_id')
        .eq('org_id', orgId)
        .in('client_account_id', ids)
    : { data: [] }

  const jobsByAccount = new Map<string, number>()
  for (const j of jobCounts ?? []) {
    const key = j.client_account_id as string
    jobsByAccount.set(key, (jobsByAccount.get(key) ?? 0) + 1)
  }

  return NextResponse.json({
    accounts: rows.map(r => ({
      ...r,
      contacts: contactsByAccount.get(r.id as string) ?? [],
      job_count: jobsByAccount.get(r.id as string) ?? 0,
      terms_current: areTermsCurrent(
        r.trading_name as TradingNameId,
        r.terms_version as string | null
      ),
    })),
  })
}

export async function POST(req: Request) {
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
  const legalName = typeof fields.legal_name === 'string' ? fields.legal_name : ''
  if (!legalName) {
    return NextResponse.json({ error: 'Legal name is required' }, { status: 400 })
  }

  const tradingName = body.trading_name
  if (!isTradingNameId(tradingName)) {
    return NextResponse.json({ error: 'Choose which trading brand this account is for' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('client_accounts')
    .insert({
      ...fields,
      org_id: orgId,
      trading_name: tradingName,
      created_by_user_id: userId,
      updated_by_user_id: userId,
    })
    .select(ACCOUNT_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ account: data })
}
