/*
 * Routes document generation to HITL-confirmed Assessment chips:
 * - Presenting risks (Risks tab) → JSA, SWMS, Risk Assessment
 * - Presenting health hazards (Assessment → Health Hazards tab) → SOW, quote, report, ATP, engagement, COD, WDM
 *
 * Add new DocTypes by extending REQUIRES_* sets and documentDriverInstructions.
 *
 * VOCABULARY NOTE: This module uses "health hazard" throughout for user-facing
 * strings, function names, and constants — matching the "Health Hazards" tab
 * label. The underlying AssessmentData JSONB keys still use the legacy
 * "biohazard" prefix (presenting_biohazard_ids, suggested_biohazards_ai, …);
 * renaming those requires a data migration and will land separately.
 */
import type {
  AssessmentData,
  ChemicalCatalogueItem,
  DocType,
  EquipmentCatalogueItem,
  Job,
  SuggestedRiskAiItem,
} from '@/lib/types'
import { staffSowHasContent } from '@/lib/sowCapture'
import {
  jobContentsItems,
  jobStructureItems,
  presentingRecommendationsFromAssessment,
  resolveJobChemicals,
  resolveJobEquipment,
} from '@/lib/assessmentResolvers'

/** Optional catalogues used to enrich equipment/chemicals context in prompts. */
export interface HitlContextOptions {
  equipmentCatalogue?: EquipmentCatalogueItem[] | null
  chemicalsCatalogue?: ChemicalCatalogueItem[] | null
}

/** Union of Identify + Generate + manual risk chips (manual wins on same id). */
export function allRiskChipItems(ad: AssessmentData | null | undefined): SuggestedRiskAiItem[] {
  if (!ad) return []
  const identified = ad.identified_risks_ai?.items ?? []
  const suggested = ad.suggested_risks_ai?.items ?? []
  const manual = ad.manual_risk_chips ?? []
  const m = new Map<string, SuggestedRiskAiItem>()
  for (const i of identified) m.set(i.id, i)
  for (const i of suggested) {
    if (!m.has(i.id)) m.set(i.id, i)
  }
  for (const i of manual) m.set(i.id, i)
  return [...m.values()]
}

/** Risks the user moved into "Presenting risks". */
export function presentingRisksFromAssessment(ad: AssessmentData | null | undefined): SuggestedRiskAiItem[] {
  if (!ad) return []
  const ids = new Set(ad.presenting_risk_ids ?? [])
  return allRiskChipItems(ad).filter(i => ids.has(i.id))
}

/** Union of Identify + Generate + manual health-hazard chips (manual wins on same id). */
export function allHealthHazardChipItems(ad: AssessmentData | null | undefined): SuggestedRiskAiItem[] {
  if (!ad) return []
  const identified = ad.identified_biohazards_ai?.items ?? []
  const suggested = ad.suggested_biohazards_ai?.items ?? []
  const manual = ad.manual_biohazard_chips ?? []
  const m = new Map<string, SuggestedRiskAiItem>()
  for (const i of identified) m.set(i.id, i)
  for (const i of suggested) {
    if (!m.has(i.id)) m.set(i.id, i)
  }
  for (const i of manual) m.set(i.id, i)
  return [...m.values()]
}

/** Deprecated alias — use allHealthHazardChipItems. Kept for one release for external callers. */
export const allBiohazardChipItems = allHealthHazardChipItems

/** Health hazards the user moved into "Presenting" on Assessment → Health Hazards. */
export function presentingHealthHazardsFromAssessment(
  ad: AssessmentData | null | undefined,
): SuggestedRiskAiItem[] {
  if (!ad) return []
  const ids = new Set(ad.presenting_biohazard_ids ?? [])
  return allHealthHazardChipItems(ad).filter(i => ids.has(i.id))
}

/** Deprecated alias — use presentingHealthHazardsFromAssessment. */
export const presentingBiohazardsFromAssessment = presentingHealthHazardsFromAssessment

export const REQUIRES_PRESENTING_RISKS: ReadonlySet<DocType> = new Set(['jsa', 'swms', 'risk_assessment'])

export const REQUIRES_PRESENTING_HEALTH_HAZARDS: ReadonlySet<DocType> = new Set([
  'sow',
  'quote',
  'report',
  'certificate_of_decontamination',
  'waste_disposal_manifest',
  'authority_to_proceed',
  'engagement_agreement',
])

/** Deprecated alias — use REQUIRES_PRESENTING_HEALTH_HAZARDS. */
export const REQUIRES_PRESENTING_BIOHAZARDS = REQUIRES_PRESENTING_HEALTH_HAZARDS

/** Human-readable block appended to JOB CONTEXT for every build-document call. */
export function hitlSelectionsBlock(
  ad: AssessmentData | null | undefined,
  opts?: HitlContextOptions,
): string {
  const risks = presentingRisksFromAssessment(ad)
  const bios = presentingHealthHazardsFromAssessment(ad)
  const idRisk = ad?.identified_risks_ai?.items ?? []
  const genRisk = ad?.suggested_risks_ai?.items ?? []
  const manRisk = ad?.manual_risk_chips ?? []
  const idBio = ad?.identified_biohazards_ai?.items ?? []
  const genBio = ad?.suggested_biohazards_ai?.items ?? []
  const manBio = ad?.manual_biohazard_chips ?? []
  const riskLines = risks.length
    ? risks
        .map(r => {
          const link =
            r.source_hazard_ids?.length ? ` ← approved hazard id(s): ${r.source_hazard_ids.join(', ')}` : ''
          return `  - [${r.category}] ${r.label} (risk id: ${r.id})${link}`
        })
        .join('\n')
    : '  (none — promote at least one chip under Presenting risks on Assessment → Risks)'
  const bioLines = bios.length
    ? bios.map(b => `  - [${b.category}] ${b.label} (id: ${b.id})`).join('\n')
    : '  (none — promote at least one chip under Presenting health hazards on Assessment → Health Hazards)'
  const idRiskLines = idRisk.length
    ? idRisk.map(r => `  - [${r.category}] ${r.label} (id: ${r.id})`).join('\n')
    : '  (none)'
  const genRiskLines = genRisk.length
    ? genRisk.map(r => `  - [${r.category}] ${r.label} (id: ${r.id})`).join('\n')
    : '  (none)'
  const manRiskLines = manRisk.length
    ? manRisk.map(r => `  - [${r.category}] ${r.label} (id: ${r.id})`).join('\n')
    : '  (none)'
  const idBioLines = idBio.length
    ? idBio.map(b => `  - [${b.category}] ${b.label} (id: ${b.id})`).join('\n')
    : '  (none)'
  const genBioLines = genBio.length
    ? genBio.map(b => `  - [${b.category}] ${b.label} (id: ${b.id})`).join('\n')
    : '  (none)'
  const manBioLines = manBio.length
    ? manBio.map(b => `  - [${b.category}] ${b.label} (id: ${b.id})`).join('\n')
    : '  (none)'
  const recs = presentingRecommendationsFromAssessment(ad)
  const recsLines = recs.length
    ? recs
        .map(r => `  - [${r.audience}] ${r.label}${r.rationale ? ` — ${r.rationale}` : ''} (id: ${r.id})`)
        .join('\n')
    : '  (none — promote at least one chip under Presenting recommendations on Assessment → Recommendations)'

  const equipment = resolveJobEquipment(ad, opts?.equipmentCatalogue ?? null)
  const equipmentLines = equipment.length
    ? equipment
        .map(e =>
          `  - [${e.category}] ${e.name}${e.notes ? ` — ${e.notes}` : ''} (${e.source})`,
        )
        .join('\n')
    : '  (none — tick catalogue rows or add ad-hoc on Assessment → Equipment)'

  const chemicals = resolveJobChemicals(ad, opts?.chemicalsCatalogue ?? null)
  const chemicalsLines = chemicals.length
    ? chemicals
        .map(c => {
          const hazards = c.hazard_classes.length ? ` · hazards: ${c.hazard_classes.join(', ')}` : ''
          const dilution = c.dilution ? ` · dilution: ${c.dilution}` : ''
          const signal = c.signal_word ? ` · signal: ${c.signal_word.toUpperCase()}` : ''
          const ppe = c.ppe_required?.length ? ` · SDS PPE: ${c.ppe_required.join('; ')}` : ''
          const handling = c.handling_precautions
            ? ` · handling: ${c.handling_precautions}`
            : ''
          const firstAid = c.first_aid_summary ? ` · first-aid: ${c.first_aid_summary}` : ''
          const mfr = c.manufacturer ? ` [${c.manufacturer}]` : ''
          const active = c.active_ingredient ? ` [${c.active_ingredient}]` : ''
          return `  - ${c.name}${mfr}${active} · ${c.application}${dilution}${hazards}${signal}${ppe}${handling}${firstAid} (${c.source})`
        })
        .join('\n')
    : '  (none — tick catalogue rows or add ad-hoc on Assessment → Chemicals)'

  const contents = jobContentsItems(ad)
  const contentsLines = contents.length
    ? contents
        .map(i => {
          const qty = i.quantity > 1 ? `×${i.quantity} ` : ''
          const val = i.replacement_value
            ? ` · est. value $${i.replacement_value}`
            : ''
          const notes = i.notes ? ` · ${i.notes}` : ''
          return `  - [${i.room}] ${qty}${i.name} (${i.category}) · disposition: ${i.disposition}${val}${notes}`
        })
        .join('\n')
    : '  (none — add inventory on Assessment → Contents)'

  const structure = jobStructureItems(ad)
  const structureLines = structure.length
    ? structure
        .map(s => {
          const notes = s.notes ? ` · ${s.notes}` : ''
          return `  - [${s.room}] ${s.element} — condition: ${s.condition} · action: ${s.action}${notes}`
        })
        .join('\n')
    : '  (none — add assessments on Assessment → Structure)'

  return `
HITL — CONFIRMED ASSESSMENT CHIPS (staff promoted these; treat as binding alongside assessment text and photos):
PRESENTING RISKS (Assessment → Risks):
${riskLines}
RISK CANDIDATES — IDENTIFIED FROM PRESENTATION (strict source):
${idRiskLines}
RISK CANDIDATES — SUGGESTED (Generate):
${genRiskLines}
RISK CANDIDATES — MANUAL (technician):
${manRiskLines}
PRESENTING HEALTH HAZARDS (Assessment → Health Hazards):
${bioLines}
HEALTH HAZARD CANDIDATES — IDENTIFIED FROM PRESENTATION (strict source):
${idBioLines}
HEALTH HAZARD CANDIDATES — SUGGESTED FROM PRESENTING RISKS (Generate):
${genBioLines}
HEALTH HAZARD CANDIDATES — MANUAL (technician):
${manBioLines}
PRESENTING RECOMMENDATIONS (Assessment → Recommendations):
${recsLines}
EQUIPMENT — IN USE ON THIS JOB (Assessment → Equipment; catalogue + ad-hoc):
${equipmentLines}
CHEMICALS — IN USE ON THIS JOB (Assessment → Chemicals; catalogue uses include SDS-parsed PPE + handling):
${chemicalsLines}
CONTENTS INVENTORY (Assessment → Contents; salvage / decontaminate / discard / undetermined per item):
${contentsLines}
STRUCTURE ASSESSMENT (Assessment → Structure; element condition + remediation action per room):
${structureLines}`.trim()
}

/** Pre-flight: block generation when required HITL list is empty. */
export function validateBuildDocument(type: DocType, job: Job): string | null {
  const ad = job.assessment_data
  if (REQUIRES_PRESENTING_RISKS.has(type)) {
    if (presentingRisksFromAssessment(ad).length === 0) {
      return 'Add at least one risk to Presenting risks on Assessment → Risks before generating this document.'
    }
  }
  if (REQUIRES_PRESENTING_HEALTH_HAZARDS.has(type)) {
    if (presentingHealthHazardsFromAssessment(ad).length === 0) {
      return 'Add at least one health hazard to Presenting health hazards on Assessment → Health Hazards before generating this document.'
    }
  }
  return null
}

/** Per-doc-type instructions so the model weights chips consistently. */
export function documentDriverInstructions(type: DocType, ad?: AssessmentData | null): string {
  if (type === 'nda') {
    return `HITL ROUTING FOR THIS DOCUMENT:
- If PRESENTING RISKS or PRESENTING HEALTH HAZARDS appear in JOB CONTEXT, do not contradict them.
- Keep legal language generic; do not invent site contamination facts beyond JOB CONTEXT.`
  }
  if (REQUIRES_PRESENTING_RISKS.has(type)) {
    return `HITL ROUTING FOR THIS DOCUMENT (MANDATORY):
- Primary source for hazards, controls, risk ratings, and step-by-step safety content: the PRESENTING RISKS list in JOB CONTEXT.
- Ground each major hazard and control in that list (plus assessment facts). Use PRESENTING HEALTH HAZARDS only as supporting context where directly relevant.
- Do not invent hazards or controls not supported by presenting risks + JOB CONTEXT.
- Populate ppe_required using: (1) every entry under EQUIPMENT — IN USE with category "ppe", then (2) the union of "SDS PPE" items listed under CHEMICALS — IN USE. Do not add PPE that is not implied by either list (unless a presenting risk demands it).
- Use CHEMICALS — IN USE to populate emergency_procedures (first-aid cues and signal words) and to shape individual step "controls" / "hazards" fields whenever that step applies a chemical. Respect the per-chemical "handling" text.
- Use EQUIPMENT — IN USE to name tools and containment in each step. Do not invent equipment not listed.
- Use PRESENTING RECOMMENDATIONS where a control or step corresponds to a recommended action — quote or paraphrase the recommendation label in the "controls" field.`
  }
  if (REQUIRES_PRESENTING_HEALTH_HAZARDS.has(type)) {
    let block = `HITL ROUTING FOR THIS DOCUMENT (MANDATORY):
- Primary source for scope of work, operational detail, products/equipment implications, and waste characterisation: the PRESENTING HEALTH HAZARDS list in JOB CONTEXT.
- Ground scope and remediation narrative in that list (plus assessment facts). Use PRESENTING RISKS for safety framing and exclusions where relevant.
- Do not invent contamination types or work scope not supported by presenting health hazards + JOB CONTEXT.
- Use EQUIPMENT — IN USE and CHEMICALS — IN USE to describe the actual tools, chemistry, dilution, and application method on site. Do not invent equipment or chemicals that are not listed.
- Use PRESENTING RECOMMENDATIONS to populate the recommendations / exclusions / next-steps narrative. Prefer the chip "label" verbatim (or closely paraphrased) so the tech's terminology carries through.
- Where CONTENTS INVENTORY lists items flagged "discard" or "decontaminate", acknowledge them in the scope/waste narrative. Ignore items flagged "salvage" unless the job is specifically a contents-pack-out.
- Where STRUCTURE ASSESSMENT lists elements flagged "remediate", "replace", or "demolish", include those works in the scope. Elements flagged "monitor" or "clean" can be summarised at a higher level.`
    if (type === 'sow' && staffSowHasContent(ad)) {
      block += `

STAFF SOW CAPTURE: When "SCOPE OF WORK — STAFF CAPTURE" appears in JOB CONTEXT with labelled lines, align executive_summary, scope, methodology, timeline, safety_protocols, waste_disposal, exclusions, and disclaimer with those staff-authored statements. Do not contradict staff capture.`
    }
    if (type === 'quote') {
      block += `

QUOTE GROUNDING: Use EQUIPMENT — IN USE and CHEMICALS — IN USE to inform materials/labour lines and site-specific assumptions. Use CONTENTS INVENTORY to scope pack-out / disposal fees when items are flagged "discard" or "decontaminate". Use STRUCTURE ASSESSMENT to scope demolition / replacement line items.`
    }
    if (type === 'report' || type === 'certificate_of_decontamination' || type === 'waste_disposal_manifest') {
      block += `

COMPLETION GROUNDING: Where a CONTENTS item or STRUCTURE element was "discard" / "demolish" / "replace", reflect that disposition in the report/certificate/manifest narrative. The CHEMICALS — IN USE list is the source of truth for what was applied; do not fabricate products.`
    }
    return block
  }
  if (type === 'assessment_document') {
    return `HITL ROUTING FOR THIS DOCUMENT:
- When "ASSESSMENT DOCUMENT — STAFF CAPTURE" appears in JOB CONTEXT with labelled lines, align site_summary, hazards_overview, risks_overview, control_measures, recommendations, and limitations with those staff-authored statements. Do not contradict staff capture.
- When staff capture is absent or sparse, synthesise from the HITL lists:
    * hazards_overview ← PRESENTING HEALTH HAZARDS (group by category, short prose).
    * risks_overview ← PRESENTING RISKS (tie each risk back to a health hazard where source_hazard_ids shows the link).
    * control_measures ← EQUIPMENT — IN USE + CHEMICALS — IN USE (with SDS-parsed handling) + PRESENTING RECOMMENDATIONS.
    * recommendations ← PRESENTING RECOMMENDATIONS verbatim where possible (preserve audience distinction: client vs insurer vs occupant vs internal).
    * limitations ← scope cautions implied by undetermined contents, access restrictions, or gaps in structure assessment.
- Ground narrative in assessment facts and photos; do not invent site conditions beyond JOB CONTEXT.`
  }
  return ''
}
