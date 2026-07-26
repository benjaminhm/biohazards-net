/*
 * POST /api/portal/company/submit
 *
 * The client's admin officer declares their trade account application complete.
 *
 * This is the deliberate hand-off point. Up to here the profile is a working
 * draft the client edits freely; from here it is the exact set of details staff
 * run a credit check against, so it locks and staff are alerted. Reopening is a
 * staff action (POST /api/accounts/[id]/reopen).
 *
 * Required fields are re-checked here rather than trusted from the browser —
 * an incomplete application that reads as complete wastes a review cycle.
 */
import { NextResponse } from 'next/server'
import { requirePortalContext } from '@/lib/portalScope'
import { missingApplicationFields } from '@/lib/portal/application'
import { sendAccountApplicationSubmittedEmail } from '@/lib/portal/email'

export async function POST(req: Request) {
  const ctx = await requirePortalContext(req)
  if ('response' in ctx) return ctx.response
  const { supabase, orgId, accountId, account, contact } = ctx

  if (account.application_submitted_at) {
    return NextResponse.json(
      {
        error: 'Your details have already been submitted for review.',
        submitted_at: account.application_submitted_at,
      },
      { status: 409 }
    )
  }

  const missing = missingApplicationFields(account)
  if (missing.length) {
    return NextResponse.json(
      { error: 'Some details are still needed before you can submit.', missing },
      { status: 400 }
    )
  }

  const submittedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('client_accounts')
    .update({
      application_submitted_at: submittedAt,
      application_submitted_by_contact_id: contact.id,
      updated_at: submittedAt,
    })
    .eq('id', accountId)
    .eq('org_id', orgId)
    // Loses a race with a second click rather than overwriting who submitted.
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

  try {
    await sendAccountApplicationSubmittedEmail({
      tradingName: account.trading_name,
      accountId,
      accountName: account.trading_as || account.legal_name,
      contactName: contact.name,
      contactEmail: contact.email,
      submittedAt,
    })
  } catch (err) {
    // The submission is recorded; a failed alert must not fail the client's action.
    console.error('[account-application-submitted] staff alert failed', err)
  }

  return NextResponse.json({ ok: true, submitted_at: submittedAt })
}
