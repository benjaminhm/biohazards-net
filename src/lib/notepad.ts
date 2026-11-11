/*
 * lib/notepad.ts
 *
 * Rules shared by the staff notepad (components/Notepad.tsx) and /api/notepad.
 */

/** Keep in step with the staff_notepads_body_len check in migration 067. */
export const NOTEPAD_MAX_CHARS = 50000

/** Why a value cannot be saved as the pad, or null when it can. */
export function notepadBodyError(body: unknown): string | null {
  if (typeof body !== 'string') return 'body must be text'
  if (body.length > NOTEPAD_MAX_CHARS) return `Notepad is full (max ${NOTEPAD_MAX_CHARS} characters)`
  return null
}

/**
 * Typing that had not reached the server, kept in localStorage per person.
 * `base` is the updated_at of the saved pad it was typed on top of
 * (null when nothing had been saved yet).
 */
export interface NotepadDraft {
  body: string
  base: string | null
}

export function notepadDraftKey(userId: string): string {
  return `bh_notepad_draft:${userId}`
}

export function parseNotepadDraft(raw: string | null): NotepadDraft | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    if (typeof v?.body !== 'string') return null
    return { body: v.body, base: typeof v.base === 'string' ? v.base : null }
  } catch {
    return null
  }
}

/**
 * The draft text to put back, or null. A draft only applies while the saved
 * pad is still the version it was typed over. If the pad has been saved from
 * somewhere else since, the saved pad wins and the draft is dropped, so an old
 * draft can never overwrite newer notes.
 */
export function draftToRestore(draft: NotepadDraft | null, savedAt: string | null): string | null {
  if (!draft || draft.base !== savedAt) return null
  return draft.body
}
