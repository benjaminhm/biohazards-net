/*
 * lib/agent/workspaceAgent.ts
 *
 * The two agents behind the Agent workspace chat.
 *
 *   Head agent — sees every job, never changes one. Answers cross-job
 *   questions ("what needs me?") and hands a job over to its file agent with
 *   open_job and a short brief.
 *   File agent — one job only. Reads the job file and records proposals as
 *   agent_drafts; staff approve them on screen.
 *
 * Chat is saved one visible line per row (agent_messages). Tool calls only live
 * inside a single request. No tool contacts clients
 * (docs/ai-product-principles.md).
 */
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_SONNET_MODEL } from '@/lib/anthropicModels'
import type { createServiceClient } from '@/lib/supabase'
import { getAgentTool, type AgentContext } from '@/lib/agent/tools'
import {
  JOB_STATUSES,
  QUOTE_DOC_KEYS,
  QUOTE_DOC_LABELS,
  describeFieldDraft,
  emptyQuoteCapture,
  listPendingDrafts,
  postMessage,
  upsertDraft,
  type DraftRow,
  type QuoteDocKey,
} from './drafts'
import {
  DRAFTABLE_FIELDS,
  isDraftableField,
  parseJobMention,
  rebuildHistory,
  type ChatRow,
} from './workspaceText'

type Supabase = ReturnType<typeof createServiceClient>
type Input = Record<string, unknown>

const MAX_STEPS = 10
const HISTORY_ROWS = 40
const URGENCIES = ['standard', 'urgent', 'emergency']
const JOB_FIELDS = `id, job_code, status, job_type, ${Object.keys(DRAFTABLE_FIELDS).join(', ')}, assessment_data`

export interface WsContext extends AgentContext {
  jobId: string | null
  draftIds: string[]
  handover: { job_id: string; job_code: string | null; brief: string } | null
}

interface WsTool {
  name: string
  description: string
  input_schema: Anthropic.Tool.InputSchema
  run: (ctx: WsContext, input: Input) => Promise<unknown>
}

class ToolError extends Error {}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

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
            value: { type: 'string', description: 'New value. scheduled_at as ISO date-time; urgency standard|urgent|emergency.' },
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
      let value: string | null = typeof c.value === 'string' ? c.value.trim() : String(c.value ?? '')
      if (!isDraftableField(field)) { out.push({ field, skipped: 'not a field you can change' }); continue }
      if (field === 'urgency' && !URGENCIES.includes(value)) { out.push({ field, skipped: 'urgency must be standard, urgent or emergency' }); continue }
      if (field === 'scheduled_at') {
        if (!value) value = null
        else if (Number.isNaN(Date.parse(value))) { out.push({ field, skipped: 'not a date-time' }); continue }
        else value = new Date(value).toISOString()
      }
      const before = row[field] ?? null
      if ((before ?? '') === (value ?? '')) { out.push({ field, skipped: 'already that value' }); continue }
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

const draftDocument: WsTool = {
  name: 'draft_document',
  description:
    'Start a quote on the open job (Biohazard Cleaning, Contents Clearance or Surface Area Cleaning) with wording only and every price blank. Only when that quote is not already started. Staff price and send it themselves.',
  input_schema: {
    type: 'object',
    properties: {
      quote_type: { type: 'string', enum: [...QUOTE_DOC_KEYS] },
      description: { type: 'string', description: 'What needs doing, in neutral words from the staff member. Used as the BCQ description or SACQ scope of work.' },
      estimated_m3: { type: 'number', description: 'Contents Clearance only: estimated cubic metres if the staff member gave one.' },
    },
    required: ['quote_type'],
  },
  async run(ctx, input) {
    const jobId = activeJob(ctx)
    const key = str(input.quote_type) as QuoteDocKey
    if (!QUOTE_DOC_KEYS.includes(key)) throw new ToolError('Unknown quote type')
    const { data: job } = await ctx.supabase.from('jobs').select('assessment_data').eq('id', jobId).eq('org_id', ctx.orgId).maybeSingle()
    if (!job) throw new ToolError('Job not found')
    if (((job.assessment_data ?? {}) as Record<string, unknown>)[key] != null) {
      throw new ToolError(`A ${QUOTE_DOC_LABELS[key]} is already started on this job. Staff can edit it in the job file.`)
    }
    const m3 = typeof input.estimated_m3 === 'number' && input.estimated_m3 > 0 ? input.estimated_m3 : null
    const capture = emptyQuoteCapture(key, { description: str(input.description), estimated_m3: m3 })
    const id = await upsertDraft(ctx.supabase, {
      orgId: ctx.orgId, jobId, kind: 'document', target_path: key, before: null, proposed: capture,
      summary: `New ${QUOTE_DOC_LABELS[key]} draft (prices blank)`, createdBy: 'file_agent',
    })
    ctx.draftIds.push(id)
    return { draft_id: id, note: 'Pending staff approval. Prices are left for staff.' }
  },
}

const FILE_TOOLS: WsTool[] = [
  getJobFile,
  reuse('list_job_documents'),
  reuse('list_job_photos'),
  draftFieldChanges,
  draftNote,
  draftStatus,
  draftDocument,
]

// ── Head agent tools ──────────────────────────────────────────────────────────

export interface JobMarkers { pending_drafts: number; unread: number }

/** Per-job counts of pending drafts and unread feed lines for one user. */
export async function workspaceMarkers(supabase: Supabase, orgId: string, userId: string): Promise<Record<string, JobMarkers>> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [draftsRes, msgsRes, readsRes] = await Promise.all([
    supabase.from('agent_drafts').select('job_id').eq('org_id', orgId).eq('status', 'pending'),
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
    const [markers, reviewRes, callsRes] = await Promise.all([
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
    ])
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
    if (!ids.length) return { jobs: [] }
    const { data: jobs } = await ctx.supabase
      .from('jobs')
      .select('id, job_code, client_name, site_address, status')
      .eq('org_id', ctx.orgId)
      .in('id', ids)
    return {
      jobs: (jobs ?? []).map(j => ({ ...j, ...byJob.get(j.id as string) })),
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

const HEAD_TOOLS: WsTool[] = [reuse('find_jobs'), reuse('get_job_summary'), listJobsNeedingMe, openJob]

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
- You never change a job. You find, summarise and route.
- "What needs me / what needs approving" → call list_jobs_needing_me.
- When you list jobs, write each on its own line starting with the job code like "#3452 · Annerley — 3 changes waiting" so staff can click it.
- When the staff member wants to work on, change or review one job, call open_job with a short brief. The file agent replies after you; keep your own reply to one short line.
- Resolve jobs with find_jobs; if more than one matches, ask which.
${COMMON_RULES}`
}

function filePrompt(firstName: string, snapshot: unknown, jobCode: string | null) {
  return `You are the file agent for job ${jobCode ? `#${jobCode}` : ''} in the Agent workspace of an Australian biohazard remediation company. You work on this one job only, with ${firstName || 'a staff member'}. Today is ${today()}.

RULES:
- Every change you make is a draft. draft_field_changes, draft_note, draft_status and draft_document record proposals that staff approve on screen. Call them directly; do not ask "shall I?" first.
- After drafting, say in one or two sentences what you drafted. The change card shows the detail. Say plainly when a draft would overwrite something already on file.
- Only draft what the staff member asked for or what clearly follows from what they told you. Never invent names, numbers, emails or addresses. If something is unclear (two addresses, which room), ask.
- If a [Log] line shows a staff edit that makes one of your pending drafts or a document out of date, mention it briefly and offer to update it.
- Quotes: draft_document starts a BCQ, CCQ or SACQ with wording only; prices are always left for staff.
- The job description is neutral and factual.
${COMMON_RULES}

JOB FILE (as of this message):
${JSON.stringify(snapshot)}`
}

// ── Loop ──────────────────────────────────────────────────────────────────────

async function runLoop(
  anthropic: Anthropic,
  system: string,
  tools: WsTool[],
  messages: Anthropic.MessageParam[],
  ctx: WsContext,
  stopWhen: () => boolean,
): Promise<string> {
  const defs = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
  const texts: string[] = []
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await anthropic.messages.create({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 1500,
      system,
      tools: defs,
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      messages,
    })
    messages.push({ role: 'assistant', content: res.content })
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text.trim()).filter(Boolean).join('\n\n')
    if (text) texts.push(text)
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !use) return texts.join('\n\n')

    const tool = tools.find(t => t.name === use.name)
    let content: string
    let isError = false
    if (!tool) {
      content = `Unknown tool: ${use.name}`
      isError = true
    } else {
      try {
        content = JSON.stringify(await tool.run(ctx, (use.input ?? {}) as Input))
      } catch (err) {
        content = err instanceof Error ? err.message : 'Tool failed'
        isError = true
      }
    }
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content, is_error: isError }] })
    if (stopWhen()) return texts.join('\n\n')
  }
  texts.push('That took more steps than I allow in one go. Tell me what to do next.')
  return texts.join('\n\n')
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
    const reply = await runLoop(anthropic, headPrompt(firstName), HEAD_TOOLS, messages, base, () => base.handover !== null)
    const h = base.handover as WsContext['handover']
    await postMessage(supabase, {
      org_id: orgId, thread_id: userId, job_id: null, speaker: 'head_agent',
      content: {
        text: reply || (h ? `Handing you to the file agent for #${h.job_code ?? ''}.` : 'Done.'),
        ...(h ? { handover: { job_id: h.job_id, job_code: h.job_code } } : {}),
      },
    })
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
  const reply = await runLoop(anthropic, filePrompt(ctx.staffFirstName, snapshot, jobCode), FILE_TOOLS, messages, ctx, () => false)
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
