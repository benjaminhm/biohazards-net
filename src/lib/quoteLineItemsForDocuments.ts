import type { SupabaseClient } from '@supabase/supabase-js'
import type { AreaPricingRow, AssessmentData, DocType, OutcomeQuoteRow, QuoteAuthorisation, QuoteGstMode, QuoteLineItemRow } from '@/lib/types'

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

export function quoteLineItemsContentPatch(
  rows: QuoteLineItemRow[],
  gstModeOrAddGst: QuoteGstMode | boolean = false,
  outcomeRows?: OutcomeQuoteRow[],
  outcomeMode?: 'outcomes' | 'line_items',
  captureFields?: QuoteCaptureFields,
  areaPricing?: AreaPricingRow[],
): Record<string, unknown> {
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
  const areaPricingSum = pricedAreaPricing.reduce((s, r) => s + Number(r.total || 0), 0)
  const lineOrOutcomeBase = lineItems.length
    ? lineItems.reduce((sum, row) => sum + Number(row.total || 0), 0)
    : pricedOutcomes.reduce((sum, row) => sum + Number(row.price || 0), 0)
  const subtotal = Math.round((lineOrOutcomeBase + areaPricingSum) * 100) / 100
  if (!lineItems.length && !(outcomeRows?.length) && pricedAreaPricing.length === 0) return {}
  const totals = computeQuoteTotals(subtotal, gstMode)
  const patch: Record<string, unknown> = {
    line_items: lineItems,
    outcome_rows: outcomeRows ?? [],
    outcome_mode: outcomeMode,
    area_pricing: pricedAreaPricing,
    gst_mode: gstMode,
    subtotal: totals.subtotal,
    gst: totals.gst,
    total: totals.total,
    intro: '',
  }
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
    options?.outcome_rows,
    options?.outcome_mode,
    options?.capture_fields,
    options?.area_pricing,
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
}

/** Active run + line items for merging into quote documents and print. */
export async function fetchQuoteLineItemsMergeContext(
  supabase: SupabaseClient,
  jobId: string,
): Promise<QuoteLineItemsMergeContext> {
  const { data: run, error: runErr } = await supabase
    .from('quote_line_item_runs')
    .select('*')
    .eq('job_id', jobId)
    .eq('is_active', true)
    .maybeSingle()
  if (runErr || !run) return { rows: [], gst_mode: 'no_gst', add_gst_to_total: false, outcome_rows: [], outcome_mode: 'line_items', capture_fields: {}, area_pricing: [] }

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
    return { rows: syntheticRows, gst_mode, add_gst_to_total, outcome_rows: outcomeRows, outcome_mode: 'outcomes', capture_fields, area_pricing }
  }

  if (capture?.mode === 'outcomes') {
    return { rows: dbRows, gst_mode, add_gst_to_total, outcome_rows: outcomeRows, outcome_mode: 'outcomes', capture_fields, area_pricing }
  }

  return { rows: dbRows, gst_mode, add_gst_to_total, outcome_rows: [], outcome_mode: 'line_items', capture_fields, area_pricing }
}

/** Active run line items for a job (service client; used by print and server merge). */
export async function fetchActiveQuoteLineItemsForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<QuoteLineItemRow[]> {
  const { rows } = await fetchQuoteLineItemsMergeContext(supabase, jobId)
  return rows
}
