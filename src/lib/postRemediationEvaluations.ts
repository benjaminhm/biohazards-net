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
  DocType,
  Document,
  Photo,
  PostRemediationEvaluation,
  PostRemediationEvaluationV2,
  PrePart,
  PrePartKey,
  PrePartResolved,
  PreScopeLine,
  QuoteContent,
} from '@/lib/types'
import { preMeasuredRows, prePartSources, preVerifiedRecords, preWasteRecordRows } from '@/lib/preVerifiedRecords'

/** Saved document types a PRE can report against. */
export const PRE_SOURCE_DOC_TYPES: readonly DocType[] = [
  'quote',
  'biohazard_cleaning_quote',
  'surface_area_cleaning_quote',
  'contents_clearance_quote',
]

export function isPreSourceDocType(type: string): boolean {
  return (PRE_SOURCE_DOC_TYPES as readonly string[]).includes(type)
}

/**
 * Non-financial scope summary of any saved quote document (Quote/Estimate, BCQ,
 * SACQ, CCQ) for drafting a PRE. Picks only scope fields by name, so prices,
 * rates, totals, and terms never reach the draft.
 */
export function quoteScopeSummary(content: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!content) return null
  const text = (v: unknown) => (typeof v === 'string' && v.replace(/<[^>]+>/g, ' ').trim()) || undefined
  const list = (v: unknown) => {
    if (typeof v === 'string') return text(v) ? [text(v) as string] : undefined
    if (!Array.isArray(v)) return undefined
    const out = v.map(text).filter((s): s is string => !!s)
    return out.length ? out : undefined
  }
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined)
  const rooms = (v: unknown) => {
    if (!Array.isArray(v)) return undefined
    const out = v.flatMap(r => {
      if (!r || typeof r !== 'object') return []
      const row = r as Record<string, unknown>
      const name = text(row.name)
      return name ? [{ name, area_m2: num(row.area_m2) }] : []
    })
    return out.length ? out : undefined
  }
  const summary: Record<string, unknown> = {
    title: text(content.title),
    biohazard_type: text(content.biohazard_type),
    area_affected: text(content.area_affected),
    description: text(content.description),
    objective: text(content.objective),
    scope_of_work: list(content.scope_of_work),
    rooms: rooms(content.rooms),
    estimated_m2: num(content.estimated_m2),
    secondary_zone: content.has_secondary === true ? text(content.secondary_zone) : undefined,
    secondary_contamination: content.has_secondary === true ? text(content.secondary_contamination) : undefined,
    secondary_objective: content.has_secondary === true ? text(content.secondary_objective) : undefined,
    secondary_rooms: content.has_secondary === true ? rooms(content.secondary_rooms) : undefined,
    other_zones: text(content.other_zones),
    estimated_m3: num(content.estimated_m3),
    estimated_tonnes: num(content.estimated_tonnes),
    tip_address: text(content.tip_address),
    inclusions: list(content.inclusions),
    exclusions: list(content.exclusions),
    assumptions: list(content.assumptions),
  }
  for (const k of Object.keys(summary)) if (summary[k] === undefined) delete summary[k]
  return Object.keys(summary).length ? summary : null
}

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

/** The job's standalone PRE (no linked quote), if any. */
export function getStandalonePre(ad: AssessmentData | null | undefined): PostRemediationEvaluation | undefined {
  return getPres(ad).find(p => !p.source_quote_document_id)
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

/** Progress photos placed at the end of a generated Post Remediation Evaluation. */
export function reportAppendixPhotos(photos: Photo[]): Photo[] {
  return photos.filter(
    p => p.include_in_composed_reports !== false && (
      p.capture_phase === 'progress'
      || (p.capture_phase !== 'assessment' && (p.category === 'during' || p.category === 'after'))
    ),
  )
}

function photoTime(photo: Photo): number {
  const t = Date.parse(photo.taken_at || photo.uploaded_at)
  return Number.isFinite(t) ? t : 0
}

function compareByTimeTaken(a: Photo, b: Photo): number {
  const byTime = photoTime(a) - photoTime(b)
  if (byTime !== 0) return byTime
  const byUpload = a.uploaded_at.localeCompare(b.uploaded_at)
  return byUpload !== 0 ? byUpload : a.id.localeCompare(b.id)
}

/** Photos ordered by when they were taken; photos without a taken time use their upload time. */
export function sortPhotosByTimeTaken(photos: Photo[]): Photo[] {
  return [...photos].sort(compareByTimeTaken)
}

/** Puts each new photo into an existing order just before the first photo taken after it. */
export function insertPhotosByTimeTaken(ordered: Photo[], added: Photo[]): Photo[] {
  const next = [...ordered]
  for (const photo of sortPhotosByTimeTaken(added)) {
    const at = next.findIndex(existing => compareByTimeTaken(photo, existing) < 0)
    if (at < 0) next.push(photo)
    else next.splice(at, 0, photo)
  }
  return next
}

/** Report images in the order they were taken, or in an explicit id list when the user has dragged them. */
export function orderReportAppendixPhotos(photos: Photo[], orderedIds?: string[] | null): Photo[] {
  const byCreated = sortPhotosByTimeTaken(reportAppendixPhotos(photos))
  if (!orderedIds?.length) return byCreated
  const byId = new Map(byCreated.map(photo => [photo.id, photo]))
  const ordered: Photo[] = []
  const seen = new Set<string>()
  for (const id of orderedIds) {
    const photo = byId.get(id)
    if (!photo || seen.has(id)) continue
    ordered.push(photo)
    seen.add(id)
  }
  return insertPhotosByTimeTaken(ordered, byCreated.filter(photo => !seen.has(photo.id)))
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

// ── Multi-part PRE (v2) ──────────────────────────────────────────────────────

export const PRE_PART_KEYS: readonly PrePartKey[] = ['a', 'b', 'c']

/** Editor letters and titles. docType / quoteLabel serve only Part A on a fixed-price BCQ. */
export const PRE_PART_DEFS: Record<PrePartKey, { letter: string; title: string; docType: DocType; quoteLabel: string }> = {
  a: { letter: 'A', title: 'Biohazard Cleaning', docType: 'biohazard_cleaning_quote', quoteLabel: 'BCQ' },
  b: { letter: 'B', title: 'Contents Clearance', docType: 'contents_clearance_quote', quoteLabel: 'CCQ' },
  c: { letter: 'C', title: 'Surface Area Cleaning', docType: 'surface_area_cleaning_quote', quoteLabel: 'SACQ' },
}

/** Label / reference / date of a saved quote document for pickers and headers. */
export function quoteDocMeta(doc: Pick<Document, 'content' | 'created_at'>): { label: string; reference: string; date: string } {
  const c = (doc.content ?? {}) as Record<string, unknown>
  const label = String(c.quote_label || c.title || 'Quote')
  const reference = String(c.reference || '')
  const date = new Date(doc.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return { label, reference, date }
}

export function genPreV2Id(): string {
  return `prev2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function getPreV2s(ad: AssessmentData | null | undefined): PostRemediationEvaluationV2[] {
  if (!ad || !Array.isArray(ad.pre_multi_part)) return []
  return ad.pre_multi_part
}

/** Link a part to a saved quote document (or clear the link with null). */
export function linkPartToQuote(part: PrePart, doc: Pick<Document, 'id' | 'content' | 'created_at'> | null): PrePart {
  if (!doc) {
    return { ...part, source_quote_document_id: undefined, source_quote_label: undefined, source_quote_reference: undefined }
  }
  const meta = quoteDocMeta(doc)
  return { ...part, source_quote_document_id: doc.id, source_quote_label: meta.label, source_quote_reference: meta.reference }
}

/**
 * Fresh multi-part PRE. A section starts on when its record exists. Part A on
 * a fixed-price BCQ has no record: it starts on when the job has a saved BCQ
 * and is linked when there is exactly one.
 */
export function makeBlankPreV2(
  documents: Pick<Document, 'id' | 'type' | 'content' | 'created_at'>[],
  ad: AssessmentData | null | undefined,
): PostRemediationEvaluationV2 {
  const now = new Date().toISOString()
  const sources = prePartSources(ad)
  const parts = {} as Record<PrePartKey, PrePart>
  for (const key of PRE_PART_KEYS) {
    const blank: PrePart = { enabled: sources[key] === 'record', works_rows: [], products_rows: [], waste: {} }
    if (sources[key] !== 'fixed_price') {
      parts[key] = blank
      continue
    }
    const matches = documents.filter(d => d.type === PRE_PART_DEFS[key].docType)
    blank.enabled = matches.length > 0
    parts[key] = matches.length === 1 ? linkPartToQuote(blank, matches[0]) : blank
  }
  return {
    id: genPreV2Id(),
    attendance: '',
    executive_summary: '',
    site_conditions: [],
    parts,
    recommendations: [],
    compliance: '',
    limitations: '',
    technician_signoff: '',
    created_at: now,
    updated_at: now,
  }
}

const hasProse = (s?: string) => !!(s && s.replace(/<[^>]+>/g, '').trim())

/** True when a part has anything printable. */
export function prePartHasContent(part: PrePart): boolean {
  const w = part.waste
  return (
    hasProse(part.methodology) ||
    hasProse(part.outcome_verification) ||
    (part.works_rows ?? []).some(r => r.stage_name.trim() || r.description.trim()) ||
    (part.products_rows ?? []).some(r => r.item_name.trim() || r.usage_note.trim()) ||
    !!(w && (w.waste_type || w.volume || w.containment || w.disposal))
  )
}

/** True when a multi-part PRE has anything printable. */
export function preV2HasContent(pre: PostRemediationEvaluationV2): boolean {
  return (
    hasProse(pre.executive_summary) ||
    hasProse(pre.compliance) ||
    hasProse(pre.limitations) ||
    hasProse(pre.attendance) ||
    (pre.site_conditions ?? []).some(s => s.trim()) ||
    (pre.recommendations ?? []).some(s => s.trim()) ||
    PRE_PART_KEYS.some(k => pre.parts[k]?.enabled && prePartHasContent(pre.parts[k]))
  )
}

/**
 * Sections to print, in A/B/C order, frozen for printing: switched on, with a
 * record behind them (or Part A on a fixed-price BCQ), and something to show.
 * Figures come from the records; quotes are never read.
 */
export function resolvePreV2Parts(
  pre: PostRemediationEvaluationV2,
  ad: AssessmentData | null | undefined,
): PrePartResolved[] {
  const clean = (s?: string) => (s ?? '').trim() || undefined
  const records = preVerifiedRecords(ad)
  const sources = prePartSources(ad, records)
  const out: PrePartResolved[] = []
  for (const key of PRE_PART_KEYS) {
    const part = pre.parts[key]
    if (!part?.enabled || !sources[key]) continue
    const measured = preMeasuredRows(key, records)
    const wasteRows = preWasteRecordRows(key, records)
    if (!prePartHasContent(part) && !measured.length && !wasteRows.length) continue
    const w = part.waste
    out.push({
      key,
      title: PRE_PART_DEFS[key].title,
      measured_rows: measured.length ? measured : undefined,
      waste_rows: wasteRows.length ? wasteRows : undefined,
      works_rows: (part.works_rows ?? []).filter(r => r.stage_name.trim() || r.description.trim()),
      methodology: clean(part.methodology),
      products_rows: (part.products_rows ?? []).filter(r => r.item_name.trim() || r.usage_note.trim()),
      waste: w && (w.waste_type || w.volume || w.containment || w.disposal) ? w : undefined,
      outcome_verification: clean(part.outcome_verification),
    })
  }
  return out
}

/** Insert or replace a multi-part PRE by id, returning a new array. */
export function upsertPreV2(
  ad: AssessmentData | null | undefined,
  pre: PostRemediationEvaluationV2,
): PostRemediationEvaluationV2[] {
  const existing = getPreV2s(ad)
  const stamped: PostRemediationEvaluationV2 = { ...pre, updated_at: new Date().toISOString() }
  const idx = existing.findIndex(p => p.id === pre.id)
  if (idx === -1) return [...existing, stamped]
  const next = existing.slice()
  next[idx] = stamped
  return next
}
