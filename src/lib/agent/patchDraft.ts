/*
 * lib/agent/patchDraft.ts
 *
 * Pure helpers for the file agent's patch drafts: a nested patch into a job
 * capture (assessment_data.<key>), a saved document's content, or a photo.
 *
 * A patch is flattened to leaf paths ("rooms" or "objective.text"). Plain
 * objects are walked; arrays, numbers, strings and booleans replace whole.
 * The draft keeps the value at each path when it was made (before) and the
 * proposed value; approval only applies while every path still holds its
 * before value, otherwise the draft is stale.
 */
import type { AssessmentData, PhotoCategory, PhotoCapturePhase } from '@/lib/types'

/** Every top-level assessment_data key the agent may read and draft into. */
export const CAPTURE_KEYS = [
  'areas', 'contamination_level', 'biohazard_type', 'ppe_required', 'special_risks', 'estimated_hours',
  'estimated_waste_litres', 'access_restrictions', 'observations', 'fast_quote', 'target_price', 'target_price_note',
  'payment_terms', 'terms_and_conditions', 'custom_fields', 'risks_hitl', 'suggested_risks_ai', 'identified_risks_ai',
  'manual_risk_chips', 'presenting_risk_ids', 'suggested_biohazards_ai', 'identified_biohazards_ai',
  'manual_biohazard_chips', 'presenting_biohazard_ids', 'suggested_recommendations_ai', 'identified_recommendations_ai',
  'manual_recommendation_chips', 'presenting_recommendation_ids', 'suggested_equipment_ai', 'used_equipment_catalogue_ids',
  'adhoc_equipment_chips', 'contents_items', 'suggested_contents_ai', 'structure_items', 'suggested_structure_ai',
  'used_chemical_catalogue_uses', 'suggested_chemicals_ai', 'adhoc_chemical_chips', 'pre_remediation_preflight',
  'sow_capture', 'sow_objective', 'assessment_document_capture', 'content_blocks', 'content_blocks_version',
  'completion_report_capture', 'per_execute_capture', 'disposal_manifest_capture', 'outcome_quote_capture',
  'outcome_quotes', 'post_remediation_evaluations', 'pre_multi_part', 'quotes_required', 'house_survey',
  'contents_clearance_quote', 'surface_area_cleaning_quote', 'biohazard_cleaning_quote', 'statement_of_accounts',
  'company_letterhead', 'payment_overdue', 'pathogens_capture',
] as const satisfies readonly (keyof AssessmentData)[]
export type CaptureKey = (typeof CAPTURE_KEYS)[number]

export function isCaptureKey(k: unknown): k is CaptureKey {
  return typeof k === 'string' && (CAPTURE_KEYS as readonly string[]).includes(k)
}

/** Photo columns the agent may draft, and their allowed values. */
export const PHOTO_FIELDS = ['caption', 'area_ref', 'category', 'capture_phase', 'include_in_composed_reports'] as const
const PHOTO_CATEGORIES: PhotoCategory[] = ['before', 'during', 'after', 'assessment']
const PHOTO_PHASES: PhotoCapturePhase[] = ['assessment', 'progress']

/** Draft targets share kind 'document' and are told apart by prefix. */
export const TARGET = {
  capture: (key: string) => `capture:${key}`,
  doc: (id: string) => `doc:${id}`,
  photo: (id: string) => `photo:${id}`,
}

export function parseTarget(t: string): { type: 'capture' | 'doc' | 'photo'; ref: string } | null {
  const m = /^(capture|doc|photo):(.+)$/.exec(t)
  return m ? { type: m[1] as 'capture' | 'doc' | 'photo', ref: m[2] } : null
}

export class PatchError extends Error {}

const FORBIDDEN = new Set(['id', 'org_id', 'job_id', '__proto__', 'prototype', 'constructor'])
const MAX_LEAVES = 200
const MAX_DEPTH = 8

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Leaf paths of a patch. Throws on ids, prototype keys, dotted keys or oversized patches. */
export function flattenPatch(patch: unknown, prefix = '', depth = 0, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!isPlainObject(patch)) throw new PatchError('patch must be an object of field: value')
  if (depth > MAX_DEPTH) throw new PatchError('patch is nested too deeply')
  for (const [k, v] of Object.entries(patch)) {
    if (!k || k.includes('.')) throw new PatchError(`invalid key "${k}"`)
    if (FORBIDDEN.has(k)) throw new PatchError(`"${k}" cannot be changed by the agent`)
    const path = prefix ? `${prefix}.${k}` : k
    if (isPlainObject(v) && Object.keys(v).length) flattenPatch(v, path, depth + 1, out)
    else out[path] = v === undefined ? null : v
    if (Object.keys(out).length > MAX_LEAVES) throw new PatchError('patch is too large; split it up')
  }
  return out
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (!isPlainObject(cur)) return null
    cur = cur[seg]
  }
  return cur ?? null
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split('.')
  let cur = obj
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg]
    if (next == null) cur[seg] = {}
    else if (!isPlainObject(next)) throw new PatchError(`"${path}" goes inside a value that is not an object`)
    cur = cur[seg] as Record<string, unknown>
  }
  cur[segs[segs.length - 1]] = value
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export interface PatchDraft {
  before: Record<string, unknown>
  proposed: Record<string, unknown>
}

/** Leaf changes that differ from what is there now. Empty when the patch changes nothing. */
export function buildPatchDraft(current: unknown, patch: unknown): PatchDraft {
  const leaves = flattenPatch(patch)
  const before: Record<string, unknown> = {}
  const proposed: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(leaves)) {
    const now = getPath(current, path)
    if (sameJson(now, value)) continue
    before[path] = now
    proposed[path] = value
  }
  return { before, proposed }
}

/** A later draft for the same target adds to the pending one. Paths already pending keep their first before. */
export function mergePatchDrafts(pending: PatchDraft, next: PatchDraft): PatchDraft {
  return {
    before: { ...next.before, ...pending.before },
    proposed: { ...pending.proposed, ...next.proposed },
  }
}

export function patchIsCurrent(current: unknown, before: Record<string, unknown>): boolean {
  return Object.entries(before).every(([path, v]) => sameJson(getPath(current, path), v))
}

/** A copy of current (or base when there is none yet) with the proposed paths set. */
export function applyPatch(current: unknown, proposed: Record<string, unknown>, base: () => Record<string, unknown> = () => ({})): Record<string, unknown> {
  const next = isPlainObject(current) ? structuredClone(current) : base()
  for (const [path, value] of Object.entries(proposed)) setPath(next, path, value)
  return next
}

export function isEmptyLeaf(v: unknown): boolean {
  return v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)
}

export interface PatchLine {
  path: string
  before: string
  after: string
  overwrite: boolean
}

/** "Kitchen 12 m²" for a room-like item, else JSON. */
function itemText(item: unknown): string {
  if (!isPlainObject(item)) return typeof item === 'string' ? item : JSON.stringify(item)
  const name = [item.label, item.name, item.title].find(x => typeof x === 'string' && x.trim()) as string | undefined
  if (!name) return JSON.stringify(item)
  const sqm = typeof item.sqm === 'number' ? ` ${item.sqm} m²` : ''
  return `${name}${sqm}`
}

function show(v: unknown, max: number): string {
  if (isEmptyLeaf(v)) return '(empty)'
  const s = typeof v === 'string' ? v : Array.isArray(v) ? v.map(itemText).join(', ') : JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** One readable line per changed path, for change cards. */
export function patchLines(before: unknown, proposed: unknown, max = 70): PatchLine[] {
  const b = isPlainObject(before) ? before : {}
  const p = isPlainObject(proposed) ? proposed : {}
  return Object.keys(p).map(path => ({
    path: path.replace(/_/g, ' ').replace(/\./g, ' › '),
    before: show(b[path], max),
    after: show(p[path], max),
    overwrite: !isEmptyLeaf(b[path]),
  }))
}

export function describePatch(label: string, d: PatchDraft): string {
  const lines = patchLines(d.before, d.proposed, 40)
  const head = lines.slice(0, 3).map(l => (l.before === '(empty)' ? `${l.path}: ${l.after}` : `${l.path}: ${l.before} → ${l.after}`))
  return `${label}: ${head.join('; ')}${lines.length > 3 ? `; +${lines.length - 3} more` : ''}`
}

/** Validates a photo patch; returns only allowed columns with checked values. */
export function photoPatch(patch: unknown): Record<string, unknown> {
  if (!isPlainObject(patch)) throw new PatchError('patch must be an object')
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (!(PHOTO_FIELDS as readonly string[]).includes(k)) throw new PatchError(`photo field "${k}" cannot be changed`)
    if (k === 'category' && !PHOTO_CATEGORIES.includes(v as PhotoCategory)) throw new PatchError('category must be before, during, after or assessment')
    if (k === 'capture_phase' && !PHOTO_PHASES.includes(v as PhotoCapturePhase)) throw new PatchError('capture_phase must be assessment or progress')
    if (k === 'include_in_composed_reports' && typeof v !== 'boolean') throw new PatchError('include_in_composed_reports must be true or false')
    if ((k === 'caption' || k === 'area_ref') && typeof v !== 'string') throw new PatchError(`${k} must be text`)
    out[k] = v
  }
  if (!Object.keys(out).length) throw new PatchError('nothing to change')
  return out
}
