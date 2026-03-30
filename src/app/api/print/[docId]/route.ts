import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { buildPrintHTML } from '@/lib/printDocument'

export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params
  const supabase = createServiceClient()

  // Fetch the document record
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('*')
    .eq('id', docId)
    .single()

  if (docErr || !doc) {
    return new NextResponse('Document not found', { status: 404 })
  }

  // Fetch company profile
  const { data: company } = await supabase
    .from('company_profile')
    .select('*')
    .limit(1)
    .maybeSingle()

  // Fetch photos for the job
  const { data: photos } = await supabase
    .from('photos')
    .select('*')
    .eq('job_id', doc.job_id)
    .order('uploaded_at', { ascending: true })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'

  const html = buildPrintHTML(
    doc.type,
    doc.content ?? {},
    photos ?? [],
    company ?? null,
    doc.job_id,
    appUrl,
  )

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
