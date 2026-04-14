/*
 * GET /api/print/bundle/[bundleId] — single HTML: ordered job documents stitched
 * between one branded header/footer (see buildComposedBundleHTML).
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { buildComposedBundleHTML } from '@/lib/printDocument'
import type { DocType } from '@/lib/types'

export async function GET(_req: Request, { params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params
  const supabase = createServiceClient()

  const { data: bundle, error: bErr } = await supabase
    .from('document_bundles')
    .select('*')
    .eq('id', bundleId)
    .single()

  if (bErr || !bundle) {
    return new NextResponse('<h1 style="font-family:sans-serif;padding:40px">Bundle not found</h1>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const jobId = bundle.job_id as string
  const ids = (bundle.part_document_ids as string[] | null) ?? []
  if (ids.length === 0) {
    return new NextResponse('<h1 style="font-family:sans-serif;padding:40px">Bundle has no parts</h1>', {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const [companyRes, photosRes, jobRes, docsRes] = await Promise.all([
    supabase.from('company_profile').select('*').limit(1).maybeSingle(),
    supabase.from('photos').select('*').eq('job_id', jobId).order('uploaded_at', { ascending: true }),
    supabase
      .from('jobs')
      .select(
        'client_name,client_organization_name,client_email,client_phone,assessment_data',
      )
      .eq('id', jobId)
      .single(),
    supabase.from('documents').select('*').eq('job_id', jobId).in('id', ids),
  ])

  const byId = new Map((docsRes.data ?? []).map(d => [d.id, d]))
  const parts: Array<{ type: DocType; content: Record<string, unknown> }> = []
  for (const uid of ids) {
    const d = byId.get(uid)
    if (!d) {
      return new NextResponse('<h1 style="font-family:sans-serif;padding:40px">Missing document in bundle</h1>', {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      })
    }
    parts.push({ type: d.type as DocType, content: (d.content ?? {}) as Record<string, unknown> })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const printUrl = `${appUrl}/api/print/bundle/${bundleId}`

  const html = buildComposedBundleHTML(
    parts,
    (bundle.title as string) || 'Composed document',
    photosRes.data ?? [],
    jobRes.data?.assessment_data?.areas ?? [],
    companyRes.data ?? null,
    jobId,
    appUrl,
    { ...jobRes.data, printUrl },
  )

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
