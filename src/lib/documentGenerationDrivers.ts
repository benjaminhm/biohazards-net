/*
 * Routes document generation to HITL-confirmed Assessment chips:
 * - Presenting risks (Risks tab) → JSA, SWMS, Risk Assessment
 * - Presenting hazards (Assessment → Hazards tab) → SOW, quote, report, ATP, engagement, COD, WDM
 *
 * Add new DocTypes by extending REQUIRES_* sets and documentDriverInstructions.
 */
import type { AssessmentData, DocType, Job, SuggestedRiskAiItem } from '@/lib/types'
import { staffSowHasContent } from '@/lib/sowCapture'

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

/** Union of Identify + Generate + manual hazard chips (manual wins on same id). */
export function allBiohazardChipItems(ad: AssessmentData | null | undefined): SuggestedRiskAiItem[] {
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

/** Hazards the user moved into "Presenting" on Assessment → Hazards. */
export function presentingBiohazardsFromAssessment(ad: AssessmentData | null | undefined): SuggestedRiskAiItem[] {
  if (!ad) return []
  const ids = new Set(ad.presenting_biohazard_ids ?? [])
  return allBiohazardChipItems(ad).filter(i => ids.has(i.id))
}

export const REQUIRES_PRESENTING_RISKS: ReadonlySet<DocType> = new Set(['jsa', 'swms', 'risk_assessment'])

export const REQUIRES_PRESENTING_BIOHAZARDS: ReadonlySet<DocType> = new Set([
  'sow',
  'quote',
  'report',
  'certificate_of_decontamination',
  'waste_disposal_manifest',
  'authority_to_proceed',
  'engagement_agreement',
])

/** Human-readable block appended to JOB CONTEXT for every build-document call. */
export function hitlSelectionsBlock(ad: AssessmentData | null | undefined): string {
  const risks = presentingRisksFromAssessment(ad)
  const bios = presentingBiohazardsFromAssessment(ad)
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
    : '  (none — promote at least one chip under Presenting hazards on Assessment → Hazards)'
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
PRESENTING HAZARDS (Assessment → Hazards):
${bioLines}
HAZARD CANDIDATES — IDENTIFIED FROM PRESENTATION (strict source):
${idBioLines}
HAZARD CANDIDATES — SUGGESTED FROM PRESENTING RISKS (Generate):
${genBioLines}
HAZARD CANDIDATES — MANUAL (technician):
${manBioLines}`.trim()
}

/** Pre-flight: block generation when required HITL list is empty. */
export function validateBuildDocument(type: DocType, job: Job): string | null {
  const ad = job.assessment_data
  if (REQUIRES_PRESENTING_RISKS.has(type)) {
    if (presentingRisksFromAssessment(ad).length === 0) {
      return 'Add at least one risk to Presenting risks on Assessment → Risks before generating this document.'
    }
  }
  if (REQUIRES_PRESENTING_BIOHAZARDS.has(type)) {
    if (presentingBiohazardsFromAssessment(ad).length === 0) {
      return 'Add at least one hazard to Presenting hazards on Assessment → Hazards before generating this document.'
    }
  }
  return null
}

/** Per-doc-type instructions so the model weights chips consistently. */
export function documentDriverInstructions(type: DocType, ad?: AssessmentData | null): string {
  if (type === 'nda') {
    return `HITL ROUTING FOR THIS DOCUMENT:
- If PRESENTING RISKS or PRESENTING HAZARDS appear in JOB CONTEXT, do not contradict them.
- Keep legal language generic; do not invent site contamination facts beyond JOB CONTEXT.`
  }
  if (REQUIRES_PRESENTING_RISKS.has(type)) {
    return `HITL ROUTING FOR THIS DOCUMENT (MANDATORY):
- Primary source for hazards, controls, risk ratings, and step-by-step safety content: the PRESENTING RISKS list in JOB CONTEXT.
- Ground each major hazard and control in that list (plus assessment facts). Use PRESENTING HAZARDS only as supporting context where directly relevant.
- Do not invent hazards or controls not supported by presenting risks + JOB CONTEXT.`
  }
  if (REQUIRES_PRESENTING_BIOHAZARDS.has(type)) {
    let block = `HITL ROUTING FOR THIS DOCUMENT (MANDATORY):
- Primary source for scope of work, operational detail, products/equipment implications, and waste characterisation: the PRESENTING HAZARDS list in JOB CONTEXT.
- Ground scope and remediation narrative in that list (plus assessment facts). Use PRESENTING RISKS for safety framing and exclusions where relevant.
- Do not invent contamination types or work scope not supported by presenting hazards + JOB CONTEXT.`
    if (type === 'sow' && staffSowHasContent(ad)) {
      block += `

STAFF SOW CAPTURE: When "SCOPE OF WORK — STAFF CAPTURE" appears in JOB CONTEXT with labelled lines, align executive_summary, scope, methodology, timeline, safety_protocols, waste_disposal, exclusions, and disclaimer with those staff-authored statements. Do not contradict staff capture.`
    }
    return block
  }
  if (type === 'assessment_document') {
    return `HITL ROUTING FOR THIS DOCUMENT:
- When "ASSESSMENT DOCUMENT — STAFF CAPTURE" appears in JOB CONTEXT with labelled lines, align site_summary, hazards_overview, risks_overview, control_measures, recommendations, and limitations with those staff-authored statements. Do not contradict staff capture.
- Ground narrative in assessment facts and photos; do not invent site conditions beyond JOB CONTEXT.`
  }
  return ''
}
