import { statementAgentFigures, statementInputsDraft, statementPatchProblem, type StatementInputs } from '../../statementDraft'
import { bcqRecordSummary, cdrSummary, surveySummary } from '../../recordSummaries'
import { composeStatementForJob } from '../../statementGenerate'
import { ToolError } from '../../loop'
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
    { capture: 'biohazard_cleaning_record', documentType: 'house_survey', key: 'bcq_record_summary', summarise: bcqRecordSummary },
  ],
  readDocumentTypes: ['biohazard_cleaning_quote', 'contents_clearance_quote', 'surface_area_cleaning_quote', 'quote'],
  extraReads: ['acceptances', 'xero'],
  shape: `statement_of_accounts (model_version 2). Staff inputs only:
- deposit_amount + deposit_date (YYYY-MM-DD; required with a deposit).
- manual_adjustment (signed dollars, optional) + manual_adjustment_reason (required with an adjustment).
- invoice_number, invoice_url (the job's one invoice and its payment link).
- charges_gst: one GST setting for the statement; inputs are inc GST when it is true.
Everything else is calculated, never typed: Surface cleaning (survey_summary total), Contents removal (cdr_summary total), Biohazard cleaning (bcq_record_summary total, or the BCQ total when the BCQ is fixed price), Job total ex GST, GST, Job total inc GST, Less deposit paid, Adjustment, Balance owing (or Credit). The quotes appear only as an "original estimates" paragraph.
survey_summary, cdr_summary and bcq_record_summary are computed from the House Survey, the Contents Disposal Record and the Biohazard Cleaning Record (read only; you never see the records themselves).`,
  rules: `- You do not calculate the statement. statement_figures shows it as it stands, with its flags.
- Draft inputs only when staff ask, with draft_statement_inputs and the values they state. A deposit read from Xero is staff's to confirm; never write to Xero.
- Flag, do not fix: a missing House Survey, CDR or Biohazard Cleaning Record behind a quote, a deposit without a date, a deposit not about half the quotes (suggested_deposit), an adjustment without a reason.
- A summary with exists false means that record is not started: say so, do not guess its figures.
- Generate only when statement_figures has no flags that block it; draft_generate runs the same checks and tells you what fails.`,
  unique: true,
  generateNeeds: ['documents'],
  patchProblem: statementPatchProblem,
  generate: ({ job, documents }) => composeStatementForJob(job, documents),
  extraTools: api => [
    {
      name: 'statement_figures',
      description: 'The statement as it calculates now: survey_summary, cdr_summary, bcq_record_summary, the summary lines, deposit, adjustment and balance, the original estimates, suggested_deposit and flags. Read only.',
      input_schema: { type: 'object', properties: {} },
      run: async () => statementAgentFigures(await api.readAssessment()),
    },
    {
      name: 'draft_statement_inputs',
      description: 'Draft the staff inputs: deposit_amount, deposit_date, manual_adjustment, manual_adjustment_reason, invoice_number, invoice_url. Only the ones given change. Plain numbers, inc GST when the statement charges GST.',
      input_schema: {
        type: 'object',
        properties: {
          deposit_amount: { type: ['number', 'null'] },
          deposit_date: { type: 'string', description: 'YYYY-MM-DD' },
          manual_adjustment: { type: ['number', 'null'], description: 'Signed. Negative reduces the balance.' },
          manual_adjustment_reason: { type: 'string' },
          invoice_number: { type: 'string' },
          invoice_url: { type: 'string' },
          summary: { type: 'string', description: 'One line for the change card.' },
        },
      },
      run: async (_ctx, input) => {
        const { summary, ...inputs } = input as StatementInputs & { summary?: string }
        const problem = statementPatchProblem(inputs)
        if (problem) throw new ToolError(problem)
        const draft = statementInputsDraft(await api.readAssessment(), inputs)
        if (!draft) return { drafted: false, note: 'The statement already has these values.' }
        const id = await api.draftOwnPatch(draft, summary || 'Statement of Accounts inputs')
        return { draft_id: id, paths: Object.keys(draft.proposed) }
      },
    },
  ],
}
