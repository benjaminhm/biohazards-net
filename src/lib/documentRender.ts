/*
 * lib/documentRender.ts
 *
 * Turns a saved `documents` row into a full HTML page.
 *
 * Extracted from api/print/[docId] so the commercial accounts portal can serve
 * the same rendering behind its own session guard instead of sending clients to
 * the public print URL. Both entry points must produce identical output; the only
 * difference is authorisation and which action-bar buttons make sense.
 */
import { applyTradingBrand, isTradingNameId } from '@/lib/tradingNames'
import { buildPrintHTML } from '@/lib/printDocument'
import {
  fetchQuoteLineItemsMergeContext,
  mergeQuoteLineItemsIntoDocContent,
} from '@/lib/quoteLineItemsForDocuments'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocType } from '@/lib/types'

/** True when a saved doc already carries a spoke `quote_id` (a frozen snapshot). */
export function docHasQuoteId(docType: DocType, content: Record<string, unknown>): boolean {
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
export const PHOTO_TOGGLE_TYPES: DocType[] = ['quote', 'report', 'assessment_document', 'iaq_multi']

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

export interface DocumentRow {
  id: string
  job_id: string
  type: string
  content: Record<string, unknown> | null
}

export interface RenderDocumentOptions {
  supabase: SupabaseClient
  doc: DocumentRow
  /** `?images=on|off` when the viewer toggled photos, otherwise null. */
  imagesParam: string | null
  /** URL the action bar's Copy Link / Images toggle should point at. */
  viewerUrl: string
  /**
   * Include the client's own email and phone, which adds Email and Text Link
   * buttons to the action bar. Useful for staff sending a document; pointless in
   * the client's own portal, where they are the recipient.
   */
  includeClientContact: boolean
}

/** Fetch everything a document needs and return the rendered HTML page. */
export async function renderDocumentHtml(options: RenderDocumentOptions): Promise<string> {
  const { supabase, doc, imagesParam, viewerUrl, includeClientContact } = options

  const [companyRes, photosRes, jobRes] = await Promise.all([
    supabase.from('company_profile').select('*').limit(1).maybeSingle(),
    supabase.from('photos').select('*').eq('job_id', doc.job_id).order('uploaded_at', { ascending: true }),
    supabase
      .from('jobs')
      .select(
        'client_name,client_organization_name,client_email,client_phone,site_address,assessment_data,trading_name',
      )
      .eq('id', doc.job_id)
      .single(),
  ])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.biohazards.net'
  const tradingName = isTradingNameId(jobRes.data?.trading_name) ? jobRes.data.trading_name : null
  const company = applyTradingBrand(companyRes.data ?? null, tradingName)

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
        custom_section_title: ctx.custom_section_title,
        custom_section_rows: ctx.custom_section_rows,
        custom_section_total: ctx.custom_section_total,
        custom_section_terms: ctx.custom_section_terms,
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

  const job = jobRes.data

  return buildPrintHTML(
    doc.type as DocType,
    docContent,
    photosRes.data ?? [],
    job?.assessment_data?.areas ?? [],
    company,
    doc.job_id,
    appUrl,
    {
      client_name: job?.client_name,
      client_organization_name: job?.client_organization_name,
      client_email: includeClientContact ? job?.client_email : undefined,
      client_phone: includeClientContact ? job?.client_phone : undefined,
      site_address: job?.site_address,
      printUrl: viewerUrl,
      photoToggleSupported,
      photosOn,
    },
  )
}
