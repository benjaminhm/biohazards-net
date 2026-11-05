/*
 * lib/agent/workspaceText.ts
 *
 * Pure helpers for the Agent workspace (no database, no network) so they can
 * be unit tested: which job fields an agent may draft, how saved chat lines are
 * turned back into a model conversation, and parsing "@1234" job switches.
 */
import type Anthropic from '@anthropic-ai/sdk'

export type Speaker = 'user' | 'head_agent' | 'file_agent' | 'system'

export interface ChatRow {
  id: string
  thread_id: string | null
  job_id: string | null
  speaker: Speaker
  author: string
  content: { text?: string; draft_ids?: string[]; handover?: { job_id: string; job_code: string | null } }
  created_at: string
}

/**
 * Job columns the file agent may draft changes to, with plain labels. Every
 * editable column except identity and tenancy (id, org_id, job_code,
 * inbound_email_token, created_at, updated_at, archived_*, client_account_id,
 * trading_name). status has its own draft; assessment_data is drafted per
 * capture with draft_capture_patch.
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

/** "@1234 rest" switches to job code 1234. Returns null when there is no mention. */
export function parseJobMention(text: string): { code: string; rest: string } | null {
  const m = /^\s*@([A-Za-z0-9-]{2,12})\b[\s,:]*([\s\S]*)$/.exec(text)
  if (!m) return null
  return { code: m[1], rest: m[2].trim() }
}

const LABEL: Record<Speaker, string> = {
  user: 'Staff',
  head_agent: 'Head agent',
  file_agent: 'File agent',
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
    const role = r.speaker === 'head_agent' || r.speaker === 'file_agent' ? 'assistant' : 'user'
    const line = r.speaker === 'system'
      ? `[${LABEL.system}${r.author ? ` · ${r.author}` : ''}] ${text}`
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
