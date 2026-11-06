/*
 * lib/agent/subagents/labels.ts
 *
 * Names of the document sub-agents. No server imports, so change cards in the
 * browser can say who drafted a change ("File agent > Statement agent").
 */
import type { DocAgentType } from './types'

export const DOC_AGENT_LABEL: Record<DocAgentType, { agent: string; doc: string }> = {
  statement_of_accounts: { agent: 'Statement agent', doc: 'Statement of Accounts' },
  biohazard_cleaning_quote: { agent: 'BCQ agent', doc: 'Biohazard Cleaning Quote' },
  contents_clearance_quote: { agent: 'CCQ agent', doc: 'Contents Clearance Quote' },
  surface_area_cleaning_quote: { agent: 'SACQ agent', doc: 'Surface Area Cleaning Quote' },
  house_survey: { agent: 'Survey agent', doc: 'House Survey' },
  waste_disposal_manifest: { agent: 'CDR agent', doc: 'Contents Disposal Record' },
  completion_report: { agent: 'Report agent', doc: 'Completion Report' },
}

/** "File agent > Statement agent" for created_by doc_agent:<type>, else "File agent". */
export function draftedByLabel(createdBy: string | null | undefined): string | null {
  if (!createdBy?.startsWith('doc_agent:')) return null
  const entry = DOC_AGENT_LABEL[createdBy.slice('doc_agent:'.length) as DocAgentType]
  return entry ? `File agent > ${entry.agent}` : null
}
