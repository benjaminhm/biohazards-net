/*
 * lib/postRemediationEvaluations.ts
 *
 * Hub-and-spoke Post Remediation Evaluations (PRE). The PRE is the redesigned
 * completion report: each PRE is anchored 1:1 to a saved quote/estimate
 * document, which is the immutable source of truth for "what we agreed to do".
 * The PRE records what was actually done against that scope (NON-FINANCIAL),
 * plus added works, per-room evidence, and narrative.
 *
 * Stored on assessment_data.post_remediation_evaluations[]. At most one PRE per
 * source quote document. The source link is immutable after first save.
 */
import type {
  AssessmentData,
  PostRemediationEvaluation,
  PreScopeLine,
  QuoteContent,
} from '@/lib/types'

/** Stable client-generated id for a new PRE. */
export function genPreId(): string {
  return `pre_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** All PREs on a job (newest assumed last; callers order as needed). */
export function getPres(ad: AssessmentData | null | undefined): PostRemediationEvaluation[] {
  if (!ad || !Array.isArray(ad.post_remediation_evaluations)) return []
  return ad.post_remediation_evaluations
}

/** Find the single PRE anchored to a given source quote document, if any. */
export function getPreBySourceQuoteId(
  ad: AssessmentData | null | undefined,
  sourceQuoteDocumentId: string | null | undefined,
): PostRemediationEvaluation | undefined {
  if (!sourceQuoteDocumentId) return undefined
  return getPres(ad).find(p => p.source_quote_document_id === sourceQuoteDocumentId)
}

/**
 * Seed `from_quote` scope lines from a saved quote document's content. Source
 * line ids are namespaced per pricing section so they stay stable across reads:
 *   outcome row  → `outcome:<row.id>`
 *   area row     → `area:<area_name>`
 *   volume row   → `volume:<index>`
 */
export function seedScopeLinesFromQuoteContent(
  content: Partial<QuoteContent> | null | undefined,
): PreScopeLine[] {
  if (!content) return []
  const lines: PreScopeLine[] = []

  for (const row of content.outcome_rows ?? []) {
    if (!row?.id) continue
    lines.push({ kind: 'from_quote', source_line_id: `outcome:${row.id}` })
  }

  for (const row of content.area_pricing ?? []) {
    if (!row?.area_name) continue
    lines.push({ kind: 'from_quote', source_line_id: `area:${row.area_name}` })
  }

  const volumeRows = content.volume_pricing?.rows ?? []
  volumeRows.forEach((_row, i) => {
    lines.push({ kind: 'from_quote', source_line_id: `volume:${i}` })
  })

  return lines
}

export interface QuotedLineContext {
  sectionLabel: string
  title: string
  detail?: string
  qty?: number
  unit?: string
}

/**
 * Resolve the quoted context for a `from_quote` scope line against a source
 * quote document's content. Mirrors the namespaced ids from
 * seedScopeLinesFromQuoteContent. Used by the builder (live display) and the
 * composer (baked snapshot).
 */
export function resolveQuotedLineContext(
  content: Partial<QuoteContent> | null | undefined,
  sourceLineId: string,
): QuotedLineContext | undefined {
  if (!content) return undefined
  const [kind, ...rest] = sourceLineId.split(':')
  const key = rest.join(':')
  if (kind === 'outcome') {
    const row = (content.outcome_rows ?? []).find(r => r.id === key)
    if (!row) return undefined
    return {
      sectionLabel: 'Section 1 — Fees & fixed-rate items',
      title: row.outcome_title || 'Outcome',
      detail: row.outcome_description || undefined,
    }
  }
  if (kind === 'area') {
    const row = (content.area_pricing ?? []).find(r => r.area_name === key)
    if (!row) return undefined
    return {
      sectionLabel: 'Section 3 — Surfaces',
      title: row.area_name,
      detail: row.sqm ? `${row.sqm} m²` : undefined,
      qty: row.sqm || undefined,
      unit: 'm²',
    }
  }
  if (kind === 'volume') {
    const idx = Number(key)
    const row = (content.volume_pricing?.rows ?? [])[idx]
    if (!row) return undefined
    return {
      sectionLabel: 'Section 2 — Contents removal',
      title: row.description || 'Contents',
      detail: row.estimated_volume_m3 ? `${row.estimated_volume_m3} m³` : undefined,
      qty: row.estimated_volume_m3 || undefined,
      unit: 'm³',
    }
  }
  return undefined
}

/** Build a fresh PRE anchored to a source quote document. */
export function makeBlankPre(opts: {
  source_quote_document_id: string
  source_quote_label?: string
  source_quote_reference?: string
  scope_lines?: PreScopeLine[]
}): PostRemediationEvaluation {
  const now = new Date().toISOString()
  return {
    id: genPreId(),
    source_quote_document_id: opts.source_quote_document_id,
    source_quote_label: opts.source_quote_label,
    source_quote_reference: opts.source_quote_reference,
    // v2 completion-report sections (filled by Regenerate, then HITL-edited)
    attendance: '',
    executive_summary: '',
    site_conditions: [],
    works_rows: [],
    methodology: '',
    products_rows: [],
    waste: {},
    outcome_verification: '',
    recommendations: [],
    compliance: '',
    limitations: '',
    // legacy scope-line fields retained for back-compat with older PREs
    opening_rich_html: '',
    scope_lines: opts.scope_lines ?? [],
    area_notes: [],
    closing_rich_html: '',
    technician_signoff: '',
    created_at: now,
    updated_at: now,
  }
}

/** True when a PRE carries any v2 completion-report section content, i.e. it
 *  should render with the 9-section completion-report layout (not legacy). */
export function preHasV2Content(pre: PostRemediationEvaluation): boolean {
  const hasText = (s?: string) => !!(s && s.replace(/<[^>]+>/g, '').trim().length > 0)
  const w = pre.waste
  return (
    hasText(pre.executive_summary) ||
    hasText(pre.methodology) ||
    hasText(pre.outcome_verification) ||
    hasText(pre.compliance) ||
    hasText(pre.limitations) ||
    hasText(pre.attendance) ||
    (pre.site_conditions ?? []).some(s => s.trim()) ||
    (pre.recommendations ?? []).some(s => s.trim()) ||
    (pre.works_rows ?? []).some(r => r.stage_name.trim() || r.description.trim()) ||
    (pre.products_rows ?? []).some(r => r.item_name.trim() || r.usage_note.trim()) ||
    !!(w && (w.waste_type || w.volume || w.containment || w.disposal))
  )
}

/**
 * Insert or replace a PRE in the array by id, returning a new array. The
 * source_quote_document_id of an existing PRE is preserved (immutable) even if
 * the incoming object differs.
 */
export function upsertPre(
  ad: AssessmentData | null | undefined,
  pre: PostRemediationEvaluation,
): PostRemediationEvaluation[] {
  const existing = getPres(ad)
  const idx = existing.findIndex(p => p.id === pre.id)
  const stamped: PostRemediationEvaluation = { ...pre, updated_at: new Date().toISOString() }
  if (idx === -1) return [...existing, stamped]
  const next = existing.slice()
  next[idx] = { ...stamped, source_quote_document_id: existing[idx].source_quote_document_id }
  return next
}
