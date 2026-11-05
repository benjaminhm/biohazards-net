/*
 * lib/calls/extraction.ts
 *
 * Stage 3 — the head agent. Reads the CLEAN transcript and fills one strict
 * schema: contact, site, a neutral job description, and which of the three
 * quotes (BCQ / CCQ / SACQ) the call calls for, with quantities only.
 *
 * The schema has no price fields. Any money the caller mentions is moved to
 * `money_mentioned` so it can never land in a quote figure.
 */
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_OPUS_MODEL } from '@/lib/anthropicModels'
import { BIOHAZARD_CLEANING_CLIENT_TITLES, type BiohazardCleaningKind } from '@/lib/biohazardCleaningQuote'
import { CONTENTS_CLEARANCE_CLIENT_TITLES, type ContentsClearanceKind } from '@/lib/contentsClearanceQuote'
import { SURFACE_AREA_ROOM_PRESETS } from '@/lib/surfaceAreaCleaningQuote'
import type { JobUrgency } from '@/lib/types'

const SURFACE_KINDS = ['surface', 'squalor', 'estate', 'custom'] as const
type SurfaceKind = (typeof SURFACE_KINDS)[number]
const URGENCIES: JobUrgency[] = ['standard', 'urgent', 'emergency']
const BIOHAZARD_KINDS = BIOHAZARD_CLEANING_CLIENT_TITLES.map(t => t.id) as BiohazardCleaningKind[]
const CLEARANCE_KINDS = CONTENTS_CLEARANCE_CLIENT_TITLES.map(t => t.id) as ContentsClearanceKind[]
const ROOM_PRESETS = SURFACE_AREA_ROOM_PRESETS.map(p => p.id) as string[]

export interface CallRoom {
  name: string
  /** Average-room preset id, used when the caller gave no sizes. */
  preset: string | null
  count: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
}

export interface CallQuoteBase {
  reason: string
  /** Words from the call that support this quote. */
  evidence: string
}

export interface CallExtraction {
  is_job_enquiry: boolean
  not_job_reason: string
  /** Internal call summary for the progress note. */
  summary: string
  /** One to three neutral sentences describing the job. */
  job_description: string
  urgency: JobUrgency
  contact: { name: string; organisation: string; role: string; relationship: string; phone: string; email: string }
  site: { address: string; contact_name: string; contact_phone: string; access_notes: string }
  quotes: {
    biohazard: (CallQuoteBase & {
      cleaning_kind: BiohazardCleaningKind
      biohazard_types: string[]
      areas_affected: string[]
      description: string
      rooms: CallRoom[]
      secondary_zone: string
      secondary_contaminations: string[]
      other_zones: string[]
    }) | null
    contents_clearance: (CallQuoteBase & {
      clearance_kind: ContentsClearanceKind
      estimated_m3: number | null
      volume_basis: string
    }) | null
    surface_area: (CallQuoteBase & {
      cleaning_kind: SurfaceKind
      rooms: CallRoom[]
      presentation: string
      objective: string
      scope_of_work: string
    }) | null
  }
  money_mentioned: string
  unclear: string[]
}

const roomSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Room name as said, e.g. "Main bedroom", "Kitchen".' },
    preset: { type: ['string', 'null'], enum: [...ROOM_PRESETS, null], description: 'Closest average-room preset, or null.' },
    count: { type: 'number', description: 'How many of this room. Default 1.' },
    length_m: { type: ['number', 'null'], description: 'Only if the caller stated it.' },
    width_m: { type: ['number', 'null'] },
    height_m: { type: ['number', 'null'] },
  },
  required: ['name', 'preset', 'count'],
}

const quoteBase = {
  needed: { type: 'boolean' },
  reason: { type: 'string', description: 'Why this quote is needed, one line.' },
  evidence: { type: 'string', description: 'Short quote of what was said that shows it.' },
}

export const RECORD_CALL_TOOL: Anthropic.Tool = {
  name: 'record_call',
  description: 'Record the structured details of this call.',
  input_schema: {
    type: 'object',
    properties: {
      is_job_enquiry: { type: 'boolean', description: 'False for wrong numbers, sales calls, suppliers, or calls with no work in them.' },
      not_job_reason: { type: 'string' },
      summary: { type: 'string', description: 'Internal 2-5 sentence summary of the call for staff.' },
      job_description: {
        type: 'string',
        description: 'One to three neutral, factual sentences describing the job. No graphic detail. No labels or categories.',
      },
      urgency: { type: 'string', enum: URGENCIES },
      contact_name: { type: 'string', description: 'The caller\'s name as they gave it, e.g. "My name is Mick Testy" → "Mick Testy".' },
      contact_organisation: { type: 'string', description: 'Company/agency if calling on behalf of one.' },
      contact_role: { type: 'string', description: 'e.g. property manager, executor, police officer.' },
      contact_relationship: { type: 'string', description: 'Relationship to the property or deceased, e.g. son, landlord.' },
      contact_phone: { type: 'string', description: 'Callback number the caller said, as said.' },
      contact_email: { type: 'string' },
      site_address: { type: 'string', description: 'Full site address as given, including unit number and suburb.' },
      site_contact_name: { type: 'string', description: 'On-site contact if different from the caller.' },
      site_contact_phone: { type: 'string' },
      site_access_notes: { type: 'string', description: 'Keys, parking, stairs, lift, pets, discretion.' },
      biohazard: {
        type: 'object',
        description: 'Biohazard Cleaning Quote: bodily fluids, decomposition, trauma, crime scene, sewage, mould.',
        properties: {
          ...quoteBase,
          cleaning_kind: { type: 'string', enum: BIOHAZARD_KINDS },
          biohazard_types: { type: 'array', items: { type: 'string' }, description: 'e.g. "blood and bodily fluids", "decomposition fluids".' },
          areas_affected: { type: 'array', items: { type: 'string' }, description: 'Primary zone areas, e.g. "main bedroom".' },
          description: { type: 'string', description: 'Factual description of the contamination, non-graphic.' },
          rooms: { type: 'array', items: roomSchema, description: 'Rooms in the primary zone.' },
          secondary_zone: { type: 'string', description: 'Areas affected by odour or insects only.' },
          secondary_contaminations: { type: 'array', items: { type: 'string' } },
          other_zones: { type: 'array', items: { type: 'string' }, description: 'Areas said to be unaffected.' },
        },
        required: ['needed'],
      },
      contents_clearance: {
        type: 'object',
        description: 'Contents Clearance Quote: removing contents, hoarded items, deceased estate belongings.',
        properties: {
          ...quoteBase,
          clearance_kind: { type: 'string', enum: CLEARANCE_KINDS },
          estimated_m3: { type: ['number', 'null'], description: 'Only if the caller gave something to base it on (e.g. "about two skip bins"). Otherwise null.' },
          volume_basis: { type: 'string', description: 'What the volume estimate is based on, in the caller\'s words.' },
        },
        required: ['needed'],
      },
      surface_area: {
        type: 'object',
        description: 'Surface Area Cleaning Quote: general, squalor, or end-of-estate cleaning of rooms.',
        properties: {
          ...quoteBase,
          cleaning_kind: { type: 'string', enum: SURFACE_KINDS },
          rooms: { type: 'array', items: roomSchema },
          presentation: { type: 'string', description: 'What the rooms look like now, factual.' },
          objective: { type: 'string', description: 'What the client wants the cleaning to achieve.' },
          scope_of_work: { type: 'string', description: 'Plain description of the cleaning asked for.' },
        },
        required: ['needed'],
      },
      money_mentioned: { type: 'string', description: 'Any budget, price, or insurance amount mentioned, verbatim. Empty if none.' },
      unclear: { type: 'array', items: { type: 'string' }, description: 'Anything you could not be sure of. Do not guess.' },
    },
    required: [
      'is_job_enquiry', 'summary', 'job_description', 'urgency',
      'contact_name', 'contact_organisation', 'contact_role', 'contact_relationship', 'contact_phone', 'contact_email',
      'site_address', 'site_contact_name', 'site_contact_phone', 'site_access_notes',
      'biohazard', 'contents_clearance', 'surface_area', 'money_mentioned', 'unclear',
    ],
  },
}

const SYSTEM = `You are the intake agent for an Australian biohazard, trauma, hoarding and cleaning company. You receive a cleaned phone call transcript and record it with the record_call tool.

The company quotes work as up to three separate quotes:
- biohazard: Biohazard Cleaning Quote (bodily fluids, decomposition, trauma, crime scene, sewage, mould).
- contents_clearance: Contents Clearance Quote (removing contents, hoarded items, estate belongings). Measured in cubic metres.
- surface_area: Surface Area Cleaning Quote (cleaning rooms: general, squalor, estate). Measured in square metres from rooms.
One call can need one, two or all three. Mark needed=true only when the call supports it, and give the reason and evidence.

RULES:
- Record only what was said. Never invent names, numbers, sizes, addresses or emails. Empty string or null when not said.
- Every name, phone number, email and address the caller gives goes in the contact_ and site_ fields. If your summary mentions it, the field must have it.
- Never record prices, rates or fees anywhere except money_mentioned. Staff price every quote.
- Rooms: list the rooms mentioned with a count. Use a preset when it fits; give dimensions only when the caller stated them.
- job_description is neutral and factual: what happened, where, what the client wants. Not a category.
- Urgency: emergency only when the caller needs attendance today; urgent within a few days; otherwise standard.
- Put anything you are unsure of in unclear.`

export async function runHeadAgent(cleanTranscript: string, callerNumber: string, apiKey: string): Promise<{ raw: unknown; model: string }> {
  const anthropic = new Anthropic({ apiKey })
  const res = await anthropic.messages.create({
    model: CLAUDE_OPUS_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    tools: [RECORD_CALL_TOOL],
    tool_choice: { type: 'tool', name: RECORD_CALL_TOOL.name },
    messages: [{ role: 'user', content: `CALLER_ID: ${callerNumber || 'unknown'}\n\nTRANSCRIPT:\n${cleanTranscript}` }],
  })
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!use) throw new Error('Head agent returned no record')
  return { raw: use.input, model: CLAUDE_OPUS_MODEL }
}

// ── Normalisation (pure) ──────────────────────────────────────────────────────

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(s).filter(Boolean) : []
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(s(v))
  return Number.isFinite(n) && n > 0 ? n : null
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback
}

/** An object, or an object the model sent as a JSON string. */
function obj(v: unknown): Record<string, unknown> {
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try {
      return obj(JSON.parse(v))
    } catch {
      return {}
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/**
 * A quote block from the tool output (`biohazard: { needed, … }`) or from an
 * already-normalised extraction (`quotes.biohazard: { … }` or null).
 */
function quoteBlock(r: Record<string, unknown>, toolKey: string): Record<string, unknown> | null {
  if (toolKey in r) {
    const o = obj(r[toolKey])
    return o.needed === true ? o : null
  }
  const stored = obj(r.quotes)[toolKey]
  return stored ? obj(stored) : null
}

const MONEY = /(\$\s?\d[\d,]*(\.\d+)?\s?(k|K)?|\b\d[\d,]*(\.\d+)?\s?(dollars|bucks)\b)/

/** Remove sentences that carry a money amount; return what was removed. */
export function stripMoney(text: string): { text: string; removed: string[] } {
  if (!MONEY.test(text)) return { text, removed: [] }
  const removed: string[] = []
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter(sentence => {
      if (MONEY.test(sentence)) {
        removed.push(sentence.trim())
        return false
      }
      return true
    })
  return { text: kept.join(' ').trim(), removed }
}

function rooms(v: unknown): CallRoom[] {
  if (!Array.isArray(v)) return []
  return v
    .map(r => {
      const o = obj(r)
      const preset = ROOM_PRESETS.includes(s(o.preset)) ? s(o.preset) : null
      return {
        name: s(o.name),
        preset,
        count: Math.min(Math.max(Math.round(num(o.count) ?? 1), 1), 20),
        length_m: num(o.length_m),
        width_m: num(o.width_m),
        height_m: num(o.height_m),
      }
    })
    .filter(r => r.name || r.preset)
}

export function normalizeExtraction(raw: unknown): CallExtraction {
  const r = obj(raw)
  const contact = obj(r.contact)
  const site = obj(r.site)
  const moneyNotes: string[] = []
  const clean = (v: unknown) => {
    const out = stripMoney(s(v))
    moneyNotes.push(...out.removed)
    return out.text
  }

  // Tool output is flat (contact_name); a stored extraction is nested (contact.name).
  const field = (nested: Record<string, unknown>, key: string, flat: string) => s(nested[key]) || s(r[flat])
  const bio = quoteBlock(r, 'biohazard') ?? {}
  const ccq = quoteBlock(r, 'contents_clearance') ?? {}
  const sacq = quoteBlock(r, 'surface_area') ?? {}
  const has = (q: Record<string, unknown>) => Object.keys(q).length > 0

  const extraction: CallExtraction = {
    is_job_enquiry: r.is_job_enquiry !== false,
    not_job_reason: s(r.not_job_reason),
    summary: s(r.summary),
    job_description: clean(r.job_description),
    urgency: oneOf(r.urgency, URGENCIES, 'standard'),
    contact: {
      name: field(contact, 'name', 'contact_name'),
      organisation: field(contact, 'organisation', 'contact_organisation'),
      role: field(contact, 'role', 'contact_role'),
      relationship: field(contact, 'relationship', 'contact_relationship'),
      phone: field(contact, 'phone', 'contact_phone'),
      email: field(contact, 'email', 'contact_email').toLowerCase(),
    },
    site: {
      address: field(site, 'address', 'site_address'),
      contact_name: field(site, 'contact_name', 'site_contact_name'),
      contact_phone: field(site, 'contact_phone', 'site_contact_phone'),
      access_notes: clean(field(site, 'access_notes', 'site_access_notes')),
    },
    quotes: {
      biohazard:
        has(bio)
          ? {
              reason: s(bio.reason),
              evidence: s(bio.evidence),
              cleaning_kind: oneOf(bio.cleaning_kind, BIOHAZARD_KINDS, 'biohazard'),
              biohazard_types: list(bio.biohazard_types),
              areas_affected: list(bio.areas_affected),
              description: clean(bio.description),
              rooms: rooms(bio.rooms),
              secondary_zone: s(bio.secondary_zone),
              secondary_contaminations: list(bio.secondary_contaminations),
              other_zones: list(bio.other_zones),
            }
          : null,
      contents_clearance:
        has(ccq)
          ? {
              reason: s(ccq.reason),
              evidence: s(ccq.evidence),
              clearance_kind: oneOf(ccq.clearance_kind, CLEARANCE_KINDS, 'contents'),
              estimated_m3: num(ccq.estimated_m3),
              volume_basis: clean(ccq.volume_basis),
            }
          : null,
      surface_area:
        has(sacq)
          ? {
              reason: s(sacq.reason),
              evidence: s(sacq.evidence),
              cleaning_kind: oneOf(sacq.cleaning_kind, SURFACE_KINDS, 'surface'),
              rooms: rooms(sacq.rooms),
              presentation: clean(sacq.presentation),
              objective: clean(sacq.objective),
              scope_of_work: clean(sacq.scope_of_work),
            }
          : null,
    },
    money_mentioned: '',
    unclear: list(r.unclear),
  }
  extraction.money_mentioned = [s(r.money_mentioned), ...moneyNotes].filter(Boolean).join(' | ')
  return extraction
}

/** Things staff should check. Empty means the call filed cleanly. */
export function extractionIssues(e: CallExtraction, callerNumber: string): string[] {
  const issues: string[] = []
  if (!e.is_job_enquiry) issues.push(`Not a job enquiry${e.not_job_reason ? `: ${e.not_job_reason}` : ''}`)
  if (!e.contact.name) issues.push('No caller name')
  if (!e.site.address) issues.push('No site address')
  if (!e.contact.phone && !callerNumber) issues.push('No callback number')
  if (e.is_job_enquiry && !e.quotes.biohazard && !e.quotes.contents_clearance && !e.quotes.surface_area) {
    issues.push('No quote identified from the call')
  }
  if (e.quotes.contents_clearance && e.quotes.contents_clearance.estimated_m3 === null) {
    issues.push('Contents clearance volume not given — estimate needed')
  }
  for (const u of e.unclear) issues.push(`Unclear: ${u}`)
  return issues
}
