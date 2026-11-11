/*
 * GET /api/sign/[token]/pdf — the signer downloads their signed copy (document
 * plus signature docket) from their own private link. Also reached as
 * document.<brand>.com.au/<token>/pdf. Public; the token is the credential,
 * plus the passcode where the link has one, and nothing is served until the
 * document has been signed.
 *
 * A link with several quotes has one signed copy for each quote the signer
 * accepted: ?doc=2 is the second quote on the link. Without it, the first
 * accepted quote. A declined quote has no signed copy.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { isUnlocked, linkState } from '@/lib/signing/core'
import { acceptedItems, pickItem, readDocNumber } from '@/lib/signing/items'
import { ensureSignedPdf, findSigningRequestByToken, loadItems, signedPdfFilename } from '@/lib/signing/store'

export const maxDuration = 60

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const row = await findSigningRequestByToken(supabase, token)
  if (!row || linkState(row, new Date()) !== 'signed') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!isUnlocked(req.headers.get('cookie'), token, row.passcode)) {
    // Opened from an email or a new browser: go and enter the passcode, then download from there.
    const pagePath = req.headers.get('x-subdomain') === 'document' ? `/${token}` : `/sign/${token}`
    return new NextResponse(null, { status: 303, headers: { Location: pagePath, 'Cache-Control': 'private, no-store' } })
  }

  const items = await loadItems(supabase, row)
  const wanted = readDocNumber(new URL(req.url).searchParams.get('doc'))
  const item = items[pickItem(items, wanted, true)]
  // Asked for a quote by number: it must be that quote, and one they accepted.
  if (!acceptedItems(items).includes(item) || (wanted != null && items[wanted - 1] !== item)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let pdf: Buffer
  try {
    pdf = await ensureSignedPdf(supabase, row, items, item)
  } catch (err) {
    console.error('[signing] signer PDF failed', row.id, err)
    return NextResponse.json({ error: 'Your signed copy could not be made just now. Please try again in a minute.' }, { status: 500 })
  }
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${signedPdfFilename(item)}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
