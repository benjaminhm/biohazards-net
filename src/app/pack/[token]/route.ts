/*
 * GET /pack/[token] — the client's statement pack (lib/documentPack.ts).
 *
 * Reached as document.<brand>.com.au/p/<token> where the brand has a document
 * host (proxy.ts rewrites it here), or as /pack/<token> on the app address.
 * Opens on the Statement of Accounts; ?doc=2 and on are the other documents
 * staff put in the pack. A bar above each links to the others and downloads
 * the one in view.
 *
 * Public: the token in the link is the way in, plus the passcode where the
 * link has one. Serves each document exactly as it was sent.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { PASSCODE_LENGTH, isUnlocked } from '@/lib/signing/core'
import { passcodeGatePage, signingMessagePage } from '@/lib/signing/shell'
import { insertAtBodyStart, packBarHtml, packItemIndex, packLinkState, packPaths } from '@/lib/documentPack'
import { findPackByToken, loadPackItemHtml, loadPackItems } from '@/lib/documentPackStore'

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
  const pack = await findPackByToken(supabase, token)
  if (!pack) {
    return page(
      signingMessagePage('This link is not valid', 'Please check the link you were sent, or contact us and we will send a new one.'),
      404,
    )
  }

  const contact = `Please contact ${pack.brand_label} if you need a new one.`
  const state = packLinkState(pack, new Date())
  if (state === 'voided') return page(signingMessagePage('This link is no longer in use', `It has been replaced or cancelled. ${contact}`), 410)
  if (state === 'expired') return page(signingMessagePage('This link has expired', contact), 410)
  if (state === 'locked') {
    return page(
      signingMessagePage('This link has been locked', `The wrong passcode was entered too many times. Please contact ${pack.brand_label} for a new link.`),
      423,
    )
  }

  const paths = packPaths(token, req.headers.get('x-subdomain') === 'document')
  if (!isUnlocked(req.headers.get('cookie'), token, pack.passcode)) {
    return page(passcodeGatePage({ token, brandLabel: pack.brand_label, length: PASSCODE_LENGTH, apiPath: paths.api }))
  }

  const items = await loadPackItems(supabase, pack.id)
  if (!items.length) return page(signingMessagePage('This link could not be opened', contact), 500)
  const at = packItemIndex(items.length, new URL(req.url).searchParams.get('doc'))

  let html: string
  try {
    html = await loadPackItemHtml(supabase, items[at])
  } catch (err) {
    console.error('[pack] document failed to load', pack.id, at, err)
    return page(signingMessagePage('This document could not be opened', `Please try again in a minute, or contact ${pack.brand_label}.`), 500)
  }

  // Reported from the page, not counted here, so a link checker opening the link is not taken for the client.
  const viewScript = `<script>try{fetch(${JSON.stringify(paths.api)},{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"view"}'})}catch(e){}</script>`
  return page(
    insertAtBodyStart(
      html,
      packBarHtml({ brandLabel: pack.brand_label, items, current: at, pagePath: paths.page, pdfPath: paths.pdf }) + viewScript,
    ),
  )
}
