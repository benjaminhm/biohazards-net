/*
 * /api/signing — staff side of sending a quote for signature.
 *
 * GET  ?jobId=…        the signing requests on a job (status for the Documents tab)
 * GET  ?documentId=…   what the send window shows before sending: who it is
 *                      from, the starting wording, and anything stopping it
 * POST                 two ways to get it to the client:
 *                        { mode: 'link', documentId, toName, toEmail? }
 *                          creates a private link and a passcode and hands both
 *                          back with a message to paste; the system sends nothing
 *                        { mode: 'email', documentId, toEmail, toName, subject, message }
 *                          the system emails the link from the brand address
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
import { SIGNING_SUMMARY_COLUMNS } from '@/lib/signing/store'
import { sendSigningInviteEmail } from '@/lib/signing/email'
import { documentHostStatus, signingLinks } from '@/lib/signing/links'

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
    const hostStatus = await documentHostStatus(prepared.tradingName)
    return NextResponse.json({
      linkHost: hostStatus.liveHost,
      pendingLinkHost: hostStatus.pendingHost,
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
      requests: requests ?? [],
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
    return NextResponse.json({ requests: requests ?? [] })
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

  const sentByName = await staffName(userId)
  const prepared = await prepareSigning(supabase, orgId, documentId, sentByName)
  if (!prepared) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  if (prepared.blockers.length || !prepared.sender) {
    return NextResponse.json({ error: prepared.blockers[0] ?? 'This quote cannot be sent yet.' }, { status: 409 })
  }
  const sender = prepared.sender

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
      { error: notMigrated ? 'Signing is not fully set up yet: migrations 068 and 069 need to be applied.' : insertError?.message ?? 'Could not save the request' },
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

  if (byLink && passcode) {
    return NextResponse.json({
      request: created,
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
  return NextResponse.json({ request: created })
}
