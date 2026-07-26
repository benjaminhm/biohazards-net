/*
 * PATCH /api/portal/company — the client maintains their own trade account
 * application.
 *
 * Only the fields a client should own are writable. legal_name is included
 * because a company can genuinely change its registered name, but trading_name
 * (which brand they belong to), status, and every terms_* column stay staff- or
 * audit-owned. pickFields drops anything else in the body.
 *
 * Once the application is submitted the form is closed: staff may be part way
 * through a credit check against exactly these values, so a late edit would
 * silently change what was reviewed. Staff reopen it via
 * POST /api/accounts/[id]/reopen when something needs correcting.
 */
import { NextResponse } from 'next/server'
import { requirePortalContext } from '@/lib/portalScope'
import { isValidEmail, pickFields } from '@/lib/accountsAdmin'
import { APPLICATION_FIELDS } from '@/lib/portal/application'

const CLIENT_EDITABLE_FIELDS = APPLICATION_FIELDS

/** Email columns the client can write; each is validated only if non-empty. */
const EMAIL_FIELDS = [
  ['billing_email', 'accounts email address'],
  ['director_email', 'director email address'],
  ['finance_contact_email', 'accounts contact email address'],
  ['reference1_email', 'reference 1 email address'],
  ['reference2_email', 'reference 2 email address'],
] as const

export async function PATCH(req: Request) {
  const ctx = await requirePortalContext(req)
  if ('response' in ctx) return ctx.response

  if (ctx.account.application_submitted_at) {
    return NextResponse.json(
      {
        error:
          'Your details have been submitted for review and can no longer be edited. Contact us if something needs correcting.',
      },
      { status: 409 }
    )
  }

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
  for (const [field, description] of EMAIL_FIELDS) {
    if (fields[field] && !isValidEmail(fields[field])) {
      return NextResponse.json({ error: `Enter a valid ${description}` }, { status: 400 })
    }
  }
  if (!Object.keys(fields).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await ctx.supabase
    .from('client_accounts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', ctx.accountId)
    .eq('org_id', ctx.orgId)
    // Belt and braces against a concurrent submit between the check above and
    // this write: a submitted application must never be edited.
    .is('application_submitted_at', null)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    return NextResponse.json(
      { error: 'Your details have already been submitted for review.' },
      { status: 409 }
    )
  }

  return NextResponse.json({ ok: true })
}
