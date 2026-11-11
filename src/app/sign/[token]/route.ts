/*
 * GET /sign/[token] — the client's private signing link.
 *
 * Public: the long random token in the link is the only way in, and only its
 * hash is stored. Serves the document exactly as it was sent (not the live
 * document), with the signing controls around it. Once signed, the same link
 * shows the signed document and a download button.
 *
 * A route handler rather than a page because the document is already a full
 * HTML page with its own print styles.
 *
 * Referrer-Policy: the document loads fonts and photos from other hosts, and
 * the link must not be passed to them in a Referer header.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { insertAtBodyEnd, linkState, docketTime, signedDateLabel } from '@/lib/signing/core'
import { findSigningRequestByToken, signedDocumentHtml } from '@/lib/signing/store'
import { signedBannerHtml, signingMessagePage, signingShellHtml } from '@/lib/signing/shell'

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

function page(html: string, status = 200): NextResponse {
  return new NextResponse(html, { status, headers: HEADERS })
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const row = await findSigningRequestByToken(supabase, token)
  if (!row) {
    return page(
      signingMessagePage('This link is not valid', 'Please check the link in your email, or reply to that email and we will send a new one.'),
      404,
    )
  }

  const state = linkState(row, new Date())
  const contact = `Please reply to the email from ${row.brand_label} if you need a new one.`

  if (state === 'voided') {
    return page(signingMessagePage('This link is no longer in use', `It has been replaced or cancelled. ${contact}`), 410)
  }
  if (state === 'expired') {
    return page(signingMessagePage('This link has expired', contact), 410)
  }
  if (state === 'declined') {
    return page(signingMessagePage('This document was declined', `${row.brand_label} has been told. If that was a mistake, reply to the email you received.`))
  }

  if (state === 'signed') {
    try {
      return page(
        insertAtBodyEnd(
          signedDocumentHtml(row),
          signedBannerHtml({
            token,
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
      return page(signingMessagePage('This document has been signed', 'A signed copy was emailed to you.'))
    }
  }

  return page(
    insertAtBodyEnd(
      row.frozen_html,
      signingShellHtml({
        token,
        brandLabel: row.brand_label,
        documentTitle: row.document_title,
        reference: row.reference,
        toName: row.to_name,
        toEmail: row.to_email,
        dateLabel: signedDateLabel(new Date().toISOString()),
        consented: Boolean(row.consented_at),
      }),
    ),
  )
}
