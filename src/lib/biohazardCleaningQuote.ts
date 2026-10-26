/**
 * Biohazard Cleaning Quote (BCQ).
 * One standard scope for biohazard work. The job supplies the biohazard type, the area affected,
 * the quantities, and the rates. The clauses are copied from the company template into the job,
 * edited there, and saved back to the template only when staff choose to.
 * Rates are ex GST.
 */

import type { Job, JobType } from '@/lib/types'
import { DEFAULT_ENGAGEMENT_AGREEMENT, storedEngagementAgreement } from '@/lib/quoteEngagement'
import { mergedSowCapture } from '@/lib/sowCapture'
import {
  normalizeSurfaceAreaRoom,
  roomSurfaceArea,
  roomsSurfaceTotal,
  type SurfaceAreaRoom,
} from '@/lib/surfaceAreaCleaningQuote'

export const BIOHAZARD_CLEANING_CLIENT_TITLES = [
  { id: 'biohazard', title: 'Biohazard Cleaning' },
  { id: 'trauma', title: 'Trauma Cleaning' },
  { id: 'unattended_death', title: 'Unattended Death Cleaning' },
  { id: 'crime_scene', title: 'Crime Scene Cleaning' },
  { id: 'sewage', title: 'Sewage Cleaning' },
  { id: 'mould', title: 'Mould Remediation' },
] as const

export type BiohazardCleaningKind = (typeof BIOHAZARD_CLEANING_CLIENT_TITLES)[number]['id']

const KIND_FOR_JOB_TYPE: Partial<Record<JobType, BiohazardCleaningKind>> = {
  trauma: 'trauma',
  unattended_death: 'unattended_death',
  crime_scene: 'crime_scene',
  sewage: 'sewage',
  mold: 'mould',
}

const BIOHAZARD_FOR_JOB_TYPE: Partial<Record<JobType, string>> = {
  trauma: 'blood and bodily fluids',
  crime_scene: 'blood and bodily fluids',
  unattended_death: 'decomposition fluids',
  sewage: 'sewage',
  mold: 'mould',
  flood: 'floodwater contamination',
}

/** The last line of the scope of work. */
export const BIOHAZARD_COMPLETION_REPORT_LINE =
  'Provide a completion report: photos before, during, and after the works, disinfectant records, waste disposal certificates, and test results where testing is on this quote.'

export const BIOHAZARD_CLEANING_SCHEMA = {
  ratePerM2: 0,
  ratePerKm: 0,
  ratePerLabourDay: 0,
  scope_of_work: [
    'Isolate the primary decontamination zone, the [area affected], with containment, barriers, and signage, and control access to the work area. Set up a decontamination point at the zone exit.',
    'Technicians wear PPE suited to [biohazard type]: disposable coveralls, nitrile gloves (double gloved), eye protection, and a P2 respirator or better, fitted to AS/NZS 1715.',
    'Remove gross contamination from the [area affected], and porous materials affected by [biohazard type], such as carpet, underlay, and soft furnishings, to at least 300 mm beyond the visible staining. Bag and seal them as clinical waste.',
    'Clean all non-porous surfaces in the [area affected] with detergent, top to bottom and clean to dirty, to remove organic residue.',
    'Disinfect the cleaned surfaces with a TGA-registered hospital-grade disinfectant, at the contact time on the label. Record the product and batch number.',
    'Seal semi-porous surfaces that stay in place, such as concrete or timber subfloor, with an encapsulant where staining or odour remains after cleaning.',
    'Verify the cleaning by visual inspection: no visible residue or staining on the treated surfaces, and no odour from them.',
    'Transport and dispose of [biohazard type] waste as clinical waste at a licensed facility, under AS/NZS 3816 and the state EPA rules. Keep the disposal certificates.',
    'Deodorise the [area affected] where odour remains after cleaning.',
    'Treat the secondary zone, the [secondary zone], for [secondary contamination].',
    BIOHAZARD_COMPLETION_REPORT_LINE,
  ],
  inclusions: [
    'Removal, cleaning, and disinfection of the primary zone, the [area affected], to the clearance in the scope of work.',
    'Surface decontamination of the estimated primary zone area at the rate per square metre on this quote.',
    'Treatment of [secondary contamination] in the secondary zone, the [secondary zone], at the secondary zone rate per square metre on this quote.',
    'Travel at the rate per kilometre on this quote.',
    'Labour for the labour days on this quote, as a fixed amount.',
  ],
  exclusions: [
    'Repairs, rebuilding, and restoration, including replacing removed materials.',
    'Areas outside the zones on this quote.',
    'Contents removal, other than materials affected by [biohazard type].',
    'Hazardous building materials, such as asbestos.',
  ],
  assumptions: [
    'Square metres on this quote are an estimate. An accurate onsite measurement survey revises them, at the rate per square metre on this quote.',
    'The labour days on this quote are the labour for this cleaning.',
    'Kilometres are the return drive between our base and the job address.',
    '[biohazard type] has not spread beyond the [area affected]. If it has, a written variation is given before further work.',
  ],
  terms:
    'A deposit of 50% of this quote is requested before the cleaning starts. The balance is the measured square metres at the rate on this quote, plus the travel, labour, and fixed amounts on this quote. GST is 10%.',
  authority:
    'Acceptance authorises biohazard cleaning at the address on this quote, at the rates shown.',
  acceptance:
    'I accept this biohazard cleaning quote and the quantities, rates, and terms on this page.',
} as const

export const BIOHAZARD_LABOUR_NOTE =
  'A labour day = 1 person onsite for 1 day. (It does not = estimate days onsite. It does not = number of people onsite per day).'

export const BIOHAZARD_ESTIMATE_NOTE =
  'This figure is an estimate. It will be revised with an accurate onsite measurement survey.'

export const BIOHAZARD_TRAVEL_NOTE = 'The return drive between our base and the job address.'

/** Fixed lines staff often add. They start at a rate of zero. */
export const BIOHAZARD_EXTRA_LINE_PRESETS = [
  { label: 'Clinical waste bins', unit: 'bins' },
  { label: 'Deodorisation', unit: 'treatment' },
  { label: 'Consumables and PPE', unit: 'kit' },
] as const

export const BIOHAZARD_COH_LABEL = 'Certified Occupational Hygienist: Remediation Action Plan'
export const BIOHAZARD_ATP_LABEL = 'ATP verification testing'
export const BIOHAZARD_LAB_LABEL = 'Laboratory testing'

/** Added first in the scope of work when the COH is on the quote. */
export const BIOHAZARD_COH_SCOPE_LINE =
  'Before the works start, a Certified Occupational Hygienist (COH) inspects the site and issues a Remediation Action Plan (RAP). The works follow the RAP. Where this scope and the RAP differ, the RAP applies. Hold point: after removal, the COH inspects the exposed surfaces, including the subfloor, and confirms any further removal before cleaning starts.'

/** Added after the inclusions when the COH is on the quote. */
export const BIOHAZARD_COH_INCLUSION_LINES = [
  'A Remediation Action Plan (RAP) by a Certified Occupational Hygienist (COH) before the works start, and the COH inspection at the hold point after removal.',
  'Clearance of the treated surfaces to the criteria set by the COH. Surfaces that fail are cleaned again and retested once. Further re-cleaning is a written variation.',
  'A completion report for the COH: photos before, during, and after the works, disinfectant records, waste disposal certificates, and test results.',
] as const

/** Added at the end, before the completion report, when only ATP testing is on the quote. */
export const BIOHAZARD_ATP_SCOPE_LINE =
  'Hold point, clearance: at the end of the works, verify the decontamination by ATP surface testing of the cleaned surfaces, at the sampling points and to the pass limits set by the Certified Occupational Hygienist, and record the results. Surfaces that fail are cleaned again and retested.'

/** Added at the end, before the completion report, when only laboratory testing is on the quote. */
export const BIOHAZARD_LAB_SCOPE_LINE =
  'Hold point, clearance: at the end of the works, take surface samples from the cleaned surfaces for laboratory testing, to the criteria set by the Certified Occupational Hygienist, and record the results. Surfaces that fail are cleaned again and retested.'

/** COH verification is both. Added at the end, before the completion report, when ATP testing and laboratory testing are on the quote. */
export const BIOHAZARD_VERIFICATION_SCOPE_LINE =
  'Hold point, clearance: at the end of the works, the Certified Occupational Hygienist verifies the decontamination by ATP surface testing and by laboratory testing of surface samples, at the sampling points and to the pass limits the hygienist sets, and records the results. Surfaces that fail are cleaned again and retested.'

/** Clauses kept on the job. The company template has the same shape. */
export interface BiohazardCleaningClauses {
  /** One stage per line. */
  scope_of_work: string
  /** One item per line. */
  inclusions: string
  exclusions: string
  assumptions: string
  payment_terms: string
  engagement_agreement: string
}

export const BIOHAZARD_CLAUSE_KEYS = [
  'scope_of_work',
  'inclusions',
  'exclusions',
  'assumptions',
  'payment_terms',
  'engagement_agreement',
] as const satisfies readonly (keyof BiohazardCleaningClauses)[]

export type BiohazardClauseKey = (typeof BIOHAZARD_CLAUSE_KEYS)[number]

export interface BiohazardExtraLine {
  id: string
  label: string
  quantity: number | null
  unit: string
  /** Ex GST. */
  rate: number | null
}

export interface BiohazardCleaningCapture {
  /** Null follows the job type. */
  cleaning_kind: BiohazardCleaningKind | null
  /** Null follows the assessment, then the job type. Joined, they fill [biohazard type]. */
  biohazard_types: string[] | null
  /** Primary decontamination zone: areas affected by bodily fluids. Null follows the assessment areas. Joined, they fill [area affected]. */
  areas_affected: string[] | null
  description: string
  /** Null follows the Scope of Work objective. */
  objective: string | null
  estimated_m2: number | null
  rooms: SurfaceAreaRoom[]
  /** Areas affected by odour or insects, not by bodily fluids. Fills [secondary zone]. Blank leaves the zone off the quote. */
  secondary_zone: string
  /** What is in the secondary zone, for example odour and flies. Fills [secondary contamination]. */
  secondary_contaminations: string[]
  /** What the secondary zone treatment is meant to achieve. */
  secondary_objective: string
  secondary_m2: number | null
  secondary_rooms: SurfaceAreaRoom[]
  /** Ex GST. Blank is zero. */
  secondary_rate_per_m2: number | null
  /** Labour days the client is buying. Required before the quote is generated. */
  labour_days: number | null
  /** Ex GST. Blank uses the schema rate. */
  rate_per_m2: number | null
  rate_per_km: number | null
  rate_per_labour_day: number | null
  /** Null follows the job site address. */
  job_address: string | null
  job_lat: number | null
  job_lng: number | null
  /** Null follows the company address. */
  base_address: string | null
  base_lat: number | null
  base_lng: number | null
  /** Return drive between the base and the job. */
  travel_km: number | null
  travel_from_maps: boolean
  /** Ex GST. Attendance and setup. Blank or zero stays off the quote. */
  mobilisation_fee: number | null
  mobilisation_waived: boolean
  mobilisation_reason: string
  extra_lines: BiohazardExtraLine[]
  /** Certified Occupational Hygienist prepares the Remediation Action Plan. */
  coh_rap: boolean
  /** Ex GST. */
  coh_rap_fee: number | null
  /** ATP surface testing. One of the two parts of COH verification. */
  atp_testing: boolean
  atp_tests: number | null
  /** Ex GST, per test. */
  atp_rate: number | null
  /** Laboratory testing of surface samples. The other part of COH verification. */
  lab_testing: boolean
  lab_tests: number | null
  /** Ex GST, per test. */
  lab_rate: number | null
  /** Null until the job takes a copy of the company template. */
  clauses: BiohazardCleaningClauses | null
  /** Set when the inclusions, exclusions, assumptions, and engagement came from the last quote of this kind. */
  clauses_from_kind: BiohazardCleaningKind | null
  /** Set when staff generate the quote while the check still shows issues. */
  check_override: { at: string; codes: string[] } | null
}

export interface BiohazardCleaningLine {
  label: string
  quantity: number
  unit: string
  rate: number
  amount: number
  kind: 'surface' | 'secondary' | 'travel' | 'mobilisation' | 'labour' | 'coh' | 'atp' | 'lab' | 'extra'
}

export interface BiohazardCleaningFigures {
  estimated_m2: number
  secondary_m2: number
  secondary_rate_per_m2: number
  secondary_amount: number
  /** True when the secondary zone is on the quote. */
  has_secondary: boolean
  travel_km: number
  labour_days: number
  mobilisation_fee: number
  rate_per_m2: number
  rate_per_km: number
  rate_per_labour_day: number
  area_amount: number
  travel_amount: number
  labour_amount: number
  lines: BiohazardCleaningLine[]
  subtotal: number
  gst: number
  total: number
}

export interface BiohazardCleaningQuoteContent {
  title: string
  reference: string
  client_name: string
  site_address: string
  job_address: string
  biohazard_type: string
  area_affected: string
  description: string
  objective: string
  scope_of_work: string[]
  estimated_m2: number
  rate_per_m2: number
  area_amount: number
  rooms: { name: string; detail: string; area_m2: number }[]
  secondary_zone: string
  secondary_contamination: string
  secondary_objective: string
  secondary_m2: number
  secondary_rate_per_m2: number
  secondary_amount: number
  secondary_rooms: { name: string; detail: string; area_m2: number }[]
  has_secondary: boolean
  travel_km: number
  rate_per_km: number
  travel_amount: number
  labour_days: number
  rate_per_labour_day: number
  labour_amount: number
  mobilisation_fee: number
  mobilisation_reason: string
  extra_lines: { label: string; quantity: number; unit: string; rate: number; amount: number }[]
  subtotal: number
  gst: number
  total: number
  inclusions: string[]
  exclusions: string[]
  assumptions: string[]
  terms: string
  engagement_agreement: string
  authority: string
  acceptance: string
}

/** What the job knows before staff type anything. */
export interface BiohazardJobDefaults {
  jobType?: JobType | null
  assessmentBiohazardType?: string | null
  assessmentAreaNames?: string[]
  sowObjective?: string | null
  siteAddress?: string | null
  companyAddress?: string | null
}

export function biohazardJobDefaults(
  job: Pick<Job, 'job_type' | 'assessment_data' | 'site_address'>,
  companyAddress?: string | null,
): BiohazardJobDefaults {
  const ad = job.assessment_data
  return {
    jobType: job.job_type,
    assessmentBiohazardType: ad?.biohazard_type ?? null,
    assessmentAreaNames: (ad?.areas ?? []).map(area => area.name).filter(name => typeof name === 'string' && name.trim()),
    sowObjective: mergedSowCapture(ad).objective,
    siteAddress: job.site_address,
    companyAddress: companyAddress ?? null,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function quantityOrZero(value: number | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function newBiohazardLineId(): string {
  return `line_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function biohazardCleaningDocumentTitle(kind: string | null | undefined): string {
  return BIOHAZARD_CLEANING_CLIENT_TITLES.find(option => option.id === kind)?.title
    ?? BIOHAZARD_CLEANING_CLIENT_TITLES[0].title
}

export function resolvedBiohazardKind(capture: Pick<BiohazardCleaningCapture, 'cleaning_kind'>, jobType?: JobType | null): BiohazardCleaningKind {
  return capture.cleaning_kind ?? (jobType ? KIND_FOR_JOB_TYPE[jobType] : undefined) ?? 'biohazard'
}

function cleanNames(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const clean = name.trim()
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function joinNames(names: string[]): string {
  const clean = cleanNames(names)
  if (clean.length <= 1) return clean[0] ?? ''
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`
}

export function resolvedBiohazardTypes(capture: Pick<BiohazardCleaningCapture, 'biohazard_types'>, defaults: BiohazardJobDefaults = {}): string[] {
  if (capture.biohazard_types != null) return cleanNames(capture.biohazard_types)
  const fromAssessment = (defaults.assessmentBiohazardType ?? '').trim()
  if (fromAssessment) return [fromAssessment]
  const fromJobType = defaults.jobType ? BIOHAZARD_FOR_JOB_TYPE[defaults.jobType] : undefined
  return fromJobType ? [fromJobType] : []
}

/** For example "blood, faeces and decomposition fluids". */
export function resolvedBiohazardType(capture: Pick<BiohazardCleaningCapture, 'biohazard_types'>, defaults: BiohazardJobDefaults = {}): string {
  return joinNames(resolvedBiohazardTypes(capture, defaults))
}

export function resolvedAreasAffected(capture: Pick<BiohazardCleaningCapture, 'areas_affected'>, defaults: BiohazardJobDefaults = {}): string[] {
  if (capture.areas_affected != null) return cleanNames(capture.areas_affected)
  return cleanNames(defaults.assessmentAreaNames ?? [])
}

/** For example "kitchen, laundry and toilet". */
export function resolvedAreaAffected(capture: Pick<BiohazardCleaningCapture, 'areas_affected'>, defaults: BiohazardJobDefaults = {}): string {
  return joinNames(resolvedAreasAffected(capture, defaults))
}

export function resolvedObjective(capture: Pick<BiohazardCleaningCapture, 'objective'>, defaults: BiohazardJobDefaults = {}): string {
  if (capture.objective != null) return capture.objective.trim()
  return (defaults.sowObjective ?? '').trim()
}

/** Quick picks shown beside the lists. */
export const BIOHAZARD_TYPE_SUGGESTIONS = [
  'blood',
  'faeces',
  'urine',
  'vomit',
  'decomposition fluids',
  'bodily fluids',
  'sewage',
  'mould',
] as const

export const BIOHAZARD_AREA_SUGGESTIONS = [
  'kitchen',
  'laundry',
  'toilet',
  'bathroom',
  'ensuite',
  'bedroom',
  'lounge',
  'hallway',
] as const

export const SECONDARY_CONTAMINATION_SUGGESTIONS = [
  'odour',
  'flies',
  'insects',
  'mould',
] as const

export function emptyBiohazardCleaningCapture(): BiohazardCleaningCapture {
  return {
    cleaning_kind: null,
    biohazard_types: null,
    areas_affected: null,
    description: '',
    objective: null,
    estimated_m2: null,
    rooms: [],
    secondary_zone: '',
    secondary_contaminations: [],
    secondary_objective: '',
    secondary_m2: null,
    secondary_rooms: [],
    secondary_rate_per_m2: null,
    labour_days: null,
    rate_per_m2: null,
    rate_per_km: null,
    rate_per_labour_day: null,
    job_address: null,
    job_lat: null,
    job_lng: null,
    base_address: null,
    base_lat: null,
    base_lng: null,
    travel_km: null,
    travel_from_maps: false,
    mobilisation_fee: null,
    mobilisation_waived: false,
    mobilisation_reason: '',
    extra_lines: [],
    coh_rap: false,
    coh_rap_fee: null,
    atp_testing: false,
    atp_tests: null,
    atp_rate: null,
    lab_testing: false,
    lab_tests: null,
    lab_rate: null,
    clauses: null,
    clauses_from_kind: null,
    check_override: null,
  }
}

export function defaultBiohazardCleaningClauses(engagement = ''): BiohazardCleaningClauses {
  return {
    scope_of_work: BIOHAZARD_CLEANING_SCHEMA.scope_of_work.join('\n'),
    inclusions: BIOHAZARD_CLEANING_SCHEMA.inclusions.join('\n'),
    exclusions: BIOHAZARD_CLEANING_SCHEMA.exclusions.join('\n'),
    assumptions: BIOHAZARD_CLEANING_SCHEMA.assumptions.join('\n'),
    payment_terms: BIOHAZARD_CLEANING_SCHEMA.terms,
    engagement_agreement: engagement,
  }
}

export function biohazardClauseLines(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

/**
 * The company template. Before it is saved the first time, the engagement agreement
 * follows the one shared by the contents clearance and surface cleaning quotes.
 */
export function normalizeBiohazardCleaningClauses(raw: unknown, sharedEngagement = ''): BiohazardCleaningClauses {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const saved = typeof o.engagement_agreement === 'string' ? o.engagement_agreement : ''
  const engagement = saved.trim() ? saved : (sharedEngagement.trim() ? sharedEngagement : DEFAULT_ENGAGEMENT_AGREEMENT)
  return {
    ...jobBiohazardClauses(o),
    engagement_agreement: storedEngagementAgreement(engagement, DEFAULT_ENGAGEMENT_AGREEMENT),
  }
}

/** Clauses remembered from the last quote of the same kind, for example the last unattended death. */
export const BIOHAZARD_REMEMBERED_KEYS = [
  'inclusions',
  'exclusions',
  'assumptions',
  'engagement_agreement',
] as const satisfies readonly BiohazardClauseKey[]

export type BiohazardRememberedClauses = Pick<BiohazardCleaningClauses, (typeof BIOHAZARD_REMEMBERED_KEYS)[number]> & {
  job_id: string | null
  saved_at: string | null
}

/** Stored in the company template JSON as by_kind[kind]. */
export function rememberedBiohazardClauses(standardsRaw: unknown, kind: BiohazardCleaningKind): BiohazardRememberedClauses | null {
  const o = standardsRaw && typeof standardsRaw === 'object' ? standardsRaw as Record<string, unknown> : {}
  const byKind = o.by_kind && typeof o.by_kind === 'object' ? o.by_kind as Record<string, unknown> : {}
  const entry = byKind[kind] && typeof byKind[kind] === 'object' ? byKind[kind] as Record<string, unknown> : null
  if (!entry) return null
  if (!BIOHAZARD_REMEMBERED_KEYS.every(key => typeof entry[key] === 'string')) return null
  return {
    inclusions: entry.inclusions as string,
    exclusions: entry.exclusions as string,
    assumptions: entry.assumptions as string,
    engagement_agreement: entry.engagement_agreement as string,
    job_id: typeof entry.job_id === 'string' ? entry.job_id : null,
    saved_at: typeof entry.saved_at === 'string' ? entry.saved_at : null,
  }
}

/** The company template JSON with this job's clauses remembered for its kind. Other keys are kept. */
export function withRememberedBiohazardClauses(
  standardsRaw: unknown,
  kind: BiohazardCleaningKind,
  clauses: BiohazardCleaningClauses,
  jobId: string,
  savedAt: string,
): Record<string, unknown> {
  const o = standardsRaw && typeof standardsRaw === 'object' ? { ...standardsRaw as Record<string, unknown> } : {}
  const byKind = o.by_kind && typeof o.by_kind === 'object' ? { ...o.by_kind as Record<string, unknown> } : {}
  byKind[kind] = {
    ...Object.fromEntries(BIOHAZARD_REMEMBERED_KEYS.map(key => [key, clauses[key]])),
    job_id: jobId,
    saved_at: savedAt,
  }
  return { ...o, by_kind: byKind }
}

export function applyRememberedBiohazardClauses(
  clauses: BiohazardCleaningClauses,
  remembered: BiohazardRememberedClauses,
): BiohazardCleaningClauses {
  const next = { ...clauses }
  for (const key of BIOHAZARD_REMEMBERED_KEYS) next[key] = remembered[key]
  return next
}

/** The job's own copy. Text is kept as typed, including a cleared clause. */
function jobBiohazardClauses(raw: unknown): BiohazardCleaningClauses {
  const fallback = defaultBiohazardCleaningClauses()
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const text = (key: keyof BiohazardCleaningClauses) =>
    typeof o[key] === 'string' ? o[key] as string : fallback[key]
  return {
    scope_of_work: text('scope_of_work'),
    inclusions: text('inclusions'),
    exclusions: text('exclusions'),
    assumptions: text('assumptions'),
    payment_terms: text('payment_terms'),
    engagement_agreement: text('engagement_agreement'),
  }
}

function normalizeExtraLine(raw: unknown): BiohazardExtraLine {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const num = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return {
    id: typeof row.id === 'string' && row.id ? row.id : newBiohazardLineId(),
    label: typeof row.label === 'string' ? row.label : '',
    quantity: num(row.quantity),
    unit: typeof row.unit === 'string' ? row.unit : '',
    rate: num(row.rate),
  }
}

export function normalizeBiohazardCleaningCapture(raw: unknown): BiohazardCleaningCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const qty = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const coord = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  const optionalText = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  /** A saved list, else the single text field older quotes saved. */
  const nameList = (list: unknown, legacy: unknown): string[] | null => {
    if (Array.isArray(list)) return list.filter((item): item is string => typeof item === 'string')
    if (typeof legacy === 'string') return legacy.trim() ? [legacy.trim()] : []
    return null
  }
  const kind = BIOHAZARD_CLEANING_CLIENT_TITLES.some(option => option.id === o.cleaning_kind)
    ? o.cleaning_kind as BiohazardCleaningKind
    : null
  const override = o.check_override && typeof o.check_override === 'object'
    ? o.check_override as Record<string, unknown>
    : null
  return {
    cleaning_kind: kind,
    biohazard_types: nameList(o.biohazard_types, o.biohazard_type),
    areas_affected: nameList(o.areas_affected, o.area_affected),
    description: typeof o.description === 'string' ? o.description : '',
    objective: optionalText(o.objective),
    estimated_m2: qty(o.estimated_m2),
    rooms: Array.isArray(o.rooms) ? o.rooms.map(normalizeSurfaceAreaRoom) : [],
    secondary_zone: typeof o.secondary_zone === 'string' ? o.secondary_zone : '',
    secondary_contaminations: Array.isArray(o.secondary_contaminations)
      ? o.secondary_contaminations.filter((item): item is string => typeof item === 'string')
      : [],
    secondary_objective: typeof o.secondary_objective === 'string' ? o.secondary_objective : '',
    secondary_m2: qty(o.secondary_m2),
    secondary_rooms: Array.isArray(o.secondary_rooms) ? o.secondary_rooms.map(normalizeSurfaceAreaRoom) : [],
    secondary_rate_per_m2: qty(o.secondary_rate_per_m2),
    labour_days: qty(o.labour_days),
    rate_per_m2: qty(o.rate_per_m2),
    rate_per_km: qty(o.rate_per_km),
    rate_per_labour_day: qty(o.rate_per_labour_day),
    job_address: optionalText(o.job_address),
    job_lat: coord(o.job_lat),
    job_lng: coord(o.job_lng),
    base_address: optionalText(o.base_address),
    base_lat: coord(o.base_lat),
    base_lng: coord(o.base_lng),
    travel_km: qty(o.travel_km),
    travel_from_maps: o.travel_from_maps === true,
    mobilisation_fee: qty(o.mobilisation_fee),
    mobilisation_waived: o.mobilisation_waived === true,
    mobilisation_reason: typeof o.mobilisation_reason === 'string' ? o.mobilisation_reason : '',
    extra_lines: Array.isArray(o.extra_lines) ? o.extra_lines.map(normalizeExtraLine) : [],
    coh_rap: o.coh_rap === true,
    coh_rap_fee: qty(o.coh_rap_fee),
    atp_testing: o.atp_testing === true,
    atp_tests: qty(o.atp_tests),
    atp_rate: qty(o.atp_rate),
    lab_testing: o.lab_testing === true,
    lab_tests: qty(o.lab_tests),
    lab_rate: qty(o.lab_rate),
    clauses: o.clauses && typeof o.clauses === 'object' ? jobBiohazardClauses(o.clauses) : null,
    clauses_from_kind: BIOHAZARD_CLEANING_CLIENT_TITLES.some(option => option.id === o.clauses_from_kind)
      ? o.clauses_from_kind as BiohazardCleaningKind
      : null,
    check_override: override && typeof override.at === 'string'
      ? {
          at: override.at,
          codes: Array.isArray(override.codes) ? override.codes.filter((c): c is string => typeof c === 'string') : [],
        }
      : null,
  }
}

/** Room composite when any room has dimensions. Otherwise the typed square metres. */
export function biohazardSquareMetres(capture: Pick<BiohazardCleaningCapture, 'estimated_m2' | 'rooms'>): number | null {
  const fromRooms = roomsSurfaceTotal(capture.rooms ?? [])
  if (fromRooms != null) return fromRooms
  return capture.estimated_m2
}

export function biohazardSecondarySquareMetres(capture: Pick<BiohazardCleaningCapture, 'secondary_m2' | 'secondary_rooms'>): number | null {
  const fromRooms = roomsSurfaceTotal(capture.secondary_rooms ?? [])
  if (fromRooms != null) return fromRooms
  return capture.secondary_m2
}

export function resolvedSecondaryContaminations(capture: Pick<BiohazardCleaningCapture, 'secondary_contaminations'>): string[] {
  return cleanNames(capture.secondary_contaminations ?? [])
}

/** For example "odour and flies". */
export function resolvedSecondaryContamination(capture: Pick<BiohazardCleaningCapture, 'secondary_contaminations'>): string {
  return joinNames(resolvedSecondaryContaminations(capture))
}

export function secondaryZoneInUse(capture: Pick<BiohazardCleaningCapture, 'secondary_zone' | 'secondary_contaminations' | 'secondary_objective' | 'secondary_m2' | 'secondary_rooms'>): boolean {
  return Boolean(
    (capture.secondary_zone ?? '').trim()
    || resolvedSecondaryContamination(capture)
    || (capture.secondary_objective ?? '').trim()
    || quantityOrZero(biohazardSecondarySquareMetres(capture)) > 0
  )
}

export function biohazardCleaningFigures(capture: BiohazardCleaningCapture): BiohazardCleaningFigures {
  const estimated_m2 = round2(quantityOrZero(biohazardSquareMetres(capture)))
  const secondary_m2 = round2(quantityOrZero(biohazardSecondarySquareMetres(capture)))
  const secondary_rate_per_m2 = round2(quantityOrZero(capture.secondary_rate_per_m2))
  const secondary_amount = round2(secondary_m2 * secondary_rate_per_m2)
  const has_secondary = secondaryZoneInUse(capture)
  const travel_km = round2(quantityOrZero(capture.travel_km))
  const labour_days = Math.round(quantityOrZero(capture.labour_days))
  const mobilisation_fee = capture.mobilisation_waived ? 0 : round2(quantityOrZero(capture.mobilisation_fee))
  const rate_per_m2 = capture.rate_per_m2 ?? BIOHAZARD_CLEANING_SCHEMA.ratePerM2
  const rate_per_km = capture.rate_per_km ?? BIOHAZARD_CLEANING_SCHEMA.ratePerKm
  const rate_per_labour_day = capture.rate_per_labour_day ?? BIOHAZARD_CLEANING_SCHEMA.ratePerLabourDay
  const area_amount = round2(estimated_m2 * rate_per_m2)
  const travel_amount = round2(travel_km * rate_per_km)
  const labour_amount = round2(labour_days * rate_per_labour_day)
  const lines: BiohazardCleaningLine[] = [
    { label: 'Primary zone', quantity: estimated_m2, unit: 'm²', rate: rate_per_m2, amount: area_amount, kind: 'surface' },
  ]
  if (has_secondary) {
    lines.push({ label: 'Secondary zone', quantity: secondary_m2, unit: 'm²', rate: secondary_rate_per_m2, amount: secondary_amount, kind: 'secondary' })
  }
  if (travel_km > 0 || rate_per_km > 0) {
    lines.push({ label: 'Travel', quantity: travel_km, unit: 'km', rate: rate_per_km, amount: travel_amount, kind: 'travel' })
  }
  if (mobilisation_fee > 0) {
    lines.push({ label: 'Mobilisation', quantity: 1, unit: 'fee', rate: mobilisation_fee, amount: mobilisation_fee, kind: 'mobilisation' })
  }
  lines.push({
    label: 'Labour',
    quantity: labour_days,
    unit: labour_days === 1 ? 'labour day' : 'labour days',
    rate: rate_per_labour_day,
    amount: labour_amount,
    kind: 'labour',
  })
  if (capture.coh_rap) {
    const fee = round2(quantityOrZero(capture.coh_rap_fee))
    lines.push({ label: BIOHAZARD_COH_LABEL, quantity: 1, unit: 'plan', rate: fee, amount: fee, kind: 'coh' })
  }
  if (capture.atp_testing) {
    const tests = Math.round(quantityOrZero(capture.atp_tests))
    const rate = round2(quantityOrZero(capture.atp_rate))
    lines.push({ label: BIOHAZARD_ATP_LABEL, quantity: tests, unit: tests === 1 ? 'test' : 'tests', rate, amount: round2(tests * rate), kind: 'atp' })
  }
  if (capture.lab_testing) {
    const tests = Math.round(quantityOrZero(capture.lab_tests))
    const rate = round2(quantityOrZero(capture.lab_rate))
    lines.push({ label: BIOHAZARD_LAB_LABEL, quantity: tests, unit: tests === 1 ? 'test' : 'tests', rate, amount: round2(tests * rate), kind: 'lab' })
  }
  for (const extra of capture.extra_lines ?? []) {
    const label = extra.label.trim()
    if (!label) continue
    const quantity = round2(quantityOrZero(extra.quantity))
    const rate = round2(quantityOrZero(extra.rate))
    lines.push({ label, quantity, unit: extra.unit.trim(), rate, amount: round2(quantity * rate), kind: 'extra' })
  }
  const subtotal = round2(lines.reduce((sum, line) => sum + line.amount, 0))
  const gst = round2(subtotal * 0.1)
  return {
    estimated_m2,
    secondary_m2,
    secondary_rate_per_m2,
    secondary_amount,
    has_secondary,
    travel_km,
    labour_days,
    mobilisation_fee,
    rate_per_m2,
    rate_per_km,
    rate_per_labour_day,
    area_amount,
    travel_amount,
    labour_amount,
    lines,
    subtotal,
    gst,
    total: round2(subtotal + gst),
  }
}

export const BIOHAZARD_PLACEHOLDERS = ['biohazard type', 'area affected', 'primary zone', 'secondary zone', 'secondary contamination'] as const

function placeholderKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Fills [biohazard type], [area affected] (also [primary zone]), [secondary zone], and [secondary contamination].
 * A blank value leaves the bracket for the check to find.
 */
export function fillBiohazardPlaceholders(
  text: string,
  values: { biohazardType: string; areaAffected: string; secondaryZone?: string; secondaryContamination?: string },
): string {
  return text.replace(/\[([^\[\]\n]+)\]/g, (match, raw: string) => {
    const key = placeholderKey(raw)
    if (key === 'biohazard type' && values.biohazardType.trim()) return values.biohazardType.trim()
    if ((key === 'area affected' || key === 'primary zone') && values.areaAffected.trim()) return values.areaAffected.trim()
    if (key === 'secondary zone' && values.secondaryZone?.trim()) return values.secondaryZone.trim()
    if (key === 'secondary contamination' && values.secondaryContamination?.trim()) return values.secondaryContamination.trim()
    return match
  })
}

/**
 * The scope of work with the COH line first and the verification line at the end, before the completion report,
 * when they are on the quote. Verification is ATP testing and laboratory testing. A scope that already covers a part is left as it is.
 */
export function biohazardScopeWithServices(
  scope: string,
  capture: Pick<BiohazardCleaningCapture, 'coh_rap' | 'atp_testing' | 'lab_testing'>,
): string {
  const lines = scope.split('\n')
  if (capture.coh_rap && !/occupational hygien|remediation action plan/i.test(scope)) lines.unshift(BIOHAZARD_COH_SCOPE_LINE)
  const hasAtp = /\bATP\b/.test(scope)
  const hasLab = /laborator/i.test(scope)
  const verification: string[] = []
  if (capture.atp_testing && capture.lab_testing && !hasAtp && !hasLab) verification.push(BIOHAZARD_VERIFICATION_SCOPE_LINE)
  else {
    if (capture.atp_testing && !hasAtp) verification.push(BIOHAZARD_ATP_SCOPE_LINE)
    if (capture.lab_testing && !hasLab) verification.push(BIOHAZARD_LAB_SCOPE_LINE)
  }
  const report = lines.findIndex(line => /completion report/i.test(line))
  lines.splice(report === -1 ? lines.length : report, 0, ...verification)
  return lines.join('\n')
}

/** The inclusions with the COH lines added when the COH is on the quote. Inclusions that already cover the COH are left as they are. */
export function biohazardInclusionsWithServices(
  inclusions: string,
  capture: Pick<BiohazardCleaningCapture, 'coh_rap'>,
): string {
  if (!capture.coh_rap || /occupational hygien|remediation action plan|\bCOH\b/i.test(inclusions)) return inclusions
  return [inclusions, ...BIOHAZARD_COH_INCLUSION_LINES].filter(Boolean).join('\n')
}

/** Without a secondary zone, clause lines about it are left off. */
export function withoutUnusedSecondaryLines(text: string, inUse: boolean): string {
  if (inUse) return text
  return text
    .split('\n')
    .filter(line => ![...line.matchAll(/\[([^\[\]\n]+)\]/g)].some(match => {
      const key = placeholderKey(match[1])
      return key === 'secondary zone' || key === 'secondary contamination'
    }))
    .join('\n')
}

function sentenceStart(line: string): string {
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : line
}

export function biohazardCleaningQuoteContent(input: {
  reference: string
  clientName: string
  siteAddress: string
  capture: BiohazardCleaningCapture
  defaults?: BiohazardJobDefaults
  /** Company template, used when the job has not taken its own copy. */
  template?: BiohazardCleaningClauses | null
}): BiohazardCleaningQuoteContent {
  const capture = input.capture
  const defaults = input.defaults ?? {}
  const clauses = capture.clauses ?? input.template ?? normalizeBiohazardCleaningClauses(null)
  const figures = biohazardCleaningFigures(capture)
  const biohazardType = resolvedBiohazardType(capture, defaults)
  const areaAffected = resolvedAreaAffected(capture, defaults)
  const secondaryZone = (capture.secondary_zone ?? '').trim()
  const secondaryContamination = resolvedSecondaryContamination(capture)
  const secondaryObjective = (capture.secondary_objective ?? '').trim()
  const fill = (text: string) =>
    fillBiohazardPlaceholders(withoutUnusedSecondaryLines(text, figures.has_secondary), {
      biohazardType,
      areaAffected,
      secondaryZone,
      secondaryContamination,
    })
  const lines = (text: string) => biohazardClauseLines(fill(text)).map(sentenceStart)
  const jobAddress = (capture.job_address ?? input.siteAddress).trim()
  const printedRooms = (list: SurfaceAreaRoom[]) => list.flatMap(room => {
    const measure = roomSurfaceArea(room)
    if (!measure) return []
    return [{
      name: room.name.trim() || 'Room',
      detail: `${room.length_m} × ${room.width_m} × ${room.height_m} m`,
      area_m2: measure.total,
    }]
  })
  return {
    title: biohazardCleaningDocumentTitle(resolvedBiohazardKind(capture, defaults.jobType)),
    reference: input.reference,
    client_name: input.clientName.trim(),
    site_address: jobAddress,
    job_address: jobAddress,
    biohazard_type: biohazardType,
    area_affected: areaAffected,
    description: fill(capture.description).trim(),
    objective: fill(resolvedObjective(capture, defaults)).trim(),
    scope_of_work: lines(biohazardScopeWithServices(clauses.scope_of_work, capture)),
    estimated_m2: figures.estimated_m2,
    rate_per_m2: figures.rate_per_m2,
    area_amount: figures.area_amount,
    rooms: printedRooms(capture.rooms ?? []),
    secondary_zone: secondaryZone,
    secondary_contamination: figures.has_secondary ? secondaryContamination : '',
    secondary_objective: figures.has_secondary ? secondaryObjective : '',
    secondary_m2: figures.secondary_m2,
    secondary_rate_per_m2: figures.secondary_rate_per_m2,
    secondary_amount: figures.secondary_amount,
    secondary_rooms: figures.has_secondary ? printedRooms(capture.secondary_rooms ?? []) : [],
    has_secondary: figures.has_secondary,
    travel_km: figures.travel_km,
    rate_per_km: figures.rate_per_km,
    travel_amount: figures.travel_amount,
    labour_days: figures.labour_days,
    rate_per_labour_day: figures.rate_per_labour_day,
    labour_amount: figures.labour_amount,
    mobilisation_fee: figures.mobilisation_fee,
    mobilisation_reason: capture.mobilisation_waived ? capture.mobilisation_reason.trim() : '',
    extra_lines: figures.lines
      .filter(line => line.kind === 'coh' || line.kind === 'atp' || line.kind === 'lab' || line.kind === 'extra')
      .map(({ label, quantity, unit, rate, amount }) => ({ label, quantity, unit, rate, amount })),
    subtotal: figures.subtotal,
    gst: figures.gst,
    total: figures.total,
    inclusions: lines(biohazardInclusionsWithServices(clauses.inclusions, capture)),
    exclusions: lines(clauses.exclusions),
    assumptions: lines(clauses.assumptions),
    terms: fill(clauses.payment_terms).trim(),
    engagement_agreement: clauses.engagement_agreement.trim(),
    authority: BIOHAZARD_CLEANING_SCHEMA.authority,
    acceptance: BIOHAZARD_CLEANING_SCHEMA.acceptance,
  }
}
