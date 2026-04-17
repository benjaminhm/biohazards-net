/*
 * lib/assessmentResolvers.ts
 *
 * Pure, UI-agnostic resolvers that turn raw AssessmentData + org catalogues
 * into "presenting" lists consumed by:
 *   - lib/documentGenerationDrivers.ts → hitlSelectionsBlock() for AI context
 *   - lib/composeDocument.ts           → deterministic previews
 *   - Downstream widgets (Documents tab summaries, client-facing reports)
 *
 * HITL CONTRACT: None of these helpers fall back to "best guess" — if the user
 * hasn't promoted a chip (or ticked a catalogue row) it's not returned. This
 * mirrors presentingRisksFromAssessment / presentingBiohazardsFromAssessment.
 *
 * For data that mixes catalogue refs + ad-hoc (equipment, chemicals), the
 * resolvers accept an optional catalogue and return merged records with a
 * `source: 'catalogue' | 'adhoc'` discriminator so downstream consumers can
 * render lineage if they care.
 */
import type {
  AdhocChemicalItem,
  AdhocEquipmentItem,
  AssessmentData,
  ChemicalApplication,
  ChemicalCatalogueItem,
  ChemicalHazardClass,
  ContentsItem,
  EquipmentCatalogueItem,
  EquipmentCategory,
  JobChemicalUse,
  RecommendationItem,
  StructureItem,
} from '@/lib/types'

/* ───────────────────────────── Recommendations ────────────────────────────── */

/** Union of identify + generate + manual recommendation chips. Manual wins on same id. */
export function allRecommendationChipItems(
  ad: AssessmentData | null | undefined,
): RecommendationItem[] {
  if (!ad) return []
  const identified = ad.identified_recommendations_ai?.items ?? []
  const suggested = ad.suggested_recommendations_ai?.items ?? []
  const manual = ad.manual_recommendation_chips ?? []
  const m = new Map<string, RecommendationItem>()
  for (const i of identified) m.set(i.id, i)
  for (const i of suggested) if (!m.has(i.id)) m.set(i.id, i)
  for (const i of manual) m.set(i.id, i)
  return [...m.values()]
}

/** Recommendations the tech moved into "Presenting recommendations". */
export function presentingRecommendationsFromAssessment(
  ad: AssessmentData | null | undefined,
): RecommendationItem[] {
  if (!ad) return []
  const ids = new Set(ad.presenting_recommendation_ids ?? [])
  return allRecommendationChipItems(ad).filter(i => ids.has(i.id))
}

/* ───────────────────────────── Equipment ──────────────────────────────────── */

export interface ResolvedEquipmentItem {
  name: string
  category: EquipmentCategory
  notes?: string
  /** Whether this came from the org catalogue (reusable) or an ad-hoc chip (this job only). */
  source: 'catalogue' | 'adhoc'
  /** Catalogue id when source === 'catalogue'. */
  catalogue_id?: string
}

/**
 * Equipment actually in use on this job: catalogue rows ticked
 * (`used_equipment_catalogue_ids`) + ad-hoc chips (`adhoc_equipment_chips`).
 * Skips ticks for catalogue rows not supplied (typically archived or missing
 * catalogue context) so we never emit placeholder "unknown" lines.
 */
export function resolveJobEquipment(
  ad: AssessmentData | null | undefined,
  catalogue?: EquipmentCatalogueItem[] | null,
): ResolvedEquipmentItem[] {
  if (!ad) return []
  const out: ResolvedEquipmentItem[] = []
  const usedIds = ad.used_equipment_catalogue_ids ?? []
  if (usedIds.length && catalogue?.length) {
    const byId = new Map(catalogue.map(c => [c.id, c]))
    for (const id of usedIds) {
      const row = byId.get(id)
      if (!row) continue
      out.push({
        name: row.name,
        category: row.category,
        ...(row.notes ? { notes: row.notes } : {}),
        source: 'catalogue',
        catalogue_id: row.id,
      })
    }
  }
  for (const a of ad.adhoc_equipment_chips ?? []) {
    out.push({
      name: a.name,
      category: a.category,
      ...(a.notes ? { notes: a.notes } : {}),
      source: 'adhoc',
    })
  }
  return out
}

/* ───────────────────────────── Chemicals ──────────────────────────────────── */

export interface ResolvedChemicalItem {
  name: string
  manufacturer?: string
  active_ingredient?: string
  hazard_classes: ChemicalHazardClass[]
  application: ChemicalApplication
  dilution?: string
  notes?: string
  ppe_required?: string[]
  handling_precautions?: string
  first_aid_summary?: string
  signal_word?: 'danger' | 'warning' | null
  source: 'catalogue' | 'adhoc'
  catalogue_id?: string
}

/**
 * Chemicals confirmed on this job. Merges:
 *   - ad.used_chemical_catalogue_uses (per-job application + dilution) against
 *     the supplied catalogue (for hazard classes, SDS-parsed PPE etc.)
 *   - ad.adhoc_chemical_chips (one-off chemicals)
 */
export function resolveJobChemicals(
  ad: AssessmentData | null | undefined,
  catalogue?: ChemicalCatalogueItem[] | null,
): ResolvedChemicalItem[] {
  if (!ad) return []
  const out: ResolvedChemicalItem[] = []
  const uses = ad.used_chemical_catalogue_uses ?? []
  if (uses.length && catalogue?.length) {
    const byId = new Map(catalogue.map(c => [c.id, c]))
    for (const u of uses) {
      const row = byId.get(u.catalogue_id)
      if (!row) continue
      out.push({
        name: row.name,
        ...(row.manufacturer ? { manufacturer: row.manufacturer } : {}),
        ...(row.active_ingredient ? { active_ingredient: row.active_ingredient } : {}),
        hazard_classes: row.hazard_classes,
        application: u.application,
        ...(u.dilution ? { dilution: u.dilution } : {}),
        ...(u.notes ? { notes: u.notes } : {}),
        ...(row.sds_parsed?.ppe_required?.length
          ? { ppe_required: row.sds_parsed.ppe_required }
          : {}),
        ...(row.sds_parsed?.handling_precautions
          ? { handling_precautions: row.sds_parsed.handling_precautions }
          : {}),
        ...(row.sds_parsed?.first_aid_summary
          ? { first_aid_summary: row.sds_parsed.first_aid_summary }
          : {}),
        ...(row.sds_parsed?.signal_word !== undefined
          ? { signal_word: row.sds_parsed.signal_word }
          : {}),
        source: 'catalogue',
        catalogue_id: row.id,
      })
    }
  }
  for (const a of ad.adhoc_chemical_chips ?? []) {
    out.push({
      name: a.name,
      hazard_classes: a.hazard_classes,
      application: a.application,
      ...(a.dilution ? { dilution: a.dilution } : {}),
      ...(a.notes ? { notes: a.notes } : {}),
      source: 'adhoc',
    })
  }
  return out
}

/* ───────────────────────────── Contents / Structure ──────────────────────── */

export function jobContentsItems(ad: AssessmentData | null | undefined): ContentsItem[] {
  return ad?.contents_items ?? []
}

export function jobStructureItems(ad: AssessmentData | null | undefined): StructureItem[] {
  return ad?.structure_items ?? []
}

/* ───────────────────────────── Derived PPE ───────────────────────────────── */

/**
 * Unique PPE items drawn from all resolved chemical SDSs, preserving insertion
 * order. Useful for composing the ppe_required slot on SWMS/JSA/SOW before the
 * AI layer ever runs.
 */
export function chemicalsPpeUnion(chems: ResolvedChemicalItem[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const c of chems) {
    for (const p of c.ppe_required ?? []) {
      const key = p.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
  }
  return out
}

/** Equipment items whose category is PPE. Handy for SWMS/JSA ppe_required. */
export function ppeEquipment(equipment: ResolvedEquipmentItem[]): ResolvedEquipmentItem[] {
  return equipment.filter(e => e.category === 'ppe')
}

/* ───────────────────────────── Ad-hoc helpers (text) ─────────────────────── */

export function formatEquipmentLine(e: ResolvedEquipmentItem): string {
  const tag = e.source === 'catalogue' ? 'catalogue' : 'ad-hoc'
  const body = e.notes ? `${e.name} — ${e.notes}` : e.name
  return `${body} (${e.category}, ${tag})`
}

export function formatChemicalLine(c: ResolvedChemicalItem): string {
  const bits: string[] = [c.name]
  if (c.manufacturer) bits.push(`by ${c.manufacturer}`)
  if (c.active_ingredient) bits.push(`[${c.active_ingredient}]`)
  bits.push(`— ${c.application}${c.dilution ? ` at ${c.dilution}` : ''}`)
  if (c.hazard_classes.length) bits.push(`hazards: ${c.hazard_classes.join(', ')}`)
  if (c.signal_word) bits.push(`signal: ${c.signal_word.toUpperCase()}`)
  bits.push(`(${c.source})`)
  return bits.join(' ')
}

/** Escape ad-hoc free-text for inclusion in plain prose (trim + no newlines). */
export function oneLine(s: string | null | undefined, max = 240): string {
  if (!s) return ''
  return s.replace(/\s+/g, ' ').trim().slice(0, max)
}

/* ───────────────────────────── Ad-hoc equipment helpers ──────────────────── */

export type JobEquipmentInput = {
  used_equipment_catalogue_ids?: string[]
  adhoc_equipment_chips?: AdhocEquipmentItem[]
}

export function hasAnyJobEquipment(ad: AssessmentData | null | undefined): boolean {
  if (!ad) return false
  return (ad.used_equipment_catalogue_ids?.length ?? 0) > 0 || (ad.adhoc_equipment_chips?.length ?? 0) > 0
}

export type JobChemicalInput = {
  used_chemical_catalogue_uses?: JobChemicalUse[]
  adhoc_chemical_chips?: AdhocChemicalItem[]
}

export function hasAnyJobChemical(ad: AssessmentData | null | undefined): boolean {
  if (!ad) return false
  return (ad.used_chemical_catalogue_uses?.length ?? 0) > 0 || (ad.adhoc_chemical_chips?.length ?? 0) > 0
}
