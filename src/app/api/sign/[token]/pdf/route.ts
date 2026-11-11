/*
 * GET /api/sign/[token]/pdf — the signer downloads their signed copy (document
 * plus signature docket) from their own private link. Public; the token is the
 * credential, and nothing is served until the document has been signed.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { ensureSignedPdf, findSigningRequestByToken, signedPdfFilename } from '@/lib/signing/store'

export const maxDuration = 60

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const row = await findSigningRequestByToken(supabase, token)
  if (!row || row.status !== 'signed') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let pdf: Buffer
  try {
    pdf = await ensureSignedPdf(supabase, row)
  } catch (err) {
    console.error('[signing] signer PDF failed', row.id, err)
    return NextResponse.json({ error: 'Your signed copy could not be made just now. Please try again in a minute.' }, { status: 500 })
  }
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${signedPdfFilename(row)}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
