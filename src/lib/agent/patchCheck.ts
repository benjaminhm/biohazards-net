/*
 * lib/agent/patchCheck.ts
 *
 * The one set of checks a patch draft must pass, run both by the sub-agents'
 * validate_patch tool (before anything is drafted) and on staff approval:
 * target allowlist, which agent may change what, safe paths, the value is
 * unchanged since drafting, matching types, and the document's own checks
 * from its registry definition.
 */
import { flattenPatch, getPath, isCaptureKey, parseTarget, PatchError, photoPatch, patchIsCurrent } from './patchDraft'
import { DOC_AGENTS } from './subagents/registry'
import { isDocAgentType, type DocAgentDef } from './subagents/types'

export interface PatchCheckInput {
  target_path: string
  /** agent_drafts.created_by: file_agent, a staff id or doc_agent:<type>. */
  created_by?: string | null
  before: Record<string, unknown>
  proposed: Record<string, unknown>
  /** What is on file now: the capture, document content or photo row. */
  current: unknown
  /** Saved document type, for doc:<id> targets. */
  documentType?: string | null
}

export interface PatchCheck {
  ok: boolean
  reasons: string[]
  /** The value changed since the draft was made (the card goes out of date). */
  stale: boolean
}

/** a.b paths back into a nested object. */
export function unflatten(paths: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(paths)) {
    const segs = path.split('.')
    let cur = out
    for (const seg of segs.slice(0, -1)) {
      if (typeof cur[seg] !== 'object' || cur[seg] === null || Array.isArray(cur[seg])) cur[seg] = {}
      cur = cur[seg] as Record<string, unknown>
    }
    cur[segs[segs.length - 1]] = value
  }
  return out
}

function ownerDef(createdBy: string | null | undefined): DocAgentDef | null | 'unknown' {
  if (!createdBy?.startsWith('doc_agent:')) return null
  const t = createdBy.slice('doc_agent:'.length)
  return isDocAgentType(t) ? DOC_AGENTS[t] : 'unknown'
}

function kind(v: unknown): string {
  return v === null || v === undefined ? 'empty' : Array.isArray(v) ? 'list' : typeof v
}

export function checkPatch(input: PatchCheckInput): PatchCheck {
  const reasons: string[] = []
  let stale = false
  const target = parseTarget(input.target_path)
  if (!target) return { ok: false, reasons: ['Unknown change target'], stale }
  const owner = ownerDef(input.created_by)
  if (owner === 'unknown') return { ok: false, reasons: ['Drafted by an unknown document agent'], stale }

  let docDef: DocAgentDef | undefined
  if (target.type === 'capture') {
    if (!isCaptureKey(target.ref)) reasons.push(`"${target.ref}" is not a capture agents may change`)
    if (owner && owner.captureKey !== target.ref) reasons.push(`The ${owner.label} may only change ${owner.captureKey}.`)
    docDef = Object.values(DOC_AGENTS).find(d => d.captureKey === target.ref)
  } else if (target.type === 'doc') {
    if (!input.documentType) reasons.push('Document not found on this job')
    else if (owner && owner.documentType !== input.documentType) reasons.push(`The ${owner.label} may only change ${owner.documentType} documents.`)
  } else if (owner) {
    reasons.push(`The ${owner.label} may not change photos.`)
  }

  if (!Object.keys(input.proposed).length) reasons.push('Nothing to change')
  const nested = unflatten(input.proposed)
  try {
    if (target.type === 'photo') photoPatch(input.proposed)
    else flattenPatch(nested)
  } catch (err) {
    reasons.push(err instanceof PatchError ? err.message : 'Invalid change')
  }

  if (!patchIsCurrent(input.current ?? null, input.before)) {
    stale = true
    reasons.push('What is on file changed since this was drafted.')
  }

  for (const [path, value] of Object.entries(input.proposed)) {
    const now = target.type === 'photo' ? (input.current as Record<string, unknown> | null)?.[path] : getPath(input.current, path)
    if (now == null || value == null) continue
    if ((typeof now === 'number' || typeof now === 'boolean') && kind(value) !== kind(now)) {
      reasons.push(`${path} must be a ${typeof now}, not ${kind(value)}`)
    }
  }

  const problem = docDef?.patchProblem?.(nested)
  if (problem) reasons.push(problem)

  return { ok: reasons.length === 0, reasons, stale }
}
