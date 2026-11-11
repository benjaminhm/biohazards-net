/*
 * GET /sign/[token] — the client's private document link.
 *
 * Reached as document.<brand>.com.au/<token> where the brand has a document
 * host (proxy.ts rewrites it here), or as /sign/<token> on the app address.
 *
 * Public: the long random token in the link is the way in, and only its hash
 * is stored. A link staff sent themselves also asks for its passcode first.
 * Serves the document exactly as it was sent (not the live document). The link
 * is a funnel: the document is in view first, signing is the next step, and
 * once signed the same link shows the signed document, a download button and,
 * when a deposit was asked for, the pay step.
 *
 * A route handler rather than a page because the document is already a full
 * HTML page with its own print styles.
 *
 * Referrer-Policy: the document loads fonts and photos from other hosts, and
 * the link must not be passed to them in a Referer header.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  PASSCODE_LENGTH,
  docketTime,
  insertAtBodyEnd,
  isUnlocked,
  linkState,
  signedDateLabel,
} from '@/lib/signing/core'
import { depositAmount, money, percentLabel } from '@/lib/signing/pay'
import { findSigningRequestByToken, loadPayPanel, signedDocumentHtml } from '@/lib/signing/store'
import { passcodeGatePage, signedViewHtml, signingMessagePage, signingShellHtml } from '@/lib/signing/shell'

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

function page(html: string, status = 200): NextResponse {
  return new NextResponse(html, { status, headers: HEADERS })
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const row = await findSigningRequestByToken(supabase, token)
  if (!row) {
    return page(
      signingMessagePage('This link is not valid', 'Please check the link you were sent, or contact us and we will send a new one.'),
      404,
    )
  }

  const state = linkState(row, new Date())
  const contact = `Please contact ${row.brand_label} if you need a new one.`

  // These say nothing about the document, so they come before the passcode.
  if (state === 'voided') {
    return page(signingMessagePage('This link is no longer in use', `It has been replaced or cancelled. ${contact}`), 410)
  }
  if (state === 'expired') {
    return page(signingMessagePage('This link has expired', contact), 410)
  }
  if (state === 'locked') {
    return page(
      signingMessagePage('This link has been locked', `The wrong passcode was entered too many times. Please contact ${row.brand_label} for a new link.`),
      423,
    )
  }

  if (!isUnlocked(req.headers.get('cookie'), token, row.passcode)) {
    return page(passcodeGatePage({ token, brandLabel: row.brand_label, length: PASSCODE_LENGTH }))
  }

  if (state === 'declined') {
    return page(signingMessagePage('This document was declined', `${row.brand_label} has been told. If that was a mistake, please contact us.`))
  }

  // On a document host the signed copy is /<token>/pdf, so "sign" never shows in the address.
  const pdfUrl = req.headers.get('x-subdomain') === 'document' ? `/${token}/pdf` : `/api/sign/${token}/pdf`

  if (state === 'signed') {
    try {
      const signedHtml = signedDocumentHtml(row)
      const pay = await loadPayPanel(supabase, row).catch(err => {
        console.error('[signing] pay step failed to load', row.id, err)
        return null
      })
      return page(
        insertAtBodyEnd(
          signedHtml,
          signedViewHtml({
            token,
            pay,
            pdfUrl,
            brandLabel: row.brand_label,
            documentTitle: row.document_title,
            reference: row.reference,
            signerName: row.signer_name ?? row.to_name,
            signedAtLabel: docketTime(row.signed_at),
          }),
        ),
      )
    } catch (err) {
      console.error('[signing] signed view failed', row.id, err)
      return page(signingMessagePage('This document has been signed', 'Please contact us if you need a copy.'))
    }
  }

  const due = depositAmount(row.quote_total, row.deposit_percent)
  return page(
    insertAtBodyEnd(
      row.frozen_html,
      signingShellHtml({
        deposit: due != null && row.deposit_percent != null
          ? { amountLabel: money(due), percentLabel: percentLabel(Number(row.deposit_percent)) }
          : null,
        token,
        brandLabel: row.brand_label,
        documentTitle: row.document_title,
        reference: row.reference,
        toName: row.to_name,
        toEmail: row.to_email,
        pdfUrl,
        dateLabel: signedDateLabel(new Date().toISOString()),
        consented: Boolean(row.consented_at),
      }),
    ),
  )
}
