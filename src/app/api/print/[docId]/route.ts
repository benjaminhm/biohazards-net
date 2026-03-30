import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { buildPrintHTML } from '@/lib/printDocument'

export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params
  const supabase = createServiceClient()

  const { data: doc, error: docErr } = await supabase
    .from('documents').select('*').eq('id', docId).single()

  if (docErr || !doc) {
    return new NextResponse('<h1 style="font-family:sans-serif;padding:40px">Document not found</h1>', {
      status: 404, headers: { 'Content-Type': 'text/html' },
    })
  }

  const [companyRes, photosRes, jobRes] = await Promise.all([
    supabase.from('company_profile').select('*').limit(1).maybeSingle(),
    supabase.from('photos').select('*').eq('job_id', doc.job_id).order('uploaded_at', { ascending: true }),
    supabase.from('jobs').select('client_name,client_email,client_phone').eq('id', doc.job_id).single(),
  ])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const printUrl = `${appUrl}/api/print/${docId}`

  const html = buildPrintHTML(
    doc.type,
    doc.content ?? {},
    photosRes.data ?? [],
    companyRes.data ?? null,
    doc.job_id,
    appUrl,
    { ...jobRes.data, printUrl },
  )

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
