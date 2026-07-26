/*
 * PATCH /api/portal/company — the client maintains their own company details.
 *
 * Only the fields a client should own are writable. legal_name is included
 * because a company can genuinely change its registered name, but trading_name
 * (which brand they belong to), status, and every terms_* column stay staff- or
 * audit-owned. pickFields drops anything else in the body.
 */
import { NextResponse } from 'next/server'
import { requirePortalContext } from '@/lib/portalScope'
import { isValidEmail, pickFields } from '@/lib/accountsAdmin'

const CLIENT_EDITABLE_FIELDS = [
  'legal_name',
  'trading_as',
  'abn',
  'billing_email',
  'billing_address',
  'phone',
] as const

export async function PATCH(req: Request) {
  const ctx = await requirePortalContext(req)
  if ('response' in ctx) return ctx.response

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const fields = pickFields(body, CLIENT_EDITABLE_FIELDS)

  if ('legal_name' in fields && !fields.legal_name) {
    return NextResponse.json({ error: 'Registered company name is required' }, { status: 400 })
  }
  if ('billing_email' in fields && fields.billing_email && !isValidEmail(fields.billing_email)) {
    return NextResponse.json({ error: 'Enter a valid accounts email address' }, { status: 400 })
  }
  if (!Object.keys(fields).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await ctx.supabase
    .from('client_accounts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', ctx.accountId)
    .eq('org_id', ctx.orgId)
    .select('id, legal_name, trading_as, abn, billing_email, billing_address, phone')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ account: data })
}
