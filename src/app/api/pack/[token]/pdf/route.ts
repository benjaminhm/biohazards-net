/*
 * GET /api/pack/[token]/pdf — download a document in the client's statement
 * pack as a PDF. ?doc=2 is the second document; without it, the statement.
 * Also reached as document.<brand>.com.au/p/<token>/pdf. Public; the token is
 * the credential, plus the passcode where the link has one.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { isUnlocked } from '@/lib/signing/core'
import { packItemIndex, packLinkState, packPaths, packPdfFilename } from '@/lib/documentPack'
import { ensurePackPdf, findPackByToken, loadPackItems } from '@/lib/documentPackStore'

export const maxDuration = 60

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const pack = await findPackByToken(supabase, token)
  if (!pack || packLinkState(pack, new Date()) !== 'open') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!isUnlocked(req.headers.get('cookie'), token, pack.passcode)) {
    // Opened in a new browser: go and enter the passcode, then download from there.
    const pagePath = packPaths(token, req.headers.get('x-subdomain') === 'document').page
    return new NextResponse(null, { status: 303, headers: { Location: pagePath, 'Cache-Control': 'private, no-store' } })
  }

  const items = await loadPackItems(supabase, pack.id)
  if (!items.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const item = items[packItemIndex(items.length, new URL(req.url).searchParams.get('doc'))]

  let pdf: Buffer
  try {
    pdf = await ensurePackPdf(supabase, pack, item)
  } catch (err) {
    console.error('[pack] PDF failed', pack.id, item.position, err)
    return NextResponse.json({ error: 'The PDF could not be made just now. Please try again in a minute.' }, { status: 500 })
  }
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${packPdfFilename(item)}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
