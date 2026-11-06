/*
 * lib/agent/workspaceAgent.ts
 *
 * The two agents behind the Agent workspace chat.
 *
 *   Head agent — sees every job, never changes one. Answers cross-job
 *   questions ("what needs me?"), hands a job over to its file agent with
 *   open_job and a short brief, and can propose a new empty job (Create card).
 *   File agent — one job only. Reads everything on the job, works out what is
 *   missing or out of date, drafts job-level changes (fields, notes, status,
 *   photos) and hands document work to a per-document sub-agent
 *   (lib/agent/subagents) with delegate_to_document_agent. Every write is an
 *   agent_draft staff approve on screen.
 *
 * Chat is saved one visible line per row (agent_messages). Tool calls only live
 * inside a single request. No tool contacts clients
 * (docs/ai-product-principles.md).
 */
import Anthropic from '@anthropic-ai/sdk'
import type { createServiceClient } from '@/lib/supabase'
import { getAgentTool, type AgentContext } from '@/lib/agent/tools'
import {
  JOB_STATUSES,
  QUOTE_DOC_KEYS,
  QUOTE_DOC_LABELS,
  createNewJobDraft,
  describeFieldDraft,
  listNewJobDrafts,
  upsertPatchDraft,
  listPendingDrafts,
  postMessage,
  upsertDraft,
  type DraftRow,
} from './drafts'
import {
  DRAFTABLE_FIELDS,
  URGENCIES,
  isDraftableField,
  normalizeFieldValue,
  parseJobMention,
  rebuildHistory,
  type ChatRow,
} from './workspaceText'
import { surveyAndDisposalSummary } from './statementDraft'
import { runLoop, str, ToolError, type AgentTool, type Input } from './loop'
import { capped, readAcceptances, readCalls, readDocument, readProgressNotes, readXeroInvoice } from './jobReads'
import { jobHealth } from './jobHealth'
import { staffOnlyBlock, STAFF_ONLY_ACTIONS } from './permissions'
import { DOC_AGENTS } from './subagents/registry'
import { runDocAgent } from './subagents/runner'
import { DOC_AGENT_TYPES, isDocAgentType } from './subagents/types'
import {
  CAPTURE_KEYS,
  PHOTO_FIELDS,
  TARGET,
  buildPatchDraft,
  isCaptureKey,
  photoPatch,
  sameJson,
} from './patchDraft'
import {
  describeNewJob,
  duplicateSearchTerms,
  findDuplicates,
  normalizeNewJob,
  type DuplicateCandidate,
  type NewJobProposal,
  type PossibleDuplicate,
} from './newJobDraft'
import type { AssessmentData } from '@/lib/types'

type Supabase = ReturnType<typeof createServiceClient>

const MAX_STEPS = 10
const HISTORY_ROWS = 40
const JOB_FIELDS = `id, job_code, status, ${Object.keys(DRAFTABLE_FIELDS).join(', ')}, assessment_data`

export interface WsContext extends AgentContext {
  jobId: string | null
  draftIds: string[]
  handover: { job_id: string; job_code: string | null; brief: string } | null
  anthropic?: Anthropic
}

type WsTool = AgentTool<WsContext>

function reuse(name: string): WsTool {
  const t = getAgentTool(name)
  if (!t || t.kind !== 'read') throw new Error(`Not a read tool: ${name}`)
  return { name: t.name, description: t.description, input_schema: t.input_schema, run: (ctx, input) => t.run(ctx, input) }
}

function activeJob(ctx: WsContext): string {
  if (!ctx.jobId) throw new ToolError('No job is open')
  return ctx.jobId
}

// ── Job file snapshot ─────────────────────────────────────────────────────────

export async function jobFileSnapshot(supabase: Supabase, orgId: string, jobId: string) {
  const [jobRes, docsRes, notesRes, callsRes, drafts] = await Promise.all([
    supabase.from('jobs').select(JOB_FIELDS).eq('id', jobId).eq('org_id', orgId).maybeSingle(),
    supabase.from('documents').select('id, type, content, created_at').eq('job_id', jobId).order('created_at', { ascending: false }).limit(20),
    supabase
      .from('progress_notes')
      .select('room, body, created_by_first_name, created_at')
      .eq('job_id', jobId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('inbound_calls')
      .select('created_at, provider, caller_number, status, extraction')
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(5),
    listPendingDrafts(supabase, orgId, jobId),
  ])
  if (!jobRes.data) return null
  const { assessment_data, ...job } = jobRes.data as unknown as Record<string, unknown> & { assessment_data: Record<string, unknown> | null }
  const ad = assessment_data ?? {}
  return {
    job,
    quotes_started: QUOTE_DOC_KEYS.filter(k => ad[k] != null).map(k => QUOTE_DOC_LABELS[k]),
    quotes_required: (ad.quotes_required as unknown[] | undefined) ?? [],
    documents: (docsRes.data ?? []).map(d => {
      const c = (d.content ?? {}) as Record<string, unknown>
      return { id: d.id, type: d.type, title: str(c.title), reference: str(c.reference), created_at: d.created_at }
    }),
    recent_notes: (notesRes.data ?? []).map(n => ({
      room: n.room, by: n.created_by_first_name, at: n.created_at, body: String(n.body ?? '').slice(0, 600),
    })),
    calls_and_enquiries: (callsRes.data ?? []).map(c => ({
      at: c.created_at,
      kind: c.provider === 'netlify_form' ? 'website enquiry' : 'phone call',
      from: c.caller_number,
      status: c.status,
      summary: str((c.extraction as { summary?: string } | null)?.summary),
    })),
    pending_drafts: drafts.map(d => ({ id: d.id, kind: d.kind, summary: d.summary })),
  }
}

// ── File agent tools ──────────────────────────────────────────────────────────

const getJobFile: WsTool = {
  name: 'get_job_file',
  description: 'Re-read the open job file: details, quotes started, documents, recent notes, calls and enquiries, and your pending drafts.',
  input_schema: { type: 'object', properties: {} },
  async run(ctx) {
    const snap = await jobFileSnapshot(ctx.supabase, ctx.orgId, activeJob(ctx))
    if (!snap) throw new ToolError('Job not found')
    return snap
  },
}

const draftFieldChanges: WsTool = {
  name: 'draft_field_changes',
  description:
    'Draft changes to fields on the open job. Each becomes a pending change staff approve on screen; nothing is saved until then. A new draft for the same field replaces your earlier one.',
  input_schema: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: Object.keys(DRAFTABLE_FIELDS) },
            value: {
              description:
                'New value. Text for most fields; scheduled_at as ISO date-time; urgency standard|urgent|emergency; job_type one of crime_scene, hoarding, mold, sewage, trauma, unattended_death, flood, other; site_lat/site_lng numbers; client_phones a list of {label, number}.',
            },
          },
          required: ['field', 'value'],
        },
      },
    },
    required: ['changes'],
  },
  async run(ctx, input) {
    const jobId = activeJob(ctx)
    const changes = Array.isArray(input.changes) ? (input.changes as Input[]) : []
    if (!changes.length) throw new ToolError('No changes given')
    const { data: job } = await ctx.supabase.from('jobs').select(JOB_FIELDS).eq('id', jobId).eq('org_id', ctx.orgId).maybeSingle()
    if (!job) throw new ToolError('Job not found')
    const row = job as unknown as Record<string, unknown>
    const out: { field: string; draft_id?: string; skipped?: string }[] = []
    for (const c of changes) {
      const field = str(c.field)
      if (!isDraftableField(field)) { out.push({ field, skipped: 'not a field you can change' }); continue }
      let value: unknown
      try {
        value = normalizeFieldValue(field, c.value)
      } catch (err) {
        out.push({ field, skipped: err instanceof Error ? err.message : 'invalid value' })
        continue
      }
      const before = row[field] ?? null
      if (sameJson(before ?? '', value ?? '')) { out.push({ field, skipped: 'already that value' }); continue }
      const id = await upsertDraft(ctx.supabase, {
        orgId: ctx.orgId, jobId, kind: 'field', target_path: field, before, proposed: value,
        summary: describeFieldDraft(field, before, value), createdBy: 'file_agent',
      })
      ctx.draftIds.push(id)
      out.push({ field, draft_id: id })
    }
    return { drafted: out, note: 'Pending staff approval. Nothing is saved yet.' }
  },
}

const draftNote: WsTool = {
  name: 'draft_note',
  description: "Draft a progress note for the open job, optionally tagged with a room. Use the staff member's words; do not embellish.",
  input_schema: {
    type: 'object',
    properties: { room: { type: 'string' }, body: { type: 'string' } },
    required: ['body'],
  },
  async run(ctx, input) {
    const jobId = activeJob(ctx)
    const body = str(input.body)
    if (!body) throw new ToolError('Note cannot be empty')
    if (body.length > 20_000) throw new ToolError('Note is too long')
    const room = str(input.room)
    const id = await upsertDraft(ctx.supabase, {
      orgId: ctx.orgId, jobId, kind: 'note', target_path: '', before: null, proposed: { room, body },
      summary: `Progress note${room ? ` (${room})` : ''}: "${body.slice(0, 120)}${body.length > 120 ? '…' : ''}"`, createdBy: 'file_agent',
    })
    ctx.draftIds.push(id)
    return { draft_id: id, note: 'Pending staff approval.' }
  },
}

const draftStatus: WsTool = {
  name: 'draft_status',
  description: "Draft a change to the open job's pipeline status. Does not notify the client.",
  input_schema: {
    type: 'object',
    properties: { status: { type: 'string', enum: JOB_STATUSES } },
    required: ['status'],
  },
  async run(ctx, input) {
    const jobId = activeJob(ctx)
    const status = str(input.status)
    if (!JOB_STATUSES.includes(status as (typeof JOB_STATUSES)[number])) throw new ToolError('Unknown status')
    const { data: job } = await ctx.supabase.from('jobs').select('status').eq('id', jobId).eq('org_id', ctx.orgId).maybeSingle()
    if (!job) throw new ToolError('Job not found')
    if (job.status === status) return { skipped: 'already that status' }
    const id = await upsertDraft(ctx.supabase, {
      orgId: ctx.orgId, jobId, kind: 'status', target_path: 'status', before: job.status, proposed: status,
      summary: `status: ${job.status} → ${status}`, createdBy: 'file_agent',
    })
    ctx.draftIds.push(id)
    return { draft_id: id, note: 'Pending staff approval.' }
  },
}

async function jobAssessment(ctx: WsContext, jobId: string): Promise<AssessmentData | null> {
  const { data: job } = await ctx.supabase.from('jobs').select('assessment_data').eq('id', jobId).eq('org_id', ctx.orgId).maybeSingle()
  if (!job) throw new ToolError('Job not found')
  return (job.assessment_data ?? null) as AssessmentData | null
}

const getSurveyAndDisposal: WsTool = {
  name: 'get_survey_and_disposal',
  description:
    'Read the House Survey rooms (priced m² and price at the survey rate), the Contents Disposal Record (CDR) loads, volume and weight, and the Statement of Accounts as it stands.',
  input_schema: { type: 'object', properties: {} },
  async run(ctx) {
    return surveyAndDisposalSummary(await jobAssessment(ctx, activeJob(ctx)))
  },
}

const getCapture: WsTool = {
  name: 'get_capture',
  description:
    'Read one capture on the open job in full (assessment_data.<key>): e.g. house_survey, disposal_manifest_capture (CDR), statement_of_accounts, biohazard_cleaning_quote, contents_clearance_quote, surface_area_cleaning_quote, sow_capture, pre_remediation_preflight, areas, completion_report_capture. Without key, lists which captures exist.',
  input_schema: {
    type: 'object',
    properties: { key: { type: 'string', enum: [...CAPTURE_KEYS] } },
  },
  async run(ctx, input) {
    const ad = ((await jobAssessment(ctx, activeJob(ctx))) ?? {}) as Record<string, unknown>
    const key = str(input.key)
    if (!key) {
      return { captures: CAPTURE_KEYS.filter(k => ad[k] != null).map(k => ({ key: k, size: JSON.stringify(ad[k]).length })) }
    }
    if (!isCaptureKey(key)) throw new ToolError('Unknown capture key')
    return { key, exists: ad[key] != null, content: capped(ad[key] ?? null) }
  },
}

const getDocument: WsTool = {
  name: 'get_document',
  description: 'Read one saved document on the open job in full, including prices. Get ids from list_job_documents.',
  input_schema: { type: 'object', properties: { document_id: { type: 'string' } }, required: ['document_id'] },
  async run(ctx, input) {
    const doc = await readDocument(ctx.supabase, ctx.orgId, activeJob(ctx), str(input.document_id))
    if (!doc) throw new ToolError('Document not found on this job')
    return { ...doc, content: capped(doc.content) }
  },
}

const getJobCalls: WsTool = {
  name: 'get_job_calls',
  description: 'Read the phone calls and website enquiries filed into the open job: cleaned transcript or enquiry text, and what was extracted.',
  input_schema: { type: 'object', properties: {} },
  run: async ctx => ({ calls: await readCalls(ctx.supabase, ctx.orgId, activeJob(ctx)) }),
}

const getProgressNotes: WsTool = {
  name: 'get_progress_notes',
  description: 'Read every progress note on the open job in full, oldest first.',
  input_schema: { type: 'object', properties: {} },
  run: async ctx => ({ notes: await readProgressNotes(ctx.supabase, activeJob(ctx)) }),
}

const getXeroInvoice: WsTool = {
  name: 'get_xero_invoice',
  description: "Read the open job's Xero invoice status (read only): invoice number, Xero status, total, last sync and any error. You cannot sync or change Xero.",
  input_schema: { type: 'object', properties: {} },
  run: async ctx => (await readXeroInvoice(ctx.supabase, ctx.orgId, activeJob(ctx))) ?? { invoice: null, note: 'No Xero invoice for this job yet.' },
}

export async function loadJobHealth(supabase: Supabase, orgId: string, jobId: string) {
  const [jobRes, docsRes, acceptances] = await Promise.all([
    supabase.from('jobs').select('status, assessment_data').eq('id', jobId).eq('org_id', orgId).maybeSingle(),
    supabase.from('documents').select('id, type, content, created_at').eq('job_id', jobId).eq('org_id', orgId),
    readAcceptances(supabase, jobId),
  ])
  if (!jobRes.data) return null
  return jobHealth({
    status: jobRes.data.status as string,
    assessment: (jobRes.data.assessment_data ?? null) as AssessmentData | null,
    documents: (docsRes.data ?? []) as { id: string; type: string; content: unknown; created_at: string }[],
    acceptances,
  })
}

const getJobHealth: WsTool = {
  name: 'get_job_health',
  description:
    'What on this job is missing, out of date or needs action: captures not generated, statement quantities behind the survey/CDR, CDR volume vs the clearance quote estimate, quotes edited after the client accepted. Each issue names the document sub-agent that can fix it.',
  input_schema: { type: 'object', properties: {} },
  async run(ctx) {
    const issues = await loadJobHealth(ctx.supabase, ctx.orgId, activeJob(ctx))
    if (!issues) throw new ToolError('Job not found')
    return { issues }
  },
}

const delegateToDocumentAgent: WsTool = {
  name: 'delegate_to_document_agent',
  description: `Hand document work to that document's sub-agent: ${DOC_AGENT_TYPES.map(t => `${t} (${DOC_AGENTS[t].docLabel})`).join(', ')}. It reads its own inputs, drafts changes to that document only (cards staff approve), and can queue generating it after the same checks staff hit. Returns {doc_type, drafts_created, errors, needs_from_staff, warnings, message}. One document per call.`,
  input_schema: {
    type: 'object',
    properties: {
      doc_type: { type: 'string', enum: [...DOC_AGENT_TYPES] },
      instruction: { type: 'string', description: 'What to do, in plain words, including any figures the staff member gave (exact values).' },
      context_notes: { type: 'string', description: 'Anything else it needs from the conversation. Optional.' },
    },
    required: ['doc_type', 'instruction'],
  },
  async run(ctx, input) {
    const type = str(input.doc_type)
    if (!isDocAgentType(type)) throw new ToolError('Unknown document type')
    if (!ctx.anthropic) throw new ToolError('Document agents are not available right now')
    const jobId = activeJob(ctx)
    const report = await runDocAgent(
      ctx.anthropic,
      { supabase: ctx.supabase, orgId: ctx.orgId, userId: ctx.userId, jobId, staffFirstName: ctx.staffFirstName },
      type,
      str(input.instruction),
      str(input.context_notes),
    )
    const ids = report.drafts_created.map(d => d.id)
    const messageId = await postMessage(ctx.supabase, {
      org_id: ctx.orgId, thread_id: ctx.userId, job_id: jobId, speaker: 'file_agent', author: `File agent > ${report.agent}`,
      content: { text: report.message, ...(ids.length ? { draft_ids: ids } : {}) },
    })
    if (messageId && ids.length) {
      await ctx.supabase.from('agent_drafts').update({ message_id: messageId }).in('id', ids).eq('org_id', ctx.orgId)
    }
    return { ...report, note: 'The cards are already shown under the sub-agent line. Summarise in one or two sentences; do not repeat them.' }
  },
}

const staffOnly: WsTool = {
  name: 'staff_only_action',
  description: `Call this when asked to do something only staff can do (${Object.keys(STAFF_ONLY_ACTIONS).join(', ')}, or anything else that reaches a client). It returns who does it instead; tell the staff member.`,
  input_schema: { type: 'object', properties: { action: { type: 'string', description: 'e.g. send_email, release_to_portal' } }, required: ['action'] },
  run: async (_ctx, input) => ({ blocked: staffOnlyBlock(str(input.action) || 'unknown') }),
}

function patchInput(input: Input): unknown {
  const p = input.patch
  if (typeof p === 'string') {
    try {
      return JSON.parse(p)
    } catch {
      throw new ToolError('patch must be a JSON object')
    }
  }
  return p
}

const draftPhotoChanges: WsTool = {
  name: 'draft_photo_changes',
  description: `Draft changes to photos on the open job: ${PHOTO_FIELDS.join(', ')}. Get photo ids from list_job_photos. One pending change per photo.`,
  input_schema: {
    type: 'object',
    properties: {
      photo_ids: { type: 'array', items: { type: 'string' } },
      patch: { type: 'object', description: 'e.g. {"area_ref": "Kitchen", "category": "before", "include_in_composed_reports": false}' },
    },
    required: ['photo_ids', 'patch'],
  },
  async run(ctx, input) {
    const jobId = activeJob(ctx)
    const ids = Array.isArray(input.photo_ids) ? input.photo_ids.map(str).filter(Boolean) : []
    if (!ids.length) throw new ToolError('No photo ids given')
    if (ids.length > 100) throw new ToolError('At most 100 photos at once')
    const patch = photoPatch(patchInput(input))
    const photoCols: string = `id, ${PHOTO_FIELDS.join(', ')}`
    const { data: photos } = await ctx.supabase
      .from('photos')
      .select(photoCols)
      .eq('job_id', jobId)
      .in('id', ids)
    const rows = (photos ?? []) as unknown as Record<string, unknown>[]
    const out: { photo_id: string; draft_id?: string; skipped?: string }[] = []
    for (const p of rows) {
      const draft = buildPatchDraft(p, patch)
      if (!Object.keys(draft.proposed).length) { out.push({ photo_id: p.id as string, skipped: 'already those values' }); continue }
      const label = `Photo${p.caption ? ` "${String(p.caption).slice(0, 30)}"` : ''}${p.area_ref ? ` (${p.area_ref})` : ''}`
      const id = await upsertPatchDraft(ctx.supabase, {
        orgId: ctx.orgId, jobId, target_path: TARGET.photo(p.id as string), label, draft, createdBy: 'file_agent',
      })
      ctx.draftIds.push(id)
      out.push({ photo_id: p.id as string, draft_id: id })
    }
    const missing = ids.filter(id => !rows.some(p => p.id === id))
    return { drafted: out, not_on_this_job: missing, note: 'Pending staff approval.' }
  },
}

export const FILE_TOOLS: WsTool[] = [
  getJobFile,
  getJobHealth,
  getCapture,
  getSurveyAndDisposal,
  reuse('list_job_documents'),
  getDocument,
  getJobCalls,
  getProgressNotes,
  reuse('list_job_photos'),
  getXeroInvoice,
  draftFieldChanges,
  draftNote,
  draftStatus,
  draftPhotoChanges,
  delegateToDocumentAgent,
  staffOnly,
]

// ── Head agent tools ──────────────────────────────────────────────────────────

export interface JobMarkers { pending_drafts: number; unread: number }

/** Per-job counts of pending drafts and unread feed lines for one user. */
export async function workspaceMarkers(supabase: Supabase, orgId: string, userId: string): Promise<Record<string, JobMarkers>> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [draftsRes, msgsRes, readsRes] = await Promise.all([
    supabase.from('agent_drafts').select('job_id').eq('org_id', orgId).eq('status', 'pending').not('job_id', 'is', null),
    supabase
      .from('agent_messages')
      .select('job_id, thread_id, created_at')
      .eq('org_id', orgId)
      .not('job_id', 'is', null)
      .neq('speaker', 'user')
      .gte('created_at', since)
      .limit(2000),
    supabase.from('agent_job_reads').select('job_id, last_read_at').eq('user_id', userId).eq('org_id', orgId),
  ])
  const out: Record<string, JobMarkers> = {}
  const get = (id: string) => (out[id] ??= { pending_drafts: 0, unread: 0 })
  for (const d of draftsRes.data ?? []) get(d.job_id as string).pending_drafts++
  const reads = new Map((readsRes.data ?? []).map(r => [r.job_id as string, r.last_read_at as string]))
  for (const m of msgsRes.data ?? []) {
    if (m.thread_id === userId) continue
    const last = reads.get(m.job_id as string)
    if (!last || m.created_at > last) get(m.job_id as string).unread++
  }
  return out
}

export async function markJobRead(supabase: Supabase, orgId: string, userId: string, jobId: string) {
  await supabase
    .from('agent_job_reads')
    .upsert({ user_id: userId, job_id: jobId, org_id: orgId, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,job_id' })
}

const listJobsNeedingMe: WsTool = {
  name: 'list_jobs_needing_me',
  description:
    'Jobs that need the staff member: pending agent drafts to approve, Xero or agent items flagged for review, calls and website enquiries from the last 3 days, and unread job activity.',
  input_schema: { type: 'object', properties: {} },
  async run(ctx) {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
    const recent = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const [markers, reviewRes, callsRes, newJobs] = await Promise.all([
      workspaceMarkers(ctx.supabase, ctx.orgId, ctx.userId),
      ctx.supabase
        .from('agent_actions')
        .select('job_id, agent, action, note, created_at')
        .eq('org_id', ctx.orgId)
        .eq('status', 'needs_review')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(30),
      ctx.supabase
        .from('inbound_calls')
        .select('job_id, provider, status, created_at')
        .eq('org_id', ctx.orgId)
        .gte('created_at', recent)
        .order('created_at', { ascending: false })
        .limit(30),
      listNewJobDrafts(ctx.supabase, ctx.orgId),
    ])
    const new_jobs_waiting = newJobs.map(d => ({ draft_id: d.id, summary: d.summary }))
    const byJob = new Map<string, { drafts: number; unread: number; review: string[]; inbound: string[] }>()
    const get = (id: string) => {
      let v = byJob.get(id)
      if (!v) byJob.set(id, (v = { drafts: 0, unread: 0, review: [], inbound: [] }))
      return v
    }
    for (const [id, m] of Object.entries(markers)) {
      if (m.pending_drafts) get(id).drafts = m.pending_drafts
      if (m.unread) get(id).unread = m.unread
    }
    for (const a of reviewRes.data ?? []) {
      if (a.job_id) get(a.job_id as string).review.push(`${a.agent}: ${a.action}${a.note ? ` (${String(a.note).slice(0, 120)})` : ''}`)
    }
    for (const c of callsRes.data ?? []) {
      if (c.job_id) get(c.job_id as string).inbound.push(`${c.provider === 'netlify_form' ? 'website enquiry' : 'call'} ${c.created_at} (${c.status})`)
    }
    const ids = [...byJob.keys()]
    if (!ids.length) return { jobs: [], new_jobs_waiting }
    const { data: jobs } = await ctx.supabase
      .from('jobs')
      .select('id, job_code, client_name, site_address, status')
      .eq('org_id', ctx.orgId)
      .in('id', ids)
    return {
      jobs: (jobs ?? []).map(j => ({ ...j, ...byJob.get(j.id as string) })),
      new_jobs_waiting,
    }
  },
}

const openJob: WsTool = {
  name: 'open_job',
  description:
    "Hand the conversation to one job's file agent. Use when the staff member wants to work on, change or review a specific job. The file agent replies next.",
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string' },
      brief: { type: 'string', description: 'One or two sentences for the file agent: what the staff member wants.' },
    },
    required: ['job_id', 'brief'],
  },
  async run(ctx, input) {
    const jobId = str(input.job_id)
    const { data: job } = await ctx.supabase
      .from('jobs')
      .select('id, job_code')
      .eq('id', jobId)
      .eq('org_id', ctx.orgId)
      .maybeSingle()
    if (!job) throw new ToolError('Job not found in this organisation')
    ctx.handover = { job_id: job.id as string, job_code: (job.job_code as string | null) ?? null, brief: str(input.brief) }
    return { ok: true, opened: job.job_code ?? job.id }
  },
}

async function likelyDuplicates(ctx: WsContext, p: NewJobProposal): Promise<PossibleDuplicate[]> {
  const { name, street } = duplicateSearchTerms(p)
  const ors = [
    ...(p.client_phone ? [`client_phone.eq."${p.client_phone}"`] : []),
    ...(p.client_email && !/[",()]/.test(p.client_email) ? [`client_email.ilike."${p.client_email}"`] : []),
    ...(name ? [`client_name.ilike.%${name}%`] : []),
    ...(street ? [`site_address.ilike.%${street}%`] : []),
  ]
  const cols = 'id, job_code, client_name, client_phone, client_phones, client_email, site_address, status'
  const base = () => ctx.supabase.from('jobs').select(cols).eq('org_id', ctx.orgId).is('archived_at', null)
  const [byFields, byOtherPhones] = await Promise.all([
    ors.length ? base().or(ors.join(',')).order('created_at', { ascending: false }).limit(300) : null,
    p.client_phone ? base().contains('client_phones', [{ number: p.client_phone }]).limit(20) : null,
  ])
  if (byFields?.error) throw byFields.error
  const seen = new Set<string>()
  const rows = [...(byFields?.data ?? []), ...(byOtherPhones?.data ?? [])].filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  return findDuplicates(p, rows as DuplicateCandidate[])
}

const draftNewJob: WsTool = {
  name: 'draft_new_job',
  description:
    'Propose creating a new empty job (status lead). Staff press Create on the card; nothing is created until then. First call checks for likely duplicates (same phone, email, similar client name or site address): if any come back, the job is NOT drafted — tell the staff member and offer the existing job; call again with ignore_duplicates true only if they say it is a different job.',
  input_schema: {
    type: 'object',
    properties: {
      client_name: { type: 'string' },
      client_phone: { type: 'string', description: 'Australian number in any format.' },
      client_email: { type: 'string' },
      site_address: { type: 'string' },
      job_description: { type: 'string', description: 'Neutral and factual, one or two sentences.' },
      urgency: { type: 'string', enum: [...URGENCIES] },
      ignore_duplicates: { type: 'boolean', description: 'Only after the staff member confirmed it is a different job.' },
    },
  },
  async run(ctx, input) {
    let proposed: NewJobProposal
    try {
      proposed = normalizeNewJob(input)
    } catch (e) {
      throw new ToolError(e instanceof Error ? e.message : 'Invalid details')
    }
    const duplicates = await likelyDuplicates(ctx, proposed)
    const dupView = duplicates.map(d => ({ job_code: d.job_code, job_id: d.id, client: d.client_name, site: d.site_address, status: d.status, why: d.reasons.join(', ') }))
    if (duplicates.length && input.ignore_duplicates !== true) {
      return { drafted: false, possible_duplicates: dupView, next: 'Tell the staff member and offer the existing job (open_job). Draft again with ignore_duplicates only if they confirm it is different.' }
    }
    const id = await createNewJobDraft(ctx.supabase, {
      orgId: ctx.orgId, proposed, duplicates, summary: describeNewJob(proposed), createdBy: ctx.userId,
    })
    ctx.draftIds.push(id)
    return { drafted: true, draft_id: id, possible_duplicates: dupView }
  },
}

const HEAD_TOOLS: WsTool[] = [reuse('find_jobs'), reuse('get_job_summary'), listJobsNeedingMe, openJob, draftNewJob]

// ── Prompts ───────────────────────────────────────────────────────────────────

function today() {
  return new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Brisbane' })
}

const COMMON_RULES = `- You cannot email, SMS or otherwise contact clients. Staff send all client messages themselves.
- Lines starting with [Log] are things staff did (edits, approvals). They are context, not requests.
- Australian English. Short, plain replies. No markdown headings.`

function headPrompt(firstName: string) {
  return `You are the head agent in the Agent workspace of an Australian biohazard remediation company. You talk with ${firstName || 'a staff member'} across all jobs. Today is ${today()}.

RULES:
- You never change an existing job. You find, summarise and route; the job's file agent makes changes.
- You can propose a NEW empty job with draft_new_job (client name, phone, email, site address, description, urgency — only what the staff member gave you). It shows as a Create job card; nothing is created until staff press Create, then the chat moves to the new job's file agent.
- draft_new_job checks for duplicates first. If it returns possible_duplicates, list them ("#3452 · Smith · Annerley — same phone"), offer to open the existing job, and only draft again with ignore_duplicates when the staff member says it is a different job.
- "What needs me / what needs approving" → call list_jobs_needing_me. Mention any new jobs waiting to be created.
- When you list jobs, write each on its own line starting with the job code like "#3452 · Annerley — 3 changes waiting" so staff can click it.
- When the staff member wants to work on, change or review one job, call open_job with a short brief. The file agent replies after you; keep your own reply to one short line.
- Resolve jobs with find_jobs; if more than one matches, ask which.
${COMMON_RULES}`
}

function filePrompt(firstName: string, snapshot: unknown, jobCode: string | null) {
  const agents = DOC_AGENT_TYPES.map(t => `${t} = ${DOC_AGENTS[t].docLabel} (${DOC_AGENTS[t].label})`).join('; ')
  return `You are the file agent for job ${jobCode ? `#${jobCode}` : ''} in the Agent workspace of an Australian biohazard remediation company. You work on this one job only, with ${firstName || 'a staff member'}. Today is ${today()}.

YOUR JOB: know this file, answer questions about it, spot what is missing, out of date or needs action, make job-level changes, and hand document work to the right document agent.

READ: everything. Job details (below and get_job_file), get_job_health (what is missing or out of date, and which document agent fixes it), every capture in full (get_capture), survey/CDR/statement figures (get_survey_and_disposal), saved documents with prices (list_job_documents, get_document), calls and enquiries (get_job_calls), progress notes (get_progress_notes), photos (list_job_photos), Xero status (get_xero_invoice, read only).

WRITE (job level, as drafts staff approve): job fields (draft_field_changes), status (draft_status), progress notes (draft_note), photo caption/area/category/phase/report inclusion (draft_photo_changes).

DOCUMENTS: you do not edit documents yourself. For any change to a quote, survey, CDR, statement or completion report — filling it, correcting it, starting it, or generating the document — call delegate_to_document_agent with the doc_type and a plain instruction including any exact figures the staff member gave. Document agents: ${agents}. Each drafts only its own document and reports back; its cards appear under its own line ("File agent > Statement agent"). Then tell staff in one or two sentences what it drafted, anything it needs from them (needs_from_staff), and its warnings. If it hit errors, say so plainly. Several documents → one call each.

WHAT NOBODY HERE DOES (no tools for it): send email or SMS, release documents to the client portal, share links, send payment reminders, trigger or change Xero, delete anything. If asked, call staff_only_action and pass on who does it. A generated document is only saved to the job.

RULES:
- Every write is a draft staff approve on screen; nothing changes until they do. Call the draft tools directly; do not ask "shall I?" first.
- At the start of a conversation on this job (or after a handover), call get_job_health and mention any warnings briefly, then deal with what was asked.
- Only draft what the staff member asked for or what clearly follows. Never invent names, numbers, emails, addresses or prices. If something is unclear (two addresses, which room), ask.
- Dollar amounts only when the staff member gives or explicitly asks for them; pass them to the document agent exactly.
- If a [Log] line shows a staff edit that makes a pending draft or a document out of date, mention it briefly and offer to update it.
- The job description is neutral and factual.
${COMMON_RULES}

JOB FILE (as of this message):
${JSON.stringify(snapshot)}`
}

async function loadRows(supabase: Supabase, orgId: string, filter: { threadId?: string; jobId?: string | null }): Promise<ChatRow[]> {
  let q = supabase
    .from('agent_messages')
    .select('id, thread_id, job_id, speaker, author, content, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_ROWS)
  if (filter.jobId) q = q.eq('job_id', filter.jobId)
  else q = q.eq('thread_id', filter.threadId ?? '').is('job_id', null)
  const { data } = await q
  return ((data ?? []) as ChatRow[]).reverse()
}

export interface ChatTurnInput {
  supabase: Supabase
  orgId: string
  userId: string
  firstName: string
  apiKey: string
  text: string
  activeJobId: string | null
}

/** One staff message in, saved agent replies out. Returns the job now in focus. */
export async function handleChatTurn(input: ChatTurnInput): Promise<{ active_job_id: string | null }> {
  const { supabase, orgId, userId, firstName } = input
  let text = input.text.trim()
  let jobId = input.activeJobId

  const mention = parseJobMention(text)
  if (mention) {
    const { data: job } = await supabase
      .from('jobs')
      .select('id')
      .eq('org_id', orgId)
      .eq('job_code', mention.code)
      .maybeSingle()
    if (!job) {
      await postMessage(supabase, { org_id: orgId, thread_id: userId, job_id: jobId, speaker: 'user', author: firstName, content: { text } })
      await postMessage(supabase, {
        org_id: orgId, thread_id: userId, job_id: jobId, speaker: jobId ? 'file_agent' : 'head_agent',
        content: { text: `I can't find a job with code ${mention.code}.` },
      })
      return { active_job_id: jobId }
    }
    jobId = job.id as string
    text = mention.rest
    await markJobRead(supabase, orgId, userId, jobId)
    if (!text) return { active_job_id: jobId }
  }
  if (!text) return { active_job_id: jobId }

  await postMessage(supabase, { org_id: orgId, thread_id: userId, job_id: jobId, speaker: 'user', author: firstName, content: { text } })

  const anthropic = new Anthropic({ apiKey: input.apiKey })
  const base: WsContext = { userId, orgId, supabase, staffFirstName: firstName, jobId, draftIds: [], handover: null }

  if (!jobId) {
    const rows = await loadRows(supabase, orgId, { threadId: userId, jobId: null })
    const messages = rebuildHistory(rows)
    if (!messages.length) return { active_job_id: null }
    const reply = await runLoop(anthropic, headPrompt(firstName), HEAD_TOOLS, messages, base, { maxSteps: MAX_STEPS, stopWhen: () => base.handover !== null })
    const h = base.handover as WsContext['handover']
    const draftIds = [...new Set(base.draftIds)]
    const messageId = await postMessage(supabase, {
      org_id: orgId, thread_id: userId, job_id: null, speaker: 'head_agent',
      content: {
        text: reply || (h ? `Handing you to the file agent for #${h.job_code ?? ''}.` : draftIds.length ? 'Check the new job below and press Create.' : 'Done.'),
        ...(h ? { handover: { job_id: h.job_id, job_code: h.job_code } } : {}),
        ...(draftIds.length ? { draft_ids: draftIds } : {}),
      },
    })
    if (messageId && draftIds.length) {
      await supabase.from('agent_drafts').update({ message_id: messageId }).in('id', draftIds).eq('org_id', orgId)
    }
    if (!h) return { active_job_id: null }
    await runFileAgent(anthropic, { ...base, jobId: h.job_id, draftIds: [] }, `[Handover from the head agent] ${h.brief}\nThe staff member said: "${text}"`)
    return { active_job_id: h.job_id }
  }

  await runFileAgent(anthropic, base, null)
  return { active_job_id: jobId }
}

async function runFileAgent(anthropic: Anthropic, ctx: WsContext, handoverText: string | null) {
  const jobId = ctx.jobId as string
  const { supabase, orgId, userId } = ctx
  const snapshot = await jobFileSnapshot(supabase, orgId, jobId)
  if (!snapshot) {
    await postMessage(supabase, { org_id: orgId, thread_id: userId, job_id: jobId, speaker: 'file_agent', content: { text: 'I cannot find that job.' } })
    return
  }
  ctx.anthropic = anthropic
  const rows = await loadRows(supabase, orgId, { jobId })
  if (handoverText) {
    rows.push({
      id: 'handover', thread_id: userId, job_id: jobId, speaker: 'user', author: '', content: { text: handoverText },
      created_at: new Date().toISOString(),
    })
  }
  const messages = rebuildHistory(rows)
  if (!messages.length) return
  const jobCode = (snapshot.job as { job_code?: string | null }).job_code ?? null
  const reply = await runLoop(anthropic, filePrompt(ctx.staffFirstName, snapshot, jobCode), FILE_TOOLS, messages, ctx, { maxSteps: MAX_STEPS })
  const draftIds = [...new Set(ctx.draftIds)]
  const messageId = await postMessage(supabase, {
    org_id: orgId, thread_id: userId, job_id: jobId, speaker: 'file_agent',
    content: { text: reply || (draftIds.length ? 'Drafted. Check the changes below.' : 'Done.'), ...(draftIds.length ? { draft_ids: draftIds } : {}) },
  })
  if (messageId && draftIds.length) {
    await supabase.from('agent_drafts').update({ message_id: messageId }).in('id', draftIds).eq('org_id', orgId)
  }
  await markJobRead(supabase, orgId, userId, jobId)
}

// ── Chat view ─────────────────────────────────────────────────────────────────

export interface ChatView {
  rows: ChatRow[]
  drafts: DraftRow[]
}

/**
 * What the middle panel shows: this user's running thread, plus other lines on
 * the open job (pipeline posts, other staff) merged in by time.
 */
export async function loadChatView(supabase: Supabase, orgId: string, userId: string, jobId: string | null): Promise<ChatView> {
  const cols = 'id, thread_id, job_id, speaker, author, content, created_at'
  const threadQ = supabase
    .from('agent_messages')
    .select(cols)
    .eq('org_id', orgId)
    .eq('thread_id', userId)
    .order('created_at', { ascending: false })
    .limit(150)
  const jobQ = jobId
    ? supabase
        .from('agent_messages')
        .select(cols)
        .eq('org_id', orgId)
        .eq('job_id', jobId)
        .or(`thread_id.is.null,thread_id.neq."${userId.replace(/"/g, '')}"`)
        .order('created_at', { ascending: false })
        .limit(50)
    : null
  const [threadRes, jobRes] = await Promise.all([threadQ, jobQ])
  const seen = new Set<string>()
  const rows = [...((threadRes.data ?? []) as ChatRow[]), ...((jobRes?.data ?? []) as ChatRow[])]
    .filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const draftIds = [...new Set(rows.flatMap(r => r.content?.draft_ids ?? []))]
  const [referenced, pending] = await Promise.all([
    draftIds.length
      ? supabase.from('agent_drafts').select('*').eq('org_id', orgId).in('id', draftIds)
      : Promise.resolve({ data: [] as DraftRow[] }),
    jobId ? listPendingDrafts(supabase, orgId, jobId) : Promise.resolve([] as DraftRow[]),
  ])
  const byId = new Map<string, DraftRow>()
  for (const d of [...((referenced.data ?? []) as DraftRow[]), ...pending]) byId.set(d.id, d)
  return { rows, drafts: [...byId.values()] }
}
