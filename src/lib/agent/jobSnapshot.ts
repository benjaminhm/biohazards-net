/*
 * lib/agent/jobSnapshot.ts
 *
 * The file agent's view of one job in a single call, and what changed since
 * it last looked.
 *
 * Snapshot: job fields, every capture, every saved document with its content,
 * photo metadata, progress notes, calls and enquiries (cleaned transcript and
 * extraction summary), Xero status, pending drafts, open flags, health and
 * server_time. Long values are cut with a visible marker and the whole thing
 * is kept under SNAPSHOT_LIMITS.total characters.
 *
 * Changes: each snapshot also returns a short hash per field, capture,
 * document, photo, note, call, draft and flag. The file agent's reply stores
 * them (agent_messages.content.snapshot); the next turn compares the job
 * against them and sends only what differs. With no stored hashes the diff
 * falls back to timestamps and logged edits, which is coarse for captures
 * (assessment_data has no per-key timestamp) — the result says so.
 *
 * Team leads get the same file with dollar figures left out.
 */
import { createHash } from 'node:crypto'
import type { createServiceClient } from '@/lib/supabase'
import type { AssessmentData } from '@/lib/types'
import { DRAFTABLE_FIELDS } from './workspaceText'
import { listPendingDrafts, type DraftRow } from './drafts'
import { listOpenFlags, raiseConflictFlags, type JobFlag } from './flags'
import { documentConflicts } from './conflicts'
import { jobHealth, type HealthIssue } from './jobHealth'
import { readAcceptances, readXeroInvoice } from './jobReads'
import { PHOTO_FIELDS } from './patchDraft'

type Supabase = ReturnType<typeof createServiceClient>

export const SNAPSHOT_LIMITS = { capture: 12_000, document: 6_000, transcript: 4_000, note: 1_500, photos: 200, notes: 200, calls: 10, total: 150_000 }

export const SNAPSHOT_JOB_FIELDS = ['id', 'job_code', 'status', 'created_at', 'updated_at', ...Object.keys(DRAFTABLE_FIELDS)]

export type StaffRole = 'owner' | 'admin' | 'manager' | 'team_lead' | 'member' | string

export function seesFinancials(role: StaffRole | null | undefined): boolean {
  return role !== 'team_lead' && role !== 'member'
}

/**
 * A reader that sees some captures only as summaries (the Statement agent).
 * Health and hashes still come from the stored file; only what is shown changes.
 */
export interface ReadView {
  /** assessment_data as shown. */
  captures: (ad: AssessmentData | null) => Record<string, unknown>
  /** Stored capture key → the key its summary is shown under. */
  renamed: Record<string, string>
  hiddenDocumentTypes: readonly string[]
  /** Draft target paths not shown (besides drafts on hidden documents). */
  hiddenDraftTargets: readonly string[]
}

function visibleDocuments(raw: SnapshotRaw, view: ReadView | null | undefined) {
  return view ? raw.documents.filter(d => !view.hiddenDocumentTypes.includes(d.type)) : raw.documents
}

function visibleDrafts(raw: SnapshotRaw, view: ReadView | null | undefined): DraftRow[] {
  if (!view) return raw.drafts
  const hiddenDocs = new Set(raw.documents.filter(d => view.hiddenDocumentTypes.includes(d.type)).map(d => `doc:${d.id}`))
  return raw.drafts.filter(d => !view.hiddenDraftTargets.includes(d.target_path) && !hiddenDocs.has(d.target_path))
}

// ── Raw rows ──────────────────────────────────────────────────────────────────

export interface SnapshotRaw {
  job: Record<string, unknown>
  documents: { id: string; type: string; content: unknown; created_at: string; released_to_portal_at: string | null }[]
  photos: Record<string, unknown>[]
  notes: { id: string; room: string | null; body: string | null; created_by_first_name: string | null; created_at: string; updated_at?: string | null }[]
  calls: { id: string; created_at: string; provider: string | null; caller_number: string | null; status: string | null; transcript_clean: string | null; extraction: unknown }[]
  xero: Record<string, unknown> | null
  drafts: DraftRow[]
  flags: JobFlag[]
  acceptances: { document_id: string | null; quote_total: number | null; accepted_at: string; quote_reference?: string | null }[]
}

// ── Bounding and redaction ────────────────────────────────────────────────────

export function truncateText(s: string | null | undefined, max: number): string {
  const t = s ?? ''
  return t.length <= max ? t : `${t.slice(0, max)} …[truncated, ${t.length - max} more characters]`
}

export function bounded(value: unknown, max: number): unknown {
  const s = JSON.stringify(value ?? null)
  return s.length <= max ? value ?? null : { truncated: true, characters: s.length, first_part: `${s.slice(0, max)} …[truncated]` }
}

const MONEY_WORDS = new Set([
  'amount', 'price', 'prices', 'total', 'totals', 'subtotal', 'cost', 'costs', 'rate', 'rates', 'gst', 'fee', 'fees', 'charge', 'charges',
  'deposit', 'callout', 'skips', 'trailers', 'utes', 'tip', 'receipts', 'prepaid', 'balance', 'discount', 'markup', 'inc', 'ex', 'dollars', 'margin',
])

export function isFinancialKey(key: string): boolean {
  const k = key.toLowerCase()
  if (/^invoice\d*_(callout|contents|cleaning|skips|trailers|utes|tip_receipts|prepaid)$/.test(k)) return true
  return k.split(/[_\s-]+/).some(w => MONEY_WORDS.has(w))
}

/** Same shape with every dollar field removed. */
export function redactFinancials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactFinancials)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([k]) => !isFinancialKey(k)).map(([k, v]) => [k, redactFinancials(v)]),
    )
  }
  return value
}

function redactText(s: string): string {
  return s.replace(/\$\s?[\d,]+(\.\d+)?/g, '$…')
}

// ── Hashes ────────────────────────────────────────────────────────────────────

export interface SnapshotHashes {
  fields: Record<string, string>
  captures: Record<string, string>
  documents: Record<string, string>
  photos: Record<string, string>
  notes: Record<string, string>
  calls: Record<string, string>
  drafts: Record<string, string>
  flags: Record<string, string>
}

export function hashOf(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value ?? null)).digest('base64url').slice(0, 12)
}

function hashMap<T>(rows: T[], id: (r: T) => string, value: (r: T) => unknown): Record<string, string> {
  return Object.fromEntries(rows.map(r => [id(r), hashOf(value(r))]))
}

export function snapshotHashes(raw: SnapshotRaw): SnapshotHashes {
  const ad = (raw.job.assessment_data ?? {}) as Record<string, unknown>
  return {
    fields: Object.fromEntries(SNAPSHOT_JOB_FIELDS.filter(f => f !== 'updated_at').map(f => [f, hashOf(raw.job[f])])),
    captures: Object.fromEntries(Object.entries(ad).filter(([, v]) => v != null).map(([k, v]) => [k, hashOf(v)])),
    documents: hashMap(raw.documents, d => d.id, d => [d.type, d.content, d.released_to_portal_at]),
    photos: hashMap(raw.photos, p => String(p.id), p => PHOTO_FIELDS.map(f => p[f])),
    notes: hashMap(raw.notes, n => n.id, n => [n.room, n.body]),
    calls: hashMap(raw.calls, c => c.id, c => [c.status, c.transcript_clean?.length ?? 0, c.extraction]),
    drafts: hashMap(raw.drafts, d => d.id, d => [d.status, d.proposed]),
    flags: hashMap(raw.flags, f => f.id, f => [f.resolved_at, f.message]),
  }
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

function healthFor(raw: SnapshotRaw): HealthIssue[] {
  return jobHealth({
    status: String(raw.job.status ?? ''),
    assessment: (raw.job.assessment_data ?? null) as AssessmentData | null,
    documents: raw.documents,
    acceptances: raw.acceptances,
    xeroInvoice: Boolean(raw.xero),
  })
}

function docView(d: SnapshotRaw['documents'][number], cap: number, money: boolean) {
  const c = (d.content ?? {}) as Record<string, unknown>
  return {
    id: d.id, type: d.type, created_at: d.created_at, released_to_portal_at: d.released_to_portal_at,
    title: typeof c.title === 'string' ? c.title : '', reference: typeof c.reference === 'string' ? c.reference : '',
    ...(money && typeof c.total === 'number' ? { total: c.total } : {}),
    content: bounded(money ? d.content : redactFinancials(d.content), cap),
  }
}

function photoView(p: Record<string, unknown>) {
  return { id: p.id, uploaded_at: p.uploaded_at, ...Object.fromEntries(PHOTO_FIELDS.map(f => [f, p[f] ?? null])) }
}

function noteView(n: SnapshotRaw['notes'][number]) {
  return { id: n.id, room: n.room, by: n.created_by_first_name, at: n.created_at, body: truncateText(n.body, SNAPSHOT_LIMITS.note) }
}

function callView(c: SnapshotRaw['calls'][number]) {
  return {
    id: c.id, at: c.created_at, kind: c.provider === 'netlify_form' ? 'website enquiry' : 'phone call',
    from: c.caller_number, status: c.status,
    transcript_clean: truncateText(c.transcript_clean, SNAPSHOT_LIMITS.transcript),
    summary: (c.extraction as { summary?: string } | null)?.summary ?? null,
  }
}

function draftView(d: DraftRow) {
  return { id: d.id, kind: d.kind, summary: d.summary, status: d.status, by: d.created_by ?? null }
}

function flagView(f: JobFlag) {
  return { id: f.id, severity: f.severity, message: f.message, source: f.source, at: f.created_at }
}

function jobFields(job: Record<string, unknown>) {
  return Object.fromEntries(SNAPSHOT_JOB_FIELDS.map(f => [f, job[f] ?? null]))
}

export function buildSnapshot(raw: SnapshotRaw, opts: { role?: StaffRole | null; serverTime?: string; view?: ReadView | null } = {}) {
  const money = seesFinancials(opts.role)
  const stored = (raw.job.assessment_data ?? null) as AssessmentData | null
  const ad = opts.view ? opts.view.captures(stored) : ((stored ?? {}) as Record<string, unknown>)
  const health = healthFor(raw).map(i => (money ? i : { ...i, message: redactText(i.message) }))
  const conflicts = documentConflicts(raw.documents)
  const documents = visibleDocuments(raw, opts.view)
  const drafts = visibleDrafts(raw, opts.view)
  const build = (captureCap: number, docCap: number) => ({
    server_time: opts.serverTime ?? new Date().toISOString(),
    financials: money ? 'shown' : 'omitted for this role',
    job: jobFields(raw.job),
    captures: Object.fromEntries(
      Object.entries(ad).filter(([, v]) => v != null).map(([k, v]) => [k, bounded(money ? v : redactFinancials(v), captureCap)]),
    ),
    documents: documents.map(d => docView(d, docCap, money)),
    acceptances: raw.acceptances.map(a => (money ? a : { document_id: a.document_id, accepted_at: a.accepted_at, quote_reference: a.quote_reference ?? null })),
    photos: raw.photos.slice(0, SNAPSHOT_LIMITS.photos).map(photoView),
    progress_notes: raw.notes.slice(-SNAPSHOT_LIMITS.notes).map(noteView),
    calls_and_enquiries: raw.calls.slice(0, SNAPSHOT_LIMITS.calls).map(callView),
    xero: money ? raw.xero : raw.xero ? { status: raw.xero.xero_status ?? null } : null,
    pending_drafts: drafts.filter(d => d.status === 'pending').map(draftView),
    flags: raw.flags.map(flagView),
    conflicts,
    health,
  })
  let captureCap = SNAPSHOT_LIMITS.capture
  let docCap = SNAPSHOT_LIMITS.document
  let snap = build(captureCap, docCap)
  while (JSON.stringify(snap).length > SNAPSHOT_LIMITS.total && captureCap > 500) {
    captureCap = Math.floor(captureCap / 2)
    docCap = Math.floor(docCap / 2)
    snap = build(captureCap, docCap)
  }
  return snap
}

export type JobSnapshot = ReturnType<typeof buildSnapshot>

// ── Changes since ─────────────────────────────────────────────────────────────

export interface ChangesInput {
  since: string
  raw: SnapshotRaw
  /** Hashes stored with the earlier snapshot; null falls back to timestamps. */
  previous: SnapshotHashes | null
  /** Capture keys with a logged edit after since (agent_actions). */
  touchedCaptures?: string[]
  role?: StaffRole | null
  serverTime?: string
  view?: ReadView | null
}

function diffIds(prev: Record<string, string>, now: Record<string, string>) {
  return {
    added: Object.keys(now).filter(id => !(id in prev)),
    changed: Object.keys(now).filter(id => id in prev && prev[id] !== now[id]),
    removed: Object.keys(prev).filter(id => !(id in now)),
  }
}

interface Diff {
  job_fields: Record<string, unknown>
  captures: { changed: Record<string, unknown>; removed: string[] }
  documents: { added: unknown[]; changed: unknown[]; removed: string[] }
  photos: { added: unknown[]; changed: unknown[]; removed: string[] }
  progress_notes: { added: unknown[]; changed: unknown[]; removed: string[] }
  calls_and_enquiries: { added: unknown[]; changed: unknown[] }
  drafts: unknown[]
  drafts_no_longer_pending: string[]
  flags: { new: unknown[]; resolved: string[] }
}

function isEmptyDiff(d: Diff): boolean {
  return !Object.keys(d.job_fields).length && !Object.keys(d.captures.changed).length && !d.captures.removed.length
    && !d.documents.added.length && !d.documents.changed.length && !d.documents.removed.length
    && !d.photos.added.length && !d.photos.changed.length && !d.photos.removed.length
    && !d.progress_notes.added.length && !d.progress_notes.changed.length && !d.progress_notes.removed.length
    && !d.calls_and_enquiries.added.length && !d.calls_and_enquiries.changed.length
    && !d.drafts.length && !d.drafts_no_longer_pending.length && !d.flags.new.length && !d.flags.resolved.length
}

export function changesSince(input: ChangesInput) {
  const { raw, since } = input
  const money = seesFinancials(input.role)
  const now = snapshotHashes(raw)
  const stored = (raw.job.assessment_data ?? null) as AssessmentData | null
  const ad = input.view ? input.view.captures(stored) : ((stored ?? {}) as Record<string, unknown>)
  const renamed = input.view?.renamed ?? {}
  const after = (t: unknown) => typeof t === 'string' && t > since
  const capture = (k: string) => bounded(money ? ad[k] ?? null : redactFinancials(ad[k] ?? null), SNAPSHOT_LIMITS.capture)
  /** A change to a summarised capture shows as its summary; a removed one too (it no longer exists). */
  const capturesShown = (keys: string[]) => Object.fromEntries([...new Set(keys.map(k => renamed[k] ?? k))].map(k => [k, capture(k)]))
  const documents = visibleDocuments(raw, input.view)
  const drafts = visibleDrafts(raw, input.view)
  const doc = (d: SnapshotRaw['documents'][number]) => docView(d, SNAPSHOT_LIMITS.document, money)
  const serverTime = input.serverTime ?? new Date().toISOString()

  if (input.previous) {
    const p = input.previous
    const pick = <T>(rows: T[], id: (r: T) => string, ids: string[]) => rows.filter(r => ids.includes(id(r)))
    const fields = Object.keys(now.fields).filter(f => p.fields?.[f] !== now.fields[f])
    const caps = diffIds(p.captures ?? {}, now.captures)
    const docs = diffIds(p.documents ?? {}, now.documents)
    const photos = diffIds(p.photos ?? {}, now.photos)
    const notes = diffIds(p.notes ?? {}, now.notes)
    const calls = diffIds(p.calls ?? {}, now.calls)
    const draftIds = diffIds(p.drafts ?? {}, now.drafts)
    const flags = diffIds(p.flags ?? {}, now.flags)
    const diff: Diff = {
      job_fields: Object.fromEntries(fields.map(f => [f, raw.job[f] ?? null])),
      captures: {
        changed: capturesShown([...caps.added, ...caps.changed, ...caps.removed.filter(k => k in renamed)]),
        removed: caps.removed.filter(k => !(k in renamed)),
      },
      documents: {
        added: pick(documents, d => d.id, docs.added).map(doc),
        changed: pick(documents, d => d.id, docs.changed).map(doc),
        removed: docs.removed,
      },
      photos: {
        added: pick(raw.photos, x => String(x.id), photos.added).map(photoView),
        changed: pick(raw.photos, x => String(x.id), photos.changed).map(photoView),
        removed: photos.removed,
      },
      progress_notes: {
        added: pick(raw.notes, n => n.id, notes.added).map(noteView),
        changed: pick(raw.notes, n => n.id, notes.changed).map(noteView),
        removed: notes.removed,
      },
      calls_and_enquiries: {
        added: pick(raw.calls, c => c.id, calls.added).map(callView),
        changed: pick(raw.calls, c => c.id, calls.changed).map(callView),
      },
      drafts: pick(drafts, d => d.id, [...draftIds.added, ...draftIds.changed]).map(draftView),
      drafts_no_longer_pending: draftIds.removed,
      flags: { new: pick(raw.flags, f => f.id, flags.added).map(flagView), resolved: flags.removed },
    }
    return { since, server_time: serverTime, precision: 'exact' as const, ...diff, nothing_changed: isEmptyDiff(diff) }
  }

  const jobChanged = after(raw.job.updated_at)
  const touched = [...new Set(input.touchedCaptures ?? [])].filter(k => (k in renamed) || ad[k] != null)
  const diff: Diff = {
    job_fields: jobChanged ? jobFields(raw.job) : {},
    captures: { changed: capturesShown(touched), removed: [] },
    documents: {
      added: documents.filter(d => after(d.created_at)).map(doc),
      changed: documents.filter(d => !after(d.created_at) && after(d.released_to_portal_at)).map(doc),
      removed: [],
    },
    photos: { added: raw.photos.filter(x => after(x.uploaded_at)).map(photoView), changed: [], removed: [] },
    progress_notes: {
      added: raw.notes.filter(n => after(n.created_at)).map(noteView),
      changed: raw.notes.filter(n => !after(n.created_at) && after(n.updated_at)).map(noteView),
      removed: [],
    },
    calls_and_enquiries: { added: raw.calls.filter(c => after(c.created_at)).map(callView), changed: [] },
    drafts: drafts.filter(d => after(d.created_at)).map(draftView),
    drafts_no_longer_pending: [],
    flags: { new: raw.flags.filter(f => after(f.created_at)).map(flagView), resolved: [] },
  }
  return {
    since, server_time: serverTime, precision: 'coarse' as const,
    note: jobChanged
      ? 'No stored snapshot to compare with, so this compares timestamps. The job was saved after this time: captures listed are those with a logged agent edit, but staff saves are not logged per capture, so others may have changed too. Call get_job_snapshot if it matters.'
      : 'No stored snapshot to compare with, so this compares timestamps.',
    ...diff,
    nothing_changed: isEmptyDiff(diff) && !jobChanged,
  }
}

// ── Loading ───────────────────────────────────────────────────────────────────

export async function loadSnapshotRaw(supabase: Supabase, orgId: string, jobId: string): Promise<SnapshotRaw | null> {
  const photoCols: string = `id, uploaded_at, ${PHOTO_FIELDS.join(', ')}`
  const [jobRes, docsRes, photosRes, notesRes, callsRes, xero, drafts, flags, acceptances] = await Promise.all([
    supabase.from('jobs').select('*').eq('id', jobId).eq('org_id', orgId).maybeSingle(),
    supabase.from('documents').select('id, type, content, created_at, released_to_portal_at').eq('job_id', jobId).eq('org_id', orgId).order('created_at', { ascending: false }).limit(80),
    supabase.from('photos').select(photoCols).eq('job_id', jobId).order('uploaded_at', { ascending: false }).limit(SNAPSHOT_LIMITS.photos),
    supabase.from('progress_notes').select('*').eq('job_id', jobId).is('deleted_at', null).order('created_at', { ascending: true }).limit(SNAPSHOT_LIMITS.notes),
    supabase.from('inbound_calls').select('id, created_at, provider, caller_number, status, transcript_clean, extraction').eq('job_id', jobId).eq('org_id', orgId).order('created_at', { ascending: false }).limit(SNAPSHOT_LIMITS.calls),
    readXeroInvoice(supabase, orgId, jobId),
    listPendingDrafts(supabase, orgId, jobId),
    listOpenFlags(supabase, orgId, jobId),
    readAcceptances(supabase, jobId),
  ])
  if (!jobRes.data) return null
  return {
    job: jobRes.data as Record<string, unknown>,
    documents: (docsRes.data ?? []) as SnapshotRaw['documents'],
    photos: (photosRes.data ?? []) as unknown as Record<string, unknown>[],
    notes: (notesRes.data ?? []) as SnapshotRaw['notes'],
    calls: (callsRes.data ?? []) as SnapshotRaw['calls'],
    xero: (xero ?? null) as Record<string, unknown> | null,
    drafts,
    flags,
    acceptances,
  }
}

/** Load, flag any new document conflicts, and build the snapshot and its hashes. */
export async function jobSnapshotFor(supabase: Supabase, orgId: string, jobId: string, role: StaffRole | null, view: ReadView | null = null) {
  const raw = await loadSnapshotRaw(supabase, orgId, jobId)
  if (!raw) return null
  const conflicts = documentConflicts(raw.documents)
  if (conflicts.length && (await raiseConflictFlags(supabase, orgId, jobId, conflicts))) {
    raw.flags = await listOpenFlags(supabase, orgId, jobId)
  }
  const serverTime = new Date().toISOString()
  return { raw, snapshot: buildSnapshot(raw, { role, serverTime, view }), hashes: snapshotHashes(raw), serverTime }
}

/**
 * Capture keys with a logged edit after since (approved agent changes). Staff
 * saves of captures are not logged per key, which is why the timestamp
 * fallback is coarse.
 */
export async function touchedCapturesSince(supabase: Supabase, orgId: string, jobId: string, since: string): Promise<string[]> {
  const { data } = await supabase
    .from('agent_actions')
    .select('target_path')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .gt('created_at', since)
    .like('target_path', 'assessment_data.%')
    .limit(200)
  return (data ?? []).map(a => String(a.target_path).slice('assessment_data.'.length).split('.')[0])
}

export interface StoredSnapshot { at: string; hashes: SnapshotHashes }

/** The latest snapshot hashes the file agent stored for this staff member on this job, at or before a time. */
export async function storedSnapshot(supabase: Supabase, orgId: string, userId: string, jobId: string, atOrBefore?: string): Promise<StoredSnapshot | null> {
  const { data } = await supabase
    .from('agent_messages')
    .select('content, created_at')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('thread_id', userId)
    .eq('speaker', 'file_agent')
    .order('created_at', { ascending: false })
    .limit(40)
  for (const row of data ?? []) {
    const snap = (row.content as { snapshot?: StoredSnapshot } | null)?.snapshot
    if (snap?.at && snap.hashes && (!atOrBefore || snap.at <= atOrBefore)) return snap
  }
  return null
}
