/*
 * lib/quoteSections.ts
 *
 * Helpers for the three quote pricing sections:
 *
 *   1. Mobilisation, Fees & Fixed-Rate Items  (value-based; OutcomeQuoteRow[])
 *   2. Contents Removal                       (per-m³;       VolumePricingBlock)
 *   3. Remediation, Cleaning & Sanitisation   (per-m²;       AreaPricingRow[])
 *
 * Includes:
 *   - Sub-kind ordering / labels for Section 1 grouping on the printed quote.
 *   - `syncVolumePricing` to keep Section 2 rows aligned with Assessment areas
 *     (mirrors `syncAreaPricing` in QuoteCaptureTab).
 *   - `derivePricingLayoutFromCapture` which infers sensible toggle defaults
 *     from existing data so legacy quotes never lose visibility on save.
 *   - `applyPricingLayoutToContent` which strips disabled-section data from
 *     a `QuoteContent` so the print path can stay layout-blind.
 */

import type {
  Area,
  AreaPricingRow,
  OutcomeKind,
  OutcomeQuoteCapture,
  OutcomeQuoteRow,
  QuoteContent,
  QuotePricingLayout,
  SectionTerms,
  VolumePricingBlock,
  VolumePricingRow,
} from '@/lib/types'

/** Display label and printed-quote sub-header for each Section 1 kind. */
export const OUTCOME_KIND_LABELS: Record<OutcomeKind, string> = {
  mobilisation: 'Mobilisation',
  project_mgmt: 'Project Management',
  surcharge: 'Surcharges',
  fixed_scope: 'Fixed-Fee Scopes',
  other: 'Other',
}

/** Render order on the printed quote (and in the staff-side card stack). */
export const OUTCOME_KIND_ORDER: readonly OutcomeKind[] = [
  'mobilisation',
  'project_mgmt',
  'surcharge',
  'fixed_scope',
  'other',
] as const

const OUTCOME_KIND_RANK = new Map<OutcomeKind, number>(
  OUTCOME_KIND_ORDER.map((k, i) => [k, i]),
)

export function outcomeKindOf(row: OutcomeQuoteRow): OutcomeKind {
  return row.kind ?? 'other'
}

/**
 * Stable-sort Section 1 rows by kind (ordered) then by their original index,
 * preserving any in-kind ordering the user has set up.
 */
export function sortRowsByKind(rows: OutcomeQuoteRow[]): OutcomeQuoteRow[] {
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const ka = OUTCOME_KIND_RANK.get(outcomeKindOf(a.row)) ?? OUTCOME_KIND_ORDER.length
      const kb = OUTCOME_KIND_RANK.get(outcomeKindOf(b.row)) ?? OUTCOME_KIND_ORDER.length
      if (ka !== kb) return ka - kb
      return a.idx - b.idx
    })
    .map(x => x.row)
}

/** Group Section 1 rows by kind, preserving relative order within each group. */
export function groupRowsByKind(
  rows: OutcomeQuoteRow[],
): Array<{ kind: OutcomeKind; rows: OutcomeQuoteRow[] }> {
  const buckets = new Map<OutcomeKind, OutcomeQuoteRow[]>()
  for (const row of rows) {
    const k = outcomeKindOf(row)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(row)
  }
  return OUTCOME_KIND_ORDER
    .filter(k => buckets.has(k) && buckets.get(k)!.length > 0)
    .map(k => ({ kind: k, rows: buckets.get(k)! }))
}

/** True when a SectionTerms object has at least one non-empty list. */
export function sectionTermsHasContent(t: SectionTerms | undefined | null): boolean {
  if (!t) return false
  const lists: Array<string[] | undefined> = [t.included, t.excluded, t.assumptions]
  return lists.some(l => (l ?? []).some(x => (x ?? '').trim()))
}

/** Strip empty bullets and return a tidy `SectionTerms` ready to persist. */
export function normalizeSectionTerms(t: SectionTerms | undefined | null): SectionTerms | undefined {
  if (!t) return undefined
  const clean = (l: string[] | undefined): string[] | undefined => {
    const items = (l ?? []).map(s => (s ?? '').trim()).filter(Boolean)
    return items.length > 0 ? items : undefined
  }
  const included = clean(t.included)
  const excluded = clean(t.excluded)
  const assumptions = clean(t.assumptions)
  if (!included && !excluded && !assumptions) return undefined
  return { ...(included ? { included } : {}), ...(excluded ? { excluded } : {}), ...(assumptions ? { assumptions } : {}) }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Build / refresh Section 2 volume rows from the live assessment areas while
 * preserving any volume / notes the user has already entered for the same
 * room. Free-form rows (no `area_name` match) pass through untouched.
 */
export function syncVolumePricing(
  areas: Area[] | undefined,
  saved: VolumePricingBlock | undefined,
): VolumePricingBlock {
  const priorRows = saved?.rows ?? []
  const priorByArea = new Map<string, VolumePricingRow>()
  const freeForm: VolumePricingRow[] = []
  for (const r of priorRows) {
    const name = (r.area_name ?? '').trim().toLowerCase()
    if (name) priorByArea.set(name, r)
    else freeForm.push(r)
  }

  const fromAreas: VolumePricingRow[] = (areas ?? [])
    .filter(a => (a.name || '').trim().length > 0)
    .map(a => {
      const name = a.name.trim()
      const prior = priorByArea.get(name.toLowerCase())
      const out: VolumePricingRow = {
        area_name: name,
        description: prior?.description?.trim() || `${name} contents`,
        estimated_volume_m3: Math.max(0, Number(prior?.estimated_volume_m3 ?? 0)),
      }
      if (prior?.notes) out.notes = prior.notes
      return out
    })

  const rows: VolumePricingRow[] = [...fromAreas, ...freeForm]
  const unit = Math.max(0, Number(saved?.unit_price_per_m3 ?? 0))
  const totalM3 = rows.reduce((s, r) => s + Math.max(0, Number(r.estimated_volume_m3) || 0), 0)
  return {
    rows,
    unit_price_per_m3: unit,
    total: round2(totalM3 * unit),
    is_estimate: saved?.is_estimate ?? true,
  }
}

/** Recompute the volume block total after a row or unit-price edit. */
export function recomputeVolumePricingTotal(block: VolumePricingBlock): VolumePricingBlock {
  const totalM3 = block.rows.reduce((s, r) => s + Math.max(0, Number(r.estimated_volume_m3) || 0), 0)
  return { ...block, total: round2(totalM3 * Math.max(0, Number(block.unit_price_per_m3) || 0)) }
}

/** Sum of priced volume rows × unit rate. Zero if no rows or rate is missing. */
export function volumePricingSubtotal(block: VolumePricingBlock | undefined): number {
  if (!block) return 0
  return Math.max(0, Number(block.total) || 0)
}

/** True when the volume block has at least one row with a positive volume. */
export function volumePricingHasContent(block: VolumePricingBlock | undefined): boolean {
  if (!block) return false
  return (block.rows ?? []).some(r => Number(r.estimated_volume_m3 || 0) > 0)
}

/** True when `area_pricing` has at least one priced row. */
export function areaPricingHasContent(rows: AreaPricingRow[] | undefined): boolean {
  return (rows ?? []).some(r => Number(r.total ?? 0) > 0)
}

/** True when Section 1 has at least one priced row. */
export function outcomesHaveContent(rows: OutcomeQuoteRow[] | undefined): boolean {
  return (rows ?? []).some(r => Number(r.price ?? 0) > 0)
}

/**
 * Infer a layout from existing capture data. Used as the initial state for
 * the toggle bar so a tech opening an old quote sees their existing data
 * even though we never stored a `pricing_layout` on it.
 */
export function derivePricingLayoutFromCapture(
  cap: OutcomeQuoteCapture | undefined | null,
): QuotePricingLayout {
  if (cap?.pricing_layout) return cap.pricing_layout
  const outcomes = outcomesHaveContent(cap?.rows)
  const perSqm = areaPricingHasContent(cap?.area_pricing)
  const perM3 = volumePricingHasContent(cap?.volume_pricing)
  // Brand-new captures default to outcomes-only (matches the most common case).
  if (!outcomes && !perSqm && !perM3) {
    return { outcomes_enabled: true, per_m3_enabled: false, per_sqm_enabled: false }
  }
  return {
    outcomes_enabled: outcomes,
    per_m3_enabled: perM3,
    per_sqm_enabled: perSqm,
  }
}

/**
 * Strip disabled-section data from a `QuoteContent` so callers can keep the
 * print/compose paths agnostic to which sections are active. The returned
 * content also rewrites totals if any section is dropped — totals must reflect
 * what's actually rendered.
 */
export function applyPricingLayoutToContent(
  content: QuoteContent,
  layout: QuotePricingLayout | undefined,
): QuoteContent {
  if (!layout) return content
  const next: QuoteContent = { ...content, pricing_layout: layout }

  if (!layout.outcomes_enabled) {
    next.outcome_rows = undefined
    next.line_items = []
  }
  if (!layout.per_sqm_enabled) {
    next.area_pricing = undefined
    next.area_pricing_terms = undefined
    next.auto_excluded_surfaces = undefined
  }
  if (!layout.per_m3_enabled) {
    next.volume_pricing = undefined
    next.volume_pricing_terms = undefined
  }

  // Recompute totals from what's actually being rendered.
  const outcomesSum = (next.outcome_rows ?? []).reduce(
    (s, r) => s + Math.max(0, Number(r.price || 0)),
    0,
  )
  const lineItemsSum = (next.line_items ?? []).reduce((s, li) => s + Number(li.total || 0), 0)
  const areaSum = (next.area_pricing ?? []).reduce((s, r) => s + Number(r.total || 0), 0)
  const volSum = next.volume_pricing ? Number(next.volume_pricing.total || 0) : 0

  // Outcomes-vs-line_items: line_items only contributes when outcomes weren't
  // the chosen mode (matches the existing behaviour in quoteLineItemsContentPatch).
  const baseSum = outcomesSum > 0 ? outcomesSum : lineItemsSum
  const lineSum = round2(baseSum + areaSum + volSum)

  const gstMode = next.gst_mode ?? 'no_gst'
  if (gstMode === 'exclusive') {
    const gst = round2(lineSum * 0.1)
    next.subtotal = lineSum
    next.gst = gst
    next.total = round2(lineSum + gst)
  } else if (gstMode === 'inclusive') {
    const gst = round2(lineSum / 11)
    next.subtotal = round2(lineSum - gst)
    next.gst = gst
    next.total = lineSum
  } else {
    next.subtotal = lineSum
    next.gst = 0
    next.total = lineSum
  }

  return next
}

/** Empty/blank Section 2 block helper for first-time use. */
export function emptyVolumeBlock(): VolumePricingBlock {
  return { rows: [], unit_price_per_m3: 0, total: 0, is_estimate: true }
}
