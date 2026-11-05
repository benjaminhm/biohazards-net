/*
 * lib/agent/drafts.ts
 *
 * Agent drafts (table agent_drafts) and chat lines (agent_messages) for the
 * Agent workspace. An agent proposes; nothing reaches the job until staff
 * approve. Approving applies the change through the same tables the app
 * writes, logs it to agent_actions and posts an "approved by" line on the job.
 * A human edit to a field with a pending draft marks that draft stale.
 */
import type { createServiceClient } from '@/lib/supabase'
import { logAgentAction } from '@/lib/agentActions'
import { normalizeOptionalPhoneField } from '@/lib/phone'
import { emptyBiohazardCleaningCapture } from '@/lib/biohazardCleaningQuote'
import { emptyContentsClearanceCapture } from '@/lib/contentsClearanceQuote'
import { emptySurfaceAreaCleaningCapture } from '@/lib/surfaceAreaCleaningQuote'
import type { JobStatus } from '@/lib/types'
import { fieldLabel, isDraftableField, isEmptyValue, showValue, type Speaker } from './workspaceText'

type Supabase = ReturnType<typeof createServiceClient>

export type DraftKind = 'field' | 'note' | 'status' | 'document'

export interface DraftRow {
  id: string
  org_id: string
  job_id: string
  message_id: string | null
  kind: DraftKind
  target_path: string
  before: unknown
  proposed: unknown
  summary: string
  status: 'pending' | 'approved' | 'rejected' | 'stale'
  created_at: string
}

export const QUOTE_DOC_KEYS = ['biohazard_cleaning_quote', 'contents_clearance_quote', 'surface_area_cleaning_quote'] as const
export type QuoteDocKey = (typeof QUOTE_DOC_KEYS)[number]
export const QUOTE_DOC_LABELS: Record<QuoteDocKey, string> = {
  biohazard_cleaning_quote: 'Biohazard Cleaning Quote',
  contents_clearance_quote: 'Contents Clearance Quote',
  surface_area_cleaning_quote: 'Surface Area Cleaning Quote',
}

export const JOB_STATUSES: JobStatus[] = [
  'lead', 'assessed', 'quoted', 'accepted', 'scheduled', 'underway', 'completed', 'report_sent', 'paid',
]

export async function postMessage(
  supabase: Supabase,
  row: {
    org_id: string
    thread_id: string | null
    job_id: string | null
    speaker: Speaker
    author?: string
    content: Record<string, unknown>
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from('agent_messages')
    .insert({ ...row, author: row.author ?? '' })
    .select('id')
    .single()
  if (error) {
    console.error('[agent_messages] insert failed', error.message)
    return null
  }
  return data.id as string
}

export async function listPendingDrafts(supabase: Supabase, orgId: string, jobId: string): Promise<DraftRow[]> {
  const { data } = await supabase
    .from('agent_drafts')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  return (data ?? []) as DraftRow[]
}

/** A second draft for the same target replaces the pending one instead of stacking. */
export async function upsertDraft(
  supabase: Supabase,
  d: { orgId: string; jobId: string; kind: DraftKind; target_path: string; before: unknown; proposed: unknown; summary: string; createdBy: string },
): Promise<string> {
  const { data: existing } = await supabase
    .from('agent_drafts')
    .select('id')
    .eq('org_id', d.orgId)
    .eq('job_id', d.jobId)
    .eq('kind', d.kind)
    .eq('target_path', d.target_path)
    .eq('status', 'pending')
    .maybeSingle()
  if (existing && d.kind !== 'note') {
    const { error } = await supabase
      .from('agent_drafts')
      .update({ before: d.before ?? null, proposed: d.proposed ?? null, summary: d.summary })
      .eq('id', existing.id)
    if (error) throw error
    return existing.id as string
  }
  const { data, error } = await supabase
    .from('agent_drafts')
    .insert({
      org_id: d.orgId,
      job_id: d.jobId,
      kind: d.kind,
      target_path: d.target_path,
      before: d.before ?? null,
      proposed: d.proposed ?? null,
      summary: d.summary,
      created_by: d.createdBy,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export function emptyQuoteCapture(key: QuoteDocKey, notes: { description?: string; estimated_m3?: number | null }): Record<string, unknown> {
  if (key === 'biohazard_cleaning_quote') {
    return { ...emptyBiohazardCleaningCapture(), description: notes.description ?? '' }
  }
  if (key === 'contents_clearance_quote') {
    return { ...emptyContentsClearanceCapture(), estimated_m3: notes.estimated_m3 ?? null }
  }
  return { ...emptySurfaceAreaCleaningCapture(), scope_of_work: notes.description ?? '' }
}

class DraftError extends Error {}

async function markStale(supabase: Supabase, id: string) {
  await supabase.from('agent_drafts').update({ status: 'stale' }).eq('id', id).eq('status', 'pending')
}

export interface Approver {
  orgId: string
  userId: string
  firstName: string
}

/** Apply one pending draft. Returns an error message instead of throwing. */
export async function approveDraft(
  supabase: Supabase,
  who: Approver,
  draftId: string,
  opts: { postLine?: boolean } = {},
): Promise<{ ok: true; draft: DraftRow } | { ok: false; error: string }> {
  const { data } = await supabase
    .from('agent_drafts')
    .select('*')
    .eq('id', draftId)
    .eq('org_id', who.orgId)
    .maybeSingle()
  const draft = data as DraftRow | null
  if (!draft) return { ok: false, error: 'Draft not found' }
  if (draft.status !== 'pending') return { ok: false, error: `This change is already ${draft.status}.` }

  const trigger = 'workspace_chat'
  try {
    const { data: job } = await supabase
      .from('jobs')
      .select('id, status, assessment_data, client_name, client_organization_name, client_contact_role, client_contact_relationship, client_phone, client_email, site_address, site_contact_name, site_contact_phone, access_notes, job_description, notes, urgency, scheduled_at')
      .eq('id', draft.job_id)
      .eq('org_id', who.orgId)
      .maybeSingle()
    if (!job) throw new DraftError('Job not found')
    const jobRow = job as Record<string, unknown>

    if (draft.kind === 'field') {
      const field = draft.target_path
      if (!isDraftableField(field)) throw new DraftError('That field cannot be changed by the agent')
      const current = jobRow[field]
      if (!sameValue(current, draft.before)) {
        await markStale(supabase, draft.id)
        throw new DraftError(`${fieldLabel(field)} changed since the agent drafted this. Ask it again if you still want it.`)
      }
      let value = draft.proposed
      if (field === 'client_phone' || field === 'site_contact_phone') {
        const pr = normalizeOptionalPhoneField(value)
        if (!pr.ok) throw new DraftError(pr.error)
        value = pr.value ?? ''
      }
      const { error } = await supabase
        .from('jobs')
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .eq('id', draft.job_id)
        .eq('org_id', who.orgId)
      if (error) throw error
      await logAgentAction(supabase, {
        org_id: who.orgId, job_id: draft.job_id, agent: 'file_agent', trigger, action: 'set_job_field',
        target_table: 'jobs', target_id: draft.job_id, target_path: field,
        before: current ?? null, after: value, note: `Approved by ${who.firstName || who.userId}`,
      })
    } else if (draft.kind === 'status') {
      const status = String(draft.proposed) as JobStatus
      if (!JOB_STATUSES.includes(status)) throw new DraftError('Unknown status')
      const { error } = await supabase
        .from('jobs')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', draft.job_id)
        .eq('org_id', who.orgId)
      if (error) throw error
      await logAgentAction(supabase, {
        org_id: who.orgId, job_id: draft.job_id, agent: 'file_agent', trigger, action: 'update_job_status',
        target_table: 'jobs', target_id: draft.job_id, target_path: 'status',
        before: jobRow.status, after: status, note: `Approved by ${who.firstName || who.userId}`,
      })
    } else if (draft.kind === 'note') {
      const p = (draft.proposed ?? {}) as { room?: string; body?: string }
      const body = (p.body ?? '').trim()
      if (!body) throw new DraftError('Note is empty')
      const { data: note, error } = await supabase
        .from('progress_notes')
        .insert({
          org_id: who.orgId,
          job_id: draft.job_id,
          room: (p.room ?? '').trim(),
          body,
          created_by_user_id: who.userId,
          updated_by_user_id: who.userId,
          created_by_first_name: who.firstName,
          updated_by_first_name: who.firstName,
        })
        .select('id')
        .single()
      if (error) throw error
      await logAgentAction(supabase, {
        org_id: who.orgId, job_id: draft.job_id, agent: 'file_agent', trigger, action: 'add_progress_note',
        target_table: 'progress_notes', target_id: note.id as string, after: { body }, note: `Approved by ${who.firstName || who.userId}`,
      })
    } else if (draft.kind === 'document') {
      const key = draft.target_path as QuoteDocKey
      if (!QUOTE_DOC_KEYS.includes(key)) throw new DraftError('Unknown document type')
      const ad = (jobRow.assessment_data ?? {}) as Record<string, unknown>
      if (ad[key] != null) {
        await markStale(supabase, draft.id)
        throw new DraftError(`A ${QUOTE_DOC_LABELS[key]} is already started on this job, so the draft was not applied.`)
      }
      const nextAd = { ...ad, [key]: draft.proposed }
      const { error } = await supabase
        .from('jobs')
        .update({ assessment_data: nextAd, updated_at: new Date().toISOString() })
        .eq('id', draft.job_id)
        .eq('org_id', who.orgId)
      if (error) throw error
      await logAgentAction(supabase, {
        org_id: who.orgId, job_id: draft.job_id, agent: 'file_agent', trigger, action: 'draft_quote',
        target_table: 'jobs', target_id: draft.job_id, target_path: `assessment_data.${key}`,
        before: null, after: draft.proposed, note: `Prices left blank. Approved by ${who.firstName || who.userId}`,
      })
    }

    const { error: decErr } = await supabase
      .from('agent_drafts')
      .update({ status: 'approved', decided_by: who.userId, decided_at: new Date().toISOString() })
      .eq('id', draft.id)
      .eq('status', 'pending')
    if (decErr) throw decErr
    if (opts.postLine !== false) {
      await postMessage(supabase, {
        org_id: who.orgId, thread_id: who.userId, job_id: draft.job_id, speaker: 'system', author: who.firstName,
        content: { text: `Approved by ${who.firstName || 'staff'}: ${draft.summary}` },
      })
    }
    return { ok: true, draft: { ...draft, status: 'approved' } }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not apply this change'
    if (!(err instanceof DraftError)) {
      await logAgentAction(supabase, {
        org_id: who.orgId, job_id: draft.job_id, agent: 'file_agent', trigger, action: `apply_${draft.kind}_draft`,
        target_table: 'agent_drafts', target_id: draft.id, status: 'failed', note: msg,
      })
    }
    return { ok: false, error: msg }
  }
}

export async function rejectDraft(
  supabase: Supabase,
  who: Approver,
  draftId: string,
  opts: { postLine?: boolean } = {},
): Promise<{ ok: true; draft: DraftRow } | { ok: false; error: string }> {
  const { data } = await supabase
    .from('agent_drafts')
    .update({ status: 'rejected', decided_by: who.userId, decided_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('org_id', who.orgId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle()
  const draft = data as DraftRow | null
  if (!draft) return { ok: false, error: 'Nothing pending to reject' }
  if (opts.postLine !== false) {
    await postMessage(supabase, {
      org_id: who.orgId, thread_id: who.userId, job_id: draft.job_id, speaker: 'system', author: who.firstName,
      content: { text: `Rejected by ${who.firstName || 'staff'}: ${draft.summary}` },
    })
  }
  return { ok: true, draft }
}

/** Approve or reject many drafts and post one summary line per job. */
export async function decideMany(
  supabase: Supabase,
  who: Approver,
  draftIds: string[],
  approve: boolean,
): Promise<{ done: DraftRow[]; failed: { id: string; error: string }[] }> {
  const done: DraftRow[] = []
  const failed: { id: string; error: string }[] = []
  for (const id of draftIds) {
    const r = approve ? await approveDraft(supabase, who, id, { postLine: false }) : await rejectDraft(supabase, who, id, { postLine: false })
    if (r.ok) done.push(r.draft)
    else failed.push({ id, error: r.error })
  }
  const byJob = new Map<string, DraftRow[]>()
  for (const d of done) byJob.set(d.job_id, [...(byJob.get(d.job_id) ?? []), d])
  for (const [jobId, list] of byJob) {
    await postMessage(supabase, {
      org_id: who.orgId, thread_id: who.userId, job_id: jobId, speaker: 'system', author: who.firstName,
      content: { text: `${list.length} change${list.length === 1 ? '' : 's'} ${approve ? 'approved' : 'rejected'} by ${who.firstName || 'staff'}: ${list.map(d => d.summary).join('; ')}` },
    })
  }
  return { done, failed }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) && isEmptyValue(b)) return true
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * Called after a staff member saves the job: one log line for the fields that
 * actually changed, and any pending draft on those fields becomes stale.
 */
export async function recordHumanEdits(
  supabase: Supabase,
  e: { orgId: string; jobId: string; userId: string; firstName: string; before: Record<string, unknown>; after: Record<string, unknown> },
): Promise<void> {
  const changed = Object.keys(e.before).filter(f => isDraftableField(f) && !sameValue(e.before[f], e.after[f]))
  if (!changed.length) return
  const name = e.firstName || 'Staff'
  const text = changed
    .map(f => `${fieldLabel(f)}: ${showValue(e.before[f], 60)} → ${showValue(e.after[f], 60)}`)
    .join('; ')
  await postMessage(supabase, {
    org_id: e.orgId, thread_id: e.userId, job_id: e.jobId, speaker: 'system', author: name,
    content: { text: `${name} changed ${text}` },
  })
  const { data: stale } = await supabase
    .from('agent_drafts')
    .update({ status: 'stale' })
    .eq('org_id', e.orgId)
    .eq('job_id', e.jobId)
    .eq('kind', 'field')
    .eq('status', 'pending')
    .in('target_path', changed)
    .select('summary')
  if (stale?.length) {
    await postMessage(supabase, {
      org_id: e.orgId, thread_id: e.userId, job_id: e.jobId, speaker: 'system', author: name,
      content: { text: `Out of date after ${name}'s edit, not applied: ${stale.map(s => s.summary).join('; ')}` },
    })
  }
}

const DOC_SAVE_QUIET_MS = 10 * 60_000

/** One "saved document" line per document per person per 10 minutes, so autosave does not flood the chat. */
export async function recordDocumentSave(
  supabase: Supabase,
  e: { userId: string; firstName: string; doc: { id: string; job_id: string; type: string; content: unknown } },
): Promise<void> {
  const { data: job } = await supabase.from('jobs').select('org_id').eq('id', e.doc.job_id).maybeSingle()
  if (!job) return
  const since = new Date(Date.now() - DOC_SAVE_QUIET_MS).toISOString()
  const { count } = await supabase
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', e.doc.job_id)
    .eq('thread_id', e.userId)
    .eq('speaker', 'system')
    .contains('content', { doc_id: e.doc.id })
    .gte('created_at', since)
  if (count) return
  const c = (e.doc.content ?? {}) as Record<string, unknown>
  const label = [typeof c.title === 'string' ? c.title : '', typeof c.reference === 'string' ? c.reference : '']
    .filter(Boolean).join(' · ') || e.doc.type.replace(/_/g, ' ')
  const name = e.firstName || 'Staff'
  await postMessage(supabase, {
    org_id: job.org_id as string, thread_id: e.userId, job_id: e.doc.job_id, speaker: 'system', author: name,
    content: { text: `${name} saved document ${label}`, doc_id: e.doc.id },
  })
}

export function describeFieldDraft(field: string, before: unknown, proposed: unknown): string {
  return isEmptyValue(before)
    ? `${fieldLabel(field)}: ${showValue(proposed)}`
    : `${fieldLabel(field)}: ${showValue(before, 50)} → ${showValue(proposed)}`
}
