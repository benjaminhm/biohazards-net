/**
 * Contents Clearance Quote.
 * The job supplies the client, the address, and two estimated quantities.
 * Rates, the labour-day rule, and the fixed sections live here.
 * Rates are ex GST. Set them here to change every newly generated quote.
 */

const M3_PER_LABOUR_DAY = 6

export const CONTENTS_CLEARANCE_SCHEMA = {
  /** Ex GST. */
  ratePerM3: 0,
  /** Ex GST. */
  ratePerKm: 0,
  /** Ex GST. One labour day is `m3PerLabourDay` cubic metres. */
  ratePerLabourDay: 0,
  m3PerLabourDay: M3_PER_LABOUR_DAY,
  inclusions: [
    'Contents clearance of the stated volume at the standard rate per cubic metre.',
    'Travel at the standard rate per kilometre.',
    `Labour at one day for every ${M3_PER_LABOUR_DAY} cubic metres, at the standard daily rate.`,
  ],
  exclusions: [
    'Surface cleaning, sanitising, and remediation.',
    'Repairs, rebuilding, and restoration of contents.',
    'Work beyond the quantities on this quote.',
  ],
  assumptions: [
    `Cubic metres are an estimate. The measured volume replaces the estimate, and labour days are that volume divided by ${M3_PER_LABOUR_DAY}.`,
    'Kilometres are an estimate of the travel for this clearance.',
    'The technician decides on site how the contents leave the property.',
  ],
  terms:
    'A deposit of 50% of this estimate is requested before the clearance starts. The balance is the measured cubic metres, the kilometres, and the labour days that follow the measured volume, at the rates on this quote. GST is 10%.',
  authority:
    'Acceptance authorises contents clearance at the address on this quote, at the rates shown.',
  acceptance:
    'I accept this contents clearance quote and the quantities, rates, and terms on this page.',
} as const

export interface ContentsClearanceCapture {
  estimated_m3: number | null
  estimated_km: number | null
}

export interface ContentsClearanceLine {
  label: string
  quantity: number
  unit: string
  rate: number
  amount: number
}

export interface ContentsClearanceFigures {
  estimated_m3: number
  estimated_km: number
  labour_days: number
  m3_per_labour_day: number
  rate_per_m3: number
  rate_per_km: number
  rate_per_labour_day: number
  lines: ContentsClearanceLine[]
  subtotal: number
  gst: number
  total: number
}

export interface ContentsClearanceQuoteContent {
  title: string
  reference: string
  client_name: string
  site_address: string
  estimated_m3: number
  estimated_km: number
  labour_days: number
  m3_per_labour_day: number
  rate_per_m3: number
  rate_per_km: number
  rate_per_labour_day: number
  volume_amount: number
  distance_amount: number
  labour_amount: number
  subtotal: number
  gst: number
  total: number
  inclusions: string[]
  exclusions: string[]
  assumptions: string[]
  terms: string
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

export function emptyContentsClearanceCapture(): ContentsClearanceCapture {
  return { estimated_m3: null, estimated_km: null }
}

export function normalizeContentsClearanceCapture(raw: unknown): ContentsClearanceCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const qty = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return {
    estimated_m3: qty(o.estimated_m3),
    estimated_km: qty(o.estimated_km),
  }
}

/** Labour days are the cubic metres divided by the standard volume per day. */
export function contentsClearanceFigures(
  m3: number | null | undefined,
  km: number | null | undefined,
  schema: {
    ratePerM3: number
    ratePerKm: number
    ratePerLabourDay: number
    m3PerLabourDay: number
  } = CONTENTS_CLEARANCE_SCHEMA,
): ContentsClearanceFigures {
  const estimated_m3 = round2(quantityOrZero(m3))
  const estimated_km = round2(quantityOrZero(km))
  const perDay = schema.m3PerLabourDay > 0 ? schema.m3PerLabourDay : 6
  const labour_days = round2(estimated_m3 / perDay)
  const lines: ContentsClearanceLine[] = [
    {
      label: 'Contents',
      quantity: estimated_m3,
      unit: 'm³',
      rate: schema.ratePerM3,
      amount: round2(estimated_m3 * schema.ratePerM3),
    },
    {
      label: 'Distance',
      quantity: estimated_km,
      unit: 'km',
      rate: schema.ratePerKm,
      amount: round2(estimated_km * schema.ratePerKm),
    },
    {
      label: 'Labour',
      quantity: labour_days,
      unit: labour_days === 1 ? 'day' : 'days',
      rate: schema.ratePerLabourDay,
      amount: round2(labour_days * schema.ratePerLabourDay),
    },
  ]
  const subtotal = round2(lines.reduce((sum, line) => sum + line.amount, 0))
  const gst = round2(subtotal * 0.1)
  return {
    estimated_m3,
    estimated_km,
    labour_days,
    m3_per_labour_day: perDay,
    rate_per_m3: schema.ratePerM3,
    rate_per_km: schema.ratePerKm,
    rate_per_labour_day: schema.ratePerLabourDay,
    lines,
    subtotal,
    gst,
    total: round2(subtotal + gst),
  }
}

export function contentsClearanceQuoteContent(input: {
  reference: string
  clientName: string
  siteAddress: string
  m3: number | null | undefined
  km: number | null | undefined
}): ContentsClearanceQuoteContent {
  const figures = contentsClearanceFigures(input.m3, input.km)
  const [contents, distance, labour] = figures.lines
  return {
    title: 'Contents Clearance Quote',
    reference: input.reference,
    client_name: input.clientName.trim(),
    site_address: input.siteAddress.trim(),
    estimated_m3: figures.estimated_m3,
    estimated_km: figures.estimated_km,
    labour_days: figures.labour_days,
    m3_per_labour_day: figures.m3_per_labour_day,
    rate_per_m3: figures.rate_per_m3,
    rate_per_km: figures.rate_per_km,
    rate_per_labour_day: figures.rate_per_labour_day,
    volume_amount: contents.amount,
    distance_amount: distance.amount,
    labour_amount: labour.amount,
    subtotal: figures.subtotal,
    gst: figures.gst,
    total: figures.total,
    inclusions: [...CONTENTS_CLEARANCE_SCHEMA.inclusions],
    exclusions: [...CONTENTS_CLEARANCE_SCHEMA.exclusions],
    assumptions: [...CONTENTS_CLEARANCE_SCHEMA.assumptions],
    terms: CONTENTS_CLEARANCE_SCHEMA.terms,
    authority: CONTENTS_CLEARANCE_SCHEMA.authority,
    acceptance: CONTENTS_CLEARANCE_SCHEMA.acceptance,
  }
}
