/**
 * Contents Clearance Quote.
 * The job supplies the client, the address, the estimated quantities, and the rates.
 * The labour-day rule and the fixed sections live here.
 * A blank rate falls back to the schema. Rates are ex GST.
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

export interface ContentsClearanceStandards {
  /** One inclusion per line. */
  inclusions: string
  /** One exclusion per line. */
  exclusions: string
  /** One assumption per line. */
  assumptions: string
  payment_terms: string
}

export interface ContentsClearanceCapture {
  estimated_m3: number | null
  /** Kept for quotes saved before return trips. */
  estimated_km: number | null
  /** Ex GST. Blank uses the schema rate. */
  rate_per_m3: number | null
  rate_per_km: number | null
  rate_per_labour_day: number | null
  /** Null follows the job site address. */
  job_address: string | null
  job_lat: number | null
  job_lng: number | null
  tip_address: string
  tip_lat: number | null
  tip_lng: number | null
  return_trip_km: number | null
  /** True when return_trip_km came from a driving lookup. */
  return_trip_from_maps: boolean
  return_trips: number | null
  disposal_rate_per_tonne: number | null
  estimated_tonnes: number | null
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
  return_trip_km: number
  return_trips: number
  estimated_tonnes: number
  disposal_rate_per_tonne: number
  disposal_amount: number
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
  job_address: string
  tip_address: string
  estimated_m3: number
  estimated_km: number
  return_trip_km: number
  return_trips: number
  estimated_tonnes: number
  disposal_rate_per_tonne: number
  disposal_amount: number
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
  return {
    estimated_m3: null,
    estimated_km: null,
    rate_per_m3: null,
    rate_per_km: null,
    rate_per_labour_day: null,
    job_address: null,
    job_lat: null,
    job_lng: null,
    tip_address: '',
    tip_lat: null,
    tip_lng: null,
    return_trip_km: null,
    return_trip_from_maps: false,
    return_trips: null,
    disposal_rate_per_tonne: null,
    estimated_tonnes: null,
  }
}

export function defaultContentsClearanceStandards(): ContentsClearanceStandards {
  return {
    inclusions: CONTENTS_CLEARANCE_SCHEMA.inclusions.join('\n'),
    exclusions: CONTENTS_CLEARANCE_SCHEMA.exclusions.join('\n'),
    assumptions: CONTENTS_CLEARANCE_SCHEMA.assumptions.join('\n'),
    payment_terms: CONTENTS_CLEARANCE_SCHEMA.terms,
  }
}

export function clauseLines(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

export function normalizeContentsClearanceStandards(raw: unknown): ContentsClearanceStandards {
  const fallback = defaultContentsClearanceStandards()
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const text = (key: keyof ContentsClearanceStandards) =>
    typeof o[key] === 'string' ? o[key] : fallback[key]
  return {
    inclusions: text('inclusions'),
    exclusions: text('exclusions'),
    assumptions: text('assumptions'),
    payment_terms: text('payment_terms'),
  }
}

export function normalizeContentsClearanceCapture(raw: unknown): ContentsClearanceCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const qty = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const coord = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : null
  }
  return {
    estimated_m3: qty(o.estimated_m3),
    estimated_km: qty(o.estimated_km),
    rate_per_m3: qty(o.rate_per_m3),
    rate_per_km: qty(o.rate_per_km),
    rate_per_labour_day: qty(o.rate_per_labour_day),
    job_address: typeof o.job_address === 'string' ? o.job_address : null,
    job_lat: coord(o.job_lat),
    job_lng: coord(o.job_lng),
    tip_address: typeof o.tip_address === 'string' ? o.tip_address : '',
    tip_lat: coord(o.tip_lat),
    tip_lng: coord(o.tip_lng),
    return_trip_km: qty(o.return_trip_km),
    return_trip_from_maps: o.return_trip_from_maps === true,
    return_trips: qty(o.return_trips),
    disposal_rate_per_tonne: qty(o.disposal_rate_per_tonne),
    estimated_tonnes: qty(o.estimated_tonnes),
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
  trip: {
    returnTripKm?: number | null
    returnTrips?: number | null
    tonnes?: number | null
    ratePerTonne?: number | null
  } = {},
): ContentsClearanceFigures {
  const estimated_m3 = round2(quantityOrZero(m3))
  const return_trip_km = round2(quantityOrZero(trip.returnTripKm))
  const return_trips = round2(quantityOrZero(trip.returnTrips))
  const fromTrips = return_trip_km > 0 || return_trips > 0
  const estimated_km = fromTrips ? round2(return_trip_km * return_trips) : round2(quantityOrZero(km))
  const estimated_tonnes = round2(quantityOrZero(trip.tonnes))
  const disposal_rate_per_tonne = round2(quantityOrZero(trip.ratePerTonne))
  const disposal_amount = round2(estimated_tonnes * disposal_rate_per_tonne)
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
  if (estimated_tonnes > 0 || disposal_rate_per_tonne > 0) {
    lines.push({
      label: 'Disposal',
      quantity: estimated_tonnes,
      unit: estimated_tonnes === 1 ? 'tonne' : 'tonnes',
      rate: disposal_rate_per_tonne,
      amount: disposal_amount,
    })
  }
  const subtotal = round2(lines.reduce((sum, line) => sum + line.amount, 0))
  const gst = round2(subtotal * 0.1)
  return {
    estimated_m3,
    estimated_km,
    return_trip_km,
    return_trips,
    estimated_tonnes,
    disposal_rate_per_tonne,
    disposal_amount,
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
  capture: ContentsClearanceCapture
  standards?: ContentsClearanceStandards | null
}): ContentsClearanceQuoteContent {
  const capture = input.capture
  const standards = normalizeContentsClearanceStandards(input.standards ?? null)
  const figures = contentsClearanceFigures(capture.estimated_m3, capture.estimated_km, {
    ratePerM3: capture.rate_per_m3 ?? CONTENTS_CLEARANCE_SCHEMA.ratePerM3,
    ratePerKm: capture.rate_per_km ?? CONTENTS_CLEARANCE_SCHEMA.ratePerKm,
    ratePerLabourDay: capture.rate_per_labour_day ?? CONTENTS_CLEARANCE_SCHEMA.ratePerLabourDay,
    m3PerLabourDay: CONTENTS_CLEARANCE_SCHEMA.m3PerLabourDay,
  }, {
    returnTripKm: capture.return_trip_km,
    returnTrips: capture.return_trips,
    tonnes: capture.estimated_tonnes,
    ratePerTonne: capture.disposal_rate_per_tonne,
  })
  const contents = figures.lines.find(line => line.label === 'Contents')
  const distance = figures.lines.find(line => line.label === 'Distance')
  const labour = figures.lines.find(line => line.label === 'Labour')
  const jobAddress = (capture.job_address ?? input.siteAddress).trim()
  return {
    title: 'Contents Clearance Quote',
    reference: input.reference,
    client_name: input.clientName.trim(),
    site_address: jobAddress,
    job_address: jobAddress,
    tip_address: capture.tip_address.trim(),
    estimated_m3: figures.estimated_m3,
    estimated_km: figures.estimated_km,
    return_trip_km: figures.return_trip_km,
    return_trips: figures.return_trips,
    estimated_tonnes: figures.estimated_tonnes,
    disposal_rate_per_tonne: figures.disposal_rate_per_tonne,
    disposal_amount: figures.disposal_amount,
    labour_days: figures.labour_days,
    m3_per_labour_day: figures.m3_per_labour_day,
    rate_per_m3: figures.rate_per_m3,
    rate_per_km: figures.rate_per_km,
    rate_per_labour_day: figures.rate_per_labour_day,
    volume_amount: contents?.amount ?? 0,
    distance_amount: distance?.amount ?? 0,
    labour_amount: labour?.amount ?? 0,
    subtotal: figures.subtotal,
    gst: figures.gst,
    total: figures.total,
    inclusions: clauseLines(standards.inclusions),
    exclusions: clauseLines(standards.exclusions),
    assumptions: clauseLines(standards.assumptions),
    terms: standards.payment_terms.trim(),
    authority: CONTENTS_CLEARANCE_SCHEMA.authority,
    acceptance: CONTENTS_CLEARANCE_SCHEMA.acceptance,
  }
}
