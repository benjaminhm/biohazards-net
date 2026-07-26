/*
 * POST /api/portal/quotes/[documentId]/accept
 *
 * Click-to-accept a quote. This is the point of a trade account: because the
 * account has already accepted the standing Terms & Conditions, an authenticated
 * click from an authorised contact is a binding acceptance, so there is no need
 * to route the client through an external signing tool.
 *
 * Guards, in order:
 *   1. document is released and on a job linked to this account (portalScope)
 *   2. the account has accepted the current T&Cs version
 *   3. the contact has can_accept_quotes
 *   4. the quote has not already been accepted (unique index on document_id)
 *
 * On success: write the immutable quote_acceptances row, move the job to
 * 'accepted', and alert staff.
 */
import { NextResponse } from 'next/server'
import { loadPortalDocument, requirePortalContext } from '@/lib/portalScope'
import { areTermsCurrent } from '@/lib/portal/terms'
import { sendPortalQuoteAcceptedEmail } from '@/lib/portal/email'
import { clientIpFromRequest, userAgentFromRequest } from '@/lib/portalAuth'
import { isTradingNameId } from '@/lib/tradingNames'

/** Statuses that mean work is already underway — accepting again is a no-op. */
const POST_ACCEPTANCE_STATUSES = new Set([
  'accepted',
  'scheduled',
  'underway',
  'completed',
  'report_sent',
  'paid',
])

export async function POST(req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params
  const ctx = await requirePortalContext(req)
  if ('response' in ctx) return ctx.response
  const { supabase, orgId, accountId, account, contact } = ctx

  if (!areTermsCurrent(account.trading_name, account.terms_version)) {
    return NextResponse.json(
      { error: 'Please review and accept our trade terms before accepting a quote.' },
      { status: 403 }
    )
  }

  if (!contact.can_accept_quotes) {
    return NextResponse.json(
      {
        error:
          'Your access does not include approving quotes. Ask the account holder to approve it, or contact us to change your access.',
      },
      { status: 403 }
    )
  }

  const found = await loadPortalDocument(ctx, documentId)
  if (!found) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  const { doc, job } = found

  if (doc.type !== 'quote') {
    return NextResponse.json({ error: 'This document is not a quote' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('quote_acceptances')
    .select('id, accepted_at, contact_name')
    .eq('document_id', documentId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      {
        error: `This quote was already accepted by ${existing.contact_name || 'your team'}.`,
        accepted_at: existing.accepted_at,
      },
      { status: 409 }
    )
  }

  const content = (doc.content ?? {}) as Record<string, unknown>
  const total = typeof content.total === 'number' ? content.total : null
  const reference = typeof content.reference === 'string' ? content.reference : ''

  const { data: acceptance, error: insertError } = await supabase
    .from('quote_acceptances')
    .insert({
      org_id: orgId,
      account_id: accountId,
      contact_id: contact.id,
      job_id: doc.job_id as string,
      document_id: documentId,
      contact_name: contact.name,
      contact_email: contact.email,
      quote_total: total,
      quote_reference: reference,
      terms_version: account.terms_version ?? '',
      ip: clientIpFromRequest(req),
      user_agent: userAgentFromRequest(req),
    })
    .select('id, accepted_at')
    .single()

  if (insertError) {
    // The unique index on document_id is the real guard against a double-click
    // or two contacts accepting at the same moment.
    if (insertError.code === '23505' || /duplicate key/i.test(insertError.message)) {
      return NextResponse.json({ error: 'This quote has already been accepted.' }, { status: 409 })
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Don't drag a job backwards: a quote accepted after work started stays where
  // it is, the acceptance record is what matters.
  if (!POST_ACCEPTANCE_STATUSES.has(job.status as string)) {
    await supabase
      .from('jobs')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', doc.job_id as string)
      .eq('org_id', orgId)
  }

  try {
    await sendPortalQuoteAcceptedEmail({
      tradingName: isTradingNameId(job.trading_name) ? job.trading_name : account.trading_name,
      jobId: doc.job_id as string,
      accountName: account.trading_as || account.legal_name,
      contactName: contact.name,
      contactEmail: contact.email,
      siteAddress: (job.site_address as string) ?? '',
      reference: reference || 'Quote',
      total,
      termsVersion: account.terms_version ?? '',
      acceptedAt: acceptance.accepted_at as string,
    })
  } catch (err) {
    // The acceptance is recorded; a failed alert must not fail the client's action.
    console.error('[portal-quote-accepted] staff alert failed', err)
  }

  return NextResponse.json({ ok: true, accepted_at: acceptance.accepted_at })
}
