/*
 * lib/orgVocabulary.ts
 *
 * Derives an organisation's "house vocabulary" from HITL-confirmed chips on past
 * jobs, and formats it for injection into suggest/identify prompts so future AI
 * calls adopt the team's preferred phrasing instead of drifting.
 *
 * SOURCE PRIORITY (strong confidence first; we prefer the most-recent casing
 * when two HITL promotions disagree):
 *   1. Manual chips (explicit technician authorship) — strong.
 *   2. Identified-AI or Suggested-AI chips that were promoted to Presenting
 *      (technician confirmed the label verbatim) — strong.
 *   3. Ad-hoc equipment / chemicals / contents items / structure items
 *      (HITL authored by existence; no separate "promote" step) — medium.
 *
 * We deliberately do NOT include bare AI suggestions that were never promoted;
 * treating those as vocabulary would cause the model to reinforce its own drift.
 *
 * This module is PURE — no Supabase, no Clerk, no network. See
 * orgVocabularyLoader.ts for the data-plumbing wrapper.
 */
import type {
  AdhocChemicalItem,
  AdhocEquipmentItem,
  AssessmentData,
  ChemicalCatalogueItem,
  ContentsItem,
  EquipmentCatalogueItem,
  JobChemicalUse,
  RecommendationItem,
  StructureItem,
  SuggestedRiskAiItem,
} from '@/lib/types'

export type OrgVocabularyKind =
  | 'risk'
  | 'health_hazard'
  | 'recommendation'
  | 'equipment'
  | 'chemical'
  | 'contents_item'
  | 'structure_element'

export type OrgVocabularyConfidence = 'strong' | 'medium'

export interface OrgVocabularyEntry {
  /** Canonical label, preserving the most-recent casing we saw. */
  label: string
  /** Grouping discriminator (category / audience / etc.) — free string, lower-case. */
  category?: string
  /** Times we saw this (deduped by lowercase label) across HITL chips. */
  count: number
  /** ISO timestamp of the most recent job that used it. */
  last_used_at: string | null
  confidence: OrgVocabularyConfidence
}

export type OrgVocabularyByKind = Record<OrgVocabularyKind, OrgVocabularyEntry[]>

export function emptyVocabulary(): OrgVocabularyByKind {
  return {
    risk: [],
    health_hazard: [],
    recommendation: [],
    equipment: [],
    chemical: [],
    contents_item: [],
    structure_element: [],
  }
}

/** Input shape for extraction — one row per job. We only read what we need. */
export interface OrgVocabularyJobRow {
  id: string
  updated_at?: string | null
  created_at?: string | null
  assessment_data: AssessmentData | null
}

/** Optional catalogues let us resolve `used_*_catalogue_ids` to real names. */
export interface OrgVocabularyExtractOptions {
  equipmentCatalogue?: EquipmentCatalogueItem[] | null
  chemicalsCatalogue?: ChemicalCatalogueItem[] | null
  /** Cap per kind in the final output (most-used first). Default 30. */
  perKindCap?: number
}

/** Internal accumulator keyed by lowercase label. */
type Acc = Map<
  string,
  {
    label: string
    category?: string
    count: number
    last_used_at: string | null
    confidence: OrgVocabularyConfidence
  }
>

function normaliseKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .trim()
}

function bump(
  acc: Acc,
  label: string,
  category: string | undefined,
  timestamp: string | null,
  confidence: OrgVocabularyConfidence,
): void {
  const trimmed = label.trim()
  if (!trimmed || trimmed.length < 2 || trimmed.length > 120) return
  const key = normaliseKey(trimmed)
  if (!key) return
  const existing = acc.get(key)
  if (existing) {
    existing.count += 1
    if (confidence === 'strong') existing.confidence = 'strong'
    if (category && !existing.category) existing.category = category
    if (timestamp && (!existing.last_used_at || timestamp > existing.last_used_at)) {
      existing.last_used_at = timestamp
      // Keep the most recent casing as canonical.
      existing.label = trimmed
    }
  } else {
    acc.set(key, {
      label: trimmed,
      category: category?.toLowerCase(),
      count: 1,
      last_used_at: timestamp,
      confidence,
    })
  }
}

function finalise(acc: Acc, cap: number): OrgVocabularyEntry[] {
  const arr = [...acc.values()].sort((a, b) => {
    // Strong confidence first, then count desc, then recency desc.
    if (a.confidence !== b.confidence) return a.confidence === 'strong' ? -1 : 1
    if (b.count !== a.count) return b.count - a.count
    const at = a.last_used_at ?? ''
    const bt = b.last_used_at ?? ''
    if (at === bt) return 0
    return at < bt ? 1 : -1
  })
  return arr.slice(0, cap).map(e => ({
    label: e.label,
    ...(e.category ? { category: e.category } : {}),
    count: e.count,
    last_used_at: e.last_used_at,
    confidence: e.confidence,
  }))
}

/**
 * Scan a set of jobs and return vocabulary ranked per kind.
 * Pure / deterministic — suitable for unit testing.
 */
export function extractOrgVocabulary(
  jobs: OrgVocabularyJobRow[],
  opts?: OrgVocabularyExtractOptions,
): OrgVocabularyByKind {
  const cap = opts?.perKindCap ?? 30
  const equipmentCatalogue = opts?.equipmentCatalogue ?? []
  const chemicalsCatalogue = opts?.chemicalsCatalogue ?? []
  const equipById = new Map(equipmentCatalogue.map(e => [e.id, e]))
  const chemById = new Map(chemicalsCatalogue.map(c => [c.id, c]))

  const accs: Record<OrgVocabularyKind, Acc> = {
    risk: new Map(),
    health_hazard: new Map(),
    recommendation: new Map(),
    equipment: new Map(),
    chemical: new Map(),
    contents_item: new Map(),
    structure_element: new Map(),
  }

  for (const job of jobs) {
    const ad = job.assessment_data
    if (!ad) continue
    const ts = job.updated_at || job.created_at || null

    /* ── Risks ── */
    const presentingRiskIds = new Set(ad.presenting_risk_ids ?? [])
    const riskChipPool = new Map<string, SuggestedRiskAiItem>()
    for (const i of ad.identified_risks_ai?.items ?? []) riskChipPool.set(i.id, i)
    for (const i of ad.suggested_risks_ai?.items ?? []) {
      if (!riskChipPool.has(i.id)) riskChipPool.set(i.id, i)
    }
    for (const chip of ad.manual_risk_chips ?? []) {
      bump(accs.risk, chip.label, chip.category, ts, 'strong')
    }
    for (const id of presentingRiskIds) {
      const chip = riskChipPool.get(id)
      if (chip) bump(accs.risk, chip.label, chip.category, ts, 'strong')
    }

    /* ── Health hazards (storage: biohazard keys) ── */
    const presentingHazardIds = new Set(ad.presenting_biohazard_ids ?? [])
    const hazardChipPool = new Map<string, SuggestedRiskAiItem>()
    for (const i of ad.identified_biohazards_ai?.items ?? []) hazardChipPool.set(i.id, i)
    for (const i of ad.suggested_biohazards_ai?.items ?? []) {
      if (!hazardChipPool.has(i.id)) hazardChipPool.set(i.id, i)
    }
    for (const chip of ad.manual_biohazard_chips ?? []) {
      bump(accs.health_hazard, chip.label, chip.category, ts, 'strong')
    }
    for (const id of presentingHazardIds) {
      const chip = hazardChipPool.get(id)
      if (chip) bump(accs.health_hazard, chip.label, chip.category, ts, 'strong')
    }

    /* ── Recommendations ── */
    const presentingRecIds = new Set(ad.presenting_recommendation_ids ?? [])
    const recPool = new Map<string, RecommendationItem>()
    for (const i of ad.identified_recommendations_ai?.items ?? []) recPool.set(i.id, i)
    for (const i of ad.suggested_recommendations_ai?.items ?? []) {
      if (!recPool.has(i.id)) recPool.set(i.id, i)
    }
    for (const chip of ad.manual_recommendation_chips ?? []) {
      bump(accs.recommendation, chip.label, chip.audience, ts, 'strong')
    }
    for (const id of presentingRecIds) {
      const chip = recPool.get(id)
      if (chip) bump(accs.recommendation, chip.label, chip.audience, ts, 'strong')
    }

    /* ── Equipment ── */
    for (const id of ad.used_equipment_catalogue_ids ?? []) {
      const row = equipById.get(id)
      if (row) bump(accs.equipment, row.name, row.category, ts, 'medium')
    }
    for (const a of (ad.adhoc_equipment_chips ?? []) as AdhocEquipmentItem[]) {
      bump(accs.equipment, a.name, a.category, ts, 'medium')
    }

    /* ── Chemicals ── */
    for (const use of (ad.used_chemical_catalogue_uses ?? []) as JobChemicalUse[]) {
      const row = chemById.get(use.catalogue_id)
      if (row) bump(accs.chemical, row.name, use.application, ts, 'medium')
    }
    for (const a of (ad.adhoc_chemical_chips ?? []) as AdhocChemicalItem[]) {
      bump(accs.chemical, a.name, a.application, ts, 'medium')
    }

    /* ── Contents ── */
    for (const item of (ad.contents_items ?? []) as ContentsItem[]) {
      bump(accs.contents_item, item.name, item.category, ts, 'medium')
    }

    /* ── Structure ── */
    for (const s of (ad.structure_items ?? []) as StructureItem[]) {
      const label = s.notes?.trim() ? `${s.element} — ${s.notes.trim()}` : s.element
      bump(accs.structure_element, label, s.condition, ts, 'medium')
    }
  }

  return {
    risk: finalise(accs.risk, cap),
    health_hazard: finalise(accs.health_hazard, cap),
    recommendation: finalise(accs.recommendation, cap),
    equipment: finalise(accs.equipment, cap),
    chemical: finalise(accs.chemical, cap),
    contents_item: finalise(accs.contents_item, cap),
    structure_element: finalise(accs.structure_element, cap),
  }
}

/* ──────────────────────────── Prompt formatter ───────────────────────────── */

const KIND_LABELS: Record<OrgVocabularyKind, string> = {
  risk: 'risk chip labels',
  health_hazard: 'health-hazard chip labels',
  recommendation: 'recommendation chip labels',
  equipment: 'equipment names',
  chemical: 'chemical product names',
  contents_item: 'contents item names',
  structure_element: 'structural element phrasings',
}

/**
 * Render an ORG VOCABULARY block to inject into a suggest/identify system
 * prompt. Emits nothing (empty string) when the org has no vocabulary yet.
 */
export function orgVocabularyBlock(
  kind: OrgVocabularyKind,
  entries: OrgVocabularyEntry[],
  opts?: { maxLines?: number },
): string {
  if (!entries.length) return ''
  const max = opts?.maxLines ?? 30
  const visible = entries.slice(0, max)
  const lines = visible.map(e => {
    const catTag = e.category ? ` (${e.category})` : ''
    const strength = e.confidence === 'strong' ? '*' : ' '
    return `  ${strength} "${e.label}"${catTag} — used ${e.count}×`
  })
  return `
ORG VOCABULARY — PREFERRED ${KIND_LABELS[kind].toUpperCase()} (ranked by HITL promotions on past jobs):
${lines.join('\n')}
VOCABULARY RULES:
- When your proposed label matches one of the above (case-insensitive, minor whitespace / punctuation differences), use the preferred phrasing VERBATIM.
- Items marked with "*" are strong confidence (manually authored or promoted to "Presenting"). Weight them higher than medium-confidence lines.
- Coin a novel label ONLY when the situation is genuinely not covered above.
- Do not fabricate variants of the preferred labels (e.g. synonyms, reordered words) when a preferred form exists.`.trim()
}

/** Union of the two helpers — handy in one-liner wiring. */
export function orgVocabularyBlockFromByKind(
  kind: OrgVocabularyKind,
  byKind: OrgVocabularyByKind,
  opts?: { maxLines?: number },
): string {
  return orgVocabularyBlock(kind, byKind[kind], opts)
}
