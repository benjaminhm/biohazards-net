/**
 * Surface Area Cleaning Quote.
 * The job supplies the client, the address, the estimated square metres, and the rates.
 * Labour days are the agreed quantity. Rates are ex GST.
 */

export const SURFACE_AREA_CLIENT_TITLES = [
  { id: 'surface', title: 'Surface Area Cleaning' },
  { id: 'squalor', title: 'Gross Filth and Squalor' },
] as const

export type SurfaceAreaCleaningKind = (typeof SURFACE_AREA_CLIENT_TITLES)[number]['id']

export const SURFACE_AREA_SCHEMA = {
  ratePerM2: 0,
  ratePerLabourDay: 0,
  inclusions: [
    'Surface cleaning of the estimated area at the rate per square metre on this quote.',
    'Labour for the labour days on this quote, as a fixed amount.',
  ],
  exclusions: [
    'Contents removal and disposal.',
    'Repairs, rebuilding, and restoration.',
    'Work other than the surface cleaning and the labour days on this quote.',
  ],
  assumptions: [
    'Square metres are an estimate of the area. The measured area replaces that estimate, at the rate per square metre on this quote.',
    'The labour days on this quote are the labour for this cleaning.',
  ],
  terms:
    'A deposit of 50% of this estimate is requested before the cleaning starts. The balance is the measured square metres at the rate on this quote, plus the labour amount on this quote. GST is 10%.',
  authority:
    'Acceptance authorises surface cleaning at the address on this quote, at the rates shown.',
  acceptance:
    'I accept this surface cleaning quote and the quantities, rates, and terms on this page.',
} as const

export const SURFACE_AREA_LABOUR_NOTE =
  'A labour day = 1 person onsite for 1 day. (It does not = estimate days onsite. It does not = number of people onsite per day).'

export interface SurfaceAreaCleaningStandards {
  inclusions: string
  exclusions: string
  assumptions: string
  payment_terms: string
  engagement_agreement: string
}

export interface SurfaceAreaCleaningCapture {
  cleaning_kind: SurfaceAreaCleaningKind
  estimated_m2: number | null
  /** Labour days the client is buying. Required before the quote is generated. */
  labour_days: number | null
  /** Ex GST. Blank uses the schema rate. */
  rate_per_m2: number | null
  rate_per_labour_day: number | null
  /** Null follows the job site address. */
  job_address: string | null
  /** Ex GST. Attendance and setup. Blank or zero stays off the quote. */
  mobilisation_fee: number | null
}

export interface SurfaceAreaCleaningLine {
  label: string
  quantity: number
  unit: string
  rate: number
  amount: number
}

export interface SurfaceAreaCleaningFigures {
  estimated_m2: number
  mobilisation_fee: number
  labour_days: number
  rate_per_m2: number
  rate_per_labour_day: number
  lines: SurfaceAreaCleaningLine[]
  area_amount: number
  labour_amount: number
  subtotal: number
  gst: number
  total: number
}

export interface SurfaceAreaCleaningQuoteContent {
  title: string
  reference: string
  client_name: string
  site_address: string
  job_address: string
  estimated_m2: number
  rate_per_m2: number
  area_amount: number
  labour_days: number
  rate_per_labour_day: number
  labour_amount: number
  mobilisation_fee: number
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

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function quantityOrZero(value: number | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function surfaceAreaCleaningDocumentTitle(kind: string | null | undefined): string {
  return SURFACE_AREA_CLIENT_TITLES.find(option => option.id === kind)?.title
    ?? SURFACE_AREA_CLIENT_TITLES[0].title
}

export function emptySurfaceAreaCleaningCapture(): SurfaceAreaCleaningCapture {
  return {
    cleaning_kind: 'surface',
    estimated_m2: null,
    labour_days: null,
    rate_per_m2: null,
    rate_per_labour_day: null,
    job_address: null,
    mobilisation_fee: null,
  }
}

export function defaultSurfaceAreaCleaningStandards(): SurfaceAreaCleaningStandards {
  return {
    inclusions: SURFACE_AREA_SCHEMA.inclusions.join('\n'),
    exclusions: SURFACE_AREA_SCHEMA.exclusions.join('\n'),
    assumptions: SURFACE_AREA_SCHEMA.assumptions.join('\n'),
    payment_terms: SURFACE_AREA_SCHEMA.terms,
    engagement_agreement: '',
  }
}

export function surfaceAreaClauseLines(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

export function normalizeSurfaceAreaCleaningStandards(raw: unknown): SurfaceAreaCleaningStandards {
  const fallback = defaultSurfaceAreaCleaningStandards()
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const text = (key: keyof SurfaceAreaCleaningStandards) =>
    typeof o[key] === 'string' ? o[key] : fallback[key]
  return {
    inclusions: text('inclusions'),
    exclusions: text('exclusions'),
    assumptions: text('assumptions'),
    payment_terms: text('payment_terms'),
    engagement_agreement: text('engagement_agreement'),
  }
}

export function normalizeSurfaceAreaCleaningCapture(raw: unknown): SurfaceAreaCleaningCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const qty = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const kind = SURFACE_AREA_CLIENT_TITLES.some(option => option.id === o.cleaning_kind)
    ? o.cleaning_kind as SurfaceAreaCleaningKind
    : 'surface'
  return {
    cleaning_kind: kind,
    estimated_m2: qty(o.estimated_m2),
    labour_days: qty(o.labour_days),
    rate_per_m2: qty(o.rate_per_m2),
    rate_per_labour_day: qty(o.rate_per_labour_day),
    job_address: typeof o.job_address === 'string' ? o.job_address : null,
    mobilisation_fee: qty(o.mobilisation_fee),
  }
}

export function surfaceAreaCleaningFigures(
  m2: number | null | undefined,
  schema: { ratePerM2: number; ratePerLabourDay: number } = SURFACE_AREA_SCHEMA,
  extras: { labourDays?: number | null; mobilisationFee?: number | null } = {},
): SurfaceAreaCleaningFigures {
  const estimated_m2 = round2(quantityOrZero(m2))
  const mobilisation_fee = round2(quantityOrZero(extras.mobilisationFee))
  const labour_days = Math.round(quantityOrZero(extras.labourDays))
  const rate_per_m2 = schema.ratePerM2
  const rate_per_labour_day = schema.ratePerLabourDay
  const area_amount = round2(estimated_m2 * rate_per_m2)
  const labour_amount = round2(labour_days * rate_per_labour_day)
  const lines: SurfaceAreaCleaningLine[] = [
    { label: 'Surface area', quantity: estimated_m2, unit: 'm²', rate: rate_per_m2, amount: area_amount },
  ]
  if (mobilisation_fee > 0) {
    lines.push({ label: 'Mobilisation', quantity: 1, unit: 'fee', rate: mobilisation_fee, amount: mobilisation_fee })
  }
  lines.push({
    label: 'Labour',
    quantity: labour_days,
    unit: labour_days === 1 ? 'labour day' : 'labour days',
    rate: rate_per_labour_day,
    amount: labour_amount,
  })
  const subtotal = round2(lines.reduce((sum, line) => sum + line.amount, 0))
  const gst = round2(subtotal * 0.1)
  return {
    estimated_m2,
    mobilisation_fee,
    labour_days,
    rate_per_m2,
    rate_per_labour_day,
    lines,
    area_amount,
    labour_amount,
    subtotal,
    gst,
    total: round2(subtotal + gst),
  }
}

export function surfaceAreaCleaningQuoteContent(input: {
  reference: string
  clientName: string
  siteAddress: string
  capture: SurfaceAreaCleaningCapture
  standards?: SurfaceAreaCleaningStandards | null
}): SurfaceAreaCleaningQuoteContent {
  const capture = input.capture
  const standards = normalizeSurfaceAreaCleaningStandards(input.standards ?? null)
  const figures = surfaceAreaCleaningFigures(capture.estimated_m2, {
    ratePerM2: capture.rate_per_m2 ?? SURFACE_AREA_SCHEMA.ratePerM2,
    ratePerLabourDay: capture.rate_per_labour_day ?? SURFACE_AREA_SCHEMA.ratePerLabourDay,
  }, {
    labourDays: capture.labour_days,
    mobilisationFee: capture.mobilisation_fee,
  })
  const jobAddress = (capture.job_address ?? input.siteAddress).trim()
  return {
    title: surfaceAreaCleaningDocumentTitle(capture.cleaning_kind),
    reference: input.reference,
    client_name: input.clientName.trim(),
    site_address: jobAddress,
    job_address: jobAddress,
    estimated_m2: figures.estimated_m2,
    rate_per_m2: figures.rate_per_m2,
    area_amount: figures.area_amount,
    labour_days: figures.labour_days,
    rate_per_labour_day: figures.rate_per_labour_day,
    labour_amount: figures.labour_amount,
    mobilisation_fee: figures.mobilisation_fee,
    subtotal: figures.subtotal,
    gst: figures.gst,
    total: figures.total,
    inclusions: surfaceAreaClauseLines(standards.inclusions),
    exclusions: surfaceAreaClauseLines(standards.exclusions),
    assumptions: surfaceAreaClauseLines(standards.assumptions),
    terms: standards.payment_terms.trim(),
    engagement_agreement: standards.engagement_agreement.trim(),
    authority: SURFACE_AREA_SCHEMA.authority,
    acceptance: SURFACE_AREA_SCHEMA.acceptance,
  }
}
