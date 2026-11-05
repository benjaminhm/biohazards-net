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
import { DRAFTABLE_FIELDS, fieldLabel, isDraftableField, isEmptyValue, showValue, type Speaker } from './workspaceText'
import { emptyStatementCapture } from '@/lib/statementOfAccounts'
import {
  PatchError,
  applyPatch,
  describePatch,
  isCaptureKey,
  mergePatchDrafts,
  parseTarget,
  patchIsCurrent,
  photoPatch,
  type PatchDraft,
} from './patchDraft'

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

const CAPTURE_LABELS: Partial<Record<string, string>> = {
  house_survey: 'House Survey',
  disposal_manifest_capture: 'Contents Disposal Record',
  statement_of_accounts: 'Statement of Accounts',
  sow_capture: 'Scope of Work',
  pre_remediation_preflight: 'Pre-remediation checklist',
  completion_report_capture: 'Completion report',
  ...QUOTE_DOC_LABELS,
}

export function captureLabel(key: string): string {
  const s = CAPTURE_LABELS[key] ?? key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Starting shape for a capture the agent patches before staff have opened it. */
const CAPTURE_BASE: Partial<Record<string, () => Record<string, unknown>>> = {
  statement_of_accounts: () => ({ ...emptyStatementCapture() }),
  biohazard_cleaning_quote: () => ({ ...emptyBiohazardCleaningCapture() }),
  contents_clearance_quote: () => ({ ...emptyContentsClearanceCapture() }),
  surface_area_cleaning_quote: () => ({ ...emptySurfaceAreaCleaningCapture() }),
}

/**
 * Patch drafts (captures, documents, photos). A later patch to the same
 * target adds to the pending draft instead of replacing it.
 */
export async function upsertPatchDraft(
  supabase: Supabase,
  d: { orgId: string; jobId: string; target_path: string; label: string; draft: PatchDraft; summary?: string; createdBy: string },
): Promise<string> {
  const { data: existing } = await supabase
    .from('agent_drafts')
    .select('id, before, proposed')
    .eq('org_id', d.orgId)
    .eq('job_id', d.jobId)
    .eq('kind', 'document')
    .eq('target_path', d.target_path)
    .eq('status', 'pending')
    .maybeSingle()
  if (existing) {
    const merged = mergePatchDrafts(
      { before: (existing.before ?? {}) as Record<string, unknown>, proposed: (existing.proposed ?? {}) as Record<string, unknown> },
      d.draft,
    )
    const { error } = await supabase
      .from('agent_drafts')
      .update({ before: merged.before, proposed: merged.proposed, summary: describePatch(d.label, merged) })
      .eq('id', existing.id)
    if (error) throw error
    return existing.id as string
  }
  return upsertDraft(supabase, {
    orgId: d.orgId, jobId: d.jobId, kind: 'document', target_path: d.target_path, before: d.draft.before, proposed: d.draft.proposed,
    summary: d.summary ?? describePatch(d.label, d.draft), createdBy: d.createdBy,
  })
}

async function applyPatchDraft(supabase: Supabase, who: Approver, draft: DraftRow, jobRow: Record<string, unknown>) {
  const target = parseTarget(draft.target_path)
  if (!target) throw new DraftError('Unknown change')
  const before = (draft.before ?? {}) as Record<string, unknown>
  const proposed = (draft.proposed ?? {}) as Record<string, unknown>
  const stale = async (what: string) => {
    await markStale(supabase, draft.id)
    throw new DraftError(`${what} changed since the agent drafted this. Ask it again if you still want it.`)
  }
  const note = `Approved by ${who.firstName || who.userId}`
  const now = new Date().toISOString()

  if (target.type === 'capture') {
    const key = target.ref
    if (!isCaptureKey(key)) throw new DraftError('Unknown capture')
    const ad = (jobRow.assessment_data ?? {}) as Record<string, unknown>
    if (!patchIsCurrent(ad[key] ?? null, before)) await stale(captureLabel(key))
    const next = applyPatch(ad[key] ?? null, proposed, CAPTURE_BASE[key])
    const { error } = await supabase
      .from('jobs')
      .update({ assessment_data: { ...ad, [key]: next }, updated_at: now })
      .eq('id', draft.job_id)
      .eq('org_id', who.orgId)
    if (error) throw error
    await logAgentAction(supabase, {
      org_id: who.orgId, job_id: draft.job_id, agent: 'file_agent', trigger: 'workspace_chat', action: 'patch_capture',
      target_table: 'jobs', target_id: draft.job_id, target_path: `assessment_data.${key}`, before, after: proposed, note,
    })
    return
  }

  if (target.type === 'doc') {
    const { data: doc } = await supabase
      .from('documents')
      .select('id, content')
      .eq('id', target.ref)
      .eq('job_id', draft.job_id)
      .maybeSingle()
    if (!doc) throw new DraftError('Document not found on this job')
    if (!patchIsCurrent(doc.content ?? null, before)) await stale('The document')
    const next = applyPatch(doc.content ?? null, proposed)
    const { error } = await supabase.from('documents').update({ content: next }).eq('id', doc.id).eq('job_id', draft.job_id)
    if (error) throw error
    await logAgentAction(supabase, {
      org_id: who.orgId, job_id: draft.job_id, agent: 'file_agent', trigger: 'workspace_chat', action: 'patch_document',
      target_table: 'documents', target_id: doc.id as string, before, after: proposed, note,
    })
    return
  }

  let cols: Record<string, unknown>
  try {
    cols = photoPatch(proposed)
  } catch (err) {
    throw new DraftError(err instanceof PatchError ? err.message : 'Invalid photo change')
  }
  const photoCols: string = `id, ${Object.keys(cols).join(', ')}`
  const { data: photo } = await supabase
    .from('photos')
    .select(photoCols)
    .eq('id', target.ref)
    .eq('job_id', draft.job_id)
    .maybeSingle()
  if (!photo) throw new DraftError('Photo not found on this job')
  if (!patchIsCurrent(photo, before)) await stale('The photo')
  const { error } = await supabase.from('photos').update(cols).eq('id', target.ref).eq('job_id', draft.job_id)
  if (error) throw error
  await logAgentAction(supabase, {
    org_id: who.orgId, job_id: draft.job_id, agent: 'file_agent', trigger: 'workspace_chat', action: 'patch_photo',
    target_table: 'photos', target_id: target.ref, before, after: cols, note,
  })
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
      .select(`id, status, assessment_data, ${Object.keys(DRAFTABLE_FIELDS).join(', ')}`)
      .eq('id', draft.job_id)
      .eq('org_id', who.orgId)
      .maybeSingle()
    if (!job) throw new DraftError('Job not found')
    const jobRow = job as unknown as Record<string, unknown>

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
    } else if (draft.kind === 'document' && parseTarget(draft.target_path)) {
      await applyPatchDraft(supabase, who, draft, jobRow)
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

/**
 * After a staff save of the job's captures or of a document: pending patch
 * drafts whose paths no longer hold their "before" values become stale.
 */
export async function staleAfterStaffSave(
  supabase: Supabase,
  e: { orgId: string; jobId: string; userId: string; firstName: string; assessmentData?: unknown; doc?: { id: string; content: unknown } },
): Promise<void> {
  const { data } = await supabase
    .from('agent_drafts')
    .select('id, target_path, before, summary')
    .eq('org_id', e.orgId)
    .eq('job_id', e.jobId)
    .eq('kind', 'document')
    .eq('status', 'pending')
  const stale: { id: string; summary: string }[] = []
  for (const d of data ?? []) {
    const t = parseTarget(d.target_path as string)
    const before = (d.before ?? {}) as Record<string, unknown>
    let current: unknown
    if (t?.type === 'capture' && e.assessmentData !== undefined) {
      current = ((e.assessmentData ?? {}) as Record<string, unknown>)[t.ref] ?? null
    } else if (t?.type === 'doc' && e.doc && e.doc.id === t.ref) {
      current = e.doc.content ?? null
    } else continue
    if (!patchIsCurrent(current, before)) stale.push({ id: d.id as string, summary: d.summary as string })
  }
  if (!stale.length) return
  await supabase.from('agent_drafts').update({ status: 'stale' }).in('id', stale.map(s => s.id)).eq('status', 'pending')
  const name = e.firstName || 'Staff'
  await postMessage(supabase, {
    org_id: e.orgId, thread_id: e.userId, job_id: e.jobId, speaker: 'system', author: name,
    content: { text: `Out of date after ${name}'s edit, not applied: ${stale.map(s => s.summary).join('; ')}` },
  })
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
