/*
 * lib/agent/conflicts.ts
 *
 * Conflicts between saved documents on one job: the same reference on two
 * documents, or more than one of a document that should be one per job
 * (registry definitions marked unique). Pure; worked out on every read.
 */
import { DOC_AGENTS } from './subagents/registry'

export interface ConflictDocument {
  id: string
  type: string
  content: unknown
}

export interface Conflict {
  /** Stable key, used to flag each conflict once. */
  code: string
  message: string
  document_ids: string[]
}

export function uniqueDocumentTypes(): Map<string, string> {
  return new Map(Object.values(DOC_AGENTS).filter(d => d.unique).map(d => [d.documentType as string, d.docLabel]))
}

function reference(content: unknown): string {
  const r = (content as { reference?: unknown } | null)?.reference
  return typeof r === 'string' ? r.trim() : ''
}

export function documentConflicts(docs: ConflictDocument[], unique: Map<string, string> = uniqueDocumentTypes()): Conflict[] {
  const out: Conflict[] = []
  const byRef = new Map<string, ConflictDocument[]>()
  for (const d of docs) {
    const ref = reference(d.content)
    if (ref) byRef.set(ref.toUpperCase(), [...(byRef.get(ref.toUpperCase()) ?? []), d])
  }
  for (const [ref, list] of byRef) {
    if (list.length < 2) continue
    out.push({
      code: `duplicate_reference:${ref}`,
      message: `Reference ${reference(list[0].content)} is on ${list.length} saved documents (${list.map(d => d.type.replace(/_/g, ' ')).join(', ')}).`,
      document_ids: list.map(d => d.id).sort(),
    })
  }
  for (const [type, label] of unique) {
    const list = docs.filter(d => d.type === type)
    if (list.length < 2) continue
    out.push({
      code: `duplicate_document:${type}`,
      message: `There are ${list.length} saved ${label} documents; a job should have one.`,
      document_ids: list.map(d => d.id).sort(),
    })
  }
  return out
}
