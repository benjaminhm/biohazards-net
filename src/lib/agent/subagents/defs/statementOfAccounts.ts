import { buildStatementDraft, statementPatchProblem, surveyAndDisposalSummary } from '../../statementDraft'
import { composeStatementForJob } from '../../statementGenerate'
import { DOC_AGENT_LABEL } from '../labels'
import type { DocAgentDef } from '../types'

export const statementOfAccountsAgent: DocAgentDef = {
  type: 'statement_of_accounts',
  label: DOC_AGENT_LABEL.statement_of_accounts.agent,
  docLabel: DOC_AGENT_LABEL.statement_of_accounts.doc,
  captureKey: 'statement_of_accounts',
  documentType: 'statement_of_accounts',
  readCaptures: ['house_survey', 'disposal_manifest_capture', 'biohazard_cleaning_quote', 'contents_clearance_quote', 'surface_area_cleaning_quote'],
  readDocumentTypes: ['biohazard_cleaning_quote', 'contents_clearance_quote', 'surface_area_cleaning_quote', 'quote', 'house_survey', 'waste_disposal_manifest'],
  extraReads: ['acceptances', 'xero'],
  shape: `statement_of_accounts:
- Quantities: survey_areas [{label, sqm, total}] (rooms from the House Survey; total is the room's inc-GST price at the survey rate, printed beside it), invoice2_m3 (CDR cubic metres). The only quantity fields.
- Invoice 1 dollars: invoice1_amount; breakdown invoice1_callout, invoice1_contents, invoice1_cleaning (filled lines must add up to invoice1_amount); invoice1_adjusted_amount + adjustment_reason (reason required).
- Invoice 2 dollars: invoice2_amount; breakdown invoice2_skips, invoice2_trailers, invoice2_utes, invoice2_tip_receipts, less invoice2_prepaid (must add up to invoice2_amount). These are dollars, not counts.
- Deposit: deposit_taken (true/false), deposit_amount, deposit_includes_gst, deposit_date.
- manual_adjustment (signed dollars on the last invoice) + manual_adjustment_reason (required).
- original_invoice_number/url, new_invoice_number/url (payment links), charges_gst.`,
  rules: `- Quantities from the survey and CDR: use fill_quantities_from_survey_and_cdr. It never fills dollars. Report which CDR facts have no statement field (loads, vehicles, weight, distance).
- Dollar and text fields: only values the staff member states, or tells you to take from the CDR dollar figures listed by survey_and_cdr_figures. Plain numbers, inc GST when charges_gst.
- Generate only when breakdowns add up and reasons are present; draft_generate runs the same checks and tells you what fails.`,
  generateNeeds: ['documents'],
  patchProblem: statementPatchProblem,
  generate: ({ job, documents }) => composeStatementForJob(job, documents),
  extraTools: api => [
    {
      name: 'survey_and_cdr_figures',
      description: 'House Survey rooms (priced m², price at the survey rate), CDR loads, m³, weight, the CDR facts with no statement field, the CDR dollar figures staff may choose to use, and the statement as it stands.',
      input_schema: { type: 'object', properties: {} },
      run: async () => surveyAndDisposalSummary(await api.readAssessment()),
    },
    {
      name: 'fill_quantities_from_survey_and_cdr',
      description: 'Draft survey_areas and invoice2_m3 from the House Survey and the CDR. Quantities only. Returns cdr_not_on_statement.',
      input_schema: { type: 'object', properties: {} },
      run: async () => {
        const r = buildStatementDraft(await api.readAssessment())
        if (!r.ok) return { skipped: r.reason, cdr_not_on_statement: r.not_on_statement }
        const id = await api.draftOwnPatch({ before: r.before, proposed: r.proposed as Record<string, unknown> }, r.summary)
        return { draft_id: id, drafted: r.proposed, cdr_not_on_statement: r.not_on_statement }
      },
    },
  ],
}
