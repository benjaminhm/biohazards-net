/*
 * lib/agentActions.ts
 *
 * Ledger of every write an agent makes (table agent_actions). Each row keeps
 * the value before and after so a change can be traced and undone.
 */
import type { createServiceClient } from '@/lib/supabase'

export interface AgentActionRow {
  org_id: string
  job_id?: string | null
  agent: 'head_agent' | 'file_agent' | 'job_assistant' | 'xero_sync'
  trigger: string
  action: string
  target_table?: string
  target_id?: string
  target_path?: string
  before?: unknown
  after?: unknown
  note?: string
  status?: 'applied' | 'needs_review' | 'failed'
}

export async function logAgentAction(supabase: ReturnType<typeof createServiceClient>, row: AgentActionRow): Promise<void> {
  const { error } = await supabase.from('agent_actions').insert({
    ...row,
    job_id: row.job_id ?? null,
    before: row.before ?? null,
    after: row.after ?? null,
    note: row.note ?? '',
    status: row.status ?? 'applied',
  })
  if (error) console.error('[agent_actions] insert failed', error.message, row.action)
}
