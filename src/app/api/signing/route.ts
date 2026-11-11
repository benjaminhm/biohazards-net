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
 *                      deposit, anything stopping it, and the job's other
 *                      quotes that can go on the same link
 * POST                 two ways to get it to the client:
 *                        { mode: 'link', documentIds, toName, toEmail?, depositPercent? }
 *                          creates a private link and a passcode and hands both
 *                          back with a message to paste; the system sends nothing
 *                        { mode: 'email', documentIds, toEmail, toName, subject, message, depositPercent? }
 *                          the system emails the link from the brand address
 *                      documentIds are the quotes on the link, in order, all
 *                      from one job (documentId, for one quote, still works).
 *                      The client accepts or declines each and signs once.
 *                      depositPercent is the share of the accepted total the
 *                      client is asked to pay after signing; empty means no pay step.
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
import type { PreparedSigning } from '@/lib/signing/prepare'
import { MAX_QUOTES_PER_LINK, listLine, totalOf } from '@/lib/signing/items'
import { isAcceptableQuoteType } from '@/lib/acceptableQuotes'
import { DOC_TYPE_LABELS } from '@/lib/types'
import type { DocType } from '@/lib/types'
import { SIGNING_SUMMARY_COLUMNS, staffSummary, withItemSummaries } from '@/lib/signing/store'
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
    // Every request on the job, with the quotes on each: the window warns when
    // a link still waiting holds any quote about to be sent again.
    const { data: requests } = await supabase
      .from('signing_requests')
      .select(SIGNING_SUMMARY_COLUMNS)
      .eq('org_id', orgId)
      .eq('job_id', prepared.jobId)
      .order('sent_at', { ascending: false })
    const [hostStatus, bank, xeroConnection, otherDocs, acceptances, summaries] = await Promise.all([
      documentHostStatus(prepared.tradingName),
      loadBankDetails(supabase, orgId),
      xeroConfigured() ? loadXeroConnection(supabase, orgId).catch(() => null) : Promise.resolve(null),
      supabase
        .from('documents')
        .select('id, type, content, created_at')
        .eq('job_id', prepared.jobId)
        .neq('id', documentId)
        .order('created_at', { ascending: false }),
      supabase.from('quote_acceptances').select('document_id').eq('job_id', prepared.jobId),
      withItemSummaries(supabase, (requests ?? []) as unknown as Parameters<typeof withItemSummaries>[1]),
    ])
    // The job's other quotes that can go on the same link: quotes not yet
    // accepted. Each is checked properly (and frozen) when the link is created.
    const taken = new Set(((acceptances.data ?? []) as { document_id: string | null }[]).map(a => a.document_id))
    const others = ((otherDocs.data ?? []) as { id: string; type: string; content: Record<string, unknown> | null; created_at: string }[])
      .filter(d => isAcceptableQuoteType(d.type) && !taken.has(d.id))
      .map(d => {
        const content = d.content ?? {}
        const total = typeof content.total === 'number' ? content.total : null
        return {
          documentId: d.id,
          title: DOC_TYPE_LABELS[d.type as DocType] ?? 'Quote',
          reference: typeof content.reference === 'string' && content.reference.trim() ? content.reference.trim() : null,
          createdAt: d.created_at,
          total: financials ? total : null,
          hasTotal: (total ?? 0) > 0,
        }
      })
    return NextResponse.json({
      documentId,
      others,
      maxQuotes: MAX_QUOTES_PER_LINK,
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
      requests: summaries.map(r => staffSummary(r, financials)),
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
    const list = await withItemSummaries(supabase, (requests ?? []) as unknown as Parameters<typeof withItemSummaries>[1])
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
  // The quotes on the link, in the order the client sees them.
  const asked = Array.isArray(body.documentIds) ? body.documentIds : [body.documentId]
  const documentIds = [...new Set(asked.filter((v): v is string => typeof v === 'string' && Boolean(v)))]
  if (!documentIds.length) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  if (documentIds.length > MAX_QUOTES_PER_LINK) {
    return NextResponse.json({ error: `One link can carry up to ${MAX_QUOTES_PER_LINK} quotes.` }, { status: 400 })
  }
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
  // Each quote is checked and frozen here; nothing from the browser is trusted for what it says.
  const all = await Promise.all(documentIds.map(id => prepareSigning(supabase, orgId, id, sentByName)))
  if (all.some(p => !p)) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  const quotes = all as PreparedSigning[]
  const prepared = quotes[0]
  const several = quotes.length > 1
  const lineOf = (p: PreparedSigning) => `${p.title}${p.reference ? ` ${p.reference}` : ''}`
  if (quotes.some(p => p.jobId !== prepared.jobId)) {
    return NextResponse.json({ error: 'The quotes on one link must all be from the same job.' }, { status: 400 })
  }
  for (const p of quotes) {
    if (p.blockers.length || !p.sender) {
      const why = p.blockers[0] ?? 'This quote cannot be sent yet.'
      return NextResponse.json({ error: several ? `${lineOf(p)}: ${why}` : why }, { status: 409 })
    }
  }
  if (!prepared.sender) return NextResponse.json({ error: 'This quote cannot be sent yet.' }, { status: 409 })
  const sender = prepared.sender
  // While the link is open its total is every quote on it; once signed, the accepted ones.
  const total = several ? totalOf(quotes.map(p => ({ quote_total: p.total }))) : prepared.total
  // A deposit is a share of the total, so quotes with no total have no pay step.
  const depositPercent = depositAmount(total, depositChoice.percent) != null ? depositChoice.percent : null
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
      quote_total: total,
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

  // The quotes on the link, each frozen as it is now.
  const { error: itemsError } = await supabase.from('signing_request_items').insert(
    quotes.map((p, position) => ({
      request_id: createdId,
      org_id: orgId,
      job_id: prepared.jobId,
      position,
      document_id: p.documentId,
      document_type: p.documentType,
      document_title: p.title,
      reference: p.reference,
      quote_total: p.total,
      frozen_html: p.frozenHtml,
      doc_sha256: sha256Hex(p.frozenHtml),
    })),
  )
  if (itemsError) {
    console.error('[signing] saving the quotes on the link failed', createdId, itemsError.message)
    // One quote is also held on the request itself, so that link still works.
    // Several cannot be: nothing has gone to the client, so leave no record.
    if (several) {
      await supabase.from('signing_requests').delete().eq('id', createdId)
      const notMigrated = /does not exist|schema cache/i.test(itemsError.message)
      return NextResponse.json(
        { error: notMigrated ? 'Sending several quotes on one link is not set up yet: migration 072 needs to be applied.' : `Could not save the quotes (${itemsError.message}). Nothing has gone to the client.` },
        { status: 500 },
      )
    }
  }

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
        documentLine: listLine(quotes.map(lineOf)),
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

  // The new link replaces any earlier one still waiting that holds any of
  // these quotes, so the client cannot sign an out-of-date version. An earlier
  // link is replaced whole, even if it also held a quote that is not on this one.
  const voided = { status: 'voided', voided_at: now.toISOString(), voided_by: userId, updated_at: now.toISOString() }
  const { data: holding } = await supabase
    .from('signing_request_items')
    .select('request_id')
    .eq('org_id', orgId)
    .in('document_id', documentIds)
  const earlier = [...new Set(((holding ?? []) as { request_id: string }[]).map(h => h.request_id))].filter(id => id !== createdId)
  if (earlier.length) {
    await supabase.from('signing_requests').update(voided).eq('org_id', orgId).in('id', earlier).in('status', ['sent', 'viewed'])
  }
  await supabase
    .from('signing_requests')
    .update(voided)
    .eq('org_id', orgId)
    .in('document_id', documentIds)
    .in('status', ['sent', 'viewed'])
    .neq('id', createdId)

  const [withItems] = await withItemSummaries(supabase, [created as unknown as Parameters<typeof withItemSummaries>[1][number]])
  const request = staffSummary(withItems, seesFinancials(guard.role))
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
