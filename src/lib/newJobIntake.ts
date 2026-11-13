/*
 * lib/newJobIntake.ts
 *
 * The phone new-job form on newjob.biohazards.net: checking what was typed and
 * building the jobs row. Pure, no database. The form covers the same fields as
 * Initial Contact in the main app, so a job made here needs nothing re-typed.
 */
import { formatToTwilioE164 } from '@/lib/phone'
import { isTradingNameId, type TradingNameId } from '@/lib/tradingNames'
import { JOB_TYPES, URGENCIES } from '@/lib/agent/workspaceText'
import type { NewJobProposal, PossibleDuplicate } from '@/lib/agent/newJobDraft'
import { INTAKE_MAX_EXTRA_PHONES, INTAKE_PHONE_LABELS } from '@/lib/newJobIntakeDraft'

export const INTAKE_NOTES_MAX_CHARS = 5000
/** Smart Fill text sent from the phone form is capped at this length. */
export const INTAKE_SMART_FILL_MAX_CHARS = 20_000

export interface IntakeJob {
  client_name: string
  client_organization_name: string
  client_contact_role: string
  client_phone: string
  client_phones: { label: string; number: string }[]
  client_email: string
  site_address: string
  site_place_id: string
  site_lat: number | null
  site_lng: number | null
  site_contact_name: string
  site_contact_phone: string
  access_notes: string
  job_type: (typeof JOB_TYPES)[number]
  urgency: (typeof URGENCIES)[number]
  trading_name: TradingNameId | null
}

export type IntakeResult =
  | { ok: true; job: IntakeJob; callNotes: string }
  | { ok: false; error: string }

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** E.164 when the number parses, otherwise what was typed (a landline with no area code is still worth keeping). */
function lenientPhone(v: unknown): string {
  const typed = text(v, 40)
  return typed ? formatToTwilioE164(typed) ?? typed : ''
}

/** Checks the form. The error is a plain sentence the form shows as is. */
export function normalizeIntake(body: Record<string, unknown>): IntakeResult {
  const rawPhone = text(body.client_phone, 40)
  const client_phone = rawPhone ? formatToTwilioE164(rawPhone) : ''
  if (client_phone === null) return { ok: false, error: `"${rawPhone}" is not a valid phone number.` }

  const client_email = text(body.client_email, 200).toLowerCase()
  if (client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email)) {
    return { ok: false, error: `"${client_email}" is not a valid email address.` }
  }

  const job_type = text(body.job_type, 40) || 'other'
  if (!(JOB_TYPES as readonly string[]).includes(job_type)) return { ok: false, error: 'Choose a job type from the list.' }
  const urgency = text(body.urgency, 20) || 'standard'
  if (!(URGENCIES as readonly string[]).includes(urgency)) return { ok: false, error: 'Urgency must be standard, urgent or emergency.' }

  let trading_name: TradingNameId | null = null
  if (body.trading_name != null && body.trading_name !== '') {
    if (!isTradingNameId(body.trading_name)) return { ok: false, error: 'Choose a trading name from the list.' }
    trading_name = body.trading_name
  }

  const client_phones = (Array.isArray(body.client_phones) ? body.client_phones : [])
    .map(p => {
      const entry = (p && typeof p === 'object' ? p : {}) as { label?: unknown; number?: unknown }
      const label = text(entry.label, 20)
      return {
        label: (INTAKE_PHONE_LABELS as readonly string[]).includes(label) ? label : 'Mobile',
        number: lenientPhone(entry.number),
      }
    })
    .filter(p => p.number)
    .slice(0, INTAKE_MAX_EXTRA_PHONES)

  const site_address = text(body.site_address, 300)
  // The place id and coordinates only mean something with the address they came from.
  const lat = typeof body.site_lat === 'number' && Math.abs(body.site_lat) <= 90 ? body.site_lat : null
  const lng = typeof body.site_lng === 'number' && Math.abs(body.site_lng) <= 180 ? body.site_lng : null
  const located = Boolean(site_address) && lat !== null && lng !== null

  const job: IntakeJob = {
    client_name: text(body.client_name, 200),
    client_organization_name: text(body.client_organization_name, 200),
    client_contact_role: text(body.client_contact_role, 200),
    client_phone,
    client_phones,
    client_email,
    site_address,
    site_place_id: site_address ? text(body.site_place_id, 300) : '',
    site_lat: located ? lat : null,
    site_lng: located ? lng : null,
    site_contact_name: text(body.site_contact_name, 200),
    site_contact_phone: lenientPhone(body.site_contact_phone),
    access_notes: text(body.access_notes, 2000),
    job_type: job_type as IntakeJob['job_type'],
    urgency: urgency as IntakeJob['urgency'],
    trading_name,
  }

  if (!job.client_name && !job.client_organization_name && !job.client_phone && !job.client_email && !job.site_address) {
    return { ok: false, error: 'Add at least a name, phone number, email or site address.' }
  }
  return { ok: true, job, callNotes: text(body.call_notes, INTAKE_NOTES_MAX_CHARS) }
}

/** The fields the duplicate check compares. */
export function intakeProposal(job: IntakeJob): NewJobProposal {
  return {
    client_name: job.client_name,
    client_phone: job.client_phone,
    client_email: job.client_email,
    site_address: job.site_address,
    job_description: '',
    urgency: job.urgency,
  }
}

export interface IntakeDuplicate {
  job_code: string | null
  site_address: string | null
  status: string | null
  reasons: string[]
}

/** What a PIN user is shown about a likely duplicate: the job code and site, as on the photo app. No client details. */
export function intakeDuplicateView(duplicates: PossibleDuplicate[]): IntakeDuplicate[] {
  return duplicates.map(d => ({ job_code: d.job_code, site_address: d.site_address, status: d.status, reasons: d.reasons }))
}

function noteStamp(now: Date): string {
  return now.toLocaleString('en-AU', {
    timeZone: 'Australia/Brisbane',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * The job's opening notes log, in the "[timestamp] text" lines Call notes uses.
 * The first line records who made the job; jobs has no creator column.
 */
export function intakeNotesLog(creatorName: string, callNotes: string, now = new Date()): string {
  const stamp = noteStamp(now)
  const who = creatorName.trim() || 'staff'
  const lines = [`[${stamp}] Job created on the phone new-job form by ${who}.`]
  // The log is one entry per line, so a note typed over several lines becomes one line.
  const notes = callNotes.trim().replace(/\s*\n+\s*/g, ' / ')
  if (notes) lines.push(`[${stamp}] ${notes}`)
  return lines.join('\n')
}

/** The jobs row inserted on Create. Same defaults as POST /api/jobs. */
export function intakeJobRow(job: IntakeJob, jobCode: string, orgId: string, notes: string) {
  return {
    job_code: jobCode,
    ...job,
    client_contact_relationship: '',
    insurance_claim_ref: '',
    status: 'lead',
    notes,
    assessment_data: null,
    org_id: orgId,
  }
}
