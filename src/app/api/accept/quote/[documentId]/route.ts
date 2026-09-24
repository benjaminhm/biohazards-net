/*
 * POST /api/accept/quote/[documentId]
 *
 * Public acceptance of one saved quote/estimate. The client opens the print
 * link, enters their email, and confirms. They receive a confirmation email.
 * Staff receive an email and a text.
 */
import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase'
import { sendQuoteAcceptedClientEmail, sendQuoteAcceptedEmail } from '@/lib/email'
import { formatToTwilioE164 } from '@/lib/phone'
import { isTradingNameId, tradingNameOption } from '@/lib/tradingNames'

const POST_ACCEPTANCE = new Set([
  'accepted',
  'scheduled',
  'underway',
  'completed',
  'report_sent',
  'paid',
])

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export async function POST(req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  let email = ''
  try {
    const body = await req.json() as { email?: unknown }
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  } catch {
    email = ''
  }
  if (!isEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: doc } = await supabase
    .from('documents')
    .select('id, job_id, type, content')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc || doc.type !== 'quote') {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  const { data: job } = await supabase
    .from('jobs')
    .select('id, org_id, client_name, client_email, site_address, job_type, status, trading_name')
    .eq('id', doc.job_id)
    .maybeSingle()

  if (!job) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  const { data: existing } = await supabase
    .from('quote_acceptances')
    .select('accepted_at, contact_email')
    .eq('document_id', documentId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: `This quote was already accepted${existing.contact_email ? ` by ${existing.contact_email}` : ''}.` },
      { status: 409 },
    )
  }

  const content = (doc.content ?? {}) as Record<string, unknown>
  const total = typeof content.total === 'number' ? content.total : null
  const reference = typeof content.reference === 'string' && content.reference.trim()
    ? content.reference.trim()
    : 'Quote'
  const clientName = (job.client_name as string | null)?.trim() || email

  const { data: acceptance, error: insertError } = await supabase
    .from('quote_acceptances')
    .insert({
      org_id: job.org_id,
      account_id: null,
      contact_id: null,
      job_id: job.id,
      document_id: documentId,
      contact_name: clientName,
      contact_email: email,
      quote_total: total,
      quote_reference: reference,
      terms_version: 'online-link',
      ip: (req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '').slice(0, 100),
      user_agent: (req.headers.get('user-agent') ?? '').slice(0, 500),
    })
    .select('accepted_at')
    .single()

  if (insertError) {
    if (insertError.code === '23505' || /duplicate key/i.test(insertError.message)) {
      return NextResponse.json({ error: 'This quote has already been accepted.' }, { status: 409 })
    }
    if (/null value in column "account_id"/i.test(insertError.message)) {
      return NextResponse.json(
        { error: 'Online acceptance is not ready yet. Please contact us to accept this quote.' },
        { status: 500 },
      )
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  if (!POST_ACCEPTANCE.has(job.status as string)) {
    await supabase
      .from('jobs')
      .update({
        status: 'accepted',
        updated_at: new Date().toISOString(),
        ...(!(job.client_email as string | null)?.trim() ? { client_email: email } : {}),
      })
      .eq('id', job.id)
  }

  const trading = isTradingNameId(job.trading_name) ? job.trading_name : null
  const brandLabel = (trading && tradingNameOption(trading)?.label) || 'Brisbane Biohazard Cleaning'
  const site = (job.site_address as string | null) ?? ''

  try {
    await sendQuoteAcceptedClientEmail({
      to: email,
      clientName,
      siteAddress: site,
      reference,
      total,
      brandLabel,
    })
  } catch (err) {
    console.error('[quote-accept] client email failed', err)
  }

  try {
    await sendQuoteAcceptedEmail({
      jobId: job.id as string,
      clientName,
      siteAddress: site,
      jobType: (job.job_type as string) ?? '',
      reference,
      total: total ?? 0,
      contactEmail: email,
    })
  } catch (err) {
    console.error('[quote-accept] staff email failed', err)
  }

  const notifyPhone = process.env.NOTIFY_PHONE?.trim()
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const token = process.env.TWILIO_AUTH_TOKEN?.trim()
  const fromNum = process.env.TWILIO_PHONE_NUMBER?.trim()
  const to = notifyPhone ? formatToTwilioE164(notifyPhone) : null
  if (sid && token && fromNum && to) {
    const money = total == null
      ? ''
      : ` $${Number(total).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`
    try {
      await twilio(sid, token).messages.create({
        from: fromNum,
        to,
        body: `Quote accepted: ${clientName} (${email}) — ${reference}${money}${site ? ` — ${site}` : ''}.`,
      })
    } catch (err) {
      console.error('[quote-accept] staff sms failed', err)
    }
  }

  return NextResponse.json({ ok: true, accepted_at: acceptance?.accepted_at ?? new Date().toISOString() })
}
