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
import { CAPTURE_KEYS } from '../patchDraft'
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

/** Captures the sub-agent may read: every capture with full reads, else its own and its inputs. */
export function readableCaptures(def: DocAgentDef): string[] {
  return readsFullJob(def) ? [...CAPTURE_KEYS] : [def.captureKey, ...def.readCaptures]
}

/** Saved document types the sub-agent may read; null means any type (full reads). */
export function readableDocumentTypes(def: DocAgentDef): string[] | null {
  return readsFullJob(def) ? null : [def.documentType, ...def.readDocumentTypes]
}

export function canReadDocument(def: DocAgentDef, documentType: string): boolean {
  const types = readableDocumentTypes(def)
  return types === null || types.includes(documentType)
}

/** Calls, notes, photos, Xero and acceptances it may read: all of them with full reads. */
export function extraReadsFor(def: DocAgentDef): ExtraRead[] {
  return readsFullJob(def) ? [...EXTRA_READS] : def.extraReads
}

/** The only capture key a sub-agent may draft. Enforced by the draft tools. */
export function canDraftCapture(def: DocAgentDef, key: string): boolean {
  return key === def.captureKey
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
