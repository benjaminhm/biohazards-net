/**
 * Staff-only check: do the clearance clauses contradict the figures?
 * The result is a list of codes. The wording on screen is fixed here.
 * Nothing in this module is written onto the client document.
 */
import {
  wholeManDays,
  type ContentsClearanceFigures,
  type ContentsClearanceStandards,
} from '@/lib/contentsClearanceQuote'

export const CLEARANCE_FLAG_CODES = [
  'labour_tracks_volume',
  'man_day_wording',
  'rate_mismatch',
  'deposit_mismatch',
  'gst_mismatch',
] as const

export const CLEARANCE_FLAG_CLAUSES = [
  'inclusions',
  'exclusions',
  'assumptions',
  'payment_terms',
  'engagement_agreement',
] as const

export type ClearanceFlagCode = (typeof CLEARANCE_FLAG_CODES)[number]
export type ClearanceFlagClause = (typeof CLEARANCE_FLAG_CLAUSES)[number]

export interface ClearanceClauseFlag {
  code: ClearanceFlagCode
  clause: ClearanceFlagClause
}

export const CLEARANCE_FLAG_CLAUSE_LABEL: Record<ClearanceFlagClause, string> = {
  inclusions: 'Inclusions',
  exclusions: 'Exclusions',
  assumptions: 'Assumptions',
  payment_terms: 'Payment terms',
  engagement_agreement: 'Engagement agreement',
}

/** Fixed staff copy. The model is not allowed to supply this text. */
export const CLEARANCE_FLAG_TEXT: Record<ClearanceFlagCode, string> = {
  labour_tracks_volume: 'This clause says the labour days follow the measured volume. The labour days on the quote are the number typed on this page.',
  man_day_wording: 'This clause says man day. The quote says labour days.',
  rate_mismatch: 'This clause states a rate that is not a rate on the quote.',
  deposit_mismatch: 'This clause states a deposit that is not 50% of the total.',
  gst_mismatch: 'This clause states GST at a rate other than 10%.',
}

const DEPOSIT_PERCENT = 50
const GST_PERCENT = 10

/** Closed object. No free-text field, so the model cannot draft a replacement clause. */
export const CLEARANCE_FLAG_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    flags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string', enum: [...CLEARANCE_FLAG_CODES] },
          clause: { type: 'string', enum: [...CLEARANCE_FLAG_CLAUSES] },
        },
        required: ['code', 'clause'],
      },
    },
  },
  required: ['flags'],
} as const

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function plainClearanceClause(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function isCode(value: unknown): value is ClearanceFlagCode {
  return typeof value === 'string' && (CLEARANCE_FLAG_CODES as readonly string[]).includes(value)
}

function isClause(value: unknown): value is ClearanceFlagClause {
  return typeof value === 'string' && (CLEARANCE_FLAG_CLAUSES as readonly string[]).includes(value)
}

function quoteMoney(figures: ContentsClearanceFigures): number[] {
  return [
    figures.rate_per_m3,
    figures.rate_per_km,
    figures.rate_per_labour_day,
    figures.disposal_rate_per_tonne,
    figures.mobilisation_fee,
    figures.disposal_amount,
    figures.subtotal,
    figures.gst,
    figures.total,
    ...figures.lines.flatMap(line => [line.rate, line.amount]),
  ].filter(amount => amount > 0).map(round2)
}

function moneyMatches(amount: number, figures: ContentsClearanceFigures): boolean {
  return quoteMoney(figures).some(quoted => Math.abs(quoted - amount) < 0.011)
}

function parseAmount(whole: string, fraction?: string): number {
  const n = Number(fraction ? `${whole.replace(/,/g, '')}.${fraction}` : whole.replace(/,/g, ''))
  return Number.isFinite(n) ? round2(n) : 0
}

function dollarAmounts(text: string): number[] {
  const amounts: number[] = []
  const re = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g
  for (const match of text.matchAll(re)) {
    const amount = parseAmount(match[1], match[2])
    if (amount > 0) amounts.push(amount)
  }
  return amounts
}

function unitAmount(text: string, unit: string): number[] {
  const amounts: number[] = []
  const re = new RegExp(
    String.raw`(?:\$\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(?:per|a|\/)\s*(?:${unit})`,
    'gi',
  )
  for (const match of text.matchAll(re)) {
    const amount = parseAmount(match[1], match[2])
    if (amount > 0) amounts.push(amount)
  }
  return amounts
}

function percentBeside(text: string, label: string): number | null {
  const after = text.match(new RegExp(String.raw`${label}[^%\n]{0,40}?(\d+(?:\.\d+)?)\s*%`, 'i'))
  if (after) return Number(after[1])
  const before = text.match(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*%[^%\n]{0,40}?${label}`, 'i'))
  return before ? Number(before[1]) : null
}

function assertsLabourFromVolume(text: string): boolean {
  return /one (labour|man) day for every/i.test(text)
    || /(labour|man) days are that volume/i.test(text)
    || /(labour|man) days that follow the measured volume/i.test(text)
    || /(labour|man) days?\b[^.]{0,80}\b(divided by|follow the measured volume|for every)\b/i.test(text)
}

function statedLabourDivisor(text: string): number | null {
  const match = text.match(/every\s+(\d+(?:\.\d+)?)\s+cubic/i)
    ?? text.match(/divided by\s+(\d+(?:\.\d+)?)/i)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

function labourContradicts(text: string, figures: ContentsClearanceFigures): boolean {
  if (!assertsLabourFromVolume(text)) return false
  const paced = wholeManDays(figures.estimated_m3, figures.m3_per_labour_day)
  const divisor = statedLabourDivisor(text)
  const divisorDiffers = divisor != null && Math.abs(divisor - figures.m3_per_labour_day) > 0.001
  return figures.labour_days !== paced || divisorDiffers
}

function rateContradicts(text: string, figures: ContentsClearanceFigures): boolean {
  if (dollarAmounts(text).some(amount => !moneyMatches(amount, figures))) return true
  const checks: [string, number][] = [
    ['(?:person\\s+per\\s+)?(?:labour\\s+)?days?', figures.rate_per_labour_day],
    ['(?:cubic\\s+metres?|m³|m3)', figures.rate_per_m3],
    ['(?:kilometres?|km)\\b', figures.rate_per_km],
    ['tonnes?', figures.disposal_rate_per_tonne],
  ]
  return checks.some(([unit, rate]) => unitAmount(text, unit).some(amount => Math.abs(amount - rate) >= 0.011))
}

function pushFlag(flags: ClearanceClauseFlag[], code: ClearanceFlagCode, clause: ClearanceFlagClause) {
  if (flags.some(flag => flag.code === code && flag.clause === clause)) return
  flags.push({ code, clause })
}

/** Exact contradictions. The same inputs always return the same flags. */
export function clearanceClauseFlags(
  figures: ContentsClearanceFigures,
  standards: ContentsClearanceStandards,
): ClearanceClauseFlag[] {
  const flags: ClearanceClauseFlag[] = []
  for (const clause of CLEARANCE_FLAG_CLAUSES) {
    const text = plainClearanceClause(standards[clause] ?? '')
    if (!text) continue
    if (/\bman[\s-]?days?\b/i.test(text)) pushFlag(flags, 'man_day_wording', clause)
    if (labourContradicts(text, figures)) pushFlag(flags, 'labour_tracks_volume', clause)
    if (rateContradicts(text, figures)) pushFlag(flags, 'rate_mismatch', clause)
    const deposit = percentBeside(text, 'deposit')
    if (deposit != null && Math.abs(deposit - DEPOSIT_PERCENT) > 0.001) pushFlag(flags, 'deposit_mismatch', clause)
    const gst = percentBeside(text, 'gst')
    if (gst != null && Math.abs(gst - GST_PERCENT) > 0.001) pushFlag(flags, 'gst_mismatch', clause)
  }
  return flags
}

function modelLabourIsAboutVolume(text: string): boolean {
  return /\b(volume|cubic|divided|measured|follow|every|calculated|calculation|worked out)\b/i.test(text)
}

function modelRateHasNumber(text: string): boolean {
  return /\$\s*\d/.test(text) || /\d[\d,]*(?:\.\d+)?\s*(?:per|a|\/)\s+/i.test(text)
}

/**
 * Keep model flags that fit the schema and still contradict the figures.
 * Extra keys, unknown codes, and replacement wording are dropped.
 */
export function acceptModelFlags(
  raw: unknown,
  figures: ContentsClearanceFigures,
  standards: ContentsClearanceStandards,
): ClearanceClauseFlag[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { flags?: unknown }).flags)
    ? (raw as { flags: unknown[] }).flags
    : null
  if (!list) return []
  const flags: ClearanceClauseFlag[] = []
  const paced = wholeManDays(figures.estimated_m3, figures.m3_per_labour_day)
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const code = (item as { code?: unknown }).code
    const clause = (item as { clause?: unknown }).clause
    if (!isCode(code) || !isClause(clause)) continue
    const text = plainClearanceClause(standards[clause] ?? '')
    if (!text) continue
    if (code === 'man_day_wording' && !/\bman[\s-]?days?\b/i.test(text)) continue
    if (code === 'labour_tracks_volume' && (figures.labour_days === paced || !modelLabourIsAboutVolume(text))) continue
    if (code === 'rate_mismatch' && !modelRateHasNumber(text)) continue
    if (code === 'deposit_mismatch' && (!/\bdeposit\b/i.test(text) || !/\d/.test(text))) continue
    if (code === 'gst_mismatch' && (!/\bgst\b/i.test(text) || !/\d/.test(text))) continue
    pushFlag(flags, code, clause)
  }
  return flags
}

export function knownClearanceFlags(raw: unknown): ClearanceClauseFlag[] | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { flags?: unknown }).flags)) return null
  const flags: ClearanceClauseFlag[] = []
  for (const item of (raw as { flags: unknown[] }).flags) {
    if (!item || typeof item !== 'object') continue
    const code = (item as { code?: unknown }).code
    const clause = (item as { clause?: unknown }).clause
    if (!isCode(code) || !isClause(clause)) continue
    pushFlag(flags, code, clause)
  }
  return flags
}

export function mergeClearanceFlags(
  exact: ClearanceClauseFlag[],
  model: ClearanceClauseFlag[],
): ClearanceClauseFlag[] {
  const flags: ClearanceClauseFlag[] = []
  for (const flag of [...exact, ...model]) pushFlag(flags, flag.code, flag.clause)
  return flags
}
