/*
 * POST /api/signing/[id] — staff actions on one signing request.
 *
 *   { action: 'void' }     cancel a request the client has not signed; the link stops working
 *   { action: 'resend' }   email the same message again with a fresh link (the old link stops working);
 *                          only for requests the system emailed
 *   { action: 'deliver' }  email the signed copy again (e.g. after a failed delivery); with no
 *                          client email on the request it goes to the office inbox
 *   { action: 'confirm' }  the staff check on a signed request: a person has looked at who
 *                          signed and what they accepted, and the job's draft invoice is now
 *                          created in Xero (or brought up to date). With Xero not connected
 *                          it only records the check. Until this is done nothing is invoiced
 *                          and the client's page shows no payment details.
 *   { action: 'pay_message' }
 *                          once the client can pay: a message for staff to send themselves,
 *                          with a new private link to the client's page (the first link is
 *                          never stored, so it cannot be shown again) and the passcode where
 *                          the link has one. Nothing is sent from here.
 *
 * Full-access staff only, and only for requests in their own organisation. The
 * check and the pay message are for staff who are shown money (not team leads).
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { seesFinancials } from '@/lib/agent/jobSnapshot'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { newSigningToken, paymentReadyMessage, signedDateLabel, signingExpiry } from '@/lib/signing/core'
import { SIGNING_SUMMARY_COLUMNS, deliverSignedCopy, documentLine, loadPayPanel } from '@/lib/signing/store'
import type { SigningRequestRow } from '@/lib/signing/store'
import { sendSigningInviteEmail } from '@/lib/signing/email'
import { signingLinks } from '@/lib/signing/links'
import { depositPartPaid, depositSettled, money } from '@/lib/signing/pay'
import { loadXeroConnection, xeroConfigured } from '@/lib/xero/client'
import { syncJobInvoice } from '@/lib/xero/sync'

export const maxDuration = 60

const NOT_MIGRATED = 'This is not fully set up yet: migration 071 needs to be applied.'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardFullAccessStaff(req)
  if (!guard.ok) return guard.response
  const { supabase, orgId, userId } = guard
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let action = ''
  try {
    const body = (await req.json()) as { action?: unknown }
    action = typeof body.action === 'string' ? body.action : ''
  } catch {
    action = ''
  }

  const { data } = await supabase.from('signing_requests').select('*').eq('id', id).eq('org_id', orgId).maybeSingle()
  const row = data as SigningRequestRow | null
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const summary = async () => {
    const { data: fresh } = await supabase.from('signing_requests').select(SIGNING_SUMMARY_COLUMNS).eq('id', id).maybeSingle()
    return NextResponse.json({ request: fresh })
  }
  const waiting = row.status === 'sent' || row.status === 'viewed'
  const now = new Date()

  if (action === 'void') {
    if (!waiting) return NextResponse.json({ error: 'Only a request that is still waiting can be cancelled.' }, { status: 409 })
    await supabase
      .from('signing_requests')
      .update({ status: 'voided', voided_at: now.toISOString(), voided_by: userId, updated_at: now.toISOString() })
      .eq('id', id)
      .in('status', ['sent', 'viewed'])
    return summary()
  }

  if (action === 'resend') {
    if (!waiting) return NextResponse.json({ error: 'Only a request that is still waiting can be sent again.' }, { status: 409 })
    if (row.delivery_method === 'link' || !row.to_email) {
      return NextResponse.json({ error: 'This one was a link you sent yourself. Create a new link instead.' }, { status: 409 })
    }
    // Only the hash of a link is kept, so sending again means a new link.
    const { token, hash } = newSigningToken()
    const expiresAt = signingExpiry(now)
    const { error } = await supabase
      .from('signing_requests')
      .update({ token_hash: hash, expires_at: expiresAt.toISOString(), updated_at: now.toISOString() })
      .eq('id', id)
      .in('status', ['sent', 'viewed'])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const links = await signingLinks(row.trading_name, token)
    try {
      await sendSigningInviteEmail({
        from: row.from_address,
        replyTo: row.reply_to,
        to: row.to_email,
        subject: row.subject,
        message: row.message,
        brandLabel: row.brand_label,
        documentLine: documentLine(row),
        signUrl: links.page,
        expiresLabel: signedDateLabel(expiresAt.toISOString()),
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'send rejected'
      return NextResponse.json(
        { error: `The email was not sent (${reason}). The earlier link no longer works, so please try again.` },
        { status: 502 },
      )
    }
    return summary()
  }

  if (action === 'deliver') {
    if (row.status !== 'signed') return NextResponse.json({ error: 'This document has not been signed.' }, { status: 409 })
    const result = await deliverSignedCopy(supabase, row, null)
    if (!result.ok) return NextResponse.json({ error: `The signed copy was not sent: ${result.error}` }, { status: 502 })
    return summary()
  }

  if (action === 'confirm' || action === 'pay_message') {
    if (!seesFinancials(guard.role)) {
      return NextResponse.json({ error: 'This is done by the office: you are not set up to see invoices.' }, { status: 403 })
    }
    if (row.status !== 'signed') return NextResponse.json({ error: 'This document has not been signed.' }, { status: 409 })
  }

  if (action === 'confirm') {
    let note = ''
    const connected = xeroConfigured() && Boolean(await loadXeroConnection(supabase, orgId))
    if (!connected) {
      note = 'Marked as checked. Xero is not connected, so no invoice was created.'
    } else {
      const result = await syncJobInvoice(supabase, row.job_id, 'staff_confirmed', { requestId: row.id })
      if (result.outcome === 'failed') {
        return NextResponse.json(
          { error: `Xero did not take the invoice (${result.error}). Nothing has been marked as checked; try again.` },
          { status: 502 },
        )
      }
      if (result.outcome === 'skipped') {
        const why: Record<string, string> = {
          'another sync is still running': 'Xero is still working on this job. Try again in a minute.',
          'no accepted quotes': 'There is no accepted quote left on this job to invoice (the quote may have been deleted). Raise the invoice in Xero by hand.',
          'no priced quotes': 'The accepted quote has no total, so there is nothing to invoice. Add the total to the quote, then try again.',
          'Xero not connected': 'Xero is not connected. Connect it in Settings, then try again.',
          'Xero app keys not set': 'Xero is not set up. Connect it in Settings, then try again.',
        }
        return NextResponse.json({ error: why[result.reason] ?? `The invoice was not created (${result.reason}).` }, { status: 409 })
      }
      note = {
        created: 'Draft invoice created in Xero. Next: open it in Xero, set the deposit request and approve it.',
        updated: "The job's draft invoice in Xero now includes this quote. Next: set the deposit request and approve it.",
        unchanged: "The job's Xero invoice already has this quote on it.",
        needs_review: "The job's invoice is already approved in Xero, so it was not changed. Add this quote to it in Xero by hand.",
      }[result.outcome]
    }

    // Which Xero contact the invoice went to, kept with the signed request.
    const { data: invoiceRow } = await supabase
      .from('xero_job_invoices')
      .select('xero_contact_id')
      .eq('job_id', row.job_id)
      .eq('org_id', orgId)
      .maybeSingle()
    const contactId = (invoiceRow as { xero_contact_id?: string | null } | null)?.xero_contact_id || null
    const { error } = await supabase
      .from('signing_requests')
      .update({
        // The first check is the one on record; pressing again only brings the invoice up to date.
        invoice_confirmed_at: row.invoice_confirmed_at ?? now.toISOString(),
        invoice_confirmed_by: row.invoice_confirmed_by ?? userId,
        ...(connected && contactId ? { xero_contact_id: contactId } : {}),
        updated_at: now.toISOString(),
      })
      .eq('id', id)
      .eq('status', 'signed')
    if (error) {
      console.error('[signing] recording the staff check failed', id, error.message)
      return NextResponse.json({ error: /does not exist|schema cache/i.test(error.message) ? NOT_MIGRATED : error.message }, { status: 500 })
    }
    const { data: fresh } = await supabase.from('signing_requests').select(SIGNING_SUMMARY_COLUMNS).eq('id', id).maybeSingle()
    return NextResponse.json({ request: fresh, note })
  }

  if (action === 'pay_message') {
    const panel = await loadPayPanel(supabase, row)
    if (!panel) {
      return NextResponse.json({ error: 'No deposit was asked for on this link, so there is nothing for the client to pay on their page.' }, { status: 409 })
    }
    if (depositSettled(panel)) return NextResponse.json({ error: 'The deposit has already been received.' }, { status: 409 })
    if (panel.stage !== 'ready') {
      return NextResponse.json(
        {
          error: !row.invoice_confirmed_at
            ? 'The client cannot pay yet: check the signed quote and create the invoice first.'
            : panel.stage === 'contact'
              ? 'The invoice was voided in Xero, so the client is not shown a way to pay.'
              : 'The client cannot pay yet: set the deposit request and approve the invoice in Xero first.',
        },
        { status: 409 },
      )
    }
    if (!panel.cardUrl && !panel.bank) {
      return NextResponse.json(
        { error: 'There is nothing on the client\'s page to pay with yet: Xero has not given a pay link, and no bank details are saved in Settings.' },
        { status: 409 },
      )
    }

    // Only the hash of a link is kept, so the first link cannot be shown again.
    // This is a second link to the same page; the first keeps working.
    const { token, hash } = newSigningToken()
    const { error } = await supabase
      .from('signing_requests')
      .update({ pay_token_hash: hash, updated_at: now.toISOString() })
      .eq('id', id)
      .eq('status', 'signed')
    if (error) {
      console.error('[signing] saving the pay link failed', id, error.message)
      return NextResponse.json({ error: /does not exist|schema cache/i.test(error.message) ? NOT_MIGRATED : error.message }, { status: 500 })
    }
    const links = await signingLinks(row.trading_name, token)
    const staffFirstName = (await getStaffFirstName(userId)).trim()
    const part = depositPartPaid(panel)
    return NextResponse.json({
      payMessage: {
        url: links.page,
        passcode: row.passcode,
        card: Boolean(panel.cardUrl),
        bank: Boolean(panel.bank),
        message: paymentReadyMessage({
          clientName: row.signer_name || row.to_name,
          brandLabel: row.brand_label,
          // 'User' is the helper's placeholder when no display name is set.
          staffFirstName: staffFirstName === 'User' ? '' : staffFirstName,
          depositLabel: money(part ? part.remaining : panel.deposit),
          link: links.page,
          passcode: row.passcode,
          card: Boolean(panel.cardUrl),
          bank: Boolean(panel.bank),
        }),
      },
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
