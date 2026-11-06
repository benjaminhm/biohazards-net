/*
 * lib/agent/subagents/runner.ts
 *
 * Runs one document sub-agent for the file agent, inside the same request:
 * its own prompt, its own tools and a short tool loop. It reads only its
 * inputs, drafts only its own capture and saved documents, and queues
 * generate drafts after the same checks staff hit. It reports back to the
 * file agent; nothing reaches the job until staff approve the cards.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { createServiceClient } from '@/lib/supabase'
import type { AssessmentData } from '@/lib/types'
import { runLoop, str, ToolError, type AgentTool, type Input } from '../loop'
import { blocked } from '../permissions'
import { changesSince, jobSnapshotFor, loadSnapshotRaw, redactFinancials, seesFinancials, storedSnapshot, touchedCapturesSince } from '../jobSnapshot'
import { buildPatchDraft, mergePatchDrafts, PatchError, TARGET, type CaptureKey, type PatchDraft } from '../patchDraft'
import { checkPatch } from '../patchCheck'
import { captureLabel, listPendingDrafts, upsertDraft, upsertPatchDraft } from '../drafts'
import { capped, readAcceptances, readCalls, readDocument, readDocumentList, readPhotos, readProgressNotes, readXeroInvoice } from '../jobReads'
import {
  agentView, canDraftCapture, canDraftDocument, canReadDocument, captureOwner, DOC_AGENTS, docAgent, docAgentId, extraReadsFor, generateTarget,
  hiddenCaptures, ownCaptures, readableCaptures, readableDocumentTypes, readsFullJob, readViewFor,
} from './registry'
import { checkGenerate } from './generate'
import { DOC_AGENT_TYPES, type DocAgentDef, type DocAgentReport, type DocAgentType, type ExtraRead, type SubAgentApi } from './types'

type Supabase = ReturnType<typeof createServiceClient>

export const SUB_AGENT_MAX_STEPS = 8
export const SUB_AGENT_MAX_TOKENS = 1200
const OWN_CAP = 24_000
const INPUT_CAP = 8_000

export interface SubCtx {
  supabase: Supabase
  orgId: string
  userId: string
  jobId: string
  def: DocAgentDef
  /** org_users.role of the staff member; team leads get dollar figures redacted on full-file reads. */
  role?: string | null
  drafts: { id: string; summary: string }[]
  reported: { summary: string; needs_from_staff: string[]; warnings: string[] } | null
  /** Direct chat: where the agent sent staff for something outside its document. */
  referral?: Referral | null
}

/** A document agent, or null for the file agent. */
export interface Referral { doc_agent: DocAgentType | null; label: string }

async function assessment(ctx: SubCtx): Promise<AssessmentData | null> {
  const { data } = await ctx.supabase.from('jobs').select('assessment_data').eq('id', ctx.jobId).eq('org_id', ctx.orgId).maybeSingle()
  if (!data) throw new ToolError('Job not found')
  return (data.assessment_data ?? null) as AssessmentData | null
}

/** assessment_data as this agent may read it. */
async function visibleAssessment(ctx: SubCtx): Promise<Record<string, unknown>> {
  return agentView(ctx.def, await assessment(ctx))
}

async function readableDocumentList(ctx: SubCtx) {
  const docs = await readDocumentList(ctx.supabase, ctx.orgId, ctx.jobId, readableDocumentTypes(ctx.def) ?? undefined)
  return docs.filter(d => canReadDocument(ctx.def, d.type))
}

function otherAgentFor(key: string): string {
  const owner = captureOwner(key) ?? Object.values(DOC_AGENTS).find(d => d.documentType === key)
  return owner ? owner.label : 'the file agent or staff'
}

function isOwnCaptureTarget(def: DocAgentDef, target: string): boolean {
  return ownCaptures(def).some(k => target === TARGET.capture(k))
}

function ownCapturesText(def: DocAgentDef, ad: Record<string, unknown>): string {
  return ownCaptures(def)
    .map((k, i) => `${i === 0 ? 'YOUR CAPTURE' : 'ALSO YOURS'} (${k}): ${JSON.stringify(capped(ad[k] ?? null, OWN_CAP))}`)
    .join('\n\n')
}

export interface PatchChange { key?: unknown; patch?: unknown; summary?: unknown }

export type PreparedPatches =
  | { ok: true; drafts: { key: string; draft: PatchDraft; summary?: string }[]; unchanged: string[] }
  | { ok: false; reasons: string[] }

function parsePatch(p: unknown): unknown {
  if (typeof p !== 'string') return p
  try {
    return JSON.parse(p)
  } catch {
    throw new PatchError('patch must be a JSON object')
  }
}

/**
 * Check every change first (ownership, the document's own checks, the same
 * checkPatch approval runs); nothing is drafted unless all pass. Changes to
 * the same capture merge into one draft.
 */
export function preparePatches(def: DocAgentDef, assessment: Record<string, unknown>, changes: PatchChange[]): PreparedPatches {
  if (!changes.length) return { ok: false, reasons: ['No changes given'] }
  const foreign = changes.map(c => str(c.key) || def.captureKey).find(k => !canDraftCapture(def, k))
  if (foreign) {
    blocked({
      blocked_action: `draft_patch:${foreign}`,
      required_permission: `write:${foreign}`,
      handled_by: otherAgentFor(foreign),
      message: `The ${def.label} may only change ${ownCaptures(def).join(' or ')}. Nothing was drafted.`,
    })
  }
  const reasons: string[] = []
  const byKey = new Map<string, { draft: PatchDraft; summary?: string }>()
  const unchanged: string[] = []
  changes.forEach((c, i) => {
    const key = str(c.key) || def.captureKey
    const label = changes.length > 1 ? `Change ${i + 1}: ` : ''
    let patch: unknown
    let draft: PatchDraft
    try {
      patch = parsePatch(c.patch)
      draft = buildPatchDraft(assessment[key] ?? null, patch)
    } catch (err) {
      reasons.push(`${label}${err instanceof Error ? err.message : 'Invalid patch'}`)
      return
    }
    if (!Object.keys(draft.proposed).length) { unchanged.push(key); return }
    const check = checkPatch({
      target_path: TARGET.capture(key), created_by: docAgentId(def.type), before: draft.before, proposed: draft.proposed, current: assessment[key] ?? null,
    })
    if (!check.ok) { reasons.push(...check.reasons.map(r => `${label}${r}`)); return }
    const prev = byKey.get(key)
    byKey.set(key, { draft: prev ? mergePatchDrafts(prev.draft, draft) : draft, summary: str(c.summary) || prev?.summary })
  })
  if (reasons.length) return { ok: false, reasons }
  return { ok: true, drafts: [...byKey].map(([key, v]) => ({ key, ...v })), unchanged }
}

function changesArg(input: Input): PatchChange[] {
  if (Array.isArray(input.changes)) return input.changes as PatchChange[]
  if (input.patch !== undefined) return [{ key: input.key, patch: input.patch, summary: input.summary }]
  return []
}

async function recordPatch(ctx: SubCtx, key: string, draft: PatchDraft, summary?: string) {
  const id = await upsertPatchDraft(ctx.supabase, {
    orgId: ctx.orgId, jobId: ctx.jobId, target_path: TARGET.capture(key), label: captureLabel(key),
    draft, summary, createdBy: docAgentId(ctx.def.type),
  })
  ctx.drafts.push({ id, summary: summary ?? `${ctx.def.docLabel}: ${Object.keys(draft.proposed).length} field change(s)` })
  return { draft_id: id, paths: Object.keys(draft.proposed) }
}

/** Full-file readers keep the team lead rule: no dollar figures. */
function shown(ctx: SubCtx, value: unknown): unknown {
  return readsFullJob(ctx.def) && !seesFinancials(ctx.role ?? null) ? redactFinancials(value) : value
}

/** Whole-job reads for agents with reads 'full'. Bounded like the file agent's; nothing here writes job data. */
export const FULL_READ_TOOLS: AgentTool<SubCtx>[] = [
  {
    name: 'get_job_snapshot',
    description: 'The whole job file in one call (read only): job fields, every capture, every saved document, photo metadata, progress notes, calls and enquiries, Xero status, pending drafts, open flags, conflicts, health and server_time. Long values are cut with a [truncated] marker; read_capture or read_document for one in full.',
    input_schema: { type: 'object', properties: {} },
    async run(ctx) {
      const r = await jobSnapshotFor(ctx.supabase, ctx.orgId, ctx.jobId, ctx.role ?? null, readViewFor(ctx.def))
      if (!r) throw new ToolError('Job not found')
      return r.snapshot
    },
  },
  {
    name: 'get_job_changes_since',
    description: 'Only what changed on this job after a time (ISO, e.g. the server_time of a snapshot): job fields, captures, documents, notes, photos, calls, drafts and flags. Read only.',
    input_schema: { type: 'object', properties: { since: { type: 'string', description: 'ISO date-time' } }, required: ['since'] },
    async run(ctx, input) {
      const since = str(input.since)
      if (!since || Number.isNaN(Date.parse(since))) throw new ToolError('since must be an ISO date-time')
      const [raw, previous, touched] = await Promise.all([
        loadSnapshotRaw(ctx.supabase, ctx.orgId, ctx.jobId),
        storedSnapshot(ctx.supabase, ctx.orgId, ctx.userId, ctx.jobId, since),
        touchedCapturesSince(ctx.supabase, ctx.orgId, ctx.jobId, since),
      ])
      if (!raw) throw new ToolError('Job not found')
      return changesSince({ since: previous?.at ?? since, raw, previous: previous?.hashes ?? null, touchedCaptures: touched, role: ctx.role ?? null, view: readViewFor(ctx.def) })
    },
  },
  {
    name: 'get_job_health',
    description: 'What on this job is missing, incomplete, expected for its status, blocking the next status or in conflict, with the document agent that can fix each. Read only.',
    input_schema: { type: 'object', properties: {} },
    async run(ctx) {
      const r = await jobSnapshotFor(ctx.supabase, ctx.orgId, ctx.jobId, ctx.role ?? null, readViewFor(ctx.def))
      if (!r) throw new ToolError('Job not found')
      return { status: r.snapshot.job.status, issues: r.snapshot.health, conflicts: r.snapshot.conflicts, open_flags: r.snapshot.flags }
    },
  },
  {
    name: 'list_job_documents',
    description: 'Every saved document on this job: id, type, title, reference and date. Read one with read_document.',
    input_schema: { type: 'object', properties: {} },
    run: async ctx => ({ documents: shown(ctx, await readableDocumentList(ctx)) }),
  },
]

const READ_TOOLS: Record<ExtraRead, AgentTool<SubCtx>> = {
  calls: {
    name: 'read_calls',
    description: 'Phone calls and website enquiries on this job: transcript and what was extracted.',
    input_schema: { type: 'object', properties: {} },
    run: async ctx => ({ calls: shown(ctx, await readCalls(ctx.supabase, ctx.orgId, ctx.jobId)) }),
  },
  progress_notes: {
    name: 'read_progress_notes',
    description: 'Every progress note on this job, oldest first.',
    input_schema: { type: 'object', properties: {} },
    run: async ctx => ({ notes: shown(ctx, await readProgressNotes(ctx.supabase, ctx.jobId)) }),
  },
  photos: {
    name: 'read_photos',
    description: 'Photo metadata on this job: caption, area, category, phase, report inclusion.',
    input_schema: { type: 'object', properties: {} },
    run: async ctx => ({ photos: shown(ctx, await readPhotos(ctx.supabase, ctx.jobId)) }),
  },
  xero: {
    name: 'read_xero_invoice',
    description: "This job's Xero invoice status, read only.",
    input_schema: { type: 'object', properties: {} },
    run: async ctx => shown(ctx, (await readXeroInvoice(ctx.supabase, ctx.orgId, ctx.jobId)) ?? { invoice: null }),
  },
  acceptances: {
    name: 'read_acceptances',
    description: 'Quote acceptances on this job: which saved quote, when, and the total accepted.',
    input_schema: { type: 'object', properties: {} },
    run: async ctx => ({ acceptances: shown(ctx, await readAcceptances(ctx.supabase, ctx.jobId)) }),
  },
}

function baseTools(def: DocAgentDef): AgentTool<SubCtx>[] {
  const tools: AgentTool<SubCtx>[] = [
    {
      name: 'read_capture',
      description: `Read a capture in full. Allowed: ${readableCaptures(def).join(', ')}.`,
      input_schema: { type: 'object', properties: { key: { type: 'string', enum: readableCaptures(def) } }, required: ['key'] },
      async run(ctx, input) {
        const key = str(input.key)
        if (!readableCaptures(def).includes(key)) {
          const summary = def.summarised?.find(s => s.capture === key)
          blocked({
            blocked_action: `read_capture:${key}`, required_permission: `read:${key}`, handled_by: 'file agent',
            message: summary ? `The ${def.label} reads ${summary.key} instead of ${key}.` : `The ${def.label} does not read ${key}; ask the file agent.`,
          })
        }
        const ad = await visibleAssessment(ctx)
        const value = ad[key] ?? null
        const exists = value != null && (value as { exists?: unknown }).exists !== false
        return { key, exists, content: shown(ctx, capped(value)) }
      },
    },
    {
      name: 'read_document',
      description: `Read a saved document in full (read only). Allowed types: ${readableDocumentTypes(def)?.join(', ') ?? 'any document on this job'}.`,
      input_schema: { type: 'object', properties: { document_id: { type: 'string' } }, required: ['document_id'] },
      async run(ctx, input) {
        const doc = await readDocument(ctx.supabase, ctx.orgId, ctx.jobId, str(input.document_id))
        if (!doc) throw new ToolError('Document not found on this job')
        if (!canReadDocument(def, doc.type as string)) {
          blocked({ blocked_action: `read_document:${doc.type}`, required_permission: `read:${doc.type}`, handled_by: 'file agent', message: `The ${def.label} does not read ${doc.type} documents.` })
        }
        return shown(ctx, { ...doc, content: capped(doc.content) })
      },
    },
    {
      name: 'draft_patch',
      description: `Draft changes to ${ownCaptures(def).join(' or ')} (your document). changes is a list of {key, patch, summary}; key is ${ownCaptures(def).join(' or ')} (default ${def.captureKey}). Each patch is merged in: nested objects are walked; lists, text and numbers replace the value. Ids cannot change. Every change is checked first (the same checks as approval) and nothing is drafted unless all pass. One card per capture; later patches add to it.`,
      input_schema: {
        type: 'object',
        properties: {
          changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', enum: ownCaptures(def) },
                patch: { type: 'object' },
                summary: { type: 'string', description: 'One line for the change card.' },
              },
              required: ['patch'],
            },
          },
        },
        required: ['changes'],
      },
      async run(ctx, input) {
        const ad = ((await assessment(ctx)) ?? {}) as Record<string, unknown>
        const prepared = preparePatches(def, ad, changesArg(input))
        if (!prepared.ok) return { drafted: false, reasons: prepared.reasons, note: 'Nothing was drafted. Fix these and try again.' }
        const out = []
        for (const d of prepared.drafts) out.push(await recordPatch(ctx, d.key, d.draft, d.summary))
        return { drafted: out, ...(prepared.unchanged.length ? { already_those_values: prepared.unchanged } : {}) }
      },
    },
    {
      name: 'validate_patch',
      description: 'Check changes without drafting anything: the same checks staff approval runs (allowed capture, unchanged since read, safe paths, types, this document\'s own rules). Pass changes like draft_patch, or document_id with patch for a saved document. Returns {ok, reasons}.',
      input_schema: {
        type: 'object',
        properties: {
          changes: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, patch: { type: 'object' } }, required: ['patch'] } },
          document_id: { type: 'string' },
          patch: { type: 'object' },
        },
      },
      async run(ctx, input) {
        try {
          if (str(input.document_id)) {
            const doc = await readDocument(ctx.supabase, ctx.orgId, ctx.jobId, str(input.document_id))
            if (!doc) return { ok: false, reasons: ['Document not found on this job'] }
            if (!canReadDocument(def, doc.type as string)) return { ok: false, reasons: [`The ${def.label} does not read ${doc.type} documents.`] }
            const draft = buildPatchDraft(doc.content ?? null, parsePatch(input.patch))
            const c = checkPatch({ target_path: TARGET.doc(doc.id as string), created_by: docAgentId(def.type), before: draft.before, proposed: draft.proposed, current: doc.content ?? null, documentType: doc.type as string })
            return { ok: c.ok, reasons: c.reasons }
          }
          const ad = ((await assessment(ctx)) ?? {}) as Record<string, unknown>
          const prepared = preparePatches(def, ad, changesArg(input))
          return prepared.ok ? { ok: true, reasons: [] } : { ok: false, reasons: prepared.reasons }
        } catch (err) {
          if (err instanceof ToolError) return { ok: false, reasons: [err.message] }
          return { ok: false, reasons: [err instanceof Error ? err.message : 'Invalid patch'] }
        }
      },
    },
    {
      name: 'draft_document_patch',
      description: `Draft a change to a saved ${def.documentType} document's content. Other document types are refused. It does not release or send the document.`,
      input_schema: { type: 'object', properties: { document_id: { type: 'string' }, patch: { type: 'object' } }, required: ['document_id', 'patch'] },
      async run(ctx, input) {
        const doc = await readDocument(ctx.supabase, ctx.orgId, ctx.jobId, str(input.document_id))
        if (!doc) throw new ToolError('Document not found on this job')
        if (!canDraftDocument(def, doc.type as string)) {
          blocked({ blocked_action: `draft_document_patch:${doc.type}`, required_permission: `write:${doc.type}`, handled_by: otherAgentFor(String(doc.type)), message: `The ${def.label} may only change ${def.documentType} documents.` })
        }
        let draft: PatchDraft
        try {
          draft = buildPatchDraft(doc.content ?? null, parsePatch(input.patch))
        } catch (err) {
          throw new ToolError(err instanceof Error ? err.message : 'Invalid patch')
        }
        if (!Object.keys(draft.proposed).length) return { skipped: 'already those values' }
        const check = checkPatch({ target_path: TARGET.doc(doc.id as string), created_by: docAgentId(def.type), before: draft.before, proposed: draft.proposed, current: doc.content ?? null, documentType: doc.type as string })
        if (!check.ok) return { drafted: false, reasons: check.reasons }
        const c = (doc.content ?? {}) as Record<string, unknown>
        const label = `${def.docLabel} ${str(c.reference) || str(c.title)}`.trim()
        const id = await upsertPatchDraft(ctx.supabase, {
          orgId: ctx.orgId, jobId: ctx.jobId, target_path: TARGET.doc(doc.id as string), label, draft, createdBy: docAgentId(def.type),
        })
        ctx.drafts.push({ id, summary: `${label}: ${Object.keys(draft.proposed).length} field change(s)` })
        return { draft_id: id, paths: Object.keys(draft.proposed) }
      },
    },
    {
      name: 'draft_generate',
      description: `Queue generating the ${def.docLabel} document (the same as staff pressing Generate). Runs the same checks now and again on approval. Saves the document to the job only; never sends it.`,
      input_schema: { type: 'object', properties: {} },
      async run(ctx) {
        const check = await checkGenerate(ctx.supabase, ctx.orgId, ctx.jobId, def.type)
        const pending = await listPendingDrafts(ctx.supabase, ctx.orgId, ctx.jobId)
        const ownChangesWaiting = pending.some(d => isOwnCaptureTarget(def, d.target_path)) || ctx.drafts.length > 0
        if (!check.ok && !ownChangesWaiting) return { drafted: false, cannot_generate_yet: check.reason }
        const summary = `Generate the ${def.docLabel} (saved to the job, not sent)`
        const id = await upsertDraft(ctx.supabase, {
          orgId: ctx.orgId, jobId: ctx.jobId, kind: 'document', target_path: generateTarget(def.type),
          before: null, proposed: { type: def.documentType }, summary, createdBy: docAgentId(def.type),
        })
        ctx.drafts.push({ id, summary })
        return check.ok ? { drafted: true, draft_id: id } : { drafted: true, draft_id: id, warning: `Approve the pending ${def.docLabel} changes first. As saved now it fails: ${check.reason}` }
      },
    },
    {
      name: 'report',
      description: 'Finish: report back to the file agent. Call once, last.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One or two plain sentences: what you drafted.' },
          needs_from_staff: { type: 'array', items: { type: 'string' }, description: 'Figures or decisions only staff can give.' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: ['summary'],
      },
      async run(ctx, input) {
        const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
        ctx.reported = { summary: str(input.summary), needs_from_staff: list(input.needs_from_staff), warnings: list(input.warnings) }
        return { ok: true }
      },
    },
  ]
  return [...tools, ...(readsFullJob(def) ? FULL_READ_TOOLS : []), ...extraReadsFor(def).map(r => READ_TOOLS[r])]
}

export function subAgentTools(def: DocAgentDef, api?: SubAgentApi): AgentTool<SubCtx>[] {
  const extra = api && def.extraTools ? (def.extraTools(api) as AgentTool<SubCtx>[]) : []
  return [...baseTools(def), ...extra]
}

/** What the agent may read, for its prompt. Reading never permits editing. */
export function readScopeLine(def: DocAgentDef): string {
  const summaries = def.summarised?.length
    ? ` You never see ${hiddenCaptures(def).join(' or ')} themselves or their saved documents: only ${def.summarised.map(s => s.key).join(' and ')} (computed, read only, shown each turn and in the snapshot).`
    : ''
  if (readsFullJob(def)) {
    return `- Read the whole job file, read only: get_job_snapshot, get_job_changes_since, get_job_health, list_job_documents, read_capture (any capture), read_document (any saved document), read_calls, read_progress_notes, read_photos, read_xero_invoice, read_acceptances. Pull in what you need.${summaries} Reading another document never lets you edit it: you draft only ${ownCaptures(def).join(' and ')} and saved ${def.documentType} documents; anything else is refused with a permission error naming who handles it.`
  }
  return `- Read your own capture and these inputs only: captures ${def.readCaptures.join(', ') || '(none)'}; saved documents ${(readableDocumentTypes(def) ?? []).join(', ')}${def.extraReads.length ? `; ${def.extraReads.join(', ')}` : ''}.${summaries}`
}

/** Input captures and summaries shown up front each turn. */
function inputCaptures(def: DocAgentDef, ad: Record<string, unknown>) {
  const keys = [...def.readCaptures, ...(def.summarised ?? []).map(s => s.key)]
  return Object.fromEntries(keys.filter(k => ad[k] != null).map(k => [k, capped(ad[k], INPUT_CAP)]))
}

export function subAgentPrompt(def: DocAgentDef, staffFirstName: string): string {
  return `You are the ${def.label} for the file agent of an Australian biohazard remediation company, working on one job's ${def.docLabel}${staffFirstName ? ` for ${staffFirstName}` : ''}. The file agent gives you an instruction; you do the document work and report back.

YOUR DOCUMENT
${def.shape}

YOU CAN
${readScopeLine(def)}
- Draft changes to ${ownCaptures(def).join(' and ')} only (draft_patch, several changes in one call), patch saved ${def.documentType} documents (draft_document_patch), and queue generating it (draft_generate). validate_patch checks changes without drafting. Every write is a card staff approve; nothing changes until then.

YOU NEVER: send email or SMS, share links, release to the client portal, send payment reminders, touch Xero, delete anything, or change any other document.

RULES
${def.rules}
- Only do what the instruction asks. Never invent names, figures or measurements. If something needed is missing, list it in needs_from_staff instead of guessing.
- Patch only the fields you mean to change, in the existing shape.
- Finish with report (summary, needs_from_staff, warnings). Australian English, plain words.`
}

export function inputsMessage(def: DocAgentDef, ad: Record<string, unknown>, docs: unknown, pending: { kind: string; target_path: string; summary: string }[], instruction: string, notes: string): string {
  const inputs = inputCaptures(def, ad)
  return `INSTRUCTION FROM THE FILE AGENT: ${instruction}${notes ? `\nCONTEXT NOTES: ${notes}` : ''}

${ownCapturesText(def, ad)}

INPUT CAPTURES (trimmed; read_capture for the full one): ${JSON.stringify(inputs)}

SAVED DOCUMENTS YOU CAN READ: ${JSON.stringify(docs)}

PENDING CARDS ON THIS JOB FOR YOUR DOCUMENT: ${JSON.stringify(pending)}`
}

function ownApi(ctx: SubCtx): SubAgentApi {
  const def = ctx.def
  return {
    readAssessment: () => assessment(ctx),
    draftOwnPatch: async (draft: PatchDraft, summary?: string, key: CaptureKey = def.captureKey) => {
      const ad = ((await assessment(ctx)) ?? {}) as Record<string, unknown>
      const check = checkPatch({ target_path: TARGET.capture(key), created_by: docAgentId(def.type), before: draft.before, proposed: draft.proposed, current: ad[key] ?? null })
      if (!check.ok) throw new ToolError(check.reasons.join(' '))
      return (await recordPatch(ctx, key, draft, summary)).draft_id
    },
  }
}

export async function runDocAgent(
  anthropic: Anthropic,
  base: { supabase: Supabase; orgId: string; userId: string; jobId: string; staffFirstName: string; role?: string | null },
  type: DocAgentType,
  instruction: string,
  notes: string,
): Promise<DocAgentReport> {
  const def = docAgent(type)
  const ctx: SubCtx = { ...base, role: base.role ?? null, def, drafts: [], reported: null }
  const errors: string[] = []
  const [ad, docs, pending] = await Promise.all([
    visibleAssessment(ctx),
    readableDocumentList(ctx),
    listPendingDrafts(base.supabase, base.orgId, base.jobId),
  ])
  const mine = pending
    .filter(d => isOwnCaptureTarget(def, d.target_path) || d.target_path === generateTarget(type))
    .map(d => ({ kind: d.kind, target_path: d.target_path, summary: d.summary }))
  const api = ownApi(ctx)
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: inputsMessage(def, ad, docs, mine, instruction, notes) },
  ]
  const text = await runLoop(anthropic, subAgentPrompt(def, base.staffFirstName), subAgentTools(def, api), messages, ctx, {
    maxSteps: SUB_AGENT_MAX_STEPS,
    maxTokens: SUB_AGENT_MAX_TOKENS,
    stopWhen: () => ctx.reported !== null,
    onToolResult: (name, content, isError) => {
      if (isError) errors.push(`${name}: ${content}`)
    },
  })
  return buildReport(def, ctx.drafts, errors, ctx.reported, text)
}

export function buildReport(
  def: DocAgentDef,
  drafts: { id: string; summary: string }[],
  errors: string[],
  reported: SubCtx['reported'],
  text: string,
): DocAgentReport {
  const seen = new Set<string>()
  return {
    doc_type: def.type,
    agent: def.label,
    drafts_created: drafts.filter(d => (seen.has(d.id) ? false : (seen.add(d.id), true))),
    errors,
    needs_from_staff: reported?.needs_from_staff ?? [],
    warnings: reported?.warnings ?? [],
    message: reported?.summary || text || (drafts.length ? 'Drafted.' : 'Nothing drafted.'),
  }
}

// ── Direct chat ───────────────────────────────────────────────────────────────

/** Who handles a capture or document type, for refusals and the switch button. */
export function referralFor(target: string): Referral {
  if (isDocAgentTypeName(target)) return { doc_agent: target, label: DOC_AGENTS[target].label }
  const owner = captureOwner(target) ?? Object.values(DOC_AGENTS).find(d => d.documentType === target || d.label === target)
  return owner ? { doc_agent: owner.type, label: owner.label } : { doc_agent: null, label: 'File agent' }
}

function isDocAgentTypeName(v: string): v is DocAgentType {
  return (DOC_AGENT_TYPES as readonly string[]).includes(v)
}

/** A structured refusal in a tool result names who handles it; offer that agent. */
export function referralFromToolError(content: string): Referral | null {
  try {
    const parsed = JSON.parse(content) as { blocked_action?: unknown; handled_by?: unknown }
    if (typeof parsed?.blocked_action !== 'string' || typeof parsed.handled_by !== 'string') return null
    return /file agent|staff/i.test(parsed.handled_by) ? { doc_agent: null, label: 'File agent' } : referralFor(parsed.handled_by)
  } catch {
    return null
  }
}

function referTool(def: DocAgentDef): AgentTool<SubCtx> {
  const targets = [...DOC_AGENT_TYPES.filter(t => t !== def.type), 'file_agent']
  return {
    name: 'refer_to_other_agent',
    description: `Call when staff ask for something outside the ${def.docLabel}: another document (its agent) or job-level things like client details, status, notes, photos and flags (file_agent). Returns the permission error; tell staff in one line who handles it. The screen offers them a switch.`,
    input_schema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: targets },
        requested: { type: 'string', description: 'What they asked for, in a few words.' },
      },
      required: ['agent', 'requested'],
    },
    async run(ctx, input) {
      const target = str(input.agent)
      const referral = target === 'file_agent' || !isDocAgentTypeName(target) ? { doc_agent: null, label: 'File agent' } : referralFor(target)
      ctx.referral = referral
      blocked({
        blocked_action: str(input.requested) || 'outside_document',
        required_permission: referral.doc_agent ? `write:${DOC_AGENTS[referral.doc_agent].captureKey}` : 'write:job',
        handled_by: referral.label,
        message: `The ${def.label} only works on the ${def.docLabel}. ${referral.label} handles this.`,
      })
    },
  }
}

/** What a document agent can use when staff talk to it directly: its own tools, no report step, plus referral. */
export function directTools(def: DocAgentDef, api?: SubAgentApi, opts: { redact?: boolean } = {}): AgentTool<SubCtx>[] {
  const tools = subAgentTools(def, api).filter(t => t.name !== 'report')
  const out = opts.redact
    ? tools.map(t => (t.name.startsWith('read_') ? { ...t, run: async (ctx: SubCtx, input: Input) => redactFinancials(await t.run(ctx, input)) } : t))
    : tools
  return [...out, referTool(def)]
}

export function directPrompt(def: DocAgentDef, o: { staffLine: string; jobCode: string | null; roleRule: string; context: string; today: string }): string {
  const others = DOC_AGENT_TYPES.filter(t => t !== def.type).map(t => `${DOC_AGENTS[t].label} (${DOC_AGENTS[t].docLabel})`).join(', ')
  return `You are the ${def.label} for job ${o.jobCode ? `#${o.jobCode}` : ''} in the Agent workspace of an Australian biohazard remediation company. Staff opened you directly; you talk with ${o.staffLine}. You look after the ${def.docLabel} on this job and nothing else. Today is ${o.today}.

YOUR DOCUMENT
${def.shape}

YOU CAN
- Answer questions about the ${def.docLabel} from the current state below, read_capture and read_document.
${readScopeLine(def)}
- Draft changes to ${ownCaptures(def).join(' and ')} only (draft_patch), patch saved ${def.documentType} documents (draft_document_patch), check changes first (validate_patch) and queue generating it (draft_generate). Every write is a card staff approve on screen; nothing changes until then. Call the draft tools directly; do not ask "shall I?" first.

YOU NEVER: send email or SMS, share links, release to the client portal, send payment reminders, touch Xero, delete anything, or change any other document or the job itself.

OUTSIDE YOUR DOCUMENT: other documents have their own agents (${others}); job fields, status, notes, photos and flags are the File agent's. If asked for any of that, call refer_to_other_agent and say in one line who handles it. A tool result shaped {blocked_action, required_permission, handled_by, message} is a refusal: tell staff the message and who handles it.

RULES
${def.rules}
- When values you need are missing, ask staff for them in one short list. Never invent names, figures or measurements.
- Patch only the fields you mean to change, in the existing shape. If a draft tool returns reasons, tell staff plainly.
- Mention drafts in a sentence; the cards show under your reply.
${o.roleRule}
- Australian English. Short, plain replies. No markdown headings.

CURRENT STATE (fresh this turn)
${o.context}`
}

export interface DirectResult { text: string; draftIds: string[]; referral: Referral | null; errors: string[] }

/** One staff turn with a document agent, given its history as Messages API turns. Saves nothing itself. */
export async function runDocAgentDirect(
  anthropic: Anthropic,
  base: { supabase: Supabase; orgId: string; userId: string; jobId: string; staffFirstName: string; staffLine: string; jobCode: string | null; roleRule: string; redact: boolean; today: string; role?: string | null },
  type: DocAgentType,
  messages: Anthropic.MessageParam[],
): Promise<DirectResult> {
  const def = docAgent(type)
  const ctx: SubCtx = { supabase: base.supabase, orgId: base.orgId, userId: base.userId, jobId: base.jobId, role: base.role ?? null, def, drafts: [], reported: null, referral: null }
  const [ad, docs, pending] = await Promise.all([
    visibleAssessment(ctx),
    readableDocumentList(ctx),
    listPendingDrafts(base.supabase, base.orgId, base.jobId),
  ])
  const mine = pending
    .filter(d => isOwnCaptureTarget(def, d.target_path) || d.target_path === generateTarget(type) || d.created_by === docAgentId(type))
    .map(d => ({ kind: d.kind, target_path: d.target_path, summary: d.summary }))
  const shown = (v: unknown) => (base.redact ? redactFinancials(v) : v)
  const context = stateText(def, (shown(ad) ?? {}) as Record<string, unknown>, shown(docs), mine)
  const errors: string[] = []
  const text = await runLoop(
    anthropic,
    directPrompt(def, { staffLine: base.staffLine, jobCode: base.jobCode, roleRule: base.roleRule, context, today: base.today }),
    directTools(def, ownApi(ctx), { redact: base.redact }),
    messages,
    ctx,
    {
      maxSteps: SUB_AGENT_MAX_STEPS,
      onToolResult: (name, content, isError) => {
        if (!isError) return
        errors.push(`${name}: ${content}`)
        ctx.referral ??= referralFromToolError(content)
      },
    },
  )
  const seen = new Set<string>()
  return { text, draftIds: ctx.drafts.map(d => d.id).filter(id => (seen.has(id) ? false : (seen.add(id), true))), referral: ctx.referral ?? null, errors }
}

export function stateText(def: DocAgentDef, ad: Record<string, unknown>, docs: unknown, pending: { kind: string; target_path: string; summary: string }[]): string {
  const inputs = inputCaptures(def, ad)
  return `${ownCapturesText(def, ad)}

INPUT CAPTURES (trimmed; read_capture for the full one): ${JSON.stringify(inputs)}

SAVED DOCUMENTS YOU CAN READ: ${JSON.stringify(docs)}

PENDING CARDS FOR YOUR DOCUMENT: ${JSON.stringify(pending)}`
}
