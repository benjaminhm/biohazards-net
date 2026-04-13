/*
 * Links between approved presenting hazards (Hazards tab) and risk chips (source_hazard_ids).
 * Used when demoting/removing hazards, pruning orphans, and gating Identify/Generate risks.
 */
import type { AssessmentData, SuggestedRiskAiItem } from './types'
import { allRiskChipItems } from './documentGenerationDrivers'
import { mergeAssessmentData } from './riskDerivation'

export function approvedHazardIdSet(ad: AssessmentData | null | undefined): Set<string> {
  return new Set(ad?.presenting_biohazard_ids ?? [])
}

/** AI-linked risks whose hazard sources are all demoted (no overlap with presenting hazards). */
export function orphanRiskItems(ad: AssessmentData | null | undefined): SuggestedRiskAiItem[] {
  if (!ad) return []
  const approved = approvedHazardIdSet(ad)
  return allRiskChipItems(ad).filter(r => {
    const src = r.source_hazard_ids
    if (!src?.length) return false
    return src.every(id => !approved.has(id))
  })
}

export function risksReferencingHazard(
  ad: AssessmentData | null | undefined,
  hazardId: string
): SuggestedRiskAiItem[] {
  return allRiskChipItems(ad).filter(r => r.source_hazard_ids?.includes(hazardId))
}

/**
 * When a hazard is demoted or removed: drop hazard id from each risk's source_hazard_ids;
 * remove risk chips that end up with no source. Manual risks without source_hazard_ids unchanged.
 */
export function applyHazardDemotionOrRemoval(
  ad: AssessmentData | null | undefined,
  hazardId: string
): AssessmentData {
  const base = mergeAssessmentData(ad ?? null)
  const prev: AssessmentData = { ...base, ...(ad ?? {}) }

  const strip = (item: SuggestedRiskAiItem): SuggestedRiskAiItem | 'drop' => {
    const src = item.source_hazard_ids
    if (!src?.length) return item
    if (!src.includes(hazardId)) return item
    const next = src.filter(id => id !== hazardId)
    if (next.length === 0) return 'drop'
    return { ...item, source_hazard_ids: next }
  }

  const mapPool = (items: SuggestedRiskAiItem[] | undefined) => {
    const out: SuggestedRiskAiItem[] = []
    const dropped = new Set<string>()
    for (const item of items ?? []) {
      const r = strip(item)
      if (r === 'drop') dropped.add(item.id)
      else out.push(r)
    }
    return { items: out, droppedIds: dropped }
  }

  const idR = mapPool(prev.identified_risks_ai?.items)
  const sgR = mapPool(prev.suggested_risks_ai?.items)
  const mnR = mapPool(prev.manual_risk_chips)

  const allDropped = new Set([...idR.droppedIds, ...sgR.droppedIds, ...mnR.droppedIds])
  const presenting_risk_ids = (prev.presenting_risk_ids ?? []).filter(id => !allDropped.has(id))

  return {
    ...prev,
    identified_risks_ai: prev.identified_risks_ai
      ? { ...prev.identified_risks_ai, items: idR.items }
      : prev.identified_risks_ai,
    suggested_risks_ai: prev.suggested_risks_ai
      ? { ...prev.suggested_risks_ai, items: sgR.items }
      : prev.suggested_risks_ai,
    manual_risk_chips: mnR.items,
    presenting_risk_ids,
  }
}

/** Remove AI-linked risks that no longer have any approved hazard source; trim partial links. */
export function pruneOrphanRisks(ad: AssessmentData | null | undefined): AssessmentData {
  const base = mergeAssessmentData(ad ?? null)
  const prev: AssessmentData = { ...base, ...(ad ?? {}) }
  const approved = approvedHazardIdSet(prev)

  const strip = (item: SuggestedRiskAiItem): SuggestedRiskAiItem | 'drop' => {
    const src = item.source_hazard_ids
    if (!src?.length) return item
    const kept = src.filter(id => approved.has(id))
    if (kept.length === 0) return 'drop'
    if (kept.length === src.length) return item
    return { ...item, source_hazard_ids: kept }
  }

  const mapPool = (items: SuggestedRiskAiItem[] | undefined) => {
    const out: SuggestedRiskAiItem[] = []
    const dropped = new Set<string>()
    for (const item of items ?? []) {
      const r = strip(item)
      if (r === 'drop') dropped.add(item.id)
      else out.push(r)
    }
    return { items: out, droppedIds: dropped }
  }

  const idR = mapPool(prev.identified_risks_ai?.items)
  const sgR = mapPool(prev.suggested_risks_ai?.items)
  const mnR = mapPool(prev.manual_risk_chips)
  const allDropped = new Set([...idR.droppedIds, ...sgR.droppedIds, ...mnR.droppedIds])
  const presenting_risk_ids = (prev.presenting_risk_ids ?? []).filter(id => !allDropped.has(id))

  return {
    ...prev,
    identified_risks_ai: prev.identified_risks_ai
      ? { ...prev.identified_risks_ai, items: idR.items }
      : prev.identified_risks_ai,
    suggested_risks_ai: prev.suggested_risks_ai
      ? { ...prev.suggested_risks_ai, items: sgR.items }
      : prev.suggested_risks_ai,
    manual_risk_chips: mnR.items,
    presenting_risk_ids,
  }
}
