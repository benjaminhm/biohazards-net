/*
 * lib/calls/fileAgent.ts
 *
 * Stage 5 — the file agent. Works on ONE job only and turns the head agent's
 * record into job-file writes:
 *   - contact and site fields, only where the job field is empty;
 *   - a draft for each quote the call needs (BCQ / CCQ / SACQ), quantities and
 *     wording only, every price left blank for staff;
 *   - the list of quotes required, with the reason from the call.
 * This file is pure: it works out the writes. The pipeline applies and logs them.
 */
import { emptyBiohazardCleaningCapture } from '@/lib/biohazardCleaningQuote'
import { emptyContentsClearanceCapture } from '@/lib/contentsClearanceQuote'
import {
  SURFACE_AREA_ROOM_PRESETS,
  emptySurfaceAreaCleaningCapture,
  newSurfaceAreaRoomId,
  type SurfaceAreaRoom,
} from '@/lib/surfaceAreaCleaningQuote'
import { formatToTwilioE164 } from '@/lib/phone'
import type { AssessmentData, QuoteRequired } from '@/lib/types'
import type { CallExtraction, CallRoom } from './extraction'

export type QuoteKey = 'biohazard_cleaning_quote' | 'contents_clearance_quote' | 'surface_area_cleaning_quote'

export const CONTACT_FIELDS = [
  'client_name',
  'client_organization_name',
  'client_contact_role',
  'client_contact_relationship',
  'client_phone',
  'client_email',
  'site_address',
  'site_contact_name',
  'site_contact_phone',
  'access_notes',
  'job_description',
] as const
export type ContactField = (typeof CONTACT_FIELDS)[number]

export interface FieldConflict {
  field: ContactField
  existing: string
  heard: string
}

function phoneOrText(v: string): string {
  return v ? formatToTwilioE164(v) ?? v : ''
}

export function heardContactFields(e: CallExtraction, callerNumber: string): Record<ContactField, string> {
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.contact.email) ? e.contact.email : ''
  return {
    client_name: e.contact.name,
    client_organization_name: e.contact.organisation,
    client_contact_role: e.contact.role,
    client_contact_relationship: e.contact.relationship,
    client_phone: phoneOrText(e.contact.phone) || callerNumber,
    client_email: email,
    site_address: e.site.address,
    site_contact_name: e.site.contact_name,
    site_contact_phone: phoneOrText(e.site.contact_phone),
    access_notes: e.site.access_notes,
    job_description: e.job_description,
  }
}

/** The name the call agent gives a job when the caller's name was not heard. */
export function placeholderName(callerNumber: string): string {
  return callerNumber ? `Caller ${callerNumber}` : 'Unknown caller'
}

function isPlaceholderName(name: string): boolean {
  return name === 'Unknown caller' || /^Caller \+?\d+$/.test(name)
}

/**
 * Fill empty job fields only. A field staff already filled is never overwritten;
 * the call agent's own placeholder name counts as empty.
 */
export function contactPatch(
  job: Partial<Record<ContactField, string | null>>,
  e: CallExtraction,
  callerNumber: string,
): { patch: Partial<Record<ContactField, string>>; before: Partial<Record<ContactField, string>>; conflicts: FieldConflict[] } {
  const heard = heardContactFields(e, callerNumber)
  const patch: Partial<Record<ContactField, string>> = {}
  const before: Partial<Record<ContactField, string>> = {}
  const conflicts: FieldConflict[] = []
  for (const field of CONTACT_FIELDS) {
    const value = heard[field]
    if (!value) continue
    const onFile = (job[field] ?? '').trim()
    const existing = field === 'client_name' && isPlaceholderName(onFile) ? '' : onFile
    if (existing === value) continue
    if (!existing) {
      patch[field] = value
      before[field] = onFile
    } else {
      conflicts.push({ field, existing, heard: value })
    }
  }
  return { patch, before, conflicts }
}

export function expandRooms(rooms: CallRoom[]): SurfaceAreaRoom[] {
  const out: SurfaceAreaRoom[] = []
  for (const r of rooms) {
    const preset = SURFACE_AREA_ROOM_PRESETS.find(p => p.id === r.preset)
    const base = r.name || preset?.name || 'Room'
    for (let i = 0; i < r.count; i++) {
      out.push({
        id: newSurfaceAreaRoomId(),
        name: r.count > 1 ? `${base} ${i + 1}` : base,
        length_m: r.length_m ?? preset?.length_m ?? null,
        width_m: r.width_m ?? preset?.width_m ?? null,
        height_m: r.height_m ?? preset?.height_m ?? null,
        ...(preset && r.length_m === null && r.width_m === null ? { preset_id: preset.id } : {}),
      })
    }
  }
  return out
}

export interface QuoteDraft {
  key: QuoteKey
  capture: Record<string, unknown>
}

/**
 * Drafts for the quotes the call needs. A quote that already has a capture on
 * the job is left alone and reported as skipped.
 */
export function quoteDrafts(
  ad: AssessmentData | null | undefined,
  e: CallExtraction,
  callId: string,
  now = new Date().toISOString(),
): { drafts: QuoteDraft[]; skipped: { key: QuoteKey; reason: string }[]; quotes_required: QuoteRequired[] } {
  const drafts: QuoteDraft[] = []
  const skipped: { key: QuoteKey; reason: string }[] = []
  const required: QuoteRequired[] = []
  const has = (key: QuoteKey) => ad?.[key] != null

  const add = (key: QuoteKey, reason: string, evidence: string, capture: Record<string, unknown>) => {
    required.push({ type: key, reason, evidence, source: 'call', call_id: callId, added_at: now })
    if (has(key)) skipped.push({ key, reason: 'Quote already started on this job; left as is.' })
    else drafts.push({ key, capture })
  }

  const bio = e.quotes.biohazard
  if (bio) {
    add('biohazard_cleaning_quote', bio.reason, bio.evidence, {
      ...emptyBiohazardCleaningCapture(),
      cleaning_kind: bio.cleaning_kind,
      biohazard_types: bio.biohazard_types.length ? bio.biohazard_types : null,
      areas_affected: bio.areas_affected.length ? bio.areas_affected : null,
      description: bio.description,
      rooms: expandRooms(bio.rooms),
      secondary_zone: bio.secondary_zone,
      secondary_contaminations: bio.secondary_contaminations,
      other_zones: bio.other_zones,
    })
  }

  const ccq = e.quotes.contents_clearance
  if (ccq) {
    add('contents_clearance_quote', ccq.reason, ccq.evidence, {
      ...emptyContentsClearanceCapture(),
      clearance_kind: ccq.clearance_kind,
      estimated_m3: ccq.estimated_m3,
    })
  }

  const sacq = e.quotes.surface_area
  if (sacq) {
    add('surface_area_cleaning_quote', sacq.reason, sacq.evidence, {
      ...emptySurfaceAreaCleaningCapture(),
      cleaning_kind: sacq.cleaning_kind,
      rooms: expandRooms(sacq.rooms),
      presentation: sacq.presentation,
      objective: sacq.objective,
      scope_of_work: sacq.scope_of_work,
    })
  }

  const existing = ad?.quotes_required ?? []
  const quotes_required = [...existing.filter(q => !required.some(r => r.type === q.type)), ...required]
  return { drafts, skipped, quotes_required }
}

/** Internal progress note for the job. */
export function callNoteBody(e: CallExtraction, call: { caller_number: string; started_at: string | null }): string {
  const when = call.started_at
    ? new Date(call.started_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Brisbane' })
    : 'unknown time'
  const quotes = [
    e.quotes.biohazard && 'Biohazard Cleaning',
    e.quotes.contents_clearance && 'Contents Clearance',
    e.quotes.surface_area && 'Surface Area Cleaning',
  ].filter(Boolean)
  return [
    `Phone call ${when}${call.caller_number ? ` from ${call.caller_number}` : ''} (filed by the call agent).`,
    e.summary,
    quotes.length ? `Quotes drafted from the call: ${quotes.join(', ')}. Prices to be added by staff.` : '',
    e.money_mentioned ? `Money mentioned on the call: ${e.money_mentioned}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
