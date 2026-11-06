/*
 * lib/agent/statementGenerate.ts
 *
 * Generating the Statement of Accounts from an approved file agent draft. Uses
 * the same compose and the same checks as staff pressing Generate on the
 * Statement tab (missing adjustment reasons, then presentStatementDocument's
 * reconciliation). Generating only saves the document; sending, sharing,
 * portal release, reminders and Xero stay with staff.
 */
import type { Document, Job, StatementOfAccountsContent } from '@/lib/types'
import { composeDocumentContent } from '@/lib/composeDocument'
import { StatementReconciliationError, normalizeStatementCapture, presentStatementDocument } from '@/lib/statementOfAccounts'

export const GENERATE_STATEMENT_TARGET = 'generate:statement_of_accounts'

export type StatementCompose =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; reason: string }

export function composeStatementForJob(job: Job, documents: Document[]): StatementCompose {
  const raw = job.assessment_data?.statement_of_accounts
  if (raw == null) return { ok: false, reason: 'The Statement of Accounts has not been started on this job.' }
  const capture = normalizeStatementCapture(raw)
  if (capture.invoice1_adjusted_amount != null && !capture.adjustment_reason.trim()) {
    return { ok: false, reason: 'Enter why invoice 1 changed. The statement needs that reason before it can be generated.' }
  }
  if (capture.manual_adjustment != null && !capture.manual_adjustment_reason.trim()) {
    return { ok: false, reason: 'Enter why the last invoice total changed. The statement needs that reason before it can be generated.' }
  }
  const { content } = composeDocumentContent('statement_of_accounts', job, { documents })
  try {
    presentStatementDocument(content as unknown as StatementOfAccountsContent)
  } catch (err) {
    if (err instanceof StatementReconciliationError) return { ok: false, reason: err.message }
    throw err
  }
  return { ok: true, content: content as Record<string, unknown> }
}
