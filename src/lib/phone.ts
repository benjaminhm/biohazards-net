/*
 * lib/phone.ts
 *
 * Normalise phone numbers to strict E.164 for Twilio and database matching.
 * Default country AU so values like 04xx xxx xxx parse as Australian mobiles.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js'

const DEFAULT_CC = 'AU' as const

/**
 * Parse a raw user-entered string and return E.164 (e.g. +61404000000), or null if invalid/empty.
 */
export function formatToTwilioE164(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const phoneNumber = parsePhoneNumberFromString(trimmed, DEFAULT_CC)
    if (!phoneNumber || !phoneNumber.isValid()) return null
    return phoneNumber.format('E.164')
  } catch {
    return null
  }
}

type PhoneFieldResult =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string }

/**
 * For optional phone fields: blank → null (clear). Non-blank must parse or error.
 * `undefined` means the field was not sent — caller should omit from PATCH.
 */
export function normalizeOptionalPhoneField(raw: unknown): PhoneFieldResult {
  if (raw === undefined) return { ok: true, value: undefined }
  if (raw === null || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'Phone must be a string' }
  const t = raw.trim()
  if (!t) return { ok: true, value: null }
  const e164 = formatToTwilioE164(t)
  if (!e164) return { ok: false, error: 'Invalid phone number' }
  return { ok: true, value: e164 }
}

/**
 * For required phone fields (e.g. intake).
 */
export function normalizeRequiredPhoneField(raw: unknown):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: false, error: 'Phone is required' }
  if (typeof raw !== 'string') return { ok: false, error: 'Phone must be a string' }
  const e164 = formatToTwilioE164(raw)
  if (!e164) return { ok: false, error: 'Invalid phone number' }
  return { ok: true, value: e164 }
}

/** Normalize Twilio webhook `From` / `To` to E.164 for DB equality (Twilio usually sends E.164 already). */
export function normalizeTwilioNumber(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  const e164 = formatToTwilioE164(t)
  if (e164) return e164
  try {
    const p = parsePhoneNumberFromString(t) // international if starts with +
    if (p?.isValid()) return p.format('E.164')
  } catch {
    /* ignore */
  }
  return null
}
