import { loadHasContent, mergedDisposalManifestCapture } from '@/lib/disposalManifest'
import { compose, notStarted } from '../common'
import { DOC_AGENT_LABEL } from '../labels'
import type { DocAgentDef } from '../types'

export const wasteDisposalManifestAgent: DocAgentDef = {
  type: 'waste_disposal_manifest',
  label: DOC_AGENT_LABEL.waste_disposal_manifest.agent,
  docLabel: DOC_AGENT_LABEL.waste_disposal_manifest.doc,
  captureKey: 'disposal_manifest_capture',
  documentType: 'waste_disposal_manifest',
  readCaptures: ['contents_clearance_quote'],
  readDocumentTypes: ['contents_clearance_quote'],
  extraReads: ['photos', 'progress_notes'],
  shape: `disposal_manifest_capture (CDR):
- cost_per_m3 (dollars per m³), prepaid_m3.
- defaults: vehicle_type (trailer|ute|skip|other), size, length_m, width_m, height_m, location, facility, distance_km.
- loads []: {id, date, vehicles [{id, type, size, length_m, width_m, height_m, contents_type, contents_description, skip_cost, waste_sqm, waste_price, photo_*}], weight_kg, dump_fee, facility, dump_date, distance_km, docket_*, notes}.
- Photos and dockets are attached in the app; do not set photo or docket ids or urls.`,
  rules: `- Loads, weights, dimensions and fees only as staff give them or as read from a docket staff describe. Never invent a load.
- loads is a list: patching it replaces the whole list, so send every load with its existing ids.
- Dollars (cost_per_m3, dump_fee, skip_cost, waste_price) only when staff give them.
- Generating needs at least one load with something on it.`,
  unique: true,
  requiredFields: [],
  generateNeeds: [],
  patchProblem: patch => (JSON.stringify(patch ?? null).match(/"(photo_id|photo_url|docket_photo_id|docket_photo_url|docket_pdf_url)"\s*:\s*"[^"]/) ? 'Photos and dockets are attached in the app, not by the agent.' : null),
  generate: inputs => {
    const raw = inputs.job.assessment_data?.disposal_manifest_capture
    if (raw == null) return notStarted('Contents Disposal Record')
    if (!mergedDisposalManifestCapture(inputs.job.assessment_data).loads.some(loadHasContent)) {
      return { ok: false, reason: 'The Contents Disposal Record has no loads yet.' }
    }
    return compose('waste_disposal_manifest', inputs)
  },
}
