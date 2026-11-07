import { completionReportCaptureHasContent, mergedCompletionReportCapture } from '@/lib/completionReportCapture'
import { compose } from '../common'
import { DOC_AGENT_LABEL } from '../labels'
import type { DocAgentDef } from '../types'

export const completionReportAgent: DocAgentDef = {
  type: 'completion_report',
  label: DOC_AGENT_LABEL.completion_report.agent,
  docLabel: DOC_AGENT_LABEL.completion_report.doc,
  captureKey: 'completion_report_capture',
  documentType: 'report',
  readCaptures: ['sow_capture', 'areas', 'house_survey', 'disposal_manifest_capture', 'biohazard_cleaning_record', 'post_remediation_evaluations', 'pre_multi_part'],
  readDocumentTypes: ['sow', 'house_survey', 'waste_disposal_manifest'],
  extraReads: ['progress_notes', 'photos'],
  shape: `completion_report_capture (all text): executive_summary, site_conditions, works_carried_out, methodology, products_used, waste_disposal, photo_record, outcome, technician_signoff.`,
  rules: `- The report states what was done. Write from the records, progress notes, photos, PRE and Scope of Work only; never from quotes.
- Figures come only from the records: rooms and measured m² from the House Survey (house_survey), counted m³, loads, vehicles, load dates and the disposal facility from the Contents Disposal Record (disposal_manifest_capture), zones, measured m² and tests done from the Biohazard Cleaning Record (biohazard_cleaning_record). A figure not in a record is left out, never estimated.
- Never state prices, rates, totals, quoted or estimated figures, or mention quotes. Limitations come from the Scope of Work exclusions, areas not accessed, and a standard testing disclaimer.
- Refer to report sections by title only; never "Part" or letters. Neutral, factual, client-facing. No made-up products, volumes or dates.
- photo_record describes the photo set in plain words; no app metadata (categories, ids, upload times).
- Generating needs something in the report capture. The document is composed with the job's report photos and notes.`,
  unique: true,
  requiredFields: [],
  generateNeeds: ['company', 'report_media'],
  generate: inputs => {
    if (!completionReportCaptureHasContent(mergedCompletionReportCapture(inputs.job.assessment_data))) {
      return { ok: false, reason: 'The completion report has nothing written yet.' }
    }
    return compose('report', inputs, {
      report: { photos: inputs.photos, progressNotes: inputs.progressNotes, progressRoomNotes: inputs.progressRoomNotes },
    })
  },
}
