/*
 * PATCH /api/accounts/[id]/contacts/[contactId] — edit or disable a contact.
 *
 * Disabling is preferred over deleting: quote_acceptances reference the contact
 * as evidence of who committed the account, and setting status to 'disabled'
 * revokes access on the next request (requirePortalContext re-reads status even
 * for an unexpired session cookie).
 */
import { NextResponse } from 'next/server'
import {
  EDITABLE_CONTACT_FIELDS,
  isValidEmail,
  pickFields,
  requireAccountsAdmin,
} from '@/lib/accountsAdmin'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params
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
  if ('name' in fields && !fields.name) {
    return NextResponse.json({ error: 'Contact name is required' }, { status: 400 })
  }
  if ('email' in fields) {
    if (!isValidEmail(fields.email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
    }
    fields.email = (fields.email as string).toLowerCase()
  }
  if (!Object.keys(fields).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('client_account_contacts')
    .update({
      ...fields,
      updated_at: new Date().toISOString(),
      updated_by_user_id: userId,
    })
    .eq('id', contactId)
    .eq('account_id', id)
    .eq('org_id', orgId)
    .select('*')
    .maybeSingle()

  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      return NextResponse.json(
        { error: 'That email is already a contact on another trade account.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  return NextResponse.json({ contact: data })
}
