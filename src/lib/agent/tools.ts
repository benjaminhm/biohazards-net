/*
 * lib/agent/tools.ts
 *
 * The agent's "hands": every action the staff chat agent can take. Each tool
 * is org-scoped (jobs are checked against ctx.orgId before anything is read or
 * written). Read tools run automatically; write tools pause for an explicit
 * Approve in the chat drawer before they run.
 *
 * No tool sends email or SMS — client communication stays human-owned
 * (docs/ai-product-principles.md).
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { createServiceClient } from '@/lib/supabase'
import type { JobStatus } from '@/lib/types'

export interface AgentContext {
  userId: string
  orgId: string
  staffFirstName: string
  supabase: ReturnType<typeof createServiceClient>
}

type Input = Record<string, unknown>

export interface AgentTool {
  name: string
  description: string
  input_schema: Anthropic.Tool.InputSchema
  kind: 'read' | 'write'
  /** One line shown on the approval card for write tools. */
  describe?: (input: Input) => string
  run: (ctx: AgentContext, input: Input) => Promise<unknown>
}

const JOB_STATUSES: JobStatus[] = [
  'lead', 'assessed', 'quoted', 'accepted', 'scheduled', 'underway', 'completed', 'report_sent', 'paid',
]

class ToolError extends Error {}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : []
}

async function ownJob(ctx: AgentContext, jobId: string) {
  if (!jobId) throw new ToolError('job_id is required')
  const { data } = await ctx.supabase
    .from('jobs')
    .select('id, job_code, client_name, site_address, status, job_type, urgency, scheduled_at, notes, archived_at')
    .eq('id', jobId)
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  if (!data) throw new ToolError('Job not found in this organisation')
  return data as {
    id: string; job_code: string | null; client_name: string | null; site_address: string | null
    status: JobStatus; job_type: string | null; urgency: string | null; scheduled_at: string | null
    notes: string | null; archived_at: string | null
  }
}

const findJobs: AgentTool = {
  name: 'find_jobs',
  kind: 'read',
  description:
    'Search jobs in this organisation by client name, site address or job code. Returns up to 10 matches, newest first. Use this to resolve "the Smith job" or "the job on King St" to a job_id.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free text: client name, part of the address, or job code.' },
      status: { type: 'string', enum: JOB_STATUSES, description: 'Optional status filter.' },
    },
  },
  async run(ctx, input) {
    const q = str(input.query).replace(/[%,()]/g, ' ').trim()
    let query = ctx.supabase
      .from('jobs')
      .select('id, job_code, client_name, site_address, status, job_type, created_at')
      .eq('org_id', ctx.orgId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(10)
    if (q) query = query.or(`client_name.ilike.%${q}%,site_address.ilike.%${q}%,job_code.ilike.%${q}%`)
    const status = str(input.status)
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    if (error) throw error
    return { jobs: data ?? [] }
  },
}

const getJobSummary: AgentTool = {
  name: 'get_job_summary',
  kind: 'read',
  description: 'Get the core details of one job: client, site, status, type, schedule, office notes, and counts of photos, documents and progress notes.',
  input_schema: {
    type: 'object',
    properties: { job_id: { type: 'string' } },
    required: ['job_id'],
  },
  async run(ctx, input) {
    const job = await ownJob(ctx, str(input.job_id))
    const [photos, docs, notes] = await Promise.all([
      ctx.supabase.from('photos').select('id', { count: 'exact', head: true }).eq('job_id', job.id),
      ctx.supabase.from('documents').select('id', { count: 'exact', head: true }).eq('job_id', job.id),
      ctx.supabase.from('progress_notes').select('id', { count: 'exact', head: true }).eq('job_id', job.id).is('deleted_at', null),
    ])
    return { job, counts: { photos: photos.count ?? 0, documents: docs.count ?? 0, progress_notes: notes.count ?? 0 } }
  },
}

const listJobDocuments: AgentTool = {
  name: 'list_job_documents',
  kind: 'read',
  description: 'List the saved documents on a job (quotes, reports, SWMS, etc.) with type, title, reference and date. Does not return prices.',
  input_schema: {
    type: 'object',
    properties: { job_id: { type: 'string' } },
    required: ['job_id'],
  },
  async run(ctx, input) {
    const job = await ownJob(ctx, str(input.job_id))
    const { data, error } = await ctx.supabase
      .from('documents')
      .select('id, type, created_at, content')
      .eq('job_id', job.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    const documents = (data ?? []).map(d => {
      const c = (d.content ?? {}) as Record<string, unknown>
      return { id: d.id, type: d.type, title: str(c.title), reference: str(c.reference), created_at: d.created_at }
    })
    return { documents }
  },
}

const listJobPhotos: AgentTool = {
  name: 'list_job_photos',
  kind: 'read',
  description:
    'Search the photos on a job by metadata. Filters combine (AND). Returns id, caption, area, category, capture phase, time taken and whether it is included in composed reports.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string' },
      area_contains: { type: 'string', description: 'Room/area text, e.g. "kitchen".' },
      caption_contains: { type: 'string' },
      category: { type: 'string', enum: ['before', 'during', 'after', 'assessment'] },
      capture_phase: { type: 'string', enum: ['assessment', 'progress'] },
      taken_after: { type: 'string', description: 'ISO date/time.' },
      taken_before: { type: 'string', description: 'ISO date/time.' },
      limit: { type: 'number', description: 'Max results, default 40, max 200.' },
    },
    required: ['job_id'],
  },
  async run(ctx, input) {
    const job = await ownJob(ctx, str(input.job_id))
    let query = ctx.supabase
      .from('photos')
      .select('id, caption, area_ref, category, capture_phase, taken_at, uploaded_at, include_in_composed_reports')
      .eq('job_id', job.id)
      .order('taken_at', { ascending: true, nullsFirst: false })
      .limit(Math.min(Math.max(Number(input.limit) || 40, 1), 200))
    const area = str(input.area_contains)
    if (area) query = query.ilike('area_ref', `%${area}%`)
    const caption = str(input.caption_contains)
    if (caption) query = query.ilike('caption', `%${caption}%`)
    if (str(input.category)) query = query.eq('category', str(input.category))
    if (str(input.capture_phase)) query = query.eq('capture_phase', str(input.capture_phase))
    if (str(input.taken_after)) query = query.gte('taken_at', str(input.taken_after))
    if (str(input.taken_before)) query = query.lte('taken_at', str(input.taken_before))
    const { data, error } = await query
    if (error) throw error
    return { photos: data ?? [] }
  },
}

const addProgressNote: AgentTool = {
  name: 'add_progress_note',
  kind: 'write',
  description: 'Add a progress note to a job, optionally tagged with a room. Use the staff member\'s own words; do not embellish.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string' },
      room: { type: 'string', description: 'Room or area, may be empty.' },
      body: { type: 'string' },
    },
    required: ['job_id', 'body'],
  },
  describe: input => `Add progress note${str(input.room) ? ` (${str(input.room)})` : ''}: "${str(input.body).slice(0, 160)}"`,
  async run(ctx, input) {
    const job = await ownJob(ctx, str(input.job_id))
    const body = str(input.body)
    if (!body) throw new ToolError('Note cannot be empty')
    if (body.length > 50_000) throw new ToolError('Note is too long')
    const { data, error } = await ctx.supabase
      .from('progress_notes')
      .insert({
        org_id: ctx.orgId,
        job_id: job.id,
        room: str(input.room),
        body,
        created_by_user_id: ctx.userId,
        updated_by_user_id: ctx.userId,
        created_by_first_name: ctx.staffFirstName,
        updated_by_first_name: ctx.staffFirstName,
      })
      .select('id')
      .single()
    if (error) throw error
    return { ok: true, note_id: data.id }
  },
}

const updateJobStatus: AgentTool = {
  name: 'update_job_status',
  kind: 'write',
  description: 'Change a job\'s pipeline status. This does not notify the client.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string' },
      status: { type: 'string', enum: JOB_STATUSES },
    },
    required: ['job_id', 'status'],
  },
  describe: input => `Change job status to "${str(input.status)}"`,
  async run(ctx, input) {
    const job = await ownJob(ctx, str(input.job_id))
    const status = str(input.status) as JobStatus
    if (!JOB_STATUSES.includes(status)) throw new ToolError('Unknown status')
    const { error } = await ctx.supabase.from('jobs').update({ status }).eq('id', job.id).eq('org_id', ctx.orgId)
    if (error) throw error
    return { ok: true, from: job.status, to: status }
  },
}

const setPhotosInReports: AgentTool = {
  name: 'set_photos_in_reports',
  kind: 'write',
  description:
    'Include or exclude specific photos from composed quotes, SOWs and reports. Get photo ids from list_job_photos first.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string' },
      photo_ids: { type: 'array', items: { type: 'string' } },
      include: { type: 'boolean' },
    },
    required: ['job_id', 'photo_ids', 'include'],
  },
  describe: input =>
    `${input.include === false ? 'Exclude' : 'Include'} ${strList(input.photo_ids).length} photo(s) ${input.include === false ? 'from' : 'in'} composed reports`,
  async run(ctx, input) {
    const job = await ownJob(ctx, str(input.job_id))
    const ids = strList(input.photo_ids)
    if (!ids.length) throw new ToolError('No photo ids given')
    const { data, error } = await ctx.supabase
      .from('photos')
      .update({ include_in_composed_reports: input.include !== false })
      .eq('job_id', job.id)
      .in('id', ids)
      .select('id')
    if (error) throw error
    return { ok: true, updated: data?.length ?? 0 }
  },
}

export const AGENT_TOOLS: AgentTool[] = [
  findJobs,
  getJobSummary,
  listJobDocuments,
  listJobPhotos,
  addProgressNote,
  updateJobStatus,
  setPhotosInReports,
]

export function getAgentTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find(t => t.name === name)
}

export function anthropicToolDefs(): Anthropic.Tool[] {
  return AGENT_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
}

/** Run a tool and always return something the model can read, never throw. */
export async function runAgentTool(ctx: AgentContext, name: string, input: Input): Promise<{ content: string; is_error: boolean }> {
  const tool = getAgentTool(name)
  if (!tool) return { content: `Unknown tool: ${name}`, is_error: true }
  try {
    return { content: JSON.stringify(await tool.run(ctx, input ?? {})), is_error: false }
  } catch (err) {
    const msg = err instanceof ToolError ? err.message : err instanceof Error ? err.message : 'Tool failed'
    return { content: msg, is_error: true }
  }
}
