/*
 * lib/agent/flags.ts
 *
 * Staff flags pinned on a job (job_flags, migration 063). The file agent
 * drafts them (agent_drafts kind 'flag', pinned when staff approve). Document
 * conflicts are flagged straight away by the system, once per conflict, with
 * a line in the job's chat — no approval, because they only point at what is
 * already on file.
 */
import type { createServiceClient } from '@/lib/supabase'
import type { Conflict } from './conflicts'
import { postMessage } from './drafts'

type Supabase = ReturnType<typeof createServiceClient>

export const FLAG_SEVERITIES = ['info', 'warning', 'urgent'] as const
export type FlagSeverity = (typeof FLAG_SEVERITIES)[number]

export interface JobFlag {
  id: string
  job_id: string
  severity: FlagSeverity
  message: string
  source: 'agent' | 'staff' | 'system'
  created_by: string | null
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export function isFlagSeverity(v: unknown): v is FlagSeverity {
  return typeof v === 'string' && (FLAG_SEVERITIES as readonly string[]).includes(v)
}

export async function listOpenFlags(supabase: Supabase, orgId: string, jobId: string): Promise<JobFlag[]> {
  const { data } = await supabase
    .from('job_flags')
    .select('id, job_id, severity, message, source, created_by, created_at, resolved_at, resolved_by')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data ?? []) as JobFlag[]
}

export async function createFlag(
  supabase: Supabase,
  f: { orgId: string; jobId: string; severity: FlagSeverity; message: string; source: JobFlag['source']; createdBy: string; dedupeKey?: string },
): Promise<string | null> {
  const { data, error } = await supabase
    .from('job_flags')
    .insert({
      org_id: f.orgId, job_id: f.jobId, severity: f.severity, message: f.message.slice(0, 1000),
      source: f.source, created_by: f.createdBy, dedupe_key: f.dedupeKey ?? null,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return null
    throw error
  }
  return data.id as string
}

/** Flag each conflict the first time it is seen, and say so in the job's chat. */
export async function raiseConflictFlags(supabase: Supabase, orgId: string, jobId: string, conflicts: Conflict[]): Promise<number> {
  let raised = 0
  for (const c of conflicts) {
    try {
      const id = await createFlag(supabase, {
        orgId, jobId, severity: 'warning', message: c.message, source: 'system', createdBy: 'system', dedupeKey: `conflict:${c.code}`,
      })
      if (!id) continue
      raised++
      await postMessage(supabase, {
        org_id: orgId, thread_id: null, job_id: jobId, speaker: 'system', author: 'System',
        content: { text: `Flagged on the job: ${c.message}` },
      })
    } catch (err) {
      console.error('[flags] conflict flag failed', err)
    }
  }
  return raised
}

export async function resolveFlag(supabase: Supabase, orgId: string, jobId: string, flagId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('job_flags')
    .update({ resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', flagId)
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .is('resolved_at', null)
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}
