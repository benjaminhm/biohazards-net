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
    'Square metres on this quote are an estimate. An accurate onsite measurement survey revises them, at the rate per square metre on this quote.',
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

export const SURFACE_AREA_ESTIMATE_NOTE =
  'This figure is an estimate. It will be revised with an accurate onsite measurement survey.'

/** Saved before the room estimate named the onsite survey. Replaced only when the text still matches. */
const PREVIOUS_SURFACE_AREA_ASSUMPTIONS =
  'Square metres are an estimate of the area. The measured area replaces that estimate, at the rate per square metre on this quote.\nThe labour days on this quote are the labour for this cleaning.'

/** Typical sizes shown as a reference. The quote page does not fill a room from this list. Height is 2.4 m except the garage. */
export const SURFACE_AREA_ROOM_PRESETS = [
  { id: 'bedroom', name: 'Bedroom', length_m: 3.5, width_m: 3, height_m: 2.4 },
  { id: 'main_bedroom', name: 'Main bedroom', length_m: 4, width_m: 3.6, height_m: 2.4 },
  { id: 'living', name: 'Living', length_m: 5, width_m: 4, height_m: 2.4 },
  { id: 'kitchen', name: 'Kitchen', length_m: 4, width_m: 3.2, height_m: 2.4 },
  { id: 'dining', name: 'Dining', length_m: 3.6, width_m: 3, height_m: 2.4 },
  { id: 'bathroom', name: 'Bathroom', length_m: 2.2, width_m: 1.8, height_m: 2.4 },
  { id: 'ensuite', name: 'Ensuite', length_m: 2.4, width_m: 1.6, height_m: 2.4 },
  { id: 'toilet', name: 'Toilet', length_m: 1.8, width_m: 0.9, height_m: 2.4 },
  { id: 'laundry', name: 'Laundry', length_m: 2.2, width_m: 1.8, height_m: 2.4 },
  { id: 'hall', name: 'Hall', length_m: 6, width_m: 1.2, height_m: 2.4 },
  { id: 'garage', name: 'Garage', length_m: 6, width_m: 3, height_m: 2.7 },
] as const

export interface SurfaceAreaRoom {
  id: string
  name: string
  length_m: number | null
  width_m: number | null
  height_m: number | null
}

export interface SurfaceAreaRoomMeasure {
  floor: number
  ceiling: number
  walls: number
  total: number
}

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
  /** When set, the fee is not charged and the reason is printed instead. */
  mobilisation_waived: boolean
  mobilisation_reason: string
  /** Rooms that make up the estimated square metres. Empty keeps the typed total. */
  rooms: SurfaceAreaRoom[]
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
  mobilisation_reason: string
  rooms: { name: string; detail: string; area_m2: number }[]
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

export function newSurfaceAreaRoomId(): string {
  return `room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function newSurfaceAreaRoom(): SurfaceAreaRoom {
  return {
    id: newSurfaceAreaRoomId(),
    name: '',
    length_m: null,
    width_m: null,
    height_m: null,
  }
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
    mobilisation_waived: false,
    mobilisation_reason: '',
    rooms: [],
  }
}

/** A rectangular room: floor and ceiling are length × width, walls are the perimeter × height. */
export function roomSurfaceArea(room: Pick<SurfaceAreaRoom, 'length_m' | 'width_m' | 'height_m'>): SurfaceAreaRoomMeasure | null {
  const length = room.length_m
  const width = room.width_m
  const height = room.height_m
  if (length == null || width == null || height == null || length <= 0 || width <= 0 || height <= 0) return null
  const floor = round2(length * width)
  const walls = round2(2 * (length + width) * height)
  return {
    floor,
    ceiling: floor,
    walls,
    total: round2(floor + floor + walls),
  }
}

export function roomsSurfaceTotal(rooms: SurfaceAreaRoom[]): number | null {
  const totals = rooms.map(roomSurfaceArea).filter((measure): measure is SurfaceAreaRoomMeasure => measure != null)
  if (totals.length === 0) return null
  return round2(totals.reduce((sum, measure) => sum + measure.total, 0))
}

/** Room composite when any room has dimensions. Otherwise the typed square metres. */
export function quotedSquareMetres(capture: Pick<SurfaceAreaCleaningCapture, 'estimated_m2' | 'rooms'>): number | null {
  const fromRooms = roomsSurfaceTotal(capture.rooms ?? [])
  if (fromRooms != null) return fromRooms
  return capture.estimated_m2
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
    assumptions: text('assumptions').trim() === PREVIOUS_SURFACE_AREA_ASSUMPTIONS
      ? fallback.assumptions
      : text('assumptions'),
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
  const rooms = Array.isArray(o.rooms) ? o.rooms.map(normalizeSurfaceAreaRoom) : []
  return {
    cleaning_kind: kind,
    estimated_m2: qty(o.estimated_m2),
    labour_days: qty(o.labour_days),
    rate_per_m2: qty(o.rate_per_m2),
    rate_per_labour_day: qty(o.rate_per_labour_day),
    job_address: typeof o.job_address === 'string' ? o.job_address : null,
    mobilisation_fee: qty(o.mobilisation_fee),
    mobilisation_waived: o.mobilisation_waived === true,
    mobilisation_reason: typeof o.mobilisation_reason === 'string' ? o.mobilisation_reason : '',
    rooms,
  }
}

function normalizeSurfaceAreaRoom(raw: unknown): SurfaceAreaRoom {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const metres = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return {
    id: typeof row.id === 'string' && row.id ? row.id : newSurfaceAreaRoomId(),
    name: typeof row.name === 'string' ? row.name : '',
    length_m: metres(row.length_m),
    width_m: metres(row.width_m),
    height_m: metres(row.height_m),
  }
}

export function surfaceAreaCleaningFigures(
  m2: number | null | undefined,
  schema: { ratePerM2: number; ratePerLabourDay: number } = SURFACE_AREA_SCHEMA,
  extras: { labourDays?: number | null; mobilisationFee?: number | null; mobilisationWaived?: boolean } = {},
): SurfaceAreaCleaningFigures {
  const estimated_m2 = round2(quantityOrZero(m2))
  const mobilisation_fee = extras.mobilisationWaived ? 0 : round2(quantityOrZero(extras.mobilisationFee))
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
  const figures = surfaceAreaCleaningFigures(quotedSquareMetres(capture), {
    ratePerM2: capture.rate_per_m2 ?? SURFACE_AREA_SCHEMA.ratePerM2,
    ratePerLabourDay: capture.rate_per_labour_day ?? SURFACE_AREA_SCHEMA.ratePerLabourDay,
  }, {
    labourDays: capture.labour_days,
    mobilisationFee: capture.mobilisation_fee,
    mobilisationWaived: capture.mobilisation_waived,
  })
  const jobAddress = (capture.job_address ?? input.siteAddress).trim()
  const rooms = (capture.rooms ?? []).flatMap(room => {
    const measure = roomSurfaceArea(room)
    if (!measure) return []
    return [{
      name: room.name.trim() || 'Room',
      detail: `${room.length_m} × ${room.width_m} × ${room.height_m} m`,
      area_m2: measure.total,
    }]
  })
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
    mobilisation_reason: capture.mobilisation_waived ? capture.mobilisation_reason.trim() : '',
    rooms,
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
