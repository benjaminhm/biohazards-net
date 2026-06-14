import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AreaPricingRow,
  AssessmentData,
  DocType,
  OutcomeQuoteRow,
  QuoteAuthorisation,
  QuoteGstMode,
  QuoteLineItemRow,
  QuotePricingLayout,
  SectionTerms,
  VolumePricingBlock,
} from '@/lib/types'
import { collectExcludedSurfaces } from '@/lib/areaSurfaces'
import {
  areaPricingHasContent,
  areaPricingSectionSubtotal,
  derivePricingLayoutFromCapture,
  normalizeSectionTerms,
  recomputeVolumePricingTotal,
  volumePricingHasContent,
  volumePricingSubtotal,
} from '@/lib/quoteSections'

export interface QuoteCaptureFields {
  notes?: string
  payment_terms?: string
  validity?: string
  authorisation?: QuoteAuthorisation
}

/** Map DB quote rows → quote document `line_items` + totals; clear placeholder intro when present. */
function normalizeGstMode(mode?: unknown, addGstToTotal = false): QuoteGstMode {
  if (mode === 'no_gst' || mode === 'inclusive' || mode === 'exclusive') return mode
  return addGstToTotal ? 'exclusive' : 'no_gst'
}

function computeQuoteTotals(amount: number, gstMode: QuoteGstMode) {
  const lineSum = Math.round(amount * 100) / 100
  if (gstMode === 'exclusive') {
    const gst = Math.round(lineSum * 0.1 * 100) / 100
    return { subtotal: lineSum, gst, total: Math.round((lineSum + gst) * 100) / 100 }
  }
  if (gstMode === 'inclusive') {
    const gst = Math.round((lineSum / 11) * 100) / 100
    return { subtotal: Math.round((lineSum - gst) * 100) / 100, gst, total: lineSum }
  }
  return { subtotal: lineSum, gst: 0, total: lineSum }
}

export interface QuoteContentPatchInputs {
  outcomeRows?: OutcomeQuoteRow[]
  outcomeMode?: 'outcomes' | 'line_items'
  captureFields?: QuoteCaptureFields
  areaPricing?: AreaPricingRow[]
  areaPricingTerms?: SectionTerms
  areaPricingSectionTotal?: number
  volumePricing?: VolumePricingBlock
  volumePricingTerms?: SectionTerms
  pricingLayout?: QuotePricingLayout
  globalMobilisationFee?: number
  globalSurfaceRatePerM2?: number
  globalContentsRatePerM3?: number
}

export function quoteLineItemsContentPatch(
  rows: QuoteLineItemRow[],
  gstModeOrAddGst: QuoteGstMode | boolean = false,
  inputs: QuoteContentPatchInputs = {},
): Record<string, unknown> {
  const {
    outcomeRows,
    outcomeMode,
    captureFields,
    areaPricing,
    areaPricingTerms,
    areaPricingSectionTotal,
    volumePricing,
    volumePricingTerms,
    pricingLayout,
    globalMobilisationFee,
    globalSurfaceRatePerM2,
    globalContentsRatePerM3,
  } = inputs
  const gstMode = typeof gstModeOrAddGst === 'string' ? gstModeOrAddGst : normalizeGstMode(null, gstModeOrAddGst)
  const lineItems = rows.map(row => ({
    description: row.description,
    qty: Number(row.qty || 0),
    unit: row.unit,
    rate: Number(row.rate || 0),
    total: Number(row.total || 0),
  }))
  const pricedOutcomes = (outcomeRows ?? []).filter(row => Number(row.price || 0) > 0)
  const pricedAreaPricing = (areaPricing ?? []).filter(row => Number(row.total || 0) > 0)
  const refreshedVolume = volumePricing ? recomputeVolumePricingTotal(volumePricing) : undefined
  const volumeIncluded = refreshedVolume && volumePricingHasContent(refreshedVolume)
    ? refreshedVolume
    : undefined
  const baseMobilisationFee = Math.max(0, Number(globalMobilisationFee || 0))

  // Layout defaults: enable any section that has data unless an explicit layout disables it.
  const effectiveLayout: QuotePricingLayout = pricingLayout ?? {
    outcomes_enabled: baseMobilisationFee > 0 || lineItems.length > 0 || pricedOutcomes.length > 0,
    per_sqm_enabled: areaPricingHasContent(areaPricing, areaPricingSectionTotal),
    per_m3_enabled: !!volumeIncluded,
  }

  // Section sums — disabled sections contribute 0 even if data is present.
  // The doc renderer (renderOutcomeSection) shows EVERY outcome row with its
  // price regardless of status, so in 'outcomes' mode the subtotal must sum
  // every priced outcome too. Otherwise approved=1/suggested=N quotes display
  // all the prices but the subtotal only counts the approved ones, and the
  // numbers don't add up. In 'line_items' mode the rendered list is the
  // line_items table, so we sum that.
  const outcomesSum = effectiveLayout.outcomes_enabled
    ? baseMobilisationFee + (outcomeMode === 'outcomes'
        ? pricedOutcomes.reduce((sum, row) => sum + Number(row.price || 0), 0)
        : (lineItems.length
            ? lineItems.reduce((sum, row) => sum + Number(row.total || 0), 0)
            : pricedOutcomes.reduce((sum, row) => sum + Number(row.price || 0), 0)))
    : 0
  const areaPricingSum = effectiveLayout.per_sqm_enabled
    ? areaPricingSectionSubtotal(areaPricing, areaPricingSectionTotal)
    : 0
  const volumeSum = effectiveLayout.per_m3_enabled ? volumePricingSubtotal(volumeIncluded) : 0

  const subtotal = Math.round((outcomesSum + areaPricingSum + volumeSum) * 100) / 100
  const noData = !lineItems.length
    && !(outcomeRows?.length)
    && areaPricingSum <= 0
    && !volumeIncluded
    && baseMobilisationFee <= 0
  if (noData) return {}

  const totals = computeQuoteTotals(subtotal, gstMode)
  const autoExcludedSurfaces = effectiveLayout.per_sqm_enabled
    ? collectExcludedSurfaces(pricedAreaPricing)
    : []
  const cleanAreaTerms = effectiveLayout.per_sqm_enabled ? normalizeSectionTerms(areaPricingTerms) : undefined
  const cleanVolumeTerms = effectiveLayout.per_m3_enabled ? normalizeSectionTerms(volumePricingTerms) : undefined

  const patch: Record<string, unknown> = {
    line_items: effectiveLayout.outcomes_enabled ? lineItems : [],
    outcome_rows: effectiveLayout.outcomes_enabled ? (outcomeRows ?? []) : [],
    outcome_mode: outcomeMode,
    area_pricing: effectiveLayout.per_sqm_enabled ? pricedAreaPricing : [],
    auto_excluded_surfaces: autoExcludedSurfaces,
    pricing_layout: effectiveLayout,
    global_mobilisation_fee: baseMobilisationFee,
    global_surface_rate_per_m2: Math.max(0, Number(globalSurfaceRatePerM2 || 0)),
    global_contents_rate_per_m3: Math.max(0, Number(globalContentsRatePerM3 || 0)),
    gst_mode: gstMode,
    subtotal: totals.subtotal,
    gst: totals.gst,
    total: totals.total,
    intro: '',
  }
  if (cleanAreaTerms) patch.area_pricing_terms = cleanAreaTerms
  if (effectiveLayout.per_sqm_enabled && Number(areaPricingSectionTotal || 0) > 0) {
    patch.area_pricing_section_total = Math.max(0, Number(areaPricingSectionTotal || 0))
  }
  if (volumeIncluded && effectiveLayout.per_m3_enabled) patch.volume_pricing = volumeIncluded
  if (cleanVolumeTerms) patch.volume_pricing_terms = cleanVolumeTerms
  if (captureFields?.notes) patch.notes = captureFields.notes
  if (captureFields?.payment_terms) patch.payment_terms = captureFields.payment_terms
  if (captureFields?.validity) patch.validity = captureFields.validity
  if (captureFields?.authorisation) patch.authorisation = captureFields.authorisation
  return patch
}

export interface MergeQuoteLineItemsOptions {
  gst_mode?: QuoteGstMode | null
  add_gst_to_total?: boolean
  outcome_rows?: OutcomeQuoteRow[]
  outcome_mode?: 'outcomes' | 'line_items'
  capture_fields?: QuoteCaptureFields
  area_pricing?: AreaPricingRow[]
  area_pricing_terms?: SectionTerms
  area_pricing_section_total?: number
  volume_pricing?: VolumePricingBlock
  volume_pricing_terms?: SectionTerms
  pricing_layout?: QuotePricingLayout
  global_mobilisation_fee?: number
  global_surface_rate_per_m2?: number
  global_contents_rate_per_m3?: number
}

/** Overlay active Quote Capture line items onto standalone quote or iaq_multi bundle quote part. */
export function mergeQuoteLineItemsIntoDocContent(
  docType: DocType,
  content: Record<string, unknown>,
  rows: QuoteLineItemRow[],
  options?: MergeQuoteLineItemsOptions,
): Record<string, unknown> {
  const patch = quoteLineItemsContentPatch(
    rows,
    normalizeGstMode(options?.gst_mode, options?.add_gst_to_total === true),
    {
      outcomeRows: options?.outcome_rows,
      outcomeMode: options?.outcome_mode,
      captureFields: options?.capture_fields,
      areaPricing: options?.area_pricing,
      areaPricingTerms: options?.area_pricing_terms,
      areaPricingSectionTotal: options?.area_pricing_section_total,
      volumePricing: options?.volume_pricing,
      volumePricingTerms: options?.volume_pricing_terms,
      pricingLayout: options?.pricing_layout,
      globalMobilisationFee: options?.global_mobilisation_fee,
      globalSurfaceRatePerM2: options?.global_surface_rate_per_m2,
      globalContentsRatePerM3: options?.global_contents_rate_per_m3,
    },
  )
  if (Object.keys(patch).length === 0) return content
  if (docType === 'quote') {
    return { ...content, ...patch }
  }
  if (docType === 'iaq_multi') {
    const partsRaw = content.parts
    if (!Array.isArray(partsRaw)) return content
    const parts = partsRaw.map(part => {
      if (!part || typeof part !== 'object') return part
      const p = part as { type?: string; content?: Record<string, unknown> }
      if (p.type !== 'quote' || !p.content) return part
      return {
        ...p,
        content: {
          ...p.content,
          ...patch,
        },
      }
    })
    return { ...content, parts }
  }
  return content
}

export interface QuoteLineItemsMergeContext {
  rows: QuoteLineItemRow[]
  gst_mode: QuoteGstMode
  add_gst_to_total: boolean
  outcome_rows: OutcomeQuoteRow[]
  outcome_mode: 'outcomes' | 'line_items'
  capture_fields: QuoteCaptureFields
  area_pricing: AreaPricingRow[]
  area_pricing_terms?: SectionTerms
  volume_pricing?: VolumePricingBlock
  volume_pricing_terms?: SectionTerms
  pricing_layout?: QuotePricingLayout
  global_mobilisation_fee?: number
  global_surface_rate_per_m2?: number
  global_contents_rate_per_m3?: number
}

/** Active run + line items for merging into quote documents and print. */
export async function fetchQuoteLineItemsMergeContext(
  supabase: SupabaseClient,
  jobId: string,
): Promise<QuoteLineItemsMergeContext> {
  const empty: QuoteLineItemsMergeContext = {
    rows: [],
    gst_mode: 'no_gst',
    add_gst_to_total: false,
    outcome_rows: [],
    outcome_mode: 'line_items',
    capture_fields: {},
    area_pricing: [],
  }

  const { data: run, error: runErr } = await supabase
    .from('quote_line_item_runs')
    .select('*')
    .eq('job_id', jobId)
    .eq('is_active', true)
    .maybeSingle()
  if (runErr || !run) return empty

  const { data: items, error } = await supabase
    .from('quote_line_items')
    .select('*')
    .eq('run_id', run.id)
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('room_name', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  const gst_mode = normalizeGstMode((run as { gst_mode?: unknown }).gst_mode, Boolean(run.add_gst_to_total))
  const add_gst_to_total = gst_mode === 'exclusive'
  const dbRows = (items ?? []) as QuoteLineItemRow[]

  const { data: job } = await supabase
    .from('jobs')
    .select('assessment_data')
    .eq('id', jobId)
    .maybeSingle()

  const ad = (job?.assessment_data ?? null) as AssessmentData | null
  const capture = ad?.outcome_quote_capture
  const outcomeRows = (capture?.rows ?? []) as OutcomeQuoteRow[]
  const area_pricing = (capture?.area_pricing ?? []).filter(r => Number(r.total ?? 0) > 0) as AreaPricingRow[]
  const area_pricing_terms = capture?.area_pricing_terms
  const volume_pricing = capture?.volume_pricing && volumePricingHasContent(capture.volume_pricing)
    ? capture.volume_pricing
    : undefined
  const volume_pricing_terms = capture?.volume_pricing_terms
  const pricing_layout = derivePricingLayoutFromCapture(capture)
  const global_mobilisation_fee = Math.max(0, Number(capture?.global_mobilisation_fee || 0))
  const global_surface_rate_per_m2 = Math.max(0, Number(capture?.global_surface_rate_per_m2 || 0))
  const global_contents_rate_per_m3 = Math.max(0, Number(capture?.global_contents_rate_per_m3 || 0))

  const area_pricing_section_total = Math.max(0, Number(capture?.area_pricing_section_total || 0))

  const capture_fields: QuoteCaptureFields = {
    notes: capture?.notes ?? '',
    payment_terms: ad?.payment_terms ?? '',
    validity: capture?.validity ?? '',
    authorisation: capture?.authorisation,
  }

  const approvedOutcomes = outcomeRows.filter(
    row =>
      (row.status === 'approved' || row.status === 'edited') &&
      row.price > 0 &&
      row.outcome_title.trim()
  )

  const baseExtras = {
    area_pricing_terms,
    area_pricing_section_total: area_pricing_section_total > 0 ? area_pricing_section_total : undefined,
    volume_pricing,
    volume_pricing_terms,
    pricing_layout,
    global_mobilisation_fee,
    global_surface_rate_per_m2,
    global_contents_rate_per_m3,
  }

  if (capture?.mode === 'outcomes' && approvedOutcomes.length > 0) {
    const syntheticRows: QuoteLineItemRow[] = approvedOutcomes.map((row, idx) => ({
      id: `outcome_${idx + 1}`,
      run_id: run.id,
      org_id: '',
      job_id: jobId,
      room_name: row.areas.join(', ') || 'Outcome package',
      description: `${row.outcome_title}${row.outcome_description ? ` — ${row.outcome_description}` : ''}`,
      qty: 1,
      unit: 'lot',
      rate: Number(row.price),
      total: Number(row.price),
      sort_order: idx,
      source: 'ai',
      created_at: '',
      updated_at: '',
      created_by_user_id: '',
      updated_by_user_id: '',
      deleted_at: null,
    }))
    return { rows: syntheticRows, gst_mode, add_gst_to_total, outcome_rows: outcomeRows, outcome_mode: 'outcomes', capture_fields, area_pricing, ...baseExtras }
  }

  if (capture?.mode === 'outcomes') {
    return { rows: dbRows, gst_mode, add_gst_to_total, outcome_rows: outcomeRows, outcome_mode: 'outcomes', capture_fields, area_pricing, ...baseExtras }
  }

  return { rows: dbRows, gst_mode, add_gst_to_total, outcome_rows: [], outcome_mode: 'line_items', capture_fields, area_pricing, ...baseExtras }
}

/** Active run line items for a job (service client; used by print and server merge). */
export async function fetchActiveQuoteLineItemsForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<QuoteLineItemRow[]> {
  const { rows } = await fetchQuoteLineItemsMergeContext(supabase, jobId)
  return rows
}
