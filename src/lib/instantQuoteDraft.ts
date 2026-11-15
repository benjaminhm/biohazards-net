/**
 * Wording draft for the Fast Quote (lib/instantQuote.ts).
 * The model writes the presentation, the scope of work and this job's inclusions, exclusions and assumptions
 * from the brief: what the client reported, written down by staff. The site has not been inspected, so the draft
 * attributes the facts to the client. It never sees or writes a price, and it is not sent the client's photos.
 * Staff read and edit the draft before a quote is generated.
 *
 * What comes back is checked here, in code: a line that states money, a timeframe or a guarantee is left out
 * and reported, and a line that repeats a standard line is dropped.
 *
 * See docs/ai-product-principles.md.
 */
import {
  INSTANT_QUOTE_SERVICES,
  instantQuoteStandardAssumptions,
  instantQuoteStandardExclusions,
  instantQuoteStandardInclusions,
  type InstantQuoteCapture,
} from '@/lib/instantQuote'

const MAX_LINE_LENGTH = 400
const MAX_PRESENTATION_LENGTH = 700
const MAX_SCOPE_LINES = 12
const MAX_CLAUSE_LINES = 8
const MIN_SCOPE_LINES = 2
export const INSTANT_QUOTE_BRIEF_MIN_CHARS = 20
export const INSTANT_QUOTE_BRIEF_MAX_CHARS = 4000

const MONEY = /\$\s?\d|\b\d[\d,.]*\s?(?:dollars?|aud)\b|\bper\s+(?:hour|day|m2|m²|m3|m³|square metre|cubic metre|tonne|kilometre|km)\b/i
const TIMEFRAME = /\b\d+(?:\.\d+)?\s*(?:-|to)?\s*(?:\d+\s*)?(?:hours?|hrs?|days?|weeks?|months?)\b|\b(?:same|next)[- ]day\b|\bwithin (?:a|one|two|three) (?:day|week)s?\b/i
const GUARANTEE = /\bguarant|\bwarrant|\b100\s?%|\bcertif|\bsafe (?:to|for) (?:re-?)?(?:occup|enter|live)|\bhabitable\b|\blike new\b|\b(?:all|any) (?:odou?r|smell|staining|stains?) (?:is|are|will be) (?:completely |fully )?removed/i

export type InstantDraftDropReason = 'money' | 'timeframe' | 'guarantee'

export const INSTANT_DRAFT_DROP_LABELS: Record<InstantDraftDropReason, string> = {
  money: 'states a price or rate',
  timeframe: 'states a timeframe',
  guarantee: 'promises an outcome',
}

export interface InstantQuoteDraft {
  presentation: string
  scope_of_work: string
  job_inclusions: string
  job_exclusions: string
  job_assumptions: string
  /** Lines the model wrote that were left out, and why. Shown to staff. */
  dropped: { line: string; reason: InstantDraftDropReason }[]
}

/** What the model reads. No client name, address, phone or price. */
export function instantQuoteDraftPayload(
  capture: Pick<InstantQuoteCapture, 'services' | 'brief'>,
  job: { job_type?: string | null; job_description?: string | null },
) {
  return {
    services: INSTANT_QUOTE_SERVICES.filter(service => capture.services.includes(service.id)).map(service => service.label),
    brief: capture.brief.trim().slice(0, INSTANT_QUOTE_BRIEF_MAX_CHARS),
    job_type: (job.job_type ?? '').replace(/_/g, ' '),
    job_description: (job.job_description ?? '').trim().slice(0, 2000),
    standard_lines_added_by_code: {
      inclusions: instantQuoteStandardInclusions(capture.services),
      exclusions: instantQuoteStandardExclusions(capture.services),
      assumptions: instantQuoteStandardAssumptions(),
    },
  }
}

export function instantQuoteDraftSchema() {
  const lines = { type: 'array', items: { type: 'string' } } as const
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      presentation: { type: 'string' },
      scope: lines,
      inclusions: lines,
      exclusions: lines,
      assumptions: lines,
    },
    required: ['presentation', 'scope', 'inclusions', 'exclusions', 'assumptions'],
  } as const
}

export const INSTANT_QUOTE_DRAFT_SYSTEM = `You draft the wording of a fixed-price quote for an Australian biohazard cleaning, contents clearance, and surface cleaning company.

A staff member sets the price. You never see it and never write one. The quote is a fixed price, so nothing is remeasured later: the words you write are the limit of what the company must do for that price. Write them so the company is protected and the client can see exactly what they are buying.

The company has not inspected the site and will not before the works start. Everything known about the job is what the client reported. Nothing in the BRIEF or the JOB_DESCRIPTION has been checked by the company.

You get SERVICES (what this quote sells), the BRIEF (what the client reported, written down by staff), the JOB_TYPE, a JOB_DESCRIPTION when there is one, and STANDARD_LINES_ADDED_BY_CODE.

Return:
- presentation: one short paragraph. What the job is, as the client reported it. Attribute it to the client, for example "The client reports…". Do not state anything about the site as a fact the company has seen. Neutral and factual.
- scope: the steps of the work, in the order it is done. One step per item, one or two short sentences, written as an instruction. Each step says where (the rooms, areas, or items, named as the BRIEF names them), what is removed, cleaned, or treated, and how (the method or the type of product).
- inclusions: what the price covers that is particular to this job.
- exclusions: what a client could reasonably expect but the BRIEF does not cover. For example other rooms, outdoor areas, sheds and garages, ceilings and roof spaces, under floor coverings, contents the client is keeping, pest treatment, odour treatment, repairs.
- assumptions: the reported facts the price relies on, taken from the BRIEF. For example the number of rooms, how full the property is, where the contamination is confined to. Write each one as reported, for example "The client reports the contamination is confined to the main bedroom."

Rules:
- Bound the scope. Only cover SERVICES, and only what the BRIEF says. Where the BRIEF is silent, do not assume it is included: write an exclusion or an assumption instead.
- Do not repeat or reword a line in STANDARD_LINES_ADDED_BY_CODE. Those are printed on every quote.
- Do not state prices, rates, quantities of money, dates, or how long the work takes.
- Do not promise an outcome that cannot be checked on site. No guarantee, no "safe to occupy", no "all odour removed". State the method and what will be visibly done.
- Name the method or the type of product in each cleaning step, for example "vacuum, then wet-mop with a neutral detergent" or "wipe with a hospital-grade disinfectant". "Appropriate products" and "appropriate methods" are not a method.
- Do not invent facts, rooms, measurements, or hazards that are not in the BRIEF or JOB_DESCRIPTION. Do not give a reason for an exclusion, such as "at the client's request", unless the BRIEF gives that reason.
- Do not restate in the assumptions that the site has not been inspected. A standard line already says it.
- Plain Australian English. No graphic detail. Do not name a person, and do not guess at what caused the situation.
- No numbering and no dot points inside an item.`

function cleanLine(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function plain(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function dropReason(line: string): InstantDraftDropReason | null {
  if (MONEY.test(line)) return 'money'
  if (TIMEFRAME.test(line)) return 'timeframe'
  if (GUARANTEE.test(line)) return 'guarantee'
  return null
}

/**
 * The model's draft as the fields staff edit. Null when there is too little scope to use.
 * `standard` is what code already prints, so a repeat of it is dropped without comment.
 */
export function acceptInstantQuoteDraft(
  parsed: unknown,
  standard: { inclusions: string[]; exclusions: string[]; assumptions: string[] },
): InstantQuoteDraft | null {
  const o = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  if (!o) return null
  const dropped: InstantQuoteDraft['dropped'] = []

  const list = (value: unknown, max: number, already: string[] = []): string[] => {
    const seen = new Set(already.map(plain))
    const out: string[] = []
    for (const item of Array.isArray(value) ? value : []) {
      const line = cleanLine(item)
      if (!line || line.length > MAX_LINE_LENGTH) continue
      const key = plain(line)
      if (!key || seen.has(key)) continue
      const reason = dropReason(line)
      if (reason) {
        dropped.push({ line, reason })
        continue
      }
      if (out.length >= max) continue
      seen.add(key)
      out.push(line)
    }
    return out
  }

  const scope = list(o.scope, MAX_SCOPE_LINES)
  if (scope.length < MIN_SCOPE_LINES) return null

  let presentation = cleanLine(o.presentation).slice(0, MAX_PRESENTATION_LENGTH)
  const presentationReason = presentation ? dropReason(presentation) : null
  if (presentationReason) {
    dropped.push({ line: presentation, reason: presentationReason })
    presentation = ''
  }

  return {
    presentation,
    scope_of_work: scope.join('\n'),
    job_inclusions: list(o.inclusions, MAX_CLAUSE_LINES, standard.inclusions).join('\n'),
    job_exclusions: list(o.exclusions, MAX_CLAUSE_LINES, standard.exclusions).join('\n'),
    job_assumptions: list(o.assumptions, MAX_CLAUSE_LINES, standard.assumptions).join('\n'),
    dropped,
  }
}
