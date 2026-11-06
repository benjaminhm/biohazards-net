/*
 * lib/agent/subagents/registry.ts
 *
 * Every document sub-agent. Adding a document type: write its definition in
 * defs/ and list it here.
 */
import { biohazardCleaningQuoteAgent } from './defs/biohazardCleaningQuote'
import { completionReportAgent } from './defs/completionReport'
import { contentsClearanceQuoteAgent } from './defs/contentsClearanceQuote'
import { houseSurveyAgent } from './defs/houseSurvey'
import { statementOfAccountsAgent } from './defs/statementOfAccounts'
import { surfaceAreaCleaningQuoteAgent } from './defs/surfaceAreaCleaningQuote'
import { wasteDisposalManifestAgent } from './defs/wasteDisposalManifest'
import { CAPTURE_KEYS, TARGET, type CaptureKey } from '../patchDraft'
import type { ReadView } from '../jobSnapshot'
import type { AssessmentData } from '@/lib/types'
import { DOC_AGENT_TYPES, EXTRA_READS, type DocAgentDef, type DocAgentType, type ExtraRead } from './types'

export const DOC_AGENTS: Record<DocAgentType, DocAgentDef> = {
  statement_of_accounts: statementOfAccountsAgent,
  biohazard_cleaning_quote: biohazardCleaningQuoteAgent,
  contents_clearance_quote: contentsClearanceQuoteAgent,
  surface_area_cleaning_quote: surfaceAreaCleaningQuoteAgent,
  house_survey: houseSurveyAgent,
  waste_disposal_manifest: wasteDisposalManifestAgent,
  completion_report: completionReportAgent,
}

export function docAgent(type: DocAgentType): DocAgentDef {
  return DOC_AGENTS[type]
}

/** True when the agent reads the whole job file (still drafting only its own document). */
export function readsFullJob(def: DocAgentDef): boolean {
  return def.reads === 'full'
}

/** Captures it sees only as summaries. */
export function hiddenCaptures(def: DocAgentDef): string[] {
  return (def.summarised ?? []).map(s => s.capture)
}

/** Saved document types hidden with those captures. */
export function hiddenDocumentTypes(def: DocAgentDef): string[] {
  return (def.summarised ?? []).map(s => s.documentType)
}

/**
 * Captures the sub-agent may read: every capture with full reads, else its own
 * and its inputs. Summarised captures are replaced by their summary keys.
 */
export function readableCaptures(def: DocAgentDef): string[] {
  const hidden = hiddenCaptures(def)
  const base = readsFullJob(def) ? [...CAPTURE_KEYS] : [...ownCaptures(def), ...def.readCaptures]
  return [...base.filter(k => !hidden.includes(k)), ...(def.summarised ?? []).map(s => s.key)]
}

/** Saved document types the sub-agent may read; null means any type (full reads) except hidden ones. */
export function readableDocumentTypes(def: DocAgentDef): string[] | null {
  return readsFullJob(def) ? null : [def.documentType, ...def.readDocumentTypes].filter(t => !hiddenDocumentTypes(def).includes(t))
}

export function canReadDocument(def: DocAgentDef, documentType: string): boolean {
  if (hiddenDocumentTypes(def).includes(documentType)) return false
  const types = readableDocumentTypes(def)
  return types === null || types.includes(documentType)
}

/** assessment_data as the sub-agent sees it: summarised captures removed, each summary under its own key. */
export function agentView(def: DocAgentDef, ad: AssessmentData | null): Record<string, unknown> {
  const raw = (ad ?? {}) as Record<string, unknown>
  if (!def.summarised?.length) return raw
  const hidden = hiddenCaptures(def)
  return {
    ...Object.fromEntries(Object.entries(raw).filter(([k]) => !hidden.includes(k))),
    ...Object.fromEntries(def.summarised.map(s => [s.key, s.summarise(ad)])),
  }
}

/** The same view for whole-file reads (snapshot, changes since). Null when it sees the file as stored. */
export function readViewFor(def: DocAgentDef): ReadView | null {
  if (!def.summarised?.length) return null
  const owners = Object.values(DOC_AGENTS).filter(d => hiddenDocumentTypes(def).includes(d.documentType))
  return {
    captures: ad => agentView(def, ad),
    renamed: Object.fromEntries(def.summarised.map(s => [s.capture, s.key])),
    hiddenDocumentTypes: hiddenDocumentTypes(def),
    hiddenDraftTargets: [...hiddenCaptures(def).map(TARGET.capture), ...owners.map(d => generateTarget(d.type))],
  }
}

/** Calls, notes, photos, Xero and acceptances it may read: all of them with full reads. */
export function extraReadsFor(def: DocAgentDef): ExtraRead[] {
  return readsFullJob(def) ? [...EXTRA_READS] : def.extraReads
}

/** The capture keys a sub-agent drafts: its own, then any record it also keeps. */
export function ownCaptures(def: DocAgentDef): CaptureKey[] {
  return [def.captureKey, ...(def.alsoOwns ?? [])]
}

/** Only its own capture keys. Enforced by the draft tools and on approval. */
export function canDraftCapture(def: DocAgentDef, key: string): boolean {
  return (ownCaptures(def) as string[]).includes(key)
}

/** The sub-agent that keeps a capture, if any. */
export function captureOwner(key: string): DocAgentDef | undefined {
  return Object.values(DOC_AGENTS).find(d => canDraftCapture(d, key))
}

/** The only saved document type a sub-agent may patch or generate. */
export function canDraftDocument(def: DocAgentDef, documentType: string): boolean {
  return documentType === def.documentType
}

export const GENERATE_PREFIX = 'generate:'

export function generateTarget(type: DocAgentType): string {
  return `${GENERATE_PREFIX}${type}`
}

export function parseGenerateTarget(target: string): DocAgentType | null {
  if (!target.startsWith(GENERATE_PREFIX)) return null
  const t = target.slice(GENERATE_PREFIX.length)
  return (DOC_AGENT_TYPES as readonly string[]).includes(t) ? (t as DocAgentType) : null
}

/** agent_actions.agent and agent_drafts.created_by for a sub-agent. */
export function docAgentId(type: DocAgentType): `doc_agent:${DocAgentType}` {
  return `doc_agent:${type}`
}
