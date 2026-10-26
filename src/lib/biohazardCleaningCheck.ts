/**
 * Staff-only gap and consistency check for the Biohazard Cleaning Quote.
 * Rules in code always run. The model may add a flag from a closed list, or clear a rule flag
 * by quoting the words that cover it. Every model answer is checked here before it is kept.
 * The wording on screen is fixed here. Nothing in this module is written onto the client document.
 */
import type { Job } from '@/lib/types'
import { plainClearanceClause } from '@/lib/contentsClearanceFlags'
import { isEngagementToken } from '@/lib/quoteEngagement'
import { presentingHealthHazardsFromAssessment, presentingRisksFromAssessment } from '@/lib/documentGenerationDrivers'
import {
  BIOHAZARD_ATP_SCOPE_LINE,
  BIOHAZARD_CLAUSE_KEYS,
  BIOHAZARD_COH_SCOPE_LINE,
  BIOHAZARD_COMPLETION_REPORT_LINE,
  BIOHAZARD_LAB_SCOPE_LINE,
  BIOHAZARD_PLACEHOLDERS,
  BIOHAZARD_VERIFICATION_SCOPE_LINE,
  biohazardCleaningDocumentTitle,
  biohazardCleaningFigures,
  biohazardJobDefaults,
  fillBiohazardPlaceholders,
  normalizeBiohazardCleaningClauses,
  resolvedAreaAffected,
  resolvedBiohazardKind,
  resolvedBiohazardType,
  biohazardScopeWithServices,
  biohazardInclusionsWithServices,
  resolvedObjective,
  resolvedSecondaryContamination,
  secondaryZoneInUse,
  resolvedOtherZone,
  withoutUnusedQuoteLines,
  type BiohazardCleaningCapture,
  type BiohazardCleaningClauses,
  type BiohazardCleaningFigures,
  type BiohazardClauseKey,
  type BiohazardJobDefaults,
} from '@/lib/biohazardCleaningQuote'

export const BIOHAZARD_STAGES = [
  { id: 'containment', label: 'containment', patterns: [/contain/i, /isolat/i, /barrier/i, /control(?:led)? access/i, /restrict(?:ed)? access/i] },
  { id: 'ppe', label: 'PPE', patterns: [/\bppe\b/i, /personal protective/i, /coverall/i, /respirat/i, /gloves/i] },
  { id: 'gross_removal', label: 'removal of gross contamination', patterns: [/gross contamination/i, /bulk (?:removal|contamination)/i, /remov\w*[^.]{0,40}(?:affected|contaminated|porous)/i] },
  { id: 'cleaning', label: 'cleaning', patterns: [/\bclean(?:s|ed|ing)?\b[^.]{0,40}surface/i, /detergent/i, /scrub/i] },
  { id: 'disinfection', label: 'disinfection', patterns: [/disinfect/i, /saniti[sz]/i, /decontaminat/i] },
  { id: 'verification', label: 'verification', patterns: [/\bATP\b/, /verif/i, /swab/i] },
  { id: 'waste', label: 'waste disposal', patterns: [/clinical waste/i, /biohazard(?:ous)? waste/i, /dispos/i] },
  { id: 'deodorisation', label: 'deodorisation', patterns: [/deodori[sz]/i, /odou?r/i, /fogg/i, /ozone/i, /hydroxyl/i] },
] as const

export type BiohazardStageId = (typeof BIOHAZARD_STAGES)[number]['id']

const SPECIAL_RISKS = [
  { key: 'sharps', label: 'Sharps', pattern: /sharps|needle|syringe/i },
  { key: 'chemicals', label: 'Chemicals', pattern: /chemical/i },
  { key: 'structural_damage', label: 'Structural damage', pattern: /structur/i },
  { key: 'infectious_disease', label: 'Infectious disease', pattern: /infectio|pathogen|blood-?borne/i },
  { key: 'vermin', label: 'Vermin', pattern: /vermin|rodent|pest|insect|droppings/i },
  { key: 'mold_spores', label: 'Mould spores', pattern: /mou?ld/i },
] as const

export const BIOHAZARD_FLAG_CODES = [
  'missing_field',
  'stage_missing',
  'area_not_quoted',
  'hazard_not_addressed',
  'risk_not_covered',
  'placeholder_unfilled',
  'callout_conflict',
  'travel_incomplete',
  'surface_incomplete',
  'rate_mismatch',
  'deposit_mismatch',
  'gst_mismatch',
  'man_day_wording',
  'inclusion_exclusion_conflict',
  'title_type_mismatch',
  'scope_not_auditable',
] as const

/** What a scope step must say for a Certified Occupational Hygienist to audit it. */
export const BIOHAZARD_AUDIT_GAPS = {
  where: 'where: the rooms, surfaces, or limits of the work',
  what: 'what is removed, cleaned, or treated',
  how: 'how: the method, product, or standard',
  pass: 'what counts as a pass',
} as const

export type BiohazardAuditGap = keyof typeof BIOHAZARD_AUDIT_GAPS
const AUDIT_GAP_IDS = Object.keys(BIOHAZARD_AUDIT_GAPS) as BiohazardAuditGap[]

/** A named method, product, or standard a hygienist can check. */
export const BIOHAZARD_NAMED_METHOD =
  /thermal fogg|hydroxyl|ozone|odour counteract|odor counteract|encapsul|\bTGA\b|AS\/NZS|detergent|degreaser|P2 respirator|clinical waste|300 mm|contact time|containment|barrier|negative air|nitrile|hospital-grade/i

/** Wording that names a treatment without saying which one. */
export const BIOHAZARD_VAGUE_METHOD = /\b(?:appropriate|suitable|as required|as necessary|as needed)\b/i

/** Observable pass wording a hygienist can check on site. */
export const BIOHAZARD_PASS_CRITERIA =
  /no visible|no odour|no odor|no detectable|constitutes a pass|counts as (?:a )?pass|pass (?:limit|criteria)/i

/** The model may flag at most this many steps, so the list stays readable. */
const MAX_AUDIT_FLAGS = 5

export type BiohazardFlagCode = (typeof BIOHAZARD_FLAG_CODES)[number]

export const BIOHAZARD_GAP_CODES: ReadonlySet<BiohazardFlagCode> = new Set([
  'missing_field',
  'stage_missing',
  'area_not_quoted',
  'hazard_not_addressed',
  'risk_not_covered',
  'scope_not_auditable',
])

/** Codes the model may add. */
const MODEL_FLAG_CODES = [
  'scope_not_auditable',
  'hazard_not_addressed',
  'risk_not_covered',
  'inclusion_exclusion_conflict',
  'callout_conflict',
  'title_type_mismatch',
] as const satisfies readonly BiohazardFlagCode[]

/** Rule flags the model may clear by quoting the covering words. */
const CLEARABLE_CODES = ['stage_missing', 'area_not_quoted', 'risk_not_covered'] as const satisfies readonly BiohazardFlagCode[]

export const BIOHAZARD_CHECK_CLAUSES = ['details', 'quantities', ...BIOHAZARD_CLAUSE_KEYS] as const
export type BiohazardCheckClause = (typeof BIOHAZARD_CHECK_CLAUSES)[number]

export const BIOHAZARD_CHECK_CLAUSE_LABEL: Record<BiohazardCheckClause, string> = {
  details: 'Details',
  quantities: 'Quantities',
  scope_of_work: 'Scope of work',
  inclusions: 'Inclusions',
  exclusions: 'Exclusions',
  assumptions: 'Assumptions',
  payment_terms: 'Payment terms',
  engagement_agreement: 'Engagement agreement',
}

export interface BiohazardCheckFlag {
  code: BiohazardFlagCode
  clause: BiohazardCheckClause
  /** A stage id, an assessment name, a field, or a bracket. Empty when the code needs none. */
  subject: string
  /** Words from the clause the model pointed to. Checked to be in the clause. */
  evidence?: string
  source: 'rule' | 'ai'
}

export interface BiohazardCheckCleared {
  code: BiohazardFlagCode
  subject: string
  /** Words already in the quote that cover the rule flag. */
  evidence: string
}

export interface BiohazardCheckResult {
  flags: BiohazardCheckFlag[]
  cleared: BiohazardCheckCleared[]
  /** False when the model did not run. */
  model: boolean
}

export interface BiohazardCheckContext {
  defaults: BiohazardJobDefaults
  areaNames: string[]
  hazards: string[]
  risks: string[]
  /** Special risks ticked on the assessment, by label. */
  specialRisks: string[]
}

const FIELD_TEXT: Record<string, string> = {
  biohazard_type: 'The biohazard type is blank. It fills [biohazard type] on the quote.',
  area_affected: 'The primary zone is blank. It fills [area affected] on the quote.',
  secondary_zone: 'The secondary zone has square metres but no description. It fills [secondary zone] on the quote.',
  secondary_contamination: 'The secondary zone has no contaminations. They fill [secondary contamination] on the quote.',
  secondary_objective: 'The secondary zone objective is blank.',
  coh_rap_fee: 'The Certified Occupational Hygienist is on the quote, but the fee is blank.',
  atp_tests: 'ATP testing is on the quote, but the number of tests or the rate per test is blank.',
  lab_tests: 'Laboratory testing is on the quote, but the number of tests or the rate per test is blank.',
  lab_testing: 'COH verification needs laboratory testing as well as ATP testing.',
  atp_testing: 'COH verification needs ATP testing as well as laboratory testing.',
  description: 'The description is blank.',
  objective: 'The objective is blank.',
}

function stageLabel(id: string): string {
  return BIOHAZARD_STAGES.find(stage => stage.id === id)?.label ?? id
}

/** Short label for a cleared rule flag. */
export function biohazardClearedLabel(cleared: Pick<BiohazardCheckCleared, 'code' | 'subject'>): string {
  if (cleared.code === 'stage_missing') return `Scope stage: ${stageLabel(cleared.subject)}`
  if (cleared.code === 'area_not_quoted') return `Assessment area: ${cleared.subject}`
  return `Risk: ${cleared.subject}`
}

/** Fixed staff copy. The model supplies only a code and a subject from a closed list. */
export function biohazardFlagText(flag: Pick<BiohazardCheckFlag, 'code' | 'subject'>): string {
  switch (flag.code) {
    case 'missing_field': return FIELD_TEXT[flag.subject] ?? 'A required field is blank.'
    case 'stage_missing': return `The scope of work has no ${stageLabel(flag.subject)} stage.`
    case 'area_not_quoted': return `The assessment names "${flag.subject}". It is not in either zone, the rooms, or the scope of work.`
    case 'hazard_not_addressed': return `The assessment lists "${flag.subject}" as a presenting health hazard. The scope of work does not address it.`
    case 'risk_not_covered': return `The assessment lists "${flag.subject}" as a risk. No clause covers it.`
    case 'placeholder_unfilled': return `${flag.subject} is not filled on the printed quote.`
    case 'callout_conflict': return 'This clause does not match the call-out fee on the quote.'
    case 'travel_incomplete': return 'There is a rate per km, but no kilometres.'
    case 'surface_incomplete': return flag.subject === 'secondary'
      ? 'The secondary zone has no square metres.'
      : 'There is a rate per m², but no square metres.'
    case 'rate_mismatch': return 'This clause states a rate or an amount that is not on the quote.'
    case 'deposit_mismatch': return 'This clause states a deposit that is not 50% of the total.'
    case 'gst_mismatch': return 'This clause states GST at a rate other than 10%.'
    case 'man_day_wording': return 'This clause says man day. The quote says labour days.'
    case 'inclusion_exclusion_conflict': return 'An exclusion contradicts an inclusion.'
    case 'title_type_mismatch': return 'The client title does not match the biohazard type.'
    case 'scope_not_auditable': {
      const gap = BIOHAZARD_AUDIT_GAPS[flag.subject as BiohazardAuditGap]
      return gap
        ? `A hygienist auditing this step could not tell ${gap}.`
        : 'A hygienist auditing this step could not tell what is done.'
    }
  }
}

export function biohazardCheckContext(
  job: Pick<Job, 'job_type' | 'assessment_data' | 'site_address'>,
  companyAddress?: string | null,
): BiohazardCheckContext {
  const ad = job.assessment_data
  const defaults = biohazardJobDefaults(job, companyAddress)
  const flagged = SPECIAL_RISKS.filter(risk => ad?.special_risks?.[risk.key] === true).map(risk => risk.label)
  const unique = (items: string[]) => [...new Set(items.map(item => item.trim()).filter(Boolean))]
  return {
    defaults,
    areaNames: unique(defaults.assessmentAreaNames ?? []),
    hazards: unique(presentingHealthHazardsFromAssessment(ad).map(item => item.label)),
    risks: unique([...presentingRisksFromAssessment(ad).map(item => item.label), ...flagged]),
    specialRisks: flagged,
  }
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function contains(haystack: string, needle: string): boolean {
  const n = normalizeSpace(needle)
  return n.length > 0 && normalizeSpace(haystack).includes(n)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** The text the check reads. Placeholders are filled, markup is removed. */
export interface BiohazardCheckText {
  clauses: Record<BiohazardClauseKey, string>
  rawClauses: BiohazardCleaningClauses
  title: string
  kind: string
  biohazardType: string
  areaAffected: string
  secondaryZone: string
  secondaryContamination: string
  secondaryObjective: string
  otherZones: string
  description: string
  objective: string
  roomNames: string[]
}

export function biohazardCheckText(
  capture: BiohazardCleaningCapture,
  context: BiohazardCheckContext,
  template?: BiohazardCleaningClauses | null,
): BiohazardCheckText {
  const secondaryZone = (capture.secondary_zone ?? '').trim()
  const secondaryInUse = secondaryZoneInUse(capture)
  const storedClauses = capture.clauses ?? template ?? normalizeBiohazardCleaningClauses(null)
  const otherZones = resolvedOtherZone(capture)
  const rawClauses = Object.fromEntries(
    BIOHAZARD_CLAUSE_KEYS.map(key => [key, withoutUnusedQuoteLines(storedClauses[key] ?? '', secondaryInUse, Boolean(otherZones))]),
  ) as unknown as BiohazardCleaningClauses
  const biohazardType = resolvedBiohazardType(capture, context.defaults)
  const areaAffected = resolvedAreaAffected(capture, context.defaults)
  const secondaryContamination = resolvedSecondaryContamination(capture)
  const fill = (text: string) =>
    plainClearanceClause(fillBiohazardPlaceholders(text.replace(/\n/g, ' \n '), {
      biohazardType,
      areaAffected,
      secondaryZone,
      secondaryContamination,
      otherZones,
    }))
  rawClauses.scope_of_work = biohazardScopeWithServices(rawClauses.scope_of_work, capture)
  rawClauses.inclusions = biohazardInclusionsWithServices(rawClauses.inclusions, capture)
  const clauses = Object.fromEntries(
    BIOHAZARD_CLAUSE_KEYS.map(key => [key, fill(rawClauses[key] ?? '')]),
  ) as Record<BiohazardClauseKey, string>
  const kind = resolvedBiohazardKind(capture, context.defaults.jobType)
  return {
    clauses,
    rawClauses,
    title: biohazardCleaningDocumentTitle(kind),
    kind,
    biohazardType,
    areaAffected,
    secondaryZone,
    secondaryContamination,
    secondaryObjective: (capture.secondary_objective ?? '').trim(),
    otherZones,
    description: fill(capture.description),
    objective: fill(resolvedObjective(capture, context.defaults)),
    roomNames: [...capture.rooms, ...(secondaryInUse ? capture.secondary_rooms : [])]
      .map(room => room.name.trim())
      .filter(Boolean),
  }
}

function pushFlag(flags: BiohazardCheckFlag[], flag: BiohazardCheckFlag) {
  if (flags.some(f => f.code === flag.code && f.clause === flag.clause && f.subject === flag.subject && f.evidence === flag.evidence)) return
  flags.push(flag)
}

function quoteMoney(figures: BiohazardCleaningFigures): number[] {
  return [
    figures.rate_per_m2,
    figures.rate_per_km,
    figures.rate_per_labour_day,
    figures.mobilisation_fee,
    figures.subtotal,
    figures.gst,
    figures.total,
    round2(figures.total / 2),
    ...figures.lines.flatMap(line => [line.rate, line.amount]),
  ].filter(amount => amount > 0).map(round2)
}

function dollarAmounts(text: string): number[] {
  const amounts: number[] = []
  for (const match of text.matchAll(/\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)) {
    const n = Number(match[2] ? `${match[1].replace(/,/g, '')}.${match[2]}` : match[1].replace(/,/g, ''))
    if (Number.isFinite(n) && n > 0) amounts.push(round2(n))
  }
  return amounts
}

function percentBeside(text: string, label: string): number | null {
  const after = text.match(new RegExp(String.raw`${label}[^%\n]{0,40}?(\d+(?:\.\d+)?)\s*%`, 'i'))
  if (after) return Number(after[1])
  const before = text.match(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*%[^%\n]{0,40}?${label}`, 'i'))
  return before ? Number(before[1]) : null
}

const CALLOUT_WORDS = /\b(?:call[\s-]?out|mobili[sz]ation)\b/i
const CALLOUT_FREE = /\b(?:no|without|waived?|free)\b[^.]{0,30}\b(?:call[\s-]?out|mobili[sz]ation)\b|\b(?:call[\s-]?out|mobili[sz]ation)\b[^.]{0,30}\b(?:waived|not charged|free)\b/i

/** Exact rules. The same inputs always return the same flags. */
export function biohazardRuleFlags(
  capture: BiohazardCleaningCapture,
  context: BiohazardCheckContext,
  template?: BiohazardCleaningClauses | null,
): BiohazardCheckFlag[] {
  const flags: BiohazardCheckFlag[] = []
  const text = biohazardCheckText(capture, context, template)
  const figures = biohazardCleaningFigures(capture)
  const rule = (code: BiohazardFlagCode, clause: BiohazardCheckClause, subject = '') =>
    pushFlag(flags, { code, clause, subject, source: 'rule' })

  if (!text.biohazardType) rule('missing_field', 'details', 'biohazard_type')
  if (!text.areaAffected) rule('missing_field', 'details', 'area_affected')
  if (!text.secondaryZone && figures.secondary_m2 > 0) rule('missing_field', 'details', 'secondary_zone')
  if (secondaryZoneInUse(capture) && !text.secondaryContamination) rule('missing_field', 'details', 'secondary_contamination')
  if (secondaryZoneInUse(capture) && !text.secondaryObjective) rule('missing_field', 'details', 'secondary_objective')
  if (capture.coh_rap && !(Number(capture.coh_rap_fee) > 0)) rule('missing_field', 'quantities', 'coh_rap_fee')
  if (capture.atp_testing && !(Number(capture.atp_tests) > 0 && Number(capture.atp_rate) > 0)) rule('missing_field', 'quantities', 'atp_tests')
  if (capture.lab_testing && !(Number(capture.lab_tests) > 0 && Number(capture.lab_rate) > 0)) rule('missing_field', 'quantities', 'lab_tests')
  if (capture.atp_testing && !capture.lab_testing) rule('missing_field', 'quantities', 'lab_testing')
  if (capture.lab_testing && !capture.atp_testing) rule('missing_field', 'quantities', 'atp_testing')
  if (!text.description) rule('missing_field', 'details', 'description')
  if (!text.objective) rule('missing_field', 'details', 'objective')

  const scope = text.clauses.scope_of_work
  for (const stage of BIOHAZARD_STAGES) {
    if (!stage.patterns.some(pattern => pattern.test(scope))) rule('stage_missing', 'scope_of_work', stage.id)
  }

  const areaHaystack = [text.areaAffected, text.secondaryZone, text.otherZones, ...text.roomNames, scope].join(' \n ')
  for (const name of context.areaNames) {
    if (!contains(areaHaystack, name)) rule('area_not_quoted', 'details', name)
  }

  const allClauses = BIOHAZARD_CLAUSE_KEYS.map(key => text.clauses[key]).join(' \n ')
  for (const risk of SPECIAL_RISKS) {
    if (!context.specialRisks.includes(risk.label)) continue
    if (!risk.pattern.test(allClauses)) rule('risk_not_covered', 'details', risk.label)
  }

  const placeholderFields: [BiohazardCheckClause, string][] = [
    ['details', `${capture.description}\n${resolvedObjective(capture, context.defaults)}`],
    ...BIOHAZARD_CLAUSE_KEYS.map(key => [key, text.rawClauses[key] ?? ''] as [BiohazardCheckClause, string]),
  ]
  for (const [clause, raw] of placeholderFields) {
    for (const match of plainClearanceClause(raw).matchAll(/\[([^\[\]\n]+)\]/g)) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, ' ')
      if ((BIOHAZARD_PLACEHOLDERS as readonly string[]).includes(key)) continue
      if (clause === 'engagement_agreement' && isEngagementToken(match[1])) continue
      rule('placeholder_unfilled', clause, match[0])
    }
  }

  const calloutClauses: BiohazardClauseKey[] = ['scope_of_work', 'inclusions', 'exclusions', 'assumptions', 'payment_terms']
  for (const clause of calloutClauses) {
    const body = text.clauses[clause]
    if (!CALLOUT_WORDS.test(body)) continue
    const saysFree = CALLOUT_FREE.test(body)
    if (capture.mobilisation_waived && !saysFree) rule('callout_conflict', clause)
    if (!capture.mobilisation_waived && figures.mobilisation_fee > 0 && saysFree) rule('callout_conflict', clause)
  }

  if (figures.rate_per_km > 0 && figures.travel_km <= 0) rule('travel_incomplete', 'quantities')
  if (figures.rate_per_m2 > 0 && figures.estimated_m2 <= 0) rule('surface_incomplete', 'quantities')
  if (secondaryZoneInUse(capture) && figures.secondary_m2 <= 0) rule('surface_incomplete', 'quantities', 'secondary')

  const money = quoteMoney(figures)
  for (const clause of BIOHAZARD_CLAUSE_KEYS) {
    const body = text.clauses[clause]
    if (!body) continue
    if (dollarAmounts(body).some(amount => !money.some(quoted => Math.abs(quoted - amount) < 0.011))) {
      rule('rate_mismatch', clause)
    }
    const deposit = percentBeside(body, 'deposit')
    if (deposit != null && Math.abs(deposit - 50) > 0.001) rule('deposit_mismatch', clause)
    const gst = percentBeside(body, 'gst')
    if (gst != null && Math.abs(gst - 10) > 0.001) rule('gst_mismatch', clause)
    if (/\bman[\s-]?days?\b/i.test(body)) rule('man_day_wording', clause)
  }
  return flags
}

export function biohazardCheckSubjects(context: BiohazardCheckContext): string[] {
  return [...new Set([
    '',
    ...BIOHAZARD_STAGES.map(stage => stage.id),
    ...AUDIT_GAP_IDS,
    ...context.areaNames,
    ...context.hazards,
    ...context.risks,
  ])]
}

/** Closed object. Codes, clauses, and subjects are fixed lists. Evidence must be words already in the quote. */
export function biohazardCheckResponseSchema(context: BiohazardCheckContext) {
  const subjects = biohazardCheckSubjects(context)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      flags: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', enum: [...MODEL_FLAG_CODES] },
            clause: { type: 'string', enum: [...BIOHAZARD_CHECK_CLAUSES] },
            subject: { type: 'string', enum: subjects },
            evidence: { type: 'string' },
          },
          required: ['code', 'clause', 'subject', 'evidence'],
        },
      },
      cleared: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', enum: [...CLEARABLE_CODES] },
            subject: { type: 'string', enum: subjects },
            evidence: { type: 'string' },
          },
          required: ['code', 'subject', 'evidence'],
        },
      },
    },
    required: ['flags', 'cleared'],
  } as const
}

/** What the model reads. Plain text only. */
export function biohazardCheckPayload(
  capture: BiohazardCleaningCapture,
  context: BiohazardCheckContext,
  ruleFlags: BiohazardCheckFlag[],
  template?: BiohazardCleaningClauses | null,
) {
  const text = biohazardCheckText(capture, context, template)
  const figures = biohazardCleaningFigures(capture)
  return {
    details: {
      client_title: text.title,
      biohazard_type: text.biohazardType,
      primary_zone: text.areaAffected,
      secondary_zone: text.secondaryZone,
      secondary_contamination: text.secondaryContamination,
      secondary_objective: text.secondaryObjective,
      other_zones: text.otherZones,
      rooms: text.roomNames,
      description: text.description,
      objective: text.objective,
    },
    quantities: {
      primary_zone_m2: figures.estimated_m2,
      primary_zone_rate_per_m2: figures.rate_per_m2,
      secondary_zone_m2: figures.secondary_m2,
      secondary_zone_rate_per_m2: figures.secondary_rate_per_m2,
      travel_km: figures.travel_km,
      rate_per_km: figures.rate_per_km,
      labour_days: figures.labour_days,
      rate_per_labour_day: figures.rate_per_labour_day,
      call_out_fee: figures.mobilisation_fee,
      call_out_waived: capture.mobilisation_waived,
      call_out_reason: capture.mobilisation_waived ? capture.mobilisation_reason.trim() : '',
      other_lines: figures.lines
        .filter(line => line.kind === 'coh' || line.kind === 'atp' || line.kind === 'lab' || line.kind === 'extra')
        .map(line => line.label),
      total: figures.total,
    },
    clauses: text.clauses,
    assessment: {
      areas: context.areaNames,
      presenting_health_hazards: context.hazards,
      risks: context.risks,
    },
    rule_flags: ruleFlags.map(flag => ({ code: flag.code, subject: flag.subject })),
    standard_stages: BIOHAZARD_STAGES.map(stage => ({ id: stage.id, label: stage.label })),
  }
}

function clauseBody(text: BiohazardCheckText, clause: BiohazardCheckClause): string {
  if (clause === 'details') return [text.biohazardType, text.areaAffected, text.secondaryZone, text.secondaryContamination, text.secondaryObjective, text.otherZones, text.description, text.objective, ...text.roomNames].join(' \n ')
  if (clause === 'quantities') return ''
  return text.clauses[clause]
}

function isMember<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

const MIN_EVIDENCE = 4

/** Lines the app adds in fixed wording. They are not the model's to judge. */
const SERVICE_SCOPE_LINES = [
  BIOHAZARD_COH_SCOPE_LINE,
  BIOHAZARD_ATP_SCOPE_LINE,
  BIOHAZARD_LAB_SCOPE_LINE,
  BIOHAZARD_VERIFICATION_SCOPE_LINE,
  BIOHAZARD_COMPLETION_REPORT_LINE,
]

/**
 * Keep model answers that fit the lists and the quote.
 * A flag that needs words must quote words from its clause. A clear must quote words that are in the quote.
 */
export function acceptBiohazardModelAnswer(
  raw: unknown,
  capture: BiohazardCleaningCapture,
  context: BiohazardCheckContext,
  ruleFlags: BiohazardCheckFlag[],
  template?: BiohazardCleaningClauses | null,
): { flags: BiohazardCheckFlag[]; cleared: BiohazardCheckCleared[] } {
  const o = raw && typeof raw === 'object' ? raw as { flags?: unknown; cleared?: unknown } : {}
  const text = biohazardCheckText(capture, context, template)
  const flags: BiohazardCheckFlag[] = []
  const cleared: BiohazardCheckCleared[] = []

  for (const item of Array.isArray(o.flags) ? o.flags : []) {
    if (!item || typeof item !== 'object') continue
    const { code, clause, subject, evidence } = item as Record<string, unknown>
    if (!isMember(MODEL_FLAG_CODES, code) || !isMember(BIOHAZARD_CHECK_CLAUSES, clause)) continue
    const subjectText = typeof subject === 'string' ? subject : ''
    const evidenceText = typeof evidence === 'string' ? evidence.trim() : ''
    const body = clauseBody(text, clause)
    if (code === 'hazard_not_addressed') {
      if (!context.hazards.includes(subjectText)) continue
      pushFlag(flags, { code, clause: 'scope_of_work', subject: subjectText, source: 'ai' })
      continue
    }
    if (code === 'risk_not_covered') {
      if (!context.risks.includes(subjectText)) continue
      pushFlag(flags, { code, clause: 'details', subject: subjectText, source: 'ai' })
      continue
    }
    if (code === 'title_type_mismatch') {
      if (text.kind === 'biohazard') continue
      pushFlag(flags, { code, clause: 'details', subject: '', source: 'ai' })
      continue
    }
    if (code === 'scope_not_auditable') {
      if (!isMember(AUDIT_GAP_IDS, subjectText)) continue
      if (flags.filter(flag => flag.code === code).length >= MAX_AUDIT_FLAGS) continue
      if (evidenceText.length < MIN_EVIDENCE || !contains(text.clauses.scope_of_work, evidenceText)) continue
      if (SERVICE_SCOPE_LINES.some(line => contains(line, evidenceText))) continue
      if (subjectText === 'pass' && BIOHAZARD_PASS_CRITERIA.test(evidenceText)) continue
      if (subjectText === 'how' && BIOHAZARD_NAMED_METHOD.test(evidenceText) && !BIOHAZARD_VAGUE_METHOD.test(evidenceText)) continue
      pushFlag(flags, { code, clause: 'scope_of_work', subject: subjectText, evidence: evidenceText, source: 'ai' })
      continue
    }
    if (evidenceText.length < MIN_EVIDENCE || !contains(body, evidenceText)) continue
    if (code === 'inclusion_exclusion_conflict' && clause !== 'exclusions' && clause !== 'inclusions') continue
    if (code === 'callout_conflict' && !CALLOUT_WORDS.test(evidenceText)) continue
    pushFlag(flags, { code, clause, subject: '', evidence: evidenceText, source: 'ai' })
  }

  const scope = text.clauses.scope_of_work
  const areaHaystack = [text.areaAffected, text.secondaryZone, text.otherZones, ...text.roomNames, scope].join(' \n ')
  const allClauses = BIOHAZARD_CLAUSE_KEYS.map(key => text.clauses[key]).join(' \n ')
  for (const item of Array.isArray(o.cleared) ? o.cleared : []) {
    if (!item || typeof item !== 'object') continue
    const { code, subject, evidence } = item as Record<string, unknown>
    if (!isMember(CLEARABLE_CODES, code) || typeof subject !== 'string') continue
    if (!ruleFlags.some(flag => flag.code === code && flag.subject === subject)) continue
    const evidenceText = typeof evidence === 'string' ? evidence.trim() : ''
    if (evidenceText.length < MIN_EVIDENCE) continue
    const haystack = code === 'stage_missing' ? scope : code === 'area_not_quoted' ? areaHaystack : allClauses
    if (!contains(haystack, evidenceText)) continue
    if (cleared.some(c => c.code === code && c.subject === subject)) continue
    cleared.push({ code, subject, evidence: evidenceText })
  }
  return { flags, cleared }
}

/** Rule flags minus the ones cleared, then the model flags. */
export function mergeBiohazardCheck(
  ruleFlags: BiohazardCheckFlag[],
  model: { flags: BiohazardCheckFlag[]; cleared: BiohazardCheckCleared[] },
): { flags: BiohazardCheckFlag[]; cleared: BiohazardCheckCleared[] } {
  const isCleared = (flag: BiohazardCheckFlag) =>
    model.cleared.some(c => c.code === flag.code && c.subject === flag.subject)
  const flags: BiohazardCheckFlag[] = []
  for (const flag of ruleFlags) if (!isCleared(flag)) pushFlag(flags, flag)
  for (const flag of model.flags) {
    if (flags.some(f => f.code === flag.code && f.subject === flag.subject && f.evidence === flag.evidence && (flag.subject || f.clause === flag.clause))) continue
    pushFlag(flags, flag)
  }
  return { flags, cleared: model.cleared }
}

/** Parse a stored or returned result. Unknown entries are dropped. */
export function knownBiohazardCheck(raw: unknown): BiohazardCheckResult | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { flags?: unknown }).flags)) return null
  const o = raw as { flags: unknown[]; cleared?: unknown; model?: unknown }
  const flags: BiohazardCheckFlag[] = []
  for (const item of o.flags) {
    if (!item || typeof item !== 'object') continue
    const { code, clause, subject, evidence, source } = item as Record<string, unknown>
    if (!isMember(BIOHAZARD_FLAG_CODES, code) || !isMember(BIOHAZARD_CHECK_CLAUSES, clause)) continue
    pushFlag(flags, {
      code,
      clause,
      subject: typeof subject === 'string' ? subject : '',
      ...(typeof evidence === 'string' && evidence ? { evidence } : {}),
      source: source === 'ai' ? 'ai' : 'rule',
    })
  }
  const cleared: BiohazardCheckCleared[] = []
  for (const item of Array.isArray(o.cleared) ? o.cleared : []) {
    if (!item || typeof item !== 'object') continue
    const { code, subject, evidence } = item as Record<string, unknown>
    if (!isMember(BIOHAZARD_FLAG_CODES, code) || typeof subject !== 'string' || typeof evidence !== 'string') continue
    cleared.push({ code, subject, evidence })
  }
  return { flags, cleared, model: o.model === true }
}
