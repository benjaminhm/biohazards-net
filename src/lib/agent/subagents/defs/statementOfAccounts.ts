import { buildStatementDraft, statementAgentFigures, statementPatchProblem } from '../../statementDraft'
import { cdrSummary, surveySummary } from '../../recordSummaries'
import { composeStatementForJob } from '../../statementGenerate'
import { DOC_AGENT_LABEL } from '../labels'
import type { DocAgentDef } from '../types'

export const statementOfAccountsAgent: DocAgentDef = {
  type: 'statement_of_accounts',
  label: DOC_AGENT_LABEL.statement_of_accounts.agent,
  docLabel: DOC_AGENT_LABEL.statement_of_accounts.doc,
  captureKey: 'statement_of_accounts',
  documentType: 'statement_of_accounts',
  reads: 'full',
  readCaptures: ['biohazard_cleaning_quote', 'contents_clearance_quote', 'surface_area_cleaning_quote'],
  summarised: [
    { capture: 'house_survey', documentType: 'house_survey', key: 'survey_summary', summarise: surveySummary },
    { capture: 'disposal_manifest_capture', documentType: 'waste_disposal_manifest', key: 'cdr_summary', summarise: cdrSummary },
  ],
  readDocumentTypes: ['biohazard_cleaning_quote', 'contents_clearance_quote', 'surface_area_cleaning_quote', 'quote'],
  extraReads: ['acceptances', 'xero'],
  shape: `statement_of_accounts:
- Quantities: survey_areas [{label, sqm, total}] (rooms from the House Survey), invoice2_m3 (CDR cubic metres). The only quantity fields.
- Invoice 1 dollars: invoice1_amount; breakdown invoice1_callout, invoice1_contents, invoice1_cleaning (filled lines must add up to invoice1_amount); invoice1_adjusted_amount (invoice 1 after the surfaces were measured again) + adjustment_reason (reason required).
- Invoice 2 (contents) dollars: invoice2_amount; stored breakdown invoice2_skips, invoice2_trailers, invoice2_utes, invoice2_tip_receipts, less invoice2_prepaid (filled lines must add up to invoice2_amount).
- Deposit: deposit_taken (true/false), deposit_amount, deposit_includes_gst, deposit_date.
- manual_adjustment (signed dollars on the last invoice) + manual_adjustment_reason (required).
- original_invoice_number/url, new_invoice_number/url (payment links), charges_gst.
Survey and CDR: you read survey_summary and cdr_summary only (computed from the House Survey and the Contents Disposal Record, read only). Each has exists (false until the record is started), quantity and unit, rate_ex_gst, line_amount_ex_gst (quantity × rate), labour_days, rate_per_labour_day_ex_gst, labour_amount_ex_gst, callout_fee_ex_gst, total_ex_gst, gst, total_inc_gst.
Generated document (one pass, three sections): 1. Survey Rooms, 2. Contents Disposal Record, 3. Invoice Summary (invoice 1 and 2 breakdowns, deposit, adjustments with reasons, total owing). The survey and CDR sections are copied from the records when it is generated; regenerate to pick up later edits. A missing survey or CDR prints "Not applicable". Total owing comes from the invoice figures alone.`,
  rules: `- survey_summary and cdr_summary are THE reference for what the House Survey and the CDR actually cost. Never use skip, trailer, ute or tip pricing, prepaid volume or a CDR waste charge, and never fill invoice2_skips, invoice2_trailers, invoice2_utes, invoice2_tip_receipts or invoice2_prepaid from the survey or CDR.
- Quantities: use fill_quantities_from_survey_and_cdr. It never fills dollars.
- Dollar and text fields: only values the staff member states, or tells you to take from the summaries (survey_and_cdr_figures lists each summary total and the statement field it fits: survey → invoice1_adjusted_amount, CDR → invoice2_amount). Plain numbers, inc GST when charges_gst. If stored invoice 2 breakdown lines no longer add up to a new invoice2_amount, tell staff; do not change them unless asked.
- A summary with exists false means that record is not started: say so, do not guess its figures.
- Generate only when breakdowns add up and reasons are present; draft_generate runs the same checks and tells you what fails.`,
  unique: true,
  requiredFields: ['invoice1_amount'],
  generateNeeds: ['documents'],
  patchProblem: statementPatchProblem,
  generate: ({ job, documents }) => composeStatementForJob(job, documents),
  extraTools: api => [
    {
      name: 'survey_and_cdr_figures',
      description: 'The House Survey and CDR summaries (survey_summary, cdr_summary), each summary total with the statement field it fits, and the statement as it stands. Read only.',
      input_schema: { type: 'object', properties: {} },
      run: async () => statementAgentFigures(await api.readAssessment()),
    },
    {
      name: 'fill_quantities_from_survey_and_cdr',
      description: 'Draft survey_areas (House Survey rooms) and invoice2_m3 (cdr_summary quantity). Quantities only.',
      input_schema: { type: 'object', properties: {} },
      run: async () => {
        const r = buildStatementDraft(await api.readAssessment())
        if (!r.ok) return { skipped: r.reason }
        const id = await api.draftOwnPatch({ before: r.before, proposed: r.proposed as Record<string, unknown> }, r.summary)
        return { draft_id: id, drafted: r.summary }
      },
    },
  ],
}
