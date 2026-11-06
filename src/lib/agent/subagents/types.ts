/*
 * lib/agent/subagents/types.ts
 *
 * A document sub-agent works on one document type for the file agent. Its
 * definition says what it may read, the one capture key and the one saved
 * document type it may draft changes to, how its document is shaped, and how
 * its document is generated (the same compose and checks staff use).
 */
import type { AgentTool } from '../loop'
import type { CaptureKey, PatchDraft } from '../patchDraft'
import type { AssessmentData, CompanyProfile, DocType, Document, Job, Photo, ProgressNote, ProgressRoomNote } from '@/lib/types'

export const DOC_AGENT_TYPES = [
  'statement_of_accounts',
  'biohazard_cleaning_quote',
  'contents_clearance_quote',
  'surface_area_cleaning_quote',
  'house_survey',
  'waste_disposal_manifest',
  'completion_report',
] as const
export type DocAgentType = (typeof DOC_AGENT_TYPES)[number]

export function isDocAgentType(v: unknown): v is DocAgentType {
  return typeof v === 'string' && (DOC_AGENT_TYPES as readonly string[]).includes(v)
}

/** Job data outside the captures and documents a sub-agent may read. */
export const EXTRA_READS = ['calls', 'progress_notes', 'photos', 'xero', 'acceptances'] as const
export type ExtraRead = (typeof EXTRA_READS)[number]

/** What generating needs loaded besides the job itself. */
export type GenerateNeed = 'documents' | 'company' | 'report_media'

export interface GenerateInputs {
  job: Job
  documents: Document[]
  company: CompanyProfile | null
  photos: Photo[]
  progressNotes: ProgressNote[]
  progressRoomNotes: ProgressRoomNote[]
}

export type GenerateCheck = { ok: true; content: Record<string, unknown> } | { ok: false; reason: string }

/**
 * A capture the agent never reads raw, on any path: a computed, read-only
 * summary is shown under its own key instead, and saved documents of the
 * record's type (and drafts on either) are hidden.
 */
export interface SummarisedCapture {
  capture: CaptureKey
  documentType: DocType
  key: string
  summarise: (ad: AssessmentData | null) => unknown
}

/** What a sub-agent's own extra tools may do. Every write is a draft on its own capture. */
export interface SubAgentApi {
  /** The raw assessment, for code that computes. Tools return only what the agent may read. */
  readAssessment: () => Promise<AssessmentData | null>
  /** Drafts on captureKey unless key names another capture it owns. */
  draftOwnPatch: (draft: PatchDraft, summary?: string, key?: CaptureKey) => Promise<string>
}

export interface DocAgentDef {
  type: DocAgentType
  /** Shown as "File agent > <label>". */
  label: string
  docLabel: string
  /** The capture it drafts changes to. */
  captureKey: CaptureKey
  /** Records printed in its document that it also keeps. Nobody else may draft them. */
  alsoOwns?: CaptureKey[]
  /** The only saved document type it may patch or generate. */
  documentType: DocType
  /**
   * 'full': reads the whole job file (snapshot, changes, health, any capture,
   * any document, calls, notes, photos, Xero, acceptances), read only.
   * 'scoped' (default): only readCaptures, readDocumentTypes and extraReads.
   * Writes stay limited to its own captures and documentType either way.
   */
  reads?: 'full' | 'scoped'
  /** Other captures it reads as inputs (its own is always readable). With reads 'full', the ones shown up front each turn. */
  readCaptures: CaptureKey[]
  /** Read as summaries only, whatever reads says. Summaries are shown up front each turn. */
  summarised?: SummarisedCapture[]
  /** Other saved document types it may read. */
  readDocumentTypes: DocType[]
  extraReads: ExtraRead[]
  /** Field summary of its capture, for its prompt. */
  shape: string
  /** Document-specific rules, for its prompt. */
  rules: string
  generateNeeds: GenerateNeed[]
  /** Rejects a patch to its capture before drafting and on approval. Null when fine. */
  patchProblem?: (patch: unknown) => string | null
  /** At most one saved document of this type per job (more is a conflict). */
  unique?: boolean
  /** Capture paths that must be filled before the document is complete (job health). */
  requiredFields?: string[]
  /** Same compose and checks as staff pressing Generate. Pure. */
  generate: (inputs: GenerateInputs) => GenerateCheck
  extraTools?: (api: SubAgentApi) => AgentTool<unknown>[]
}

export interface DocAgentReport {
  doc_type: DocAgentType
  agent: string
  drafts_created: { id: string; summary: string }[]
  errors: string[]
  needs_from_staff: string[]
  warnings: string[]
  message: string
}
