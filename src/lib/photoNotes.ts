/*
 * lib/photoNotes.ts
 *
 * The job notepad on notes.biohazards.net. A note is an ordinary row in
 * progress_notes and a photo an ordinary job photo, so both show in the main
 * app's Progress Notes and Photos tabs. Notes written with a photo PIN record
 * the author as "pin:<person id>" in created_by_user_id.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PinPerson } from '@/lib/photoPin'

export const NOTE_MAX_CHARS = 50_000
/** A note may keep the time it was written offline, up to this long ago. */
const WRITTEN_AT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const WRITTEN_AT_FUTURE_SLACK_MS = 2 * 60 * 1000
/** Saves inside this window after writing are still the first draft, not an edit. */
export const NOTE_EDIT_GRACE_MS = 15 * 60 * 1000

export interface PadNote {
  kind: 'note'
  id: string
  body: string
  at: string
  updated_at: string
  by: string
  mine: boolean
}

export interface PadPhoto {
  kind: 'photo'
  id: string
  file_url: string
  caption: string
  at: string
  by: string
  mine: boolean
}

export type PadItem = PadNote | PadPhoto

export function pinAuthorId(person: Pick<PinPerson, 'person_id'>): string {
  return `pin:${person.person_id}`
}

export function pinAuthorName(person: Pick<PinPerson, 'name'>): string {
  return person.name.trim().split(/\s+/)[0] || person.name.trim()
}

/** The time the note was written on the phone, if believable, else now. */
export function noteWrittenAt(raw: unknown, now = Date.now()): string {
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN
  if (!Number.isFinite(t) || t > now + WRITTEN_AT_FUTURE_SLACK_MS || t < now - WRITTEN_AT_MAX_AGE_MS) {
    return new Date(now).toISOString()
  }
  return new Date(Math.min(t, now)).toISOString()
}

export function noteWasEdited(note: Pick<PadNote, 'at' | 'updated_at'>): boolean {
  return Date.parse(note.updated_at) - Date.parse(note.at) > NOTE_EDIT_GRACE_MS
}

/** True when the job is open and in the PIN person's organisation. */
export async function openJobForPin(supabase: SupabaseClient, jobId: string, orgId: string): Promise<boolean> {
  if (!jobId) return false
  const { data } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  return Boolean(data)
}

/** Oldest first. Photos sit at the time they were taken. */
export function sortPad<T extends { at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
