/*
 * lib/newJobIntakeDraft.ts
 *
 * The half-filled phone new-job form (newjob.biohazards.net). The form is kept
 * on the phone until Create succeeds, so a screen lock, a reload or an expired
 * PIN session loses nothing. Pure and browser-safe: no database, no phone
 * parsing (that is lib/newJobIntake.ts, on the server).
 */
import { isTradingNameId, type TradingNameId } from '@/lib/tradingNames'

export const INTAKE_PHONE_LABELS = ['Mobile', 'Landline', 'Work', 'Other'] as const
export const INTAKE_MAX_EXTRA_PHONES = 5

export const INTAKE_JOB_TYPES = [
  { value: 'crime_scene', label: 'Crime scene' },
  { value: 'hoarding', label: 'Hoarding' },
  { value: 'mold', label: 'Mold' },
  { value: 'sewage', label: 'Sewage' },
  { value: 'trauma', label: 'Trauma' },
  { value: 'unattended_death', label: 'Unattended death' },
  { value: 'flood', label: 'Flood' },
  { value: 'other', label: 'Other' },
] as const

export const INTAKE_URGENCIES = [
  { value: 'standard', label: '⚪ Standard' },
  { value: 'urgent', label: '🟠 Urgent' },
  { value: 'emergency', label: '🔴 Emergency' },
] as const

export interface IntakeDraft {
  trading_name: TradingNameId | ''
  client_name: string
  client_contact_role: string
  client_organization_name: string
  client_phone: string
  client_phones: { label: string; number: string }[]
  client_email: string
  site_address: string
  site_place_id: string
  site_lat: number | null
  site_lng: number | null
  site_contact_name: string
  site_contact_phone: string
  job_type: string
  urgency: string
  access_notes: string
  call_notes: string
}

export function emptyIntakeDraft(): IntakeDraft {
  return {
    trading_name: '',
    client_name: '',
    client_contact_role: '',
    client_organization_name: '',
    client_phone: '',
    client_phones: [],
    client_email: '',
    site_address: '',
    site_place_id: '',
    site_lat: null,
    site_lng: null,
    site_contact_name: '',
    site_contact_phone: '',
    job_type: 'other',
    urgency: 'standard',
    access_notes: '',
    call_notes: '',
  }
}

/** True when nothing has been entered or chosen. */
export function intakeDraftIsEmpty(draft: IntakeDraft): boolean {
  const blank = emptyIntakeDraft()
  return (Object.keys(blank) as (keyof IntakeDraft)[]).every(k => JSON.stringify(draft[k]) === JSON.stringify(blank[k]))
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A stored draft read back. Anything missing or malformed falls back to the blank form's value. */
export function parseIntakeDraft(raw: string | null | undefined): IntakeDraft {
  const blank = emptyIntakeDraft()
  if (!raw) return blank
  let stored: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return blank
    stored = parsed as Record<string, unknown>
  } catch {
    return blank
  }
  const jobType = str(stored.job_type)
  const urgency = str(stored.urgency)
  return {
    trading_name: isTradingNameId(stored.trading_name) ? stored.trading_name : '',
    client_name: str(stored.client_name),
    client_contact_role: str(stored.client_contact_role),
    client_organization_name: str(stored.client_organization_name),
    client_phone: str(stored.client_phone),
    client_phones: (Array.isArray(stored.client_phones) ? stored.client_phones : [])
      .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
      .map(p => ({
        label: (INTAKE_PHONE_LABELS as readonly string[]).includes(str(p.label)) ? str(p.label) : 'Mobile',
        number: str(p.number),
      }))
      .slice(0, INTAKE_MAX_EXTRA_PHONES),
    client_email: str(stored.client_email),
    site_address: str(stored.site_address),
    site_place_id: str(stored.site_place_id),
    site_lat: num(stored.site_lat),
    site_lng: num(stored.site_lng),
    site_contact_name: str(stored.site_contact_name),
    site_contact_phone: str(stored.site_contact_phone),
    job_type: INTAKE_JOB_TYPES.some(t => t.value === jobType) ? jobType : blank.job_type,
    urgency: INTAKE_URGENCIES.some(u => u.value === urgency) ? urgency : blank.urgency,
    access_notes: str(stored.access_notes),
    call_notes: str(stored.call_notes),
  }
}

/**
 * Smart Fill results merged into the form. Only fields Smart Fill found are
 * touched. An address read from text has no place id or coordinates, so the
 * ones from an earlier suggestion pick are cleared.
 */
export function applySmartFillToDraft(draft: IntakeDraft, fields: Record<string, string>): IntakeDraft {
  const next = { ...draft }
  const found = (key: string) => (typeof fields[key] === 'string' ? fields[key].trim() : '')
  for (const key of ['client_name', 'client_contact_role', 'client_organization_name', 'client_phone', 'client_email'] as const) {
    if (found(key)) next[key] = found(key)
  }
  if (!found('client_organization_name') && found('company_name')) next.client_organization_name = found('company_name')
  if (found('site_address')) {
    next.site_address = found('site_address')
    next.site_place_id = ''
    next.site_lat = null
    next.site_lng = null
  }
  const jobType = found('job_type').toLowerCase()
  if (INTAKE_JOB_TYPES.some(t => t.value === jobType)) next.job_type = jobType
  const urgency = found('urgency').toLowerCase()
  if (INTAKE_URGENCIES.some(u => u.value === urgency)) next.urgency = urgency
  return next
}
