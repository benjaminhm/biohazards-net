/**
 * Scope-of-work draft for the Surface Area Cleaning Quote (lib/surfaceAreaCleaningQuote.ts).
 * Relies on the Presentation and Objective entered on the quote (plus rooms, ceiling setting,
 * and active exclusions) to draft a tightly structured, auditable list of scope steps.
 *
 * The model never sees PII or prices. Lines about the COH, RAP, ATP, laboratory testing,
 * prices, timeframes, guarantees, or excluded ceilings are stripped and reported in code.
 *
 * See docs/ai-product-principles.md.
 */
import {
  surfaceAreaClauseLines,
  surfaceAreaCleaningDocumentTitle,
  type SurfaceAreaCleaningCapture,
  type SurfaceAreaCleaningStandards,
} from '@/lib/surfaceAreaCleaningQuote'
import { withJobOnlyLines } from '@/lib/quoteJobClauses'

/** Hygienist and testing lines are added by code when ticked, so a draft never carries them. */
const SERVICE_LINE = /occupational hygien|remediation action plan|\bRAP\b|\bCOH\b|\bATP\b|laborator|completion report|records of the works|records for the hygienist/i
const MONEY = /\$\s?\d|\b\d[\d,.]*\s?(?:dollars?|aud)\b|\bper\s+(?:hour|day|m2|m²|m3|m³|square metre|cubic metre|tonne|kilometre|km)\b/i
const TIMEFRAME = /\b\d+(?:\.\d+)?\s*(?:-|to)?\s*(?:\d+\s*)?(?:hours?|hrs?|days?|weeks?|months?)\b|\b(?:same|next)[- ]day\b|\bwithin (?:a|one|two|three) (?:day|week)s?\b/i
const GUARANTEE = /\bguarant|\bwarrant|\b100\s?%|\bcertif|\bsafe (?:to|for) (?:re-?)?(?:occup|enter|live)|\bhabitable\b|\blike new\b|\b(?:all|any) (?:odou?r|smell|staining|stains?) (?:is|are|will be) (?:completely |fully )?removed/i
const CEILING_MENTION = /\bceilings?\b/i
const VAGUE_METHOD = /\b(?:appropriate|suitable|relevant|necessary|required|as needed|approved|proper)\s+(?:methods?|treatments?|products?|chemicals?|cleaning|measures?|steps?|solutions?)\b/i
const NAMED_METHOD = /\b(?:hepa|vacuum|scrape|scraping|scrub|scrubbing|degreas|detergent|alkaline|enzymatic|enzyme|surfactant|neutral|wipe|wiping|wash|washing|wet[- ]?mop|damp[- ]?wipe|steam|pressure|hospital[- ]?grade|tga[- ]?registered|disinfect|sanitis|antimicrobial|thermal fog|fogging|odour counteractant|hydroxyl|ozone|encapsul|primer|seal(?:er|ing)?|bag(?:ging)?|double[- ]?bag|as\/nzs|ppe|respirator|p2|contain(?:ment)?|barrier|negative air)\b/i
const PASS_CRITERIA = /\b(?:no visible|free (?:of|from) visible|no detectable|no remaining|clean to sight|visual(?:ly)? (?:clean|free|inspect)|olfactory|odour check|free of residue|no residue|no staining)\b/i

const MAX_LINES = 14
const MIN_LINES = 3
const MAX_LINE_LENGTH = 450
const MIN_PART = 3

export const SURFACE_AREA_DRAFT_STAGES = [
  'setup',
  'preparation',
  'cleaning',
  'disinfection',
  'deodorisation',
  'verification',
  'waste',
] as const

export type SurfaceAreaDraftStage = (typeof SURFACE_AREA_DRAFT_STAGES)[number]
export type SurfaceAreaDraftGap = 'where' | 'what' | 'how' | 'pass' | 'basis'
export type SurfaceAreaDraftDropReason = 'service' | 'money' | 'timeframe' | 'guarantee' | 'ceiling_excluded'

export const SURFACE_AREA_DRAFT_GAP_LABELS: Record<SurfaceAreaDraftGap, string> = {
  where: 'where the work is done (rooms or surfaces)',
  what: 'what is cleaned, removed, or treated',
  how: 'a named method, product type, or standard',
  pass: 'observable pass criteria for verification',
  basis: 'how it ties back to the presentation or objective',
}

export const SURFACE_AREA_DRAFT_DROP_LABELS: Record<SurfaceAreaDraftDropReason, string> = {
  service: 'mentions hygienist or testing (added by code when ticked)',
  money: 'states a price or rate',
  timeframe: 'states a timeframe',
  guarantee: 'promises an outcome',
  ceiling_excluded: 'includes ceiling work while ceilings are excluded',
}

export interface SurfaceAreaDraftWeakStep {
  line: string
  gap: SurfaceAreaDraftGap
}

export interface SurfaceAreaDraftDroppedLine {
  line: string
  reason: SurfaceAreaDraftDropReason
}

export interface SurfaceAreaScopeDraft {
  scope: string
  weak: SurfaceAreaDraftWeakStep[]
  dropped: SurfaceAreaDraftDroppedLine[]
}

export function hasSurfaceAreaScopeInputs(capture: Pick<SurfaceAreaCleaningCapture, 'presentation' | 'objective'>): boolean {
  return capture.presentation.trim().length > 0 || capture.objective.trim().length > 0
}

/** What the model reads to draft the scope of work. No client PII and no prices. */
export function surfaceAreaScopeDraftPayload(
  capture: SurfaceAreaCleaningCapture,
  standards?: SurfaceAreaCleaningStandards | null,
) {
  const rooms = (capture.rooms ?? [])
    .map(room => room.name.trim())
    .filter(Boolean)
  const otherItems = (capture.other_lines ?? [])
    .filter(line => line.title.trim())
    .map(line => ({
      title: line.title.trim(),
      ...(line.description.trim() ? { description: line.description.trim() } : {}),
    }))
  const exclusions = surfaceAreaClauseLines(
    withJobOnlyLines(standards?.exclusions ?? '', capture.job_exclusions),
  )
  if (capture.exclude_ceiling && !exclusions.some(line => /ceiling/i.test(line))) {
    exclusions.push('The ceiling.')
  }
  return {
    quote_title: surfaceAreaCleaningDocumentTitle(
      capture.cleaning_kind,
      capture.custom_title,
      capture.title_addition,
    ),
    presentation: capture.presentation.trim(),
    objective: capture.objective.trim(),
    surfaces_included: capture.exclude_ceiling
      ? 'floors and walls only (ceilings are excluded from this quote)'
      : 'floors, walls, and ceilings',
    ceilings_excluded: capture.exclude_ceiling,
    rooms,
    other_quoted_items: otherItems,
    exclusions,
  }
}

/** Strict JSON schema enforcing stage taxonomy, presentation/objective grounding, and auditable fields. */
export function surfaceAreaScopeDraftSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stage: { type: 'string', enum: [...SURFACE_AREA_DRAFT_STAGES] },
            text: { type: 'string' },
            addresses: { type: 'string', enum: ['presentation', 'objective', 'both'] },
            basis: { type: 'string' },
            where: { type: 'string' },
            what: { type: 'string' },
            how: { type: 'string' },
            pass: { type: 'string' },
          },
          required: ['stage', 'text', 'addresses', 'basis', 'where', 'what', 'how', 'pass'],
        },
      },
    },
    required: ['steps'],
  } as const
}

export const SURFACE_AREA_SCOPE_DRAFT_SYSTEM = `You draft the scope of work for an Australian surface area cleaning, gross filth/squalor, or estate cleaning quote.

Your primary source of truth is PRESENTATION (how the property presents and what contamination or conditions were found) and OBJECTIVE (the outcome this cleaning is meant to achieve). Every step you write MUST be grounded directly in PRESENTATION and OBJECTIVE, bounded by ROOMS, SURFACES_INCLUDED, OTHER_QUOTED_ITEMS, and EXCLUSIONS.

Return the scope as an ordered list of steps, in the sequence the work is carried out. For every step:
- stage: one of setup, preparation, cleaning, disinfection, deodorisation, verification, waste.
- text: the step as it will print on the quote. Plain Australian English, 1–2 short sentences, written as an operational instruction. No numbering and no bullet prefixes.
- addresses: whether this step directly addresses PRESENTATION ("presentation"), OBJECTIVE ("objective"), or both ("both").
- basis: a short phrase naming the exact condition from PRESENTATION or outcome from OBJECTIVE that requires this step.
- where: the exact words copied from text naming which rooms or surfaces are treated.
- what: the exact words copied from text naming what soil, residue, contamination, odour, or surface is cleaned or treated.
- how: the exact words copied from text naming the specific method, product type, or standard (for example HEPA vacuuming, scraping loose residue, washing with an alkaline/enzymatic detergent, wiping with a TGA-registered hospital-grade disinfectant, thermal fogging with an odour counteractant, running hydroxyl generators, or applying an odour-blocking encapsulant/sealer). "Appropriate products" or "suitable methods" is not a method.
- pass: for verification steps, the exact words copied from text stating observable on-site pass criteria (for example no visible residue, soil, or staining on treated surfaces and no detectable odour from them). "" for non-verification steps.

If you cannot fill where, what, or how verbatim from text, rewrite text until you can.

Rules:
- Rely on PRESENTATION and OBJECTIVE: address every contaminant, residue, pest/insect vector, odour source, and target condition mentioned in PRESENTATION and OBJECTIVE (for example cockroach/rodent faeces, sebum, fly/insect cross-contamination, decomposition odour, preparing surfaces for restoration/structural works) without inventing hazards that are not present.
- Respect SURFACES_INCLUDED and CEILINGS_EXCLUDED: if ceilings_excluded is true, DO NOT include ceilings in any step (treat floors and walls only). If ceilings_excluded is false and PRESENTATION or SURFACES_INCLUDED covers ceilings, include ceilings where relevant.
- Name the ROOMS listed on the quote where applicable. If ROOMS is empty, refer to the quoted rooms/surfaces cleanly without inventing room names.
- Respect EXCLUSIONS strictly: never include contents clearance/removal, structural demolition, repairs, rebuilding, or restoration works unless explicitly listed in OTHER_QUOTED_ITEMS. Only include bagging/disposal of cleaning consumables and surface debris/gross filth loosened during surface cleaning.
- Include deodorisation steps when odour, squalor, filth, decomposition, faeces, urine, or hoarding is described in PRESENTATION or OBJECTIVE; name the actual method and product type.
- Do not write about a Certified Occupational Hygienist (COH), Remediation Action Plan (RAP), ATP testing, laboratory testing, or completion reports. Those lines are added separately by code when ticked.
- Do not state prices, rates, dollar amounts, labour days, timeframes, or guarantees ("safe to occupy", "100% odour-free", "habitable", "will pass"). State observable cleaning and inspection outcomes only.`

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function cleanLine(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function dropReason(line: string, excludeCeiling: boolean): SurfaceAreaDraftDropReason | null {
  if (SERVICE_LINE.test(line)) return 'service'
  if (MONEY.test(line)) return 'money'
  if (TIMEFRAME.test(line)) return 'timeframe'
  if (GUARANTEE.test(line)) return 'guarantee'
  if (excludeCeiling && CEILING_MENTION.test(line)) return 'ceiling_excluded'
  return null
}

/**
 * Validate and clean the model's structured JSON draft.
 * Returns null if fewer than MIN_LINES usable steps remain.
 */
export function acceptSurfaceAreaScopeDraft(
  parsed: unknown,
  opts: { excludeCeiling?: boolean } = {},
): SurfaceAreaScopeDraft | null {
  const raw = parsed && typeof parsed === 'object' ? (parsed as { steps?: unknown }).steps : null
  if (!Array.isArray(raw)) return null
  const excludeCeiling = opts.excludeCeiling === true
  const lines: string[] = []
  const seen = new Set<string>()
  const weak: SurfaceAreaDraftWeakStep[] = []
  const dropped: SurfaceAreaDraftDroppedLine[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const step = item as Record<string, unknown>
    const text = cleanLine(step.text)
    if (!text || text.length > MAX_LINE_LENGTH) continue

    const reason = dropReason(text, excludeCeiling)
    if (reason) {
      dropped.push({ line: text, reason })
      continue
    }

    const key = normalize(text)
    if (!key || seen.has(key) || lines.length >= MAX_LINES) continue
    seen.add(key)
    lines.push(text)

    const partOf = (field: string) => cleanLine(step[field])
    const says = (field: string) => {
      const part = partOf(field)
      return part.length >= MIN_PART && key.includes(normalize(part))
    }
    const how = partOf('how')
    const howIsVague = VAGUE_METHOD.test(how || text) && !NAMED_METHOD.test(how || text)
    const basis = partOf('basis')

    const gaps: SurfaceAreaDraftGap[] = ['where', 'what', 'how']
    if (step.stage === 'verification' && !PASS_CRITERIA.test(text)) gaps.push('pass')
    if (basis.length < MIN_PART) gaps.push('basis')

    const gap = gaps.find(field => {
      if (field === 'basis') return basis.length < MIN_PART
      if (field === 'how') return !says('how') || howIsVague
      return !says(field)
    })
    if (gap) weak.push({ line: text, gap })
  }

  if (lines.length < MIN_LINES) return null
  return {
    scope: lines.join('\n'),
    weak,
    dropped,
  }
}
