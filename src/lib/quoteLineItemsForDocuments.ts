import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocType, QuoteLineItemRow } from '@/lib/types'

/** Map DB quote rows → quote document `line_items` + totals; clear placeholder intro when present. */
export function quoteLineItemsContentPatch(rows: QuoteLineItemRow[]): Record<string, unknown> {
  const lineItems = rows.map(row => ({
    description: row.description,
    qty: Number(row.qty || 0),
    unit: row.unit,
    rate: Number(row.rate || 0),
    total: Number(row.total || 0),
  }))
  const subtotal = Math.round(lineItems.reduce((sum, row) => sum + Number(row.total || 0), 0) * 100) / 100
  if (!lineItems.length) return {}
  return {
    line_items: lineItems,
    subtotal,
    gst: 0,
    total: subtotal,
    intro: '',
  }
}

/** Overlay active Quote Capture line items onto standalone quote or iaq_multi bundle quote part. */
export function mergeQuoteLineItemsIntoDocContent(
  docType: DocType,
  content: Record<string, unknown>,
  rows: QuoteLineItemRow[],
): Record<string, unknown> {
  const patch = quoteLineItemsContentPatch(rows)
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

/** Active run line items for a job (service client; used by print and server merge). */
export async function fetchActiveQuoteLineItemsForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<QuoteLineItemRow[]> {
  const { data: run, error: runErr } = await supabase
    .from('quote_line_item_runs')
    .select('id')
    .eq('job_id', jobId)
    .eq('is_active', true)
    .maybeSingle()
  if (runErr || !run) return []

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
  return (items ?? []) as QuoteLineItemRow[]
}
