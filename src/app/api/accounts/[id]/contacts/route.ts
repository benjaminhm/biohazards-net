/*
 * POST /api/accounts/[id]/contacts — add a login contact to a trade account.
 *
 * The contact's email is their login identity, so it must be unique per org:
 * the magic-link lookup resolves an email to exactly one account.
 */
import { NextResponse } from 'next/server'
import {
  EDITABLE_CONTACT_FIELDS,
  isValidEmail,
  pickFields,
  requireAccountsAdmin,
} from '@/lib/accountsAdmin'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const fields = pickFields(body, EDITABLE_CONTACT_FIELDS)
  if (!fields.name) return NextResponse.json({ error: 'Contact name is required' }, { status: 400 })
  if (!isValidEmail(fields.email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  const { data: account } = await supabase
    .from('client_accounts')
    .select('id')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('client_account_contacts')
    .insert({
      ...fields,
      email: (fields.email as string).toLowerCase(),
      org_id: orgId,
      account_id: id,
      created_by_user_id: userId,
      updated_by_user_id: userId,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      return NextResponse.json(
        { error: 'That email is already a contact on another trade account.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ contact: data })
}
