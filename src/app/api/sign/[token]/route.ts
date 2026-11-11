/*
 * POST /api/sign/[token] — what the client's signing page reports.
 *
 *   { action: 'view' }      the document was opened in a browser
 *   { action: 'consent' }   they agreed to sign electronically
 *   { action: 'sign', name, signature, method, agreed }
 *   { action: 'decline', reason }
 *
 * Public: the token in the path is the credential. Everything the page sends is
 * checked again here, the date is set by the server, and a document can be
 * signed once only (the update is conditional on it still being open).
 *
 * Signing is recorded first and answered straight away. The signed PDF, the
 * emails, the staff alert and Xero follow in after(), so a slow PDF or a
 * rejected email can never lose a signature.
 */
import { after, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  DECLINE_REASON_MAX,
  cleanSignerName,
  linkState,
  signaturePngError,
  signedDateLabel,
  signerNameError,
} from '@/lib/signing/core'
import { afterDeclined, afterSigned, findSigningRequestByToken, recordAcceptance } from '@/lib/signing/store'
import type { SigningRequestRow } from '@/lib/signing/store'

export const maxDuration = 60

const MAX_BODY_CHARS = 700_000

const CLOSED_MESSAGE: Record<string, string> = {
  signed: 'This document has already been signed.',
  declined: 'This document was declined and can no longer be signed.',
  voided: 'This link is no longer in use. Please reply to the email you received for a new one.',
  expired: 'This link has expired. Please reply to the email you received for a new one.',
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const raw = await req.text()
  if (raw.length > MAX_BODY_CHARS) return NextResponse.json({ error: 'Signature image is too large' }, { status: 413 })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const action = typeof body.action === 'string' ? body.action : ''

  const supabase = createServiceClient()
  const row = await findSigningRequestByToken(supabase, token)
  if (!row) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })

  const now = new Date()
  const nowIso = now.toISOString()
  const state = linkState(row, now)
  if (state !== 'open') {
    return NextResponse.json({ error: CLOSED_MESSAGE[state] ?? 'This link can no longer be used.' }, { status: 409 })
  }

  if (action === 'view') {
    if (!row.first_viewed_at) {
      await supabase
        .from('signing_requests')
        .update({ status: 'viewed', first_viewed_at: nowIso, updated_at: nowIso })
        .eq('id', row.id)
        .eq('status', 'sent')
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'consent') {
    if (!row.consented_at) {
      await supabase
        .from('signing_requests')
        .update({
          status: 'viewed',
          first_viewed_at: row.first_viewed_at ?? nowIso,
          consented_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', row.id)
        .in('status', ['sent', 'viewed'])
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'sign') {
    if (body.agreed !== true) {
      return NextResponse.json({ error: 'Please agree to sign electronically first.' }, { status: 400 })
    }
    const name = cleanSignerName(body.name)
    const nameProblem = signerNameError(name)
    if (nameProblem) return NextResponse.json({ error: nameProblem }, { status: 400 })
    const signatureProblem = signaturePngError(body.signature)
    if (signatureProblem) return NextResponse.json({ error: signatureProblem }, { status: 400 })
    const method = body.method === 'typed' ? 'typed' : 'drawn'

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || (req.headers.get('x-real-ip') ?? '')
    const { data: updated, error } = await supabase
      .from('signing_requests')
      .update({
        status: 'signed',
        signed_at: nowIso,
        signer_name: name,
        signature_png: body.signature as string,
        signature_method: method,
        signer_ip: ip.slice(0, 100) || null,
        signer_user_agent: (req.headers.get('user-agent') ?? '').slice(0, 500) || null,
        first_viewed_at: row.first_viewed_at ?? nowIso,
        consented_at: row.consented_at ?? nowIso,
        updated_at: nowIso,
      })
      .eq('id', row.id)
      .in('status', ['sent', 'viewed'])
      .gt('expires_at', nowIso)
      .select('*')
      .maybeSingle()
    if (error) {
      console.error('[signing] recording signature failed', row.id, error.message)
      return NextResponse.json({ error: 'Could not record your signature. Please try again.' }, { status: 500 })
    }
    const signed = updated as SigningRequestRow | null
    // Someone else (or a second tap) got there first.
    if (!signed) return NextResponse.json({ error: CLOSED_MESSAGE.signed }, { status: 409 })

    const info = await recordAcceptance(supabase, signed)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
    after(() => afterSigned(supabase, signed, info, `${appUrl}/api/sign/${token}/pdf`))

    return NextResponse.json({ ok: true, dateLabel: signedDateLabel(nowIso) })
  }

  if (action === 'decline') {
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, DECLINE_REASON_MAX) : ''
    const { data: updated } = await supabase
      .from('signing_requests')
      .update({
        status: 'declined',
        declined_at: nowIso,
        decline_reason: reason || null,
        first_viewed_at: row.first_viewed_at ?? nowIso,
        updated_at: nowIso,
      })
      .eq('id', row.id)
      .in('status', ['sent', 'viewed'])
      .select('*')
      .maybeSingle()
    const declined = updated as SigningRequestRow | null
    if (!declined) return NextResponse.json({ error: 'This link can no longer be used.' }, { status: 409 })
    after(() => afterDeclined(declined))
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
