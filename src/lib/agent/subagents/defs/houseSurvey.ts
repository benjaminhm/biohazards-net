import { normalizeHouseSurvey } from '@/lib/houseSurvey'
import { compose, notStarted } from '../common'
import { DOC_AGENT_LABEL } from '../labels'
import type { DocAgentDef } from '../types'

export const houseSurveyAgent: DocAgentDef = {
  type: 'house_survey',
  label: DOC_AGENT_LABEL.house_survey.agent,
  docLabel: DOC_AGENT_LABEL.house_survey.doc,
  captureKey: 'house_survey',
  documentType: 'house_survey',
  readCaptures: ['areas', 'biohazard_cleaning_quote', 'surface_area_cleaning_quote'],
  readDocumentTypes: [],
  extraReads: ['progress_notes', 'photos'],
  shape: `house_survey:
- price_per_m2 (survey rate, dollars).
- labour_days, rate_per_labour_day, mobilisation_fee (call-out fee, dollars). Fixed charges; null follows the Surface Area Cleaning Quote.
- areas []: {id, title, description, start_note, height_m, legs [{id, turn: left|right, length_m}], adjustments [{id, length_m, width_m, area_m2, effect: exclude|add, surface: floor|ceiling|walls, description}]}.
- Each area is traced by walking its walls: every leg is a length then a left or right turn.`,
  rules: `- Measurements only as staff give them; never invent lengths, heights or adjustments. Keep existing ids; give new areas, legs and adjustments new ids.
- areas is a list: patching it replaces the whole list, so send every area.
- price_per_m2, labour_days, rate_per_labour_day and mobilisation_fee only when staff give them.
- Generating needs at least one area with a measured wall.`,
  unique: true,
  requiredFields: ['price_per_m2'],
  generateNeeds: [],
  generate: inputs => {
    const raw = inputs.job.assessment_data?.house_survey
    if (raw == null) return notStarted('House Survey')
    const measured = normalizeHouseSurvey(raw).areas.some(a => a.legs.some(l => (l.length_m ?? 0) > 0))
    if (!measured) return { ok: false, reason: 'The House Survey has no measured areas yet.' }
    return compose('house_survey', inputs)
  },
}
