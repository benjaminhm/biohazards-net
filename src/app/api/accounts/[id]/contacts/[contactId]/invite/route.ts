/*
 * POST /api/accounts/[id]/contacts/[contactId]/invite
 *
 * Email a contact their first sign-in link, or re-send one if they lost it.
 *
 * Uses the same single-use token mechanism as the portal's own login form
 * (lib/portalAuth.ts) rather than a separate long-lived invite token like
 * invites.token for staff. There is nothing to "claim": the account already
 * exists, so the first sign-in and every later one are the same operation.
 */
import { NextResponse } from 'next/server'
import { requireAccountsAdmin } from '@/lib/accountsAdmin'
import { issuePortalLoginToken, TOKEN_TTL_MINUTES } from '@/lib/portalAuth'
import { sendPortalInviteEmail, sendPortalMagicLinkEmail } from '@/lib/portal/email'
import { accountsPortalBaseUrl } from '@/lib/tradingNames'
import type { TradingNameId } from '@/lib/tradingNames'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params
  const ctx = await requireAccountsAdmin(req)
  if ('response' in ctx) return ctx.response
  const { supabase, orgId } = ctx

  const { data: contact } = await supabase
    .from('client_account_contacts')
    .select('id, name, email, status, invited_at')
    .eq('id', contactId)
    .eq('account_id', id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (contact.status !== 'active') {
    return NextResponse.json({ error: 'This contact is disabled' }, { status: 400 })
  }

  const { data: account } = await supabase
    .from('client_accounts')
    .select('id, legal_name, trading_as, trading_name, status')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (account.status !== 'active') {
    return NextResponse.json(
      { error: 'Activate the account before inviting contacts' },
      { status: 400 }
    )
  }

  const tradingName = account.trading_name as TradingNameId
  const baseUrl = accountsPortalBaseUrl(tradingName)
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'No accounts portal domain is configured for this trading brand yet' },
      { status: 400 }
    )
  }

  const token = await issuePortalLoginToken(
    supabase,
    {
      orgId,
      accountId: id,
      contactId,
      contactName: contact.name as string,
      contactEmail: contact.email as string,
      accountLegalName: account.legal_name as string,
      tradingName,
    },
    '',
    'staff-invite'
  )

  if (!token) {
    return NextResponse.json({ error: 'Could not create a sign-in link' }, { status: 500 })
  }

  const loginUrl = `${baseUrl}/portal/login/${token}`
  const firstTime = !contact.invited_at

  try {
    if (firstTime) {
      await sendPortalInviteEmail({
        tradingName,
        to: contact.email as string,
        contactName: contact.name as string,
        accountName: (account.trading_as as string) || (account.legal_name as string),
        loginUrl,
      })
    } else {
      await sendPortalMagicLinkEmail({
        tradingName,
        to: contact.email as string,
        contactName: contact.name as string,
        loginUrl,
        expiresInMinutes: TOKEN_TTL_MINUTES,
      })
    }
  } catch (err) {
    console.error('[portal-invite] send failed', err)
    return NextResponse.json(
      { error: 'The sign-in link was created but the email failed to send' },
      { status: 502 }
    )
  }

  await supabase
    .from('client_account_contacts')
    .update({ invited_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('org_id', orgId)

  return NextResponse.json({ ok: true, first_time: firstTime })
}
