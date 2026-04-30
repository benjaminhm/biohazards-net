/*
 * app/api/print/[docId]/route.ts
 *
 * GET /api/print/[docId] — renders a document as a full HTML page.
 *
 * Publicly accessible — the URL is shared with clients via email/SMS.
 * On screen, an action bar provides Print/Save PDF, Email, Text Link, and
 * Copy Link buttons. In print media, the action bar is hidden via CSS.
 *
 * Fetches document, company profile, photos (for before/after grids), and
 * job client info in parallel. Passes all to buildPrintHTML() which returns
 * a complete HTML document string.
 *
 * Cache-Control: no-store prevents proxies from caching stale document versions.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { buildPrintHTML } from '@/lib/printDocument'
import {
  fetchQuoteLineItemsMergeContext,
  mergeQuoteLineItemsIntoDocContent,
} from '@/lib/quoteLineItemsForDocuments'
import type { DocType } from '@/lib/types'

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
    supabase
      .from('jobs')
      .select(
        'client_name,client_organization_name,client_email,client_phone,site_address,assessment_data',
      )
      .eq('id', doc.job_id)
      .single(),
  ])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const printUrl = `${appUrl}/api/print/${docId}`

  let docContent: Record<string, unknown> = (doc.content ?? {}) as Record<string, unknown>
  const docType = doc.type as DocType
  if (docType === 'quote' || docType === 'iaq_multi') {
    try {
      const { rows, gst_mode, add_gst_to_total, outcome_rows, outcome_mode, capture_fields } = await fetchQuoteLineItemsMergeContext(supabase, doc.job_id)
      docContent = mergeQuoteLineItemsIntoDocContent(docType, docContent, rows, { gst_mode, add_gst_to_total, outcome_rows, outcome_mode, capture_fields })
    } catch {
      /* keep stored content if quote tables unavailable */
    }
  }

  const html = buildPrintHTML(
    doc.type,
    docContent,
    photosRes.data ?? [],
    jobRes.data?.assessment_data?.areas ?? [],
    companyRes.data ?? null,
    doc.job_id,
    appUrl,
    { ...jobRes.data, site_address: jobRes.data?.site_address, printUrl },
  )

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
