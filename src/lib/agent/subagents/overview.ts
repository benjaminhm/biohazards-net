/*
 * lib/agent/subagents/overview.ts
 *
 * One row per document agent for the workspace job list: whether its capture
 * is missing, started or generated, its pending cards, unread lines in its
 * conversation and the worst health issue it can fix. Pure; the summary route
 * loads the inputs once per job.
 */
import type { JobStatus } from '@/lib/types'
import type { HealthIssue, HealthSeverity } from '../jobHealth'
import type { Conflict } from '../conflicts'
import { STATUS_ORDER } from '../statusRules'
import { TARGET } from '../patchDraft'
import { DOC_AGENTS, docAgentId, generateTarget, ownCaptures } from './registry'
import { DOC_AGENT_TYPES, type DocAgentType } from './types'

export type DocAgentState = 'missing' | 'in_progress' | 'generated'

export interface DocAgentRowSummary {
  type: DocAgentType
  label: string
  doc_label: string
  state: DocAgentState
  /** False greys the row: nothing started and the job is not at that stage. Still clickable. */
  applicable: boolean
  pending_drafts: number
  unread: number
  health: HealthSeverity | null
  health_messages: string[]
}

export interface JobAgentsOverview {
  file_agent: { pending_drafts: number; unread: number }
  agents: DocAgentRowSummary[]
}

export interface OverviewInput {
  status: string
  assessment: Record<string, unknown> | null
  documents: { id: string; type: string }[]
  health: HealthIssue[]
  conflicts: Conflict[]
  pendingDrafts: { created_by?: string | null; target_path: string }[]
  /** Job lines from the last weeks. A document agent's lines count as read from when staff last opened that agent; the rest from when they last opened the job. */
  messages: { doc_agent?: string | null; speaker: string; thread_id: string | null; created_at: string }[]
  userId: string
  jobReadAt: string | null
  docReads: Record<string, string>
}

/** First status at which each document is usually worked on. */
const STAGE_FROM: Record<DocAgentType, JobStatus> = {
  house_survey: 'lead',
  biohazard_cleaning_quote: 'lead',
  contents_clearance_quote: 'lead',
  surface_area_cleaning_quote: 'lead',
  waste_disposal_manifest: 'scheduled',
  completion_report: 'underway',
  statement_of_accounts: 'completed',
}
/** Quotes and the survey stop being the next thing once the job is under way. */
const STAGE_UNTIL: Partial<Record<DocAgentType, JobStatus>> = {
  house_survey: 'accepted',
  biohazard_cleaning_quote: 'accepted',
  contents_clearance_quote: 'accepted',
  surface_area_cleaning_quote: 'accepted',
}

function atStage(type: DocAgentType, status: string): boolean {
  const i = STATUS_ORDER.indexOf(status as JobStatus)
  if (i < 0) return true
  const until = STAGE_UNTIL[type]
  return i >= STATUS_ORDER.indexOf(STAGE_FROM[type]) && (!until || i <= STATUS_ORDER.indexOf(until))
}

const RANK: Record<HealthSeverity, number> = { info: 1, warning: 2, urgent: 3 }

function worse(a: HealthSeverity | null, b: HealthSeverity): HealthSeverity {
  return a && RANK[a] >= RANK[b] ? a : b
}

/** Which agent a pending card belongs to: who drafted it, or the capture, generate or document it targets. */
export function draftOwner(d: { created_by?: string | null; target_path: string }, docTypeById: Map<string, string>): DocAgentType | null {
  for (const type of DOC_AGENT_TYPES) {
    const def = DOC_AGENTS[type]
    if (d.created_by === docAgentId(type)) return type
    if (ownCaptures(def).some(k => d.target_path === TARGET.capture(k)) || d.target_path === generateTarget(type)) return type
    if (d.target_path.startsWith('doc:') && docTypeById.get(d.target_path.slice(4)) === def.documentType) return type
  }
  return null
}

export function docAgentOverview(input: OverviewInput): JobAgentsOverview {
  const ad = input.assessment ?? {}
  const docTypeById = new Map(input.documents.map(d => [d.id, d.type]))
  const drafts = new Map<DocAgentType | 'file', number>()
  for (const d of input.pendingDrafts) {
    const owner = draftOwner(d, docTypeById) ?? 'file'
    drafts.set(owner, (drafts.get(owner) ?? 0) + 1)
  }
  const unread = new Map<DocAgentType | 'file', number>()
  for (const m of input.messages) {
    if (m.speaker === 'user' || m.thread_id === input.userId) continue
    const key = (m.doc_agent && (DOC_AGENT_TYPES as readonly string[]).includes(m.doc_agent) ? m.doc_agent : 'file') as DocAgentType | 'file'
    const since = key === 'file' ? input.jobReadAt : input.docReads[key] ?? null
    if (since && m.created_at <= since) continue
    unread.set(key, (unread.get(key) ?? 0) + 1)
  }
  const conflictTypes = new Map<string, Conflict[]>()
  for (const c of input.conflicts) {
    for (const id of c.document_ids) {
      const t = docTypeById.get(id)
      if (t) conflictTypes.set(t, [...(conflictTypes.get(t) ?? []), c])
    }
  }

  const agents = DOC_AGENT_TYPES.map((type): DocAgentRowSummary => {
    const def = DOC_AGENTS[type]
    const generated = input.documents.some(d => d.type === def.documentType)
    const state: DocAgentState = generated ? 'generated' : ad[def.captureKey] != null ? 'in_progress' : 'missing'
    let health: HealthSeverity | null = null
    const messages: string[] = []
    for (const h of input.health) {
      if (h.doc_agent !== type) continue
      health = worse(health, h.severity)
      messages.push(h.message)
    }
    for (const c of new Set(conflictTypes.get(def.documentType) ?? [])) {
      health = worse(health, 'warning')
      messages.push(c.message)
    }
    const pending = drafts.get(type) ?? 0
    const unreadCount = unread.get(type) ?? 0
    return {
      type,
      label: def.label,
      doc_label: def.docLabel,
      state,
      applicable: state !== 'missing' || pending > 0 || unreadCount > 0 || health !== null || atStage(type, input.status),
      pending_drafts: pending,
      unread: unreadCount,
      health,
      health_messages: [...new Set(messages)],
    }
  })
  agents.sort((a, b) => Number(b.applicable) - Number(a.applicable))
  return { file_agent: { pending_drafts: drafts.get('file') ?? 0, unread: unread.get('file') ?? 0 }, agents }
}
