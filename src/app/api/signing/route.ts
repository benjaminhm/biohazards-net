/*
 * /api/signing — staff side of sending a quote for signature.
 *
 * GET  ?jobId=…        the signing requests on a job (status for the Documents tab)
 * GET  ?documentId=…   what the send window shows before sending: who it is
 *                      from, the starting wording, and anything stopping it
 * POST                 send it: { documentId, toEmail, toName, subject, message }
 *
 * Full-access staff only. The From address always comes from the job's trading
 * name, never from the request. A person reviews the wording and presses Send
 * (docs/ai-product-principles.md); nothing is sent automatically.
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
  newSigningToken,
  sha256Hex,
  signedDateLabel,
  signingExpiry,
} from '@/lib/signing/core'
import { prepareSigning } from '@/lib/signing/prepare'
import { SIGNING_SUMMARY_COLUMNS } from '@/lib/signing/store'
import { sendSigningInviteEmail } from '@/lib/signing/email'

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
    return NextResponse.json({
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
  const documentId = typeof body.documentId === 'string' ? body.documentId : ''
  const toEmail = typeof body.toEmail === 'string' ? body.toEmail.trim().toLowerCase() : ''
  const toName = cleanSignerName(body.toName)
  const subject = typeof body.subject === 'string' ? body.subject.replace(/[\r\n]+/g, ' ').trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''

  if (!isEmail(toEmail)) return NextResponse.json({ error: "Enter the client's email address" }, { status: 400 })
  if (toName.length < 2 || toName.length > SIGNER_NAME_MAX) {
    return NextResponse.json({ error: "Enter the client's name" }, { status: 400 })
  }
  if (!subject || subject.length > SUBJECT_MAX) {
    return NextResponse.json({ error: 'Enter a subject' }, { status: 400 })
  }
  if (!message || message.length > MESSAGE_MAX) {
    return NextResponse.json({ error: 'Enter a message' }, { status: 400 })
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
      to_email: toEmail,
      to_name: toName,
      subject,
      message,
      sent_at: now.toISOString(),
      sent_by: userId,
      sent_by_name: sentByName || null,
      expires_at: expiresAt.toISOString(),
    })
    .select(SIGNING_SUMMARY_COLUMNS)
    .single()

  if (insertError || !created) {
    const missingTable = /signing_requests/.test(insertError?.message ?? '') && /does not exist|schema cache/i.test(insertError?.message ?? '')
    return NextResponse.json(
      { error: missingTable ? 'Signing is not set up yet: migration 068 has not been applied.' : insertError?.message ?? 'Could not save the request' },
      { status: 500 },
    )
  }
  const createdId = (created as unknown as { id: string }).id

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  try {
    await sendSigningInviteEmail({
      from: sender.from,
      replyTo: sender.replyTo,
      to: toEmail,
      subject,
      message,
      brandLabel: sender.brandLabel,
      documentLine: `${prepared.title}${prepared.reference ? ` ${prepared.reference}` : ''}`,
      signUrl: `${appUrl}/sign/${token}`,
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

  // The new link replaces any earlier one still waiting on this document, so
  // the client cannot sign an out-of-date version.
  await supabase
    .from('signing_requests')
    .update({ status: 'voided', voided_at: now.toISOString(), voided_by: userId, updated_at: now.toISOString() })
    .eq('org_id', orgId)
    .eq('document_id', prepared.documentId)
    .in('status', ['sent', 'viewed'])
    .neq('id', createdId)

  return NextResponse.json({ request: created })
}
