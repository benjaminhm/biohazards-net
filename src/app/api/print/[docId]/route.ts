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

/** True when a saved doc already carries a spoke `quote_id` (a frozen snapshot). */
function docHasQuoteId(docType: DocType, content: Record<string, unknown>): boolean {
  if (docType === 'quote') return typeof content.quote_id === 'string' && content.quote_id.length > 0
  if (docType === 'iaq_multi') {
    const parts = content.parts
    if (!Array.isArray(parts)) return false
    return parts.some(p => {
      const part = p as { type?: string; content?: { quote_id?: unknown } }
      return part?.type === 'quote' && typeof part.content?.quote_id === 'string' && part.content.quote_id.length > 0
    })
  }
  return false
}

/** Doc types whose printed output contains photo sections that can be toggled. */
const PHOTO_TOGGLE_TYPES: DocType[] = ['quote', 'report', 'assessment_document', 'iaq_multi']

/** Force the photo-inclusion flag on a doc's content (and any nested bundle parts). */
function applyIncludePhotos(docType: DocType, content: Record<string, unknown>, on: boolean): void {
  if (docType === 'iaq_multi') {
    const parts = content.parts
    if (Array.isArray(parts)) {
      for (const p of parts) {
        const part = p as { type?: DocType; content?: Record<string, unknown> }
        if (part?.content && part.type && PHOTO_TOGGLE_TYPES.includes(part.type)) {
          part.content.include_photos = on
        }
      }
    }
    return
  }
  content.include_photos = on
}

/**
 * Each builder has its own default when `include_photos` is unset: assessment
 * documents default OFF (opt-in), quotes/reports default ON. Mirror that so the
 * toggle label reflects reality without mutating stored content.
 */
function defaultPhotosOn(docType: DocType, content: Record<string, unknown>): boolean {
  if (docType === 'assessment_document') return content.include_photos === true
  if (docType === 'iaq_multi') {
    const parts = content.parts
    if (!Array.isArray(parts)) return false
    return parts.some(p => {
      const part = p as { type?: DocType; content?: Record<string, unknown> }
      if (!part?.content || !part.type) return false
      if (part.type === 'assessment_document') return part.content.include_photos === true
      return PHOTO_TOGGLE_TYPES.includes(part.type) && part.content.include_photos !== false
    })
  }
  return content.include_photos !== false
}

export async function GET(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params
  const imagesParam = new URL(req.url).searchParams.get('images')
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
  // Spoke-based quote documents (carrying quote_id) are frozen snapshots — render
  // their stored content as-is. Only legacy quotes re-merge the live capture.
  const isFrozenSpokeQuote = docHasQuoteId(docType, docContent)
  if ((docType === 'quote' || docType === 'iaq_multi') && !isFrozenSpokeQuote) {
    try {
      const ctx = await fetchQuoteLineItemsMergeContext(supabase, doc.job_id)
      docContent = mergeQuoteLineItemsIntoDocContent(docType, docContent, ctx.rows, {
        gst_mode: ctx.gst_mode,
        add_gst_to_total: ctx.add_gst_to_total,
        outcome_rows: ctx.outcome_rows,
        outcome_mode: ctx.outcome_mode,
        capture_fields: ctx.capture_fields,
        area_pricing: ctx.area_pricing,
        area_pricing_terms: ctx.area_pricing_terms,
        area_pricing_section_total: ctx.area_pricing_section_total,
        outcomes_section_terms: ctx.outcomes_section_terms,
        volume_pricing: ctx.volume_pricing,
        volume_pricing_section_total: ctx.volume_pricing_section_total,
        volume_disposal_fee_mode: ctx.volume_disposal_fee_mode,
        volume_disposal_fee_per_tonne: ctx.volume_disposal_fee_per_tonne,
        volume_pricing_terms: ctx.volume_pricing_terms,
        pricing_layout: ctx.pricing_layout,
        global_mobilisation_fee: ctx.global_mobilisation_fee,
        global_surface_rate_per_m2: ctx.global_surface_rate_per_m2,
        global_contents_rate_per_m3: ctx.global_contents_rate_per_m3,
      })
    } catch {
      /* keep stored content if quote tables unavailable */
    }
  }

  // Images On/Off: an explicit ?images= override mutates the content (so the
  // printed/saved PDF reflects it); with no param we leave content untouched and
  // just report the builder's stored default for the toggle label.
  const photoToggleSupported = PHOTO_TOGGLE_TYPES.includes(docType)
  let photosOn: boolean
  if (imagesParam === 'on' || imagesParam === 'off') {
    photosOn = imagesParam === 'on'
    if (photoToggleSupported) applyIncludePhotos(docType, docContent, photosOn)
  } else {
    photosOn = defaultPhotosOn(docType, docContent)
  }

  const html = buildPrintHTML(
    doc.type,
    docContent,
    photosRes.data ?? [],
    jobRes.data?.assessment_data?.areas ?? [],
    companyRes.data ?? null,
    doc.job_id,
    appUrl,
    { ...jobRes.data, site_address: jobRes.data?.site_address, printUrl, photoToggleSupported, photosOn },
  )

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
