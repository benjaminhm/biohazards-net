/*
 * POST /api/documents/[id]/share-link
 *
 * Mints a branded client-view link on document.<brand>.com.au/p/<token> for any
 * saved job document (Company Letterhead, House Survey, Scope of Work, CDR,
 * Completion Report, etc.) using the existing document_packs viewer & frozen
 * HTML store. View + Download PDF only (nothing signed).
 *
 * Unlike /api/print/<id> (internal staff URL on app.biohazards.net), this link
 * lives on the job's trading-name document host (document.biohazardcleaningqld.com.au,
 * document.forensiccleaningqld.com.au, document.hoardingclearanceqld.com.au) and
 * freezes the HTML snapshot as sent.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { documentInOrg } from '@/lib/documentAccess'
import { getStaffFirstName } from '@/lib/clerkDisplayName'
import { renderDocumentHtml } from '@/lib/documentRender'
import { isTradingNameId, tradingNameShortList } from '@/lib/tradingNames'
import { newSigningToken, resolveSender } from '@/lib/signing/core'
import { documentHostStatus } from '@/lib/signing/links'
import { buildPackLinks, packDocumentTitle, packExpiry } from '@/lib/documentPack'
import { resolveBrandSmsSenderId } from '@/lib/twilioSender'

export const maxDuration = 60

function referenceOf(content: unknown): string | null {
  const ref = (content as { reference?: unknown } | null)?.reference
  return typeof ref === 'string' && ref.trim() ? ref.trim() : null
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardFullAccessStaff(req)
  if (!g.ok) return g.response
  const { supabase, orgId, userId } = g
  const { id } = await params

  if (!(await documentInOrg(supabase, id, orgId))) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const { data: docRow } = await supabase
    .from('documents')
    .select('id, job_id, type, content, created_at')
    .eq('id', id)
    .maybeSingle()

  if (!docRow) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const doc = docRow as {
    id: string
    job_id: string
    type: string
    content: Record<string, unknown> | null
    created_at: string
  }

  const [jobRes, companyRes, staffNameRaw] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, client_name, client_email, client_phone, site_address, trading_name')
      .eq('id', doc.job_id)
      .eq('org_id', orgId)
      .maybeSingle(),
    supabase
      .from('company_profile')
      .select('email')
      .eq('org_id', orgId)
      .limit(1)
      .maybeSingle(),
    getStaffFirstName(userId),
  ])

  const job = jobRes.data as {
    id: string
    client_name: string | null
    client_email: string | null
    client_phone: string | null
    site_address: string | null
    trading_name: string | null
  } | null
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const tradingName = isTradingNameId(job.trading_name) ? job.trading_name : null
  if (!tradingName) {
    return NextResponse.json(
      { error: `Choose the trading name on the job first (${tradingNameShortList()}), so the document link uses the right brand.` },
      { status: 409 },
    )
  }

  const companyEmail = (companyRes.data as { email?: string | null } | null)?.email ?? null
  const sender = resolveSender(
    tradingName,
    { RESEND_FROM_ACCOUNTS: process.env.RESEND_FROM_ACCOUNTS, RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL },
    companyEmail,
  )

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const frozenHtml = await renderDocumentHtml({
    supabase,
    doc,
    imagesParam: null,
    viewerUrl: `${appUrl}/api/print/${doc.id}`,
    includeClientContact: true,
    forSigning: true,
  })
  if (!frozenHtml?.trim()) {
    return NextResponse.json({ error: 'This document could not be prepared for sharing.' }, { status: 500 })
  }

  const title = packDocumentTitle(doc.type)
  const reference = referenceOf(doc.content)
  const clientName = (job.client_name ?? '').trim() || 'Client'
  const toEmail = (job.client_email ?? '').trim()
  const staffFirst = staffNameRaw.trim() === 'User' ? '' : staffNameRaw.trim()

  const now = new Date()
  const expiresAt = packExpiry(now)
  const { token, hash } = newSigningToken()

  const { data: created, error: insertError } = await supabase
    .from('document_packs')
    .insert({
      org_id: orgId,
      job_id: job.id,
      document_id: doc.id,
      token_hash: hash,
      status: 'sent',
      trading_name: tradingName,
      brand_label: sender.brandLabel,
      from_address: sender.from,
      reply_to: sender.replyTo,
      to_email: toEmail || null,
      to_name: clientName,
      subject: `${title}${reference ? ` ${reference}` : ''} — ${sender.brandLabel}`,
      message: '',
      delivery_method: 'email',
      passcode: null,
      sent_at: now.toISOString(),
      sent_by: userId,
      sent_by_name: staffFirst || null,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single()

  if (insertError || !created) {
    return NextResponse.json(
      { error: insertError?.message ?? 'Could not create document link' },
      { status: 500 },
    )
  }

  const packId = (created as { id: string }).id
  const { error: itemError } = await supabase.from('document_pack_items').insert({
    pack_id: packId,
    org_id: orgId,
    position: 0,
    document_id: doc.id,
    document_type: doc.type,
    document_title: title,
    reference,
    frozen_html: frozenHtml,
  })

  if (itemError) {
    await supabase.from('document_packs').delete().eq('id', packId)
    return NextResponse.json(
      { error: `Could not freeze document (${itemError.message})` },
      { status: 500 },
    )
  }

  const hostStatus = await documentHostStatus(tradingName)
  const links = buildPackLinks(token, appUrl, hostStatus.liveHost)
  const firstName = clientName.split(/\s+/)[0] || 'there'
  const subject = `${title}${reference ? ` ${reference}` : ''} — ${clientName}`
  const body = [
    `Hi ${firstName},`,
    '',
    `Please find your ${title.toLowerCase()} from ${sender.brandLabel} at the link below:`,
    '',
    links.page,
    '',
    'Kind regards,',
    staffFirst || sender.brandLabel,
    staffFirst ? sender.brandLabel : '',
  ]
    .filter((line, idx, arr) => !(line === '' && idx === arr.length - 1))
    .join('\n')

  const toPhone = (job.client_phone ?? '').trim()
  const smsSenderId = resolveBrandSmsSenderId(tradingName)
  const replyEmail = sender.replyTo || companyEmail || ''
  const smsBody = [
    `Hi ${firstName}, your ${title.toLowerCase()} from ${sender.brandLabel} is ready to view:`,
    links.page,
    replyEmail
      ? `This is a no-reply SMS — please email ${replyEmail} if you have any questions.`
      : 'This is a no-reply SMS — please contact our office if you have any questions.',
  ].join('\n\n')

  return NextResponse.json({
    jobId: job.id,
    url: links.page,
    host: links.host,
    pendingHost: hostStatus.pendingHost,
    brandLabel: sender.brandLabel,
    toEmail,
    toPhone,
    replyEmail,
    smsSenderId,
    subject,
    body,
    smsBody,
    expiresAt: expiresAt.toISOString(),
  })
}
