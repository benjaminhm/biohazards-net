/*
 * /api/signing — staff side of sending a quote to a client to view, sign and
 * pay the deposit on.
 *
 * GET  ?jobId=…        the signing requests on a job (status for the Documents
 *                      tab), with where the job's Xero invoice is up to once a
 *                      request has been signed (the staff check on the signed
 *                      request, in /api/signing/[id], is what creates it)
 * GET  ?documentId=…   what the send window shows before sending: who it is
 *                      from, the starting wording, the quote total for the
 *                      deposit, and anything stopping it
 * POST                 two ways to get it to the client:
 *                        { mode: 'link', documentId, toName, toEmail?, depositPercent? }
 *                          creates a private link and a passcode and hands both
 *                          back with a message to paste; the system sends nothing
 *                        { mode: 'email', documentId, toEmail, toName, subject, message, depositPercent? }
 *                          the system emails the link from the brand address
 *                      depositPercent is the share of the quote total the client
 *                      is asked to pay after signing; empty means no pay step.
 *
 * Full-access staff only. The From address always comes from the job's trading
 * name, never from the request. Either way a person decides what goes to the
 * client and sends or approves it (docs/ai-product-principles.md); nothing is
 * sent automatically, and the pasted message is fixed wording, not AI.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { jobInOrg } from '@/lib/documentAccess'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { seesFinancials } from '@/lib/agent/jobSnapshot'
import {
  MESSAGE_MAX,
  SIGNER_NAME_MAX,
  SUBJECT_MAX,
  cleanSignerName,
  isEmail,
  linkMessage,
  newPasscode,
  newSigningToken,
  sha256Hex,
  signedDateLabel,
  signingExpiry,
} from '@/lib/signing/core'
import { prepareSigning } from '@/lib/signing/prepare'
import { SIGNING_SUMMARY_COLUMNS, staffSummary } from '@/lib/signing/store'
import { sendSigningInviteEmail } from '@/lib/signing/email'
import { documentHostStatus, signingLinks } from '@/lib/signing/links'
import { DEFAULT_DEPOSIT_PERCENT, depositAmount, parseDepositPercent } from '@/lib/signing/pay'
import { loadBankDetails } from '@/lib/paymentDetails'
import { loadXeroConnection, xeroConfigured } from '@/lib/xero/client'
import { xeroInvoiceUrl } from '@/lib/xero/invoice'
import { jobPayState } from '@/lib/xero/payments'

export const maxDuration = 60

async function staffName(userId: string): Promise<string> {
  const name = (await getStaffFirstName(userId)).trim()
  // 'User' is the helper's placeholder when no display name is set.
  return name === 'User' ? '' : name
}

export async function GET(req: Request) {
  const guard = await guardFullAccessStaff(req)
  if (!guard.ok) return guard.response
  const { supabase, orgId, userId } = guard
  // Team leads send quotes but are not shown money elsewhere in the app; the
  // same holds here for totals, deposits and what has been paid.
  const financials = seesFinancials(guard.role)
  const params = new URL(req.url).searchParams
  const jobId = params.get('jobId')
  const documentId = params.get('documentId')

  if (documentId) {
    const prepared = await prepareSigning(supabase, orgId, documentId, await staffName(userId))
    if (!prepared) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    const { data: requests } = await supabase
      .from('signing_requests')
      .select(SIGNING_SUMMARY_COLUMNS)
      .eq('org_id', orgId)
      .eq('document_id', documentId)
      .order('sent_at', { ascending: false })
    const [hostStatus, bank, xeroConnection] = await Promise.all([
      documentHostStatus(prepared.tradingName),
      loadBankDetails(supabase, orgId),
      xeroConfigured() ? loadXeroConnection(supabase, orgId).catch(() => null) : Promise.resolve(null),
    ])
    return NextResponse.json({
      linkHost: hostStatus.liveHost,
      pendingLinkHost: hostStatus.pendingHost,
      // For the deposit the client is asked to pay after signing.
      total: financials ? prepared.total : null,
      hasTotal: (prepared.total ?? 0) > 0,
      defaultDepositPercent: DEFAULT_DEPOSIT_PERCENT,
      bankDetailsSet: Boolean(bank.details),
      xeroConnected: Boolean(xeroConnection),
      title: prepared.title,
      reference: prepared.reference,
      blockers: prepared.blockers,
      sender: prepared.sender
        ? {
            brandLabel: prepared.sender.brandLabel,
            from: prepared.sender.from,
            replyTo: prepared.sender.replyTo,
            usesBrandAddress: prepared.sender.usesBrandAddress,
          }
        : null,
      defaults: prepared.defaults,
      requests: ((requests ?? []) as unknown as object[]).map(r => staffSummary(r, financials)),
    })
  }

  if (jobId) {
    if (!(await jobInOrg(supabase, jobId, orgId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const { data: requests, error } = await supabase
      .from('signing_requests')
      .select(SIGNING_SUMMARY_COLUMNS)
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .order('sent_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Where the job's Xero invoice is up to, once a quote has been signed: the
    // staff check creates it, and the deposit is watched from then on.
    const list = (requests ?? []) as unknown as { status: string; quote_total: number | null; deposit_percent: number | null }[]
    const hasSigned = financials && list.some(r => r.status === 'signed')
    let invoice: {
      xeroConnected: boolean
      number: string
      status: string
      amountPaid: number
      paidOn: string | null
      payLinkLive: boolean
      xeroUrl: string | null
    } | null = null
    if (hasSigned) {
      const pay = await jobPayState(supabase, orgId, jobId)
      invoice = {
        xeroConnected: pay.xeroConnected,
        number: pay.invoiceNumber,
        status: pay.status,
        amountPaid: pay.amountPaid,
        paidOn: pay.paidOn,
        payLinkLive: Boolean(pay.payUrl),
        xeroUrl: pay.invoiceId ? xeroInvoiceUrl(pay.invoiceId) : null,
      }
    }
    return NextResponse.json({
      requests: list.map(r => staffSummary(r, financials)),
      invoice,
    })
  }

  return NextResponse.json({ error: 'jobId or documentId is required' }, { status: 400 })
}

export async function POST(req: Request) {
  const guard = await guardFullAccessStaff(req)
  if (!guard.ok) return guard.response
  const { supabase, orgId, userId } = guard

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const byLink = body.mode === 'link'
  const documentId = typeof body.documentId === 'string' ? body.documentId : ''
  const toEmail = typeof body.toEmail === 'string' ? body.toEmail.trim().toLowerCase() : ''
  const toName = cleanSignerName(body.toName)
  const subject = byLink ? '' : typeof body.subject === 'string' ? body.subject.replace(/[\r\n]+/g, ' ').trim() : ''
  const message = byLink ? '' : typeof body.message === 'string' ? body.message.trim() : ''

  if (toName.length < 2 || toName.length > SIGNER_NAME_MAX) {
    return NextResponse.json({ error: "Enter the client's name" }, { status: 400 })
  }
  if (byLink) {
    // A link sent by text may have no email with it.
    if (toEmail && !isEmail(toEmail)) {
      return NextResponse.json({ error: "That email address does not look right. Fix it or leave it empty." }, { status: 400 })
    }
  } else {
    if (!isEmail(toEmail)) return NextResponse.json({ error: "Enter the client's email address" }, { status: 400 })
    if (!subject || subject.length > SUBJECT_MAX) {
      return NextResponse.json({ error: 'Enter a subject' }, { status: 400 })
    }
    if (!message || message.length > MESSAGE_MAX) {
      return NextResponse.json({ error: 'Enter a message' }, { status: 400 })
    }
  }

  const depositChoice = parseDepositPercent(body.depositPercent)
  if (!depositChoice.ok) return NextResponse.json({ error: depositChoice.error }, { status: 400 })

  const sentByName = await staffName(userId)
  const prepared = await prepareSigning(supabase, orgId, documentId, sentByName)
  if (!prepared) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  if (prepared.blockers.length || !prepared.sender) {
    return NextResponse.json({ error: prepared.blockers[0] ?? 'This quote cannot be sent yet.' }, { status: 409 })
  }
  const sender = prepared.sender
  // A deposit is a share of the quote total, so a quote with no total has no pay step.
  const depositPercent = depositAmount(prepared.total, depositChoice.percent) != null ? depositChoice.percent : null
  if (depositChoice.percent != null && depositPercent == null) {
    return NextResponse.json(
      { error: 'This quote has no total, so a deposit cannot be worked out. Clear the deposit, or add the total to the quote first.' },
      { status: 409 },
    )
  }

  const now = new Date()
  const expiresAt = signingExpiry(now)
  const { token, hash } = newSigningToken()
  const passcode = byLink ? newPasscode() : null

  const { data: created, error: insertError } = await supabase
    .from('signing_requests')
    .insert({
      org_id: orgId,
      job_id: prepared.jobId,
      document_id: prepared.documentId,
      token_hash: hash,
      status: 'sent',
      document_type: prepared.documentType,
      document_title: prepared.title,
      reference: prepared.reference,
      quote_total: prepared.total,
      frozen_html: prepared.frozenHtml,
      doc_sha256: sha256Hex(prepared.frozenHtml),
      trading_name: prepared.tradingName,
      brand_label: sender.brandLabel,
      from_address: sender.from,
      reply_to: sender.replyTo,
      to_email: toEmail || null,
      to_name: toName,
      // The pasted message holds the link, and the link is never stored.
      subject,
      message,
      delivery_method: byLink ? 'link' : 'email',
      passcode,
      deposit_percent: depositPercent,
      sent_at: now.toISOString(),
      sent_by: userId,
      sent_by_name: sentByName || null,
      expires_at: expiresAt.toISOString(),
    })
    .select(SIGNING_SUMMARY_COLUMNS)
    .single()

  if (insertError || !created) {
    const notMigrated = /does not exist|schema cache|null value in column "to_email"/i.test(insertError?.message ?? '')
    return NextResponse.json(
      { error: notMigrated ? 'Signing is not fully set up yet: migrations 068 to 071 need to be applied.' : insertError?.message ?? 'Could not save the request' },
      { status: 500 },
    )
  }
  const createdId = (created as unknown as { id: string }).id

  const links = await signingLinks(prepared.tradingName, token)
  if (!byLink) {
    try {
      await sendSigningInviteEmail({
        from: sender.from,
        replyTo: sender.replyTo,
        to: toEmail,
        subject,
        message,
        brandLabel: sender.brandLabel,
        documentLine: `${prepared.title}${prepared.reference ? ` ${prepared.reference}` : ''}`,
        signUrl: links.page,
        expiresLabel: signedDateLabel(expiresAt.toISOString()),
      })
    } catch (err) {
      // Nothing went to the client, so there must be no record saying it did.
      await supabase.from('signing_requests').delete().eq('id', createdId)
      const reason = err instanceof Error ? err.message : 'send rejected'
      return NextResponse.json(
        { error: `The email was not sent (${reason}). Nothing has gone to the client.` },
        { status: 502 },
      )
    }
  }

  // The new link replaces any earlier one still waiting on this document, so
  // the client cannot sign an out-of-date version.
  await supabase
    .from('signing_requests')
    .update({ status: 'voided', voided_at: now.toISOString(), voided_by: userId, updated_at: now.toISOString() })
    .eq('org_id', orgId)
    .eq('document_id', prepared.documentId)
    .in('status', ['sent', 'viewed'])
    .neq('id', createdId)

  const request = staffSummary(created as unknown as object, seesFinancials(guard.role))
  if (byLink && passcode) {
    return NextResponse.json({
      request,
      // Shown once: only a hash of the link is kept, so it cannot be shown again.
      link: {
        url: links.page,
        host: links.host,
        pendingHost: links.pendingHost,
        passcode,
        message: linkMessage({
          clientName: toName,
          siteAddress: prepared.siteAddress,
          staffFirstName: sentByName,
          brandLabel: sender.brandLabel,
          link: links.page,
          passcode,
        }),
      },
    })
  }
  return NextResponse.json({ request })
}
