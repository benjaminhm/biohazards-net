/*
 * app/api/pdf/route.ts
 *
 * POST /api/pdf — renders a document as a downloadable PDF binary via
 * @react-pdf/renderer.
 *
 * This is an alternative to the HTML print route — produces a true PDF file
 * rather than relying on browser print-to-PDF. Supports quote, sow, report,
 * and iaq_multi (Assessment / Scope / Quote bundle) via PDFDocument.tsx.
 *
 * runtime = 'nodejs' is required because @react-pdf/renderer uses Node.js
 * APIs incompatible with the Edge runtime.
 *
 * The renderer is imported via require() rather than import because it uses
 * CommonJS exports that cause issues with Next.js ESM bundling.
 */
import { NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToBuffer } = require('@react-pdf/renderer')
import { createElement } from 'react'
import { JobPDFDocument } from '@/components/PDFDocument'
import { createServiceClient } from '@/lib/supabase'
import {
  fetchQuoteLineItemsMergeContext,
  mergeQuoteLineItemsIntoDocContent,
} from '@/lib/quoteLineItemsForDocuments'
import type { DocType } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const { type, content, jobId } = await req.json() as {
      type: DocType
      content: object
      jobId: string
    }

    if (!type || !content) {
      return NextResponse.json({ error: 'Missing type or content' }, { status: 400 })
    }

    const supabase = createServiceClient()
    let mergedContent: Record<string, unknown> = { ...(content as Record<string, unknown>) }
    if (
      jobId &&
      (type === 'quote' || type === 'iaq_multi')
    ) {
      try {
        const { rows, add_gst_to_total, outcome_rows, outcome_mode, capture_fields } = await fetchQuoteLineItemsMergeContext(supabase, jobId)
        mergedContent = mergeQuoteLineItemsIntoDocContent(type, mergedContent, rows, { add_gst_to_total, outcome_rows, outcome_mode, capture_fields })
      } catch {
        /* use client content */
      }
    }

    const [photosRes, companyRes, jobRes] = await Promise.all([
      jobId
        ? supabase.from('photos').select('*').eq('job_id', jobId).order('uploaded_at', { ascending: true })
        : Promise.resolve({ data: [] }),
      supabase.from('company_profile').select('*').limit(1).maybeSingle(),
      jobId
        ? supabase.from('jobs').select('assessment_data,site_address').eq('id', jobId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer: Buffer = await renderToBuffer(createElement(JobPDFDocument as any, {
      type,
      content: mergedContent,
      photos: photosRes.data ?? [],
      company: companyRes.data ?? null,
      jobId,
      areas: jobRes.data?.assessment_data?.areas ?? [],
      siteAddress: jobRes.data?.site_address ?? undefined,
    } as any))

    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${type}-${jobId?.slice(0, 8) ?? 'doc'}.pdf"`,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
