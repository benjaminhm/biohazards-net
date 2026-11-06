/*
 * lib/agent/workspaceText.ts
 *
 * Pure helpers for the Agent workspace (no database, no network) so they can
 * be unit tested: which job fields an agent may draft, how saved chat lines are
 * turned back into a model conversation, and parsing "@1234" job switches.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { DOC_AGENT_TYPES, type DocAgentType } from './subagents/types'

export type Speaker = 'user' | 'head_agent' | 'file_agent' | 'doc_agent' | 'system'

export interface ChatRow {
  id: string
  thread_id: string | null
  job_id: string | null
  speaker: Speaker
  author: string
  content: {
    text?: string
    draft_ids?: string[]
    handover?: { job_id: string; job_code: string | null }
    /** What the file agent asked, on a delegated sub-agent line. */
    instruction?: string
    /** A sub-agent sending staff elsewhere: a document agent, or null for the file agent. */
    switch_to?: { doc_agent: DocAgentType | null; label: string }
  }
  /** The document sub-agent this line belongs to (migration 064). */
  doc_agent?: DocAgentType | null
  created_at: string
}

/**
 * Job columns the file agent may draft changes to, with plain labels. Every
 * editable column except identity and tenancy (id, org_id, job_code,
 * inbound_email_token, created_at, updated_at, archived_*, client_account_id,
 * trading_name). status has its own draft; assessment_data is drafted per
 * capture by the document sub-agents (lib/agent/subagents).
 */
export const DRAFTABLE_FIELDS = {
  client_name: 'client name',
  client_organization_name: 'client organisation',
  client_contact_role: 'client role',
  client_contact_relationship: 'client relationship',
  client_phone: 'client phone',
  client_phones: 'other client phones',
  client_email: 'client email',
  site_address: 'site address',
  site_place_id: 'site place id',
  site_lat: 'site latitude',
  site_lng: 'site longitude',
  site_contact_name: 'site contact name',
  site_contact_phone: 'site contact phone',
  access_notes: 'access notes',
  job_description: 'job description',
  job_type: 'job type',
  insurance_claim_ref: 'insurance claim ref',
  notes: 'office notes',
  urgency: 'urgency',
  scheduled_at: 'scheduled time',
  schedule_note: 'schedule note',
} as const

export type DraftableField = keyof typeof DRAFTABLE_FIELDS

export const JOB_TYPES = ['crime_scene', 'hoarding', 'mold', 'sewage', 'trauma', 'unattended_death', 'flood', 'other'] as const
export const URGENCIES = ['standard', 'urgent', 'emergency'] as const

/** Checks and converts a drafted job field value. Throws with a plain reason. */
export function normalizeFieldValue(field: DraftableField, raw: unknown): unknown {
  if (field === 'site_lat' || field === 'site_lng') {
    if (raw == null || raw === '') return null
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) throw new Error('must be a number')
    return n
  }
  if (field === 'client_phones') {
    const list = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    if (!Array.isArray(list)) throw new Error('must be a list of {label, number}')
    return list.map(p => {
      const o = (p ?? {}) as Record<string, unknown>
      const number = String(o.number ?? '').trim()
      if (!number) throw new Error('each phone needs a number')
      return { label: String(o.label ?? 'Other').trim() || 'Other', number }
    })
  }
  const value = raw == null ? '' : String(raw).trim()
  if (field === 'urgency' && !(URGENCIES as readonly string[]).includes(value)) throw new Error('urgency must be standard, urgent or emergency')
  if (field === 'job_type' && !(JOB_TYPES as readonly string[]).includes(value)) throw new Error(`job type must be one of ${JOB_TYPES.join(', ')}`)
  if (field === 'scheduled_at') {
    if (!value) return null
    if (Number.isNaN(Date.parse(value))) throw new Error('not a date-time')
    return new Date(value).toISOString()
  }
  return value
}

export function isDraftableField(f: unknown): f is DraftableField {
  return typeof f === 'string' && Object.prototype.hasOwnProperty.call(DRAFTABLE_FIELDS, f)
}

export function fieldLabel(f: string): string {
  return isDraftableField(f) ? DRAFTABLE_FIELDS[f] : f.replace(/_/g, ' ')
}

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

/** A draft overwrites something when the job already had a value there. */
export function isOverwrite(before: unknown): boolean {
  return !isEmptyValue(before)
}

export function showValue(v: unknown, max = 80): string {
  if (isEmptyValue(v)) return '(empty)'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Short names staff type after "@1234/" for each document agent. */
export const DOC_AGENT_ALIASES: Record<string, DocAgentType> = {
  statement: 'statement_of_accounts', soa: 'statement_of_accounts', statement_of_accounts: 'statement_of_accounts',
  bcq: 'biohazard_cleaning_quote', biohazard: 'biohazard_cleaning_quote', biohazard_cleaning_quote: 'biohazard_cleaning_quote',
  ccq: 'contents_clearance_quote', contents: 'contents_clearance_quote', contents_clearance_quote: 'contents_clearance_quote',
  sacq: 'surface_area_cleaning_quote', surface: 'surface_area_cleaning_quote', surface_area_cleaning_quote: 'surface_area_cleaning_quote',
  survey: 'house_survey', house_survey: 'house_survey',
  cdr: 'waste_disposal_manifest', disposal: 'waste_disposal_manifest', wdm: 'waste_disposal_manifest', waste_disposal_manifest: 'waste_disposal_manifest',
  completion: 'completion_report', report: 'completion_report', completion_report: 'completion_report',
}

/** Document agent for an alias, 'file' for the file agent, null when unknown. */
export function resolveAgentAlias(raw: string): DocAgentType | 'file' | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (key === 'file' || key === 'file_agent') return 'file'
  return DOC_AGENT_ALIASES[key] ?? ((DOC_AGENT_TYPES as readonly string[]).includes(key) ? (key as DocAgentType) : null)
}

export interface JobMention {
  code: string
  /** Set when "@1234/<agent>" named an agent: a document agent or 'file'. */
  agent?: DocAgentType | 'file'
  /** The text after "/" when it named no known agent. */
  unknownAgent?: string
  rest: string
}

/** "@1234 rest" switches to job code 1234; "@1234/statement rest" to its Statement agent. Null when there is no mention. */
export function parseJobMention(text: string): JobMention | null {
  const m = /^\s*@([A-Za-z0-9-]{2,12})(?:\/([A-Za-z_-]{1,40}))?(?![A-Za-z0-9/-])[\s,:]*([\s\S]*)$/.exec(text)
  if (!m) return null
  const rest = m[3].trim()
  if (!m[2]) return { code: m[1], rest }
  const agent = resolveAgentAlias(m[2])
  return agent ? { code: m[1], agent, rest } : { code: m[1], unknownAgent: m[2], rest }
}

export type ChatTarget =
  | { kind: 'head' }
  | { kind: 'file'; jobId: string }
  | { kind: 'doc'; jobId: string; docAgent: DocAgentType }

/** Who answers a staff message: a document agent needs an open job; anything unknown falls back to the file agent. */
export function chatTarget(jobId: string | null, docAgent: unknown): ChatTarget {
  if (!jobId) return { kind: 'head' }
  if (typeof docAgent === 'string' && (DOC_AGENT_TYPES as readonly string[]).includes(docAgent)) return { kind: 'doc', jobId, docAgent: docAgent as DocAgentType }
  return { kind: 'file', jobId }
}

/** Lines of a direct staff conversation with a document agent (not delegated runs or log lines). */
export function isDirectDocLine(r: Pick<ChatRow, 'speaker' | 'doc_agent'>): boolean {
  return Boolean(r.doc_agent) && (r.speaker === 'user' || r.speaker === 'doc_agent')
}

/** What the file agent replays: everything on the job except direct document-agent conversations. */
export function fileAgentRows<T extends Pick<ChatRow, 'speaker' | 'doc_agent'>>(rows: T[]): T[] {
  return rows.filter(r => !isDirectDocLine(r))
}

/** One document agent's history on a job: direct lines, delegated runs and log lines tagged with it. */
export function docAgentRows<T extends Pick<ChatRow, 'doc_agent'>>(rows: T[], type: DocAgentType): T[] {
  return rows.filter(r => r.doc_agent === type)
}

/**
 * A document agent's history as model input. A delegated run (a file agent
 * line) becomes a log line with what was asked, so it is context rather than
 * something the sub-agent said to staff.
 */
export function docAgentHistory(rows: ChatRow[]): ChatRow[] {
  return rows.map(r => {
    if (r.speaker !== 'file_agent') return r
    const asked = r.content?.instruction ? `The file agent asked: ${r.content.instruction}. ` : ''
    return { ...r, speaker: 'system' as const, author: 'Delegated by the file agent', content: { text: `${asked}You reported: ${r.content?.text ?? ''}` } }
  })
}

/** Recent direct document-agent conversations on a job, for the file agent's prompt. Oldest first. */
export function directConversationDigest(rows: ChatRow[], labels: Record<string, string>, maxLines = 12, maxChars = 280): string {
  const lines = rows.filter(isDirectDocLine).slice(-maxLines).map(r => {
    const who = labels[r.doc_agent as string] ?? 'Document agent'
    const text = (r.content?.text ?? '').replace(/\s+/g, ' ').trim()
    const cut = text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
    return `[${who}] ${r.speaker === 'user' ? `Staff${r.author ? ` (${r.author})` : ''}` : 'Agent'}: ${cut}`
  })
  return lines.join('\n')
}

const LABEL: Record<Speaker, string> = {
  user: 'Staff',
  head_agent: 'Head agent',
  file_agent: 'File agent',
  doc_agent: 'Document agent',
  system: 'Log',
}

/**
 * Turn saved chat lines (oldest first) into a valid Messages API conversation:
 * text only, strictly alternating, starting and ending with a user turn.
 * System lines (edits, approvals) are folded in as user-side context.
 */
export function rebuildHistory(rows: ChatRow[]): Anthropic.MessageParam[] {
  const turns: { role: 'user' | 'assistant'; text: string }[] = []
  for (const r of rows) {
    const text = (r.content?.text ?? '').trim()
    if (!text) continue
    const role = r.speaker === 'head_agent' || r.speaker === 'file_agent' || r.speaker === 'doc_agent' ? 'assistant' : 'user'
    const line = r.speaker === 'system'
      ? `[${LABEL.system}${r.author ? ` · ${r.author}` : ''}] ${text}`
      : r.speaker === 'file_agent' && r.author?.startsWith('File agent >')
        ? `[${r.author}] ${text}`
        : text
    const prev = turns[turns.length - 1]
    if (prev && prev.role === role) prev.text = `${prev.text}\n\n${line}`
    else turns.push({ role, text: line })
  }
  while (turns.length && turns[0].role !== 'user') turns.shift()
  while (turns.length && turns[turns.length - 1].role !== 'user') turns.pop()
  return turns.map(t => ({ role: t.role, content: t.text }))
}

/** Spoken "approve all" is only allowed when every draft just fills an empty field. */
export function voiceApprovable(drafts: { kind: string; before: unknown }[]): boolean {
  return drafts.length > 0 && drafts.every(d => d.kind === 'field' && isEmptyValue(d.before))
}

export function isApproveAllPhrase(text: string): boolean {
  return /^\s*(please\s+)?(approve|accept)\s+(them\s+)?all\b[.!\s]*$/i.test(text)
}
