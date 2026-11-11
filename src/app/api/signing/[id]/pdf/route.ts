/*
 * GET /api/signing/[id]/pdf — staff download of a signed copy (document plus
 * signature docket). Full-access staff only, own organisation only. The PDF is
 * read from private storage, or made again from the signing record if missing.
 */
import { NextResponse } from 'next/server'
import { guardFullAccessStaff } from '@/lib/fullAccessStaff'
import { ensureSignedPdf, signedPdfFilename } from '@/lib/signing/store'
import type { SigningRequestRow } from '@/lib/signing/store'

export const maxDuration = 60

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardFullAccessStaff(req)
  if (!guard.ok) return guard.response
  const { supabase, orgId } = guard
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data } = await supabase.from('signing_requests').select('*').eq('id', id).eq('org_id', orgId).maybeSingle()
  const row = data as SigningRequestRow | null
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.status !== 'signed') return NextResponse.json({ error: 'This document has not been signed.' }, { status: 409 })

  let pdf: Buffer
  try {
    pdf = await ensureSignedPdf(supabase, row)
  } catch (err) {
    console.error('[signing] staff PDF failed', id, err)
    return NextResponse.json({ error: 'The signed PDF could not be made. Please try again.' }, { status: 500 })
  }
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${signedPdfFilename(row)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
