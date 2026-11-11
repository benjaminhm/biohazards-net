/*
 * POST /api/signing/[id] — staff actions on one signing request.
 *
 *   { action: 'void' }     cancel a request the client has not signed; the link stops working
 *   { action: 'resend' }   email the same message again with a fresh link (the old link stops working);
 *                          only for requests the system emailed
 *   { action: 'deliver' }  email the signed copy again (e.g. after a failed delivery); with no
 *                          client email on the request it goes to the office inbox
 *
 * Full-access staff only, and only for requests in their own organisation.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { newSigningToken, signedDateLabel, signingExpiry } from '@/lib/signing/core'
import { SIGNING_SUMMARY_COLUMNS, deliverSignedCopy, documentLine } from '@/lib/signing/store'
import type { SigningRequestRow } from '@/lib/signing/store'
import { sendSigningInviteEmail } from '@/lib/signing/email'
import { signingLinks } from '@/lib/signing/links'

export const maxDuration = 60

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

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
