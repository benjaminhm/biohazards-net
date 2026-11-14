/*
 * POST /api/sign/[token] — what the client's signing page reports.
 *
 *   { action: 'unlock', code }   the passcode for a link staff sent themselves
 *   { action: 'view' }      the document was opened in a browser
 *   { action: 'details', details, declared }
 *                           check what they typed on the Your details step and hand it
 *                           back tidied, or say which field is wrong. Nothing is saved:
 *                           the details are saved with the signature
 *   { action: 'consent' }   they agreed to sign electronically
 *   { action: 'review', decisions }
 *                           a link with several quotes: what they chose for each
 *                           (accepted or declined, in order) comes back with the
 *                           accepted total and the deposit on it. Nothing is saved
 *   { action: 'sign', details, declared, signature, method, agreed, decisions? }
 *                           the name signed under is the legal name in their details.
 *                           With several quotes, `decisions` says which are accepted:
 *                           the one signature goes on each of those, the others are
 *                           recorded as declined, and the deposit is on the accepted total
 *   { action: 'decline', reason }
 *                           declines the link: every quote on it
 *   { action: 'pay' }       after signing: the pay step as it stands now (the page
 *                           asks again while it is open, so the payment details
 *                           and "deposit received" appear without a reload)
 *
 * Public: the token in the path is the credential, plus the passcode where the
 * link has one (five wrong tries locks the link). Everything the page sends is
 * checked again here, the date is set by the server, and a document can be
 * signed once only (the update is conditional on it still being open).
 *
 * Signing is recorded first and answered straight away. The signed PDF, the
 * emails and the staff alert follow in after(), so a slow PDF or a rejected
 * email can never lose a signature. Signing sends nothing to Xero: staff check
 * the signed request and create the invoice themselves.
 */
import { after, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  DECLINE_REASON_MAX,
  UNLOCK_SECONDS,
  isUnlocked,
  linkState,
  passcodeAttempt,
  signaturePngError,
  signedDateLabel,
  unlockCookieName,
  unlockCookieValue,
} from '@/lib/signing/core'
import { DECLARATION_VERSION, cleanSignerDetails, declarationText } from '@/lib/signing/details'
import type { SignerDetails } from '@/lib/signing/details'
import { acceptedItems, decisionsProblem, itemLine, listLine, quotesSummary, readDecisions, totalOf, withDecisions } from '@/lib/signing/items'
import { signingLinks } from '@/lib/signing/links'
import { depositAmount, depositSettled, money, percentLabel } from '@/lib/signing/pay'
import { payPanelHtml } from '@/lib/signing/shell'
import {
  afterDeclined,
  afterOpened,
  afterSigned,
  findSigningRequestByToken,
  loadItems,
  loadPayPanel,
  recordAcceptance,
  saveDecisions,
  signerEmail,
} from '@/lib/signing/store'
import type { SigningRequestRow } from '@/lib/signing/store'

export const maxDuration = 60

const MAX_BODY_CHARS = 700_000

const LOCKED_MESSAGE = 'The wrong passcode was entered too many times, so this link has been locked. Please contact us for a new link.'

const CLOSED_MESSAGE: Record<string, string> = {
  signed: 'This document has already been signed.',
  declined: 'This document was declined and can no longer be signed.',
  voided: 'This link is no longer in use. Please contact us for a new one.',
  expired: 'This link has expired. Please contact us for a new one.',
  locked: LOCKED_MESSAGE,
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

  if (action === 'unlock') {
    if (state === 'voided' || state === 'expired') {
      return NextResponse.json({ error: CLOSED_MESSAGE[state] }, { status: 409 })
    }
    if (state === 'locked') return NextResponse.json({ error: LOCKED_MESSAGE, locked: true }, { status: 423 })
    if (!row.passcode) return NextResponse.json({ ok: true })

    const result = passcodeAttempt(
      { passcode: row.passcode, passcode_attempts: row.passcode_attempts, passcode_verified_at: row.passcode_verified_at },
      body.code,
      now,
    )
    // Only counts if nobody else's try landed in between, so tries cannot be
    // raced past the limit.
    const { data: saved, error } = await supabase
      .from('signing_requests')
      .update({ ...result.patch, updated_at: nowIso })
      .eq('id', row.id)
      .eq('passcode_attempts', row.passcode_attempts)
      .is('passcode_locked_at', null)
      .select('id')
      .maybeSingle()
    if (error || !saved) {
      return NextResponse.json({ error: 'Could not check the passcode. Please try again.' }, { status: 409 })
    }
    if (!result.ok) {
      if (result.locked) return NextResponse.json({ error: LOCKED_MESSAGE, locked: true }, { status: 423 })
      const left = result.triesLeft
      return NextResponse.json(
        { error: `That passcode is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` },
        { status: 401 },
      )
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set(unlockCookieName(token), unlockCookieValue(token, row.passcode), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: UNLOCK_SECONDS,
    })
    return res
  }

  // The pay step belongs to a signed document; everything else to an open one.
  if (action === 'pay') {
    if (state !== 'signed') return NextResponse.json({ error: 'This document has not been signed.' }, { status: 409 })
    if (!isUnlocked(req.headers.get('cookie'), token, row.passcode)) {
      return NextResponse.json({ error: 'Please enter your passcode first. Reload this page to do that.' }, { status: 401 })
    }
    const pay = await loadPayPanel(supabase, row)
    if (!pay) return NextResponse.json({ error: 'There is no deposit to pay on this document.' }, { status: 404 })
    return NextResponse.json(
      { html: payPanelHtml(pay), settled: depositSettled(pay), stage: pay.stage },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  if (state !== 'open') {
    return NextResponse.json({ error: CLOSED_MESSAGE[state] ?? 'This link can no longer be used.' }, { status: state === 'locked' ? 423 : 409 })
  }
  if (!isUnlocked(req.headers.get('cookie'), token, row.passcode)) {
    return NextResponse.json({ error: 'Please enter your passcode first. Reload this page to do that.' }, { status: 401 })
  }

  if (action === 'view') {
    if (!row.first_viewed_at) {
      // Only the request that records the first view tells the team, so a reload never alerts twice.
      const { data: opened } = await supabase
        .from('signing_requests')
        .update({ status: 'viewed', first_viewed_at: nowIso, updated_at: nowIso })
        .eq('id', row.id)
        .eq('status', 'sent')
        .is('first_viewed_at', null)
        .select('*')
        .maybeSingle()
      if (opened) after(() => afterOpened(supabase, opened as SigningRequestRow))
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

  // The Your details step: one set of rules (lib/signing/details.ts), run here
  // so the page has no copy of them. Nothing is saved until they sign.
  if (action === 'details') {
    const checked = cleanSignerDetails(body.details, now)
    if (!checked.ok) return NextResponse.json({ error: checked.error, field: checked.field }, { status: 400 })
    if (body.declared !== true) {
      return NextResponse.json({ error: 'Please tick the declaration to continue.', field: 'declaration' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, details: checked.details }, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  const CHOOSE_AGAIN = 'Please reload this page and choose Accept or Decline for each quote.'

  // Several quotes: the page shows the client what they chose, with the sums
  // done here (lib/signing/items.ts) so the page has no copy of them.
  if (action === 'review') {
    const items = await loadItems(supabase, row)
    const decisions = readDecisions(body.decisions, items.length)
    if (!decisions) return NextResponse.json({ error: CHOOSE_AGAIN }, { status: 400 })
    return NextResponse.json(
      { ok: true, summary: quotesSummary(withDecisions(items, decisions), row.deposit_percent) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  if (action === 'sign') {
    if (body.agreed !== true) {
      return NextResponse.json({ error: 'Please agree to sign electronically first.' }, { status: 400 })
    }
    // A page opened before the Your details step existed sends none.
    if (body.details == null) {
      return NextResponse.json({ error: 'Please reload this page and complete your details before signing.' }, { status: 400 })
    }
    const checked = cleanSignerDetails(body.details, now)
    if (!checked.ok) return NextResponse.json({ error: checked.error, field: checked.field }, { status: 400 })
    if (body.declared !== true) {
      return NextResponse.json({ error: 'Please tick the declaration to continue.', field: 'declaration' }, { status: 400 })
    }
    const signatureProblem = signaturePngError(body.signature)
    if (signatureProblem) return NextResponse.json({ error: signatureProblem }, { status: 400 })
    const method = body.method === 'typed' ? 'typed' : 'drawn'

    // What is being signed. One quote on the link: that quote. Several: the
    // ones the page says they accepted; the signature goes on each of those and
    // on no other, and the deposit is worked out on their total.
    const sent = await loadItems(supabase, row)
    const several = sent.length > 1
    let items = withDecisions(sent, null)
    if (several) {
      const decisions = readDecisions(body.decisions, sent.length)
      if (!decisions) return NextResponse.json({ error: CHOOSE_AGAIN }, { status: 400 })
      items = withDecisions(sent, decisions)
      const problem = decisionsProblem(items)
      if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    }
    const accepted = acceptedItems(items)
    // The name signed under is the legal name they declared. The declaration is
    // kept word for word, so later changes to the wording never alter this record.
    const name = checked.details.legalName
    const signerDetails: SignerDetails = {
      ...checked.details,
      declaration: { version: DECLARATION_VERSION, text: declarationText(row.brand_label), agreedAt: nowIso },
    }

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || (req.headers.get('x-real-ip') ?? '')
    const { data: updated, error } = await supabase
      .from('signing_requests')
      .update({
        status: 'signed',
        signed_at: nowIso,
        signer_name: name,
        signer_details: signerDetails,
        signature_png: body.signature as string,
        signature_method: method,
        signer_ip: ip.slice(0, 100) || null,
        signer_user_agent: (req.headers.get('user-agent') ?? '').slice(0, 500) || null,
        first_viewed_at: row.first_viewed_at ?? nowIso,
        consented_at: row.consented_at ?? nowIso,
        // From here the total on the link is the total of what was accepted,
        // so the deposit, the staff check and the pay step all work from it.
        ...(several ? { quote_total: totalOf(accepted) } : {}),
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

    // Only the request that recorded the signature writes the choices. With
    // several quotes they decide what was signed, so if they cannot be saved
    // the signature is taken back and the client is asked to try again.
    const saved = await saveDecisions(supabase, items, nowIso)
    if (!saved && several) {
      await supabase
        .from('signing_requests')
        .update({
          status: 'viewed',
          signed_at: null,
          signer_name: null,
          signer_details: null,
          signature_png: null,
          signature_method: null,
          quote_total: row.quote_total,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'signed')
        .eq('signed_at', signed.signed_at as string)
      return NextResponse.json({ error: 'Could not record your signature. Please try again.' }, { status: 500 })
    }

    const info = await recordAcceptance(supabase, signed, accepted)
    const links = await signingLinks(signed.trading_name, token)
    after(() => afterSigned(supabase, signed, items, info, { page: links.page, pdf: links.pdf }))

    // What the page says next: what was signed and where the copy is going,
    // and the deposit on what was accepted.
    const copyTo = signerEmail(signed)
    const signedLine = listLine(accepted.map(itemLine))
    const copies = accepted.length > 1 ? 'copies' : 'copy'
    const due = depositAmount(signed.quote_total, signed.deposit_percent)
    return NextResponse.json({
      ok: true,
      dateLabel: signedDateLabel(nowIso),
      copyLine: copyTo
        ? `Your signed ${copies} of ${signedLine} ${accepted.length > 1 ? 'are' : 'is'} being emailed to ${copyTo}.`
        : `Your signed ${copies} of ${signedLine} ${accepted.length > 1 ? 'are' : 'is'} ready.`,
      deposit: due != null && signed.deposit_percent != null
        ? { amountLabel: money(due), percentLabel: percentLabel(Number(signed.deposit_percent)) }
        : null,
    })
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
    // Declining the link declines every quote on it.
    const items = (await loadItems(supabase, declined)).map(i => ({ ...i, decision: 'declined' as const }))
    await saveDecisions(supabase, items, nowIso)
    after(() => afterDeclined(declined, items))
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
