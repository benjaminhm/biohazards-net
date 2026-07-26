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
      head_office_address: account.head_office_address,
      director_name: account.director_name,
      director_email: account.director_email,
      director_phone: account.director_phone,
      finance_contact_name: account.finance_contact_name,
      finance_contact_title: account.finance_contact_title,
      finance_contact_email: account.finance_contact_email,
      finance_contact_phone: account.finance_contact_phone,
      payment_terms: account.payment_terms,
      payment_run_days: account.payment_run_days,
      payment_method: account.payment_method,
      purchase_order_required: account.purchase_order_required,
      reference1_company: account.reference1_company,
      reference1_contact: account.reference1_contact,
      reference1_phone: account.reference1_phone,
      reference1_email: account.reference1_email,
      reference2_company: account.reference2_company,
      reference2_contact: account.reference2_contact,
      reference2_phone: account.reference2_phone,
      reference2_email: account.reference2_email,
      application_submitted_at: account.application_submitted_at,
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
