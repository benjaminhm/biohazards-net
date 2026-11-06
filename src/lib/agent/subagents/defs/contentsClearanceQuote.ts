import { contentsClearanceCaptureFigures, normalizeContentsClearanceCapture } from '@/lib/contentsClearanceQuote'
import { CLEARANCE_FLAG_CLAUSE_LABEL, CLEARANCE_FLAG_TEXT, clearanceClauseFlags } from '@/lib/contentsClearanceFlags'
import { PRICE_RULE, companyClauses, compose, notStarted } from '../common'
import { DOC_AGENT_LABEL } from '../labels'
import type { DocAgentDef } from '../types'

export const contentsClearanceQuoteAgent: DocAgentDef = {
  type: 'contents_clearance_quote',
  label: DOC_AGENT_LABEL.contents_clearance_quote.agent,
  docLabel: DOC_AGENT_LABEL.contents_clearance_quote.doc,
  captureKey: 'contents_clearance_quote',
  documentType: 'contents_clearance_quote',
  readCaptures: ['disposal_manifest_capture', 'house_survey', 'areas'],
  readDocumentTypes: ['waste_disposal_manifest', 'house_survey'],
  extraReads: ['calls', 'acceptances'],
  shape: `contents_clearance_quote:
- Volume and labour: clearance_kind, estimated_m3, m3_per_labour_day, maximum_man_days (labour days, required to generate).
- Travel and tip: estimated_km, job_address, tip_address, return_trip_km, return_trips, m3_per_trip, trips_per_day.
- Rates and disposal: rate_per_m3, rate_per_km, rate_per_labour_day, disposal_rate_per_tonne, estimated_tonnes.
- Fees: mobilisation_fee, mobilisation_waived, mobilisation_reason.`,
  rules: `- ${PRICE_RULE}
- estimated_m3 comes from what staff or the caller said, or the CDR when staff ask. Say when the CDR volume differs from the quoted estimate.
- Generating needs labour days, and the clause check must pass (clauses must not contradict the figures). draft_generate tells you what fails.`,
  requiredFields: ['maximum_man_days'],
  generateNeeds: ['company'],
  generate: inputs => {
    const raw = inputs.job.assessment_data?.contents_clearance_quote
    if (raw == null) return notStarted('Contents Clearance Quote')
    const capture = normalizeContentsClearanceCapture(raw)
    if (!(capture.maximum_man_days != null && capture.maximum_man_days > 0)) return { ok: false, reason: 'Enter the labour days before generating the quote.' }
    const { clearance } = companyClauses(inputs.company)
    const flags = clearanceClauseFlags(contentsClearanceCaptureFigures(capture), clearance)
    if (flags.length) {
      const text = flags.map(f => `${CLEARANCE_FLAG_CLAUSE_LABEL[f.clause]}: ${CLEARANCE_FLAG_TEXT[f.code]}`).join(' ')
      return { ok: false, reason: `The clause check found: ${text} Fix these first, or staff can accept them in the quote tab.` }
    }
    return compose('contents_clearance_quote', inputs, { contentsClearanceStandards: clearance })
  },
}
