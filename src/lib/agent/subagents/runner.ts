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
import { buildPatchDraft, TARGET, type PatchDraft } from '../patchDraft'
import { captureLabel, listPendingDrafts, upsertDraft, upsertPatchDraft } from '../drafts'
import { capped, readAcceptances, readCalls, readDocument, readDocumentList, readPhotos, readProgressNotes, readXeroInvoice } from '../jobReads'
import { canDraftCapture, canDraftDocument, DOC_AGENTS, docAgent, docAgentId, generateTarget, readableCaptures, readableDocumentTypes } from './registry'
import { checkGenerate } from './generate'
import type { DocAgentDef, DocAgentReport, DocAgentType, ExtraRead, SubAgentApi } from './types'

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
  drafts: { id: string; summary: string }[]
  reported: { summary: string; needs_from_staff: string[]; warnings: string[] } | null
}

async function assessment(ctx: SubCtx): Promise<AssessmentData | null> {
  const { data } = await ctx.supabase.from('jobs').select('assessment_data').eq('id', ctx.jobId).eq('org_id', ctx.orgId).maybeSingle()
  if (!data) throw new ToolError('Job not found')
  return (data.assessment_data ?? null) as AssessmentData | null
}

function patchArg(input: Input): unknown {
  const p = input.patch
  if (typeof p !== 'string') return p
  try {
    return JSON.parse(p)
  } catch {
    throw new ToolError('patch must be a JSON object')
  }
}

function otherAgentFor(key: string): string {
  const owner = Object.values(DOC_AGENTS).find(d => d.captureKey === key || d.documentType === key)
  return owner ? owner.label : 'the file agent or staff'
}

/** Draft a patch to the sub-agent's own capture. Any other key is refused. */
export async function draftOwnCapture(ctx: SubCtx, key: string, patch: unknown, summary?: string): Promise<{ draft_id?: string; skipped?: string; paths?: string[] }> {
  const { def } = ctx
  if (!canDraftCapture(def, key)) {
    blocked({
      blocked_action: `draft_patch:${key}`,
      required_permission: `write:${key}`,
      handled_by: otherAgentFor(key),
      message: `The ${def.label} may only change ${def.captureKey}.`,
    })
  }
  const problem = def.patchProblem?.(patch)
  if (problem) throw new ToolError(problem)
  const ad = ((await assessment(ctx)) ?? {}) as Record<string, unknown>
  let draft: PatchDraft
  try {
    draft = buildPatchDraft(ad[key] ?? null, patch)
  } catch (err) {
    throw new ToolError(err instanceof Error ? err.message : 'Invalid patch')
  }
  if (!Object.keys(draft.proposed).length) return { skipped: 'already those values' }
  return recordPatch(ctx, draft, summary)
}

async function recordPatch(ctx: SubCtx, draft: PatchDraft, summary?: string) {
  const id = await upsertPatchDraft(ctx.supabase, {
    orgId: ctx.orgId, jobId: ctx.jobId, target_path: TARGET.capture(ctx.def.captureKey), label: captureLabel(ctx.def.captureKey),
    draft, summary, createdBy: docAgentId(ctx.def.type),
  })
  ctx.drafts.push({ id, summary: summary ?? `${ctx.def.docLabel}: ${Object.keys(draft.proposed).length} field change(s)` })
  return { draft_id: id, paths: Object.keys(draft.proposed) }
}

const READ_TOOLS: Record<ExtraRead, AgentTool<SubCtx>> = {
  calls: {
    name: 'read_calls',
    description: 'Phone calls and website enquiries on this job: transcript and what was extracted.',
    input_schema: { type: 'object', properties: {} },
    run: async ctx => ({ calls: await readCalls(ctx.supabase, ctx.orgId, ctx.jobId) }),
  },
  progress_notes: {
    name: 'read_progress_notes',
    description: 'Every progress note on this job, oldest first.',
    input_schema: { type: 'object', properties: {} },
    run: async ctx => ({ notes: await readProgressNotes(ctx.supabase, ctx.jobId) }),
  },
  photos: {
    name: 'read_photos',
    description: 'Photo metadata on this job: caption, area, category, phase, report inclusion.',
    input_schema: { type: 'object', properties: {} },
    run: async ctx => ({ photos: await readPhotos(ctx.supabase, ctx.jobId) }),
  },
  xero: {
    name: 'read_xero_invoice',
    description: "This job's Xero invoice status, read only.",
    input_schema: { type: 'object', properties: {} },
    run: async ctx => (await readXeroInvoice(ctx.supabase, ctx.orgId, ctx.jobId)) ?? { invoice: null },
  },
  acceptances: {
    name: 'read_acceptances',
    description: 'Quote acceptances on this job: which saved quote, when, and the total accepted.',
    input_schema: { type: 'object', properties: {} },
    run: async ctx => ({ acceptances: await readAcceptances(ctx.supabase, ctx.jobId) }),
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
          blocked({ blocked_action: `read_capture:${key}`, required_permission: `read:${key}`, handled_by: 'file agent', message: `The ${def.label} does not read ${key}; ask the file agent.` })
        }
        const ad = ((await assessment(ctx)) ?? {}) as Record<string, unknown>
        return { key, exists: ad[key] != null, content: capped(ad[key] ?? null) }
      },
    },
    {
      name: 'read_document',
      description: `Read a saved document in full. Allowed types: ${readableDocumentTypes(def).join(', ')}.`,
      input_schema: { type: 'object', properties: { document_id: { type: 'string' } }, required: ['document_id'] },
      async run(ctx, input) {
        const doc = await readDocument(ctx.supabase, ctx.orgId, ctx.jobId, str(input.document_id))
        if (!doc) throw new ToolError('Document not found on this job')
        if (!readableDocumentTypes(def).includes(doc.type as string)) {
          blocked({ blocked_action: `read_document:${doc.type}`, required_permission: `read:${doc.type}`, handled_by: 'file agent', message: `The ${def.label} does not read ${doc.type} documents.` })
        }
        return { ...doc, content: capped(doc.content) }
      },
    },
    {
      name: 'draft_patch',
      description: `Draft changes to ${def.captureKey} (your document). patch is merged in: nested objects are walked; lists, text and numbers replace the value. Ids cannot change. One pending card per capture; later patches add to it. Any other key is refused.`,
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: [def.captureKey], description: 'Always your own capture key.' },
          patch: { type: 'object' },
          summary: { type: 'string', description: 'One line for the change card.' },
        },
        required: ['patch'],
      },
      run: (ctx, input) => draftOwnCapture(ctx, str(input.key) || def.captureKey, patchArg(input), str(input.summary) || undefined),
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
          draft = buildPatchDraft(doc.content ?? null, patchArg(input))
        } catch (err) {
          throw new ToolError(err instanceof Error ? err.message : 'Invalid patch')
        }
        if (!Object.keys(draft.proposed).length) return { skipped: 'already those values' }
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
        const ownChangesWaiting = pending.some(d => d.target_path === TARGET.capture(def.captureKey)) || ctx.drafts.length > 0
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
  return [...tools, ...def.extraReads.map(r => READ_TOOLS[r])]
}

export function subAgentTools(def: DocAgentDef, api?: SubAgentApi): AgentTool<SubCtx>[] {
  const extra = api && def.extraTools ? (def.extraTools(api) as AgentTool<SubCtx>[]) : []
  return [...baseTools(def), ...extra]
}

export function subAgentPrompt(def: DocAgentDef, staffFirstName: string): string {
  return `You are the ${def.label} for the file agent of an Australian biohazard remediation company, working on one job's ${def.docLabel}${staffFirstName ? ` for ${staffFirstName}` : ''}. The file agent gives you an instruction; you do the document work and report back.

YOUR DOCUMENT
${def.shape}

YOU CAN
- Read your own capture and these inputs only: captures ${def.readCaptures.join(', ') || '(none)'}; saved documents ${readableDocumentTypes(def).join(', ')}${def.extraReads.length ? `; ${def.extraReads.join(', ')}` : ''}.
- Draft changes to ${def.captureKey} only (draft_patch), patch saved ${def.documentType} documents (draft_document_patch), and queue generating it (draft_generate). Every write is a card staff approve; nothing changes until then.

YOU NEVER: send email or SMS, share links, release to the client portal, send payment reminders, touch Xero, delete anything, or change any other document.

RULES
${def.rules}
- Only do what the instruction asks. Never invent names, figures or measurements. If something needed is missing, list it in needs_from_staff instead of guessing.
- Patch only the fields you mean to change, in the existing shape.
- Finish with report (summary, needs_from_staff, warnings). Australian English, plain words.`
}

function inputsMessage(def: DocAgentDef, ad: Record<string, unknown>, docs: unknown, pending: { kind: string; target_path: string; summary: string }[], instruction: string, notes: string): string {
  const inputs = Object.fromEntries(def.readCaptures.filter(k => ad[k] != null).map(k => [k, capped(ad[k], INPUT_CAP)]))
  return `INSTRUCTION FROM THE FILE AGENT: ${instruction}${notes ? `\nCONTEXT NOTES: ${notes}` : ''}

YOUR CAPTURE (${def.captureKey}): ${JSON.stringify(capped(ad[def.captureKey] ?? null, OWN_CAP))}

INPUT CAPTURES (trimmed; read_capture for the full one): ${JSON.stringify(inputs)}

SAVED DOCUMENTS YOU CAN READ: ${JSON.stringify(docs)}

PENDING CARDS ON THIS JOB FOR YOUR DOCUMENT: ${JSON.stringify(pending)}`
}

export async function runDocAgent(
  anthropic: Anthropic,
  base: { supabase: Supabase; orgId: string; userId: string; jobId: string; staffFirstName: string },
  type: DocAgentType,
  instruction: string,
  notes: string,
): Promise<DocAgentReport> {
  const def = docAgent(type)
  const ctx: SubCtx = { ...base, def, drafts: [], reported: null }
  const errors: string[] = []
  const [ad, docs, pending] = await Promise.all([
    assessment(ctx),
    readDocumentList(base.supabase, base.orgId, base.jobId, readableDocumentTypes(def)),
    listPendingDrafts(base.supabase, base.orgId, base.jobId),
  ])
  const mine = pending
    .filter(d => d.target_path === TARGET.capture(def.captureKey) || d.target_path === generateTarget(type))
    .map(d => ({ kind: d.kind, target_path: d.target_path, summary: d.summary }))
  const api: SubAgentApi = {
    readAssessment: () => assessment(ctx),
    draftOwnPatch: async (draft: PatchDraft, summary?: string) => (await recordPatch(ctx, draft, summary)).draft_id,
  }
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: inputsMessage(def, (ad ?? {}) as Record<string, unknown>, docs, mine, instruction, notes) },
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
