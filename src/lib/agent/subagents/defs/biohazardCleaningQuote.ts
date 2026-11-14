import { normalizeBiohazardCleaningCapture } from '@/lib/biohazardCleaningQuote'
import { biohazardCheckContext, biohazardFlagText, biohazardRuleFlags } from '@/lib/biohazardCleaningCheck'
import { PRICE_RULE, companyClauses, compose, notStarted } from '../common'
import { DOC_AGENT_LABEL } from '../labels'
import type { DocAgentDef } from '../types'

export const biohazardCleaningQuoteAgent: DocAgentDef = {
  type: 'biohazard_cleaning_quote',
  label: DOC_AGENT_LABEL.biohazard_cleaning_quote.agent,
  docLabel: DOC_AGENT_LABEL.biohazard_cleaning_quote.doc,
  captureKey: 'biohazard_cleaning_quote',
  documentType: 'biohazard_cleaning_quote',
  readCaptures: ['house_survey', 'areas', 'sow_capture', 'assessment_document_capture', 'surface_area_cleaning_quote'],
  readDocumentTypes: ['house_survey', 'assessment_document', 'sow'],
  extraReads: ['calls', 'progress_notes', 'acceptances'],
  shape: `biohazard_cleaning_quote:
- Actions on this quote: actions [] from remove, wash, sanitise, deodorise. Leave null for a full clean. A triage that only removes contents is ["remove"]; steps, inclusions and check stages for the others are left off.
- Wording: cleaning_kind, biohazard_types [], areas_affected, description, objective, rooms [], clauses (from the company template unless edited).
- Zones: estimated_m2, rate_per_m2; secondary_zone, secondary_contaminations, secondary_objective, secondary_m2, secondary_rooms, secondary_rate_per_m2; other_zones [].
- Affected contents removal (mattress, carpet, couch, clothing; not a contents clearance): contents_items [], contents_m3, contents_rate_per_m3, contents_disposal_fee (one fee). Line = m³ × rate, plus the disposal fee.
- Labour and travel: labour_days (required to generate), rate_per_labour_day, rate_per_km, travel_km, job_address, base_address.
- Fees and tests: mobilisation_fee/waived/reason, extra_lines [], coh_rap/coh_rap_fee, atp_testing/atp_tests/atp_rate, lab_testing/lab_tests/lab_rate.
- check_override: set by staff only.`,
  rules: `- ${PRICE_RULE} A new quote starts with every price blank.
- Use the assessment, survey and calls for wording and m² only; neutral, factual words.
- Generating needs labour_days, and the quote check must pass (scope stages, assessed areas and hazards covered, required fields). draft_generate tells you what fails; staff can accept flags from the quote tab themselves.
- Never touch check_override.`,
  requiredFields: ['labour_days'],
  generateNeeds: ['company'],
  patchProblem: patch => (patch && typeof patch === 'object' && 'check_override' in patch ? 'check_override is set by staff in the quote tab.' : null),
  generate: inputs => {
    const raw = inputs.job.assessment_data?.biohazard_cleaning_quote
    if (raw == null) return notStarted('Biohazard Cleaning Quote')
    const capture = normalizeBiohazardCleaningCapture(raw)
    if (!(capture.labour_days != null && capture.labour_days > 0)) return { ok: false, reason: 'Enter the labour days before generating the quote.' }
    const { biohazardTemplate, companyAddress } = companyClauses(inputs.company)
    const accepted = new Set(capture.check_override?.codes ?? [])
    const flags = biohazardRuleFlags({ ...capture, clauses: capture.clauses ?? biohazardTemplate }, biohazardCheckContext(inputs.job, companyAddress), biohazardTemplate)
      .filter(f => !accepted.has(f.code))
    if (flags.length) {
      return { ok: false, reason: `The quote check found: ${flags.map(f => biohazardFlagText(f)).join(' ')} Fix these first, or staff can accept them in the quote tab.` }
    }
    return compose('biohazard_cleaning_quote', inputs, { biohazardCleaningTemplate: biohazardTemplate })
  },
}
