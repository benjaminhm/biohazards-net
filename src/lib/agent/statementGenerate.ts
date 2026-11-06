/*
 * lib/agent/statementGenerate.ts
 *
 * Generating the Statement of Accounts from an approved file agent draft. Uses
 * the same compose and the same checks as staff pressing Generate on the
 * Statement tab (statementV2Figures' problems: a missing record, deposit date
 * or adjustment reason). Generating only saves the document; sending, sharing,
 * portal release, reminders and Xero stay with staff.
 */
import type { Document, Job } from '@/lib/types'
import { composeDocumentContent } from '@/lib/composeDocument'
import { isStatementV2Content } from '@/lib/statementOfAccounts'

export const GENERATE_STATEMENT_TARGET = 'generate:statement_of_accounts'

export type StatementCompose =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; reason: string }

export function composeStatementForJob(job: Job, documents: Document[]): StatementCompose {
  if (job.assessment_data?.statement_of_accounts == null) return { ok: false, reason: 'The Statement of Accounts has not been started on this job.' }
  const { content } = composeDocumentContent('statement_of_accounts', job, { documents })
  if (isStatementV2Content(content) && content.problems.length > 0) return { ok: false, reason: content.problems.join(' ') }
  return { ok: true, content: content as Record<string, unknown> }
}
