import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssessmentData, DocType, OutcomeQuoteRow, QuoteAuthorisation, QuoteLineItemRow } from '@/lib/types'

export interface QuoteCaptureFields {
  notes?: string
  payment_terms?: string
  validity?: string
  authorisation?: QuoteAuthorisation
}

/** Map DB quote rows → quote document `line_items` + totals; clear placeholder intro when present. */
export function quoteLineItemsContentPatch(
  rows: QuoteLineItemRow[],
  addGstToTotal = false,
  outcomeRows?: OutcomeQuoteRow[],
  outcomeMode?: 'outcomes' | 'line_items',
  captureFields?: QuoteCaptureFields,
): Record<string, unknown> {
  const lineItems = rows.map(row => ({
    description: row.description,
    qty: Number(row.qty || 0),
    unit: row.unit,
    rate: Number(row.rate || 0),
    total: Number(row.total || 0),
  }))
  const pricedOutcomes = (outcomeRows ?? []).filter(row => Number(row.price || 0) > 0)
  const subtotalBase = lineItems.length
    ? lineItems.reduce((sum, row) => sum + Number(row.total || 0), 0)
    : pricedOutcomes.reduce((sum, row) => sum + Number(row.price || 0), 0)
  const subtotal = Math.round(subtotalBase * 100) / 100
  if (!lineItems.length && !(outcomeRows?.length)) return {}
  const gst = addGstToTotal ? Math.round(subtotal * 0.1 * 100) / 100 : 0
  const total = Math.round((subtotal + gst) * 100) / 100
  const patch: Record<string, unknown> = {
    line_items: lineItems,
    outcome_rows: outcomeRows ?? [],
    outcome_mode: outcomeMode,
    subtotal,
    gst,
    total,
    intro: '',
  }
  if (captureFields?.notes) patch.notes = captureFields.notes
  if (captureFields?.payment_terms) patch.payment_terms = captureFields.payment_terms
  if (captureFields?.validity) patch.validity = captureFields.validity
  if (captureFields?.authorisation) patch.authorisation = captureFields.authorisation
  return patch
}

export interface MergeQuoteLineItemsOptions {
  add_gst_to_total?: boolean
  outcome_rows?: OutcomeQuoteRow[]
  outcome_mode?: 'outcomes' | 'line_items'
  capture_fields?: QuoteCaptureFields
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
    options?.add_gst_to_total === true,
    options?.outcome_rows,
    options?.outcome_mode,
    options?.capture_fields,
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
  add_gst_to_total: boolean
  outcome_rows: OutcomeQuoteRow[]
  outcome_mode: 'outcomes' | 'line_items'
  capture_fields: QuoteCaptureFields
}

/** Active run + line items for merging into quote documents and print. */
export async function fetchQuoteLineItemsMergeContext(
  supabase: SupabaseClient,
  jobId: string,
): Promise<QuoteLineItemsMergeContext> {
  const { data: run, error: runErr } = await supabase
    .from('quote_line_item_runs')
    .select('id, add_gst_to_total')
    .eq('job_id', jobId)
    .eq('is_active', true)
    .maybeSingle()
  if (runErr || !run) return { rows: [], add_gst_to_total: false, outcome_rows: [], outcome_mode: 'line_items', capture_fields: {} }

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
  const add_gst_to_total = Boolean(run.add_gst_to_total)
  const dbRows = (items ?? []) as QuoteLineItemRow[]

  const { data: job } = await supabase
    .from('jobs')
    .select('assessment_data')
    .eq('id', jobId)
    .maybeSingle()

  const ad = (job?.assessment_data ?? null) as AssessmentData | null
  const capture = ad?.outcome_quote_capture
  const outcomeRows = (capture?.rows ?? []) as OutcomeQuoteRow[]

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
    return { rows: syntheticRows, add_gst_to_total, outcome_rows: outcomeRows, outcome_mode: 'outcomes', capture_fields }
  }

  if (capture?.mode === 'outcomes') {
    return { rows: dbRows, add_gst_to_total, outcome_rows: outcomeRows, outcome_mode: 'outcomes', capture_fields }
  }

  return { rows: dbRows, add_gst_to_total, outcome_rows: [], outcome_mode: 'line_items', capture_fields }
}

/** Active run line items for a job (service client; used by print and server merge). */
export async function fetchActiveQuoteLineItemsForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<QuoteLineItemRow[]> {
  const { rows } = await fetchQuoteLineItemsMergeContext(supabase, jobId)
  return rows
}
