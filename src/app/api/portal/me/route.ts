/*
 * GET /api/portal/me
 *
 * Session context for the portal shell: who is signed in, which account they act
 * for, the brand to render, and whether the standing T&Cs are up to date.
 * Deliberately omits internal staff notes held on the account.
 */
import { NextResponse } from 'next/server'
import { requirePortalContext } from '@/lib/portalScope'
import { tradingNameOption } from '@/lib/tradingNames'
import { areTermsCurrent, portalTermsFor } from '@/lib/portal/terms'
import type { PortalMe } from '@/lib/types'

export async function GET(req: Request) {
  const ctx = await requirePortalContext(req)
  if ('response' in ctx) return ctx.response

  const { account, contact } = ctx
  const option = tradingNameOption(account.trading_name)
  const terms = portalTermsFor(account.trading_name)

  const body: PortalMe = {
    contact: {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      title: contact.title,
      can_accept_quotes: contact.can_accept_quotes,
    },
    account: {
      id: account.id,
      trading_name: account.trading_name,
      legal_name: account.legal_name,
      trading_as: account.trading_as,
      abn: account.abn,
      billing_email: account.billing_email,
      billing_address: account.billing_address,
      phone: account.phone,
      status: account.status,
      terms_version: account.terms_version,
      terms_accepted_at: account.terms_accepted_at,
    },
    brand: {
      label: option?.label ?? 'Accounts',
      email: option?.email ?? '',
    },
    terms_current: areTermsCurrent(account.trading_name, account.terms_version),
    terms_version_required: terms.version,
  }

  return NextResponse.json(body)
}
