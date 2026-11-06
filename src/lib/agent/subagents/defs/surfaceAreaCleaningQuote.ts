import { normalizeSurfaceAreaCleaningCapture } from '@/lib/surfaceAreaCleaningQuote'
import { PRICE_RULE, companyClauses, compose, notStarted } from '../common'
import { DOC_AGENT_LABEL } from '../labels'
import type { DocAgentDef } from '../types'

export const surfaceAreaCleaningQuoteAgent: DocAgentDef = {
  type: 'surface_area_cleaning_quote',
  label: DOC_AGENT_LABEL.surface_area_cleaning_quote.agent,
  docLabel: DOC_AGENT_LABEL.surface_area_cleaning_quote.doc,
  captureKey: 'surface_area_cleaning_quote',
  documentType: 'surface_area_cleaning_quote',
  readCaptures: ['house_survey', 'areas', 'sow_capture'],
  readDocumentTypes: ['house_survey'],
  extraReads: ['calls', 'acceptances'],
  shape: `surface_area_cleaning_quote:
- Wording: cleaning_kind, custom_title, title_addition, presentation, objective, scope_of_work, rooms [], exclude_ceiling.
- Quantities: estimated_m2, labour_days (required to generate).
- Rates and fees: rate_per_m2, rate_per_labour_day, mobilisation_fee, mobilisation_waived, mobilisation_reason, other_lines [].
- job_address.`,
  rules: `- ${PRICE_RULE}
- estimated_m2 and rooms may come from the House Survey when staff ask.
- Generating needs labour_days.`,
  requiredFields: ['labour_days'],
  generateNeeds: ['company'],
  generate: inputs => {
    const raw = inputs.job.assessment_data?.surface_area_cleaning_quote
    if (raw == null) return notStarted('Surface Area Cleaning Quote')
    const capture = normalizeSurfaceAreaCleaningCapture(raw)
    if (!(capture.labour_days != null && capture.labour_days > 0)) return { ok: false, reason: 'Enter the labour days before generating the quote.' }
    return compose('surface_area_cleaning_quote', inputs, { surfaceAreaCleaningStandards: companyClauses(inputs.company).surface })
  },
}
