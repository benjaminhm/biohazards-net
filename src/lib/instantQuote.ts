/**
 * Fast Quote. Stored as `instant_quote`, because `fast_quote` is the older voice brief: its box is gone from
 * Onsite Assessment, but jobs that used it keep the data and the legacy Quote/Estimate still reads it.
 * One fixed price, typed by staff, for a scope of work written from what the client reported.
 * The company has not inspected the site: every fast quote says so, and prints only photos the client supplied.
 * Nothing on it is remeasured: the scope, the exclusions and the assumptions are what the price covers.
 * The standard lines below are added by code on every fast quote. Staff add job-only lines after them.
 */
import { normalizePhotoIds, type PhotoIdsField } from '@/lib/photoIds'

export const INSTANT_QUOTE_SERVICES = [
  { id: 'biohazard', label: 'Biohazard cleaning', title: 'Biohazard Cleaning' },
  { id: 'contents', label: 'Contents clearance', title: 'Contents Clearance' },
  { id: 'surface', label: 'Surface cleaning', title: 'Surface Cleaning' },
] as const

export type InstantQuoteService = (typeof INSTANT_QUOTE_SERVICES)[number]['id']

/** Share of the inc-GST price asked for as the deposit. Matches the engagement agreement. */
export const INSTANT_QUOTE_DEPOSIT_FRACTION = 0.5

export const INSTANT_QUOTE_SCHEMA = {
  inclusions: {
    biohazard: 'Biohazard cleaning of the areas described in the scope of work, and disposal of the contaminated waste those works produce.',
    contents: 'Removal and disposal of the contents described in the scope of work, including transport and tip fees.',
    surface: 'Surface cleaning of the areas described in the scope of work.',
    always: 'Labour, equipment, cleaning products, and personal protective equipment for the works on this quote.',
  },
  exclusions: {
    always: [
      'Any room, area, item, or work not described in the scope of work on this quote.',
      'Repairs, rebuilding, repainting, and restoration.',
      'Hazards that were not disclosed or could not be seen when this quote was prepared, such as asbestos, sharps, drugs, chemicals, firearms, or contamination under floor coverings or inside walls.',
    ],
    withoutContents: 'Removal and disposal of household contents, unless described in the scope of work.',
    withoutBiohazard: 'Biohazard remediation, such as blood, bodily fluids, sewage, or mould treatment, unless described in the scope of work.',
  },
  assumptions: [
    'This is a fixed price for the scope of work on this quote. The company has not inspected the site. The price was prepared from what the client reported and any photos the client supplied.',
    'The price relies on that information being accurate and complete. If the site differs materially from what the client reported, or work outside the scope of work is needed, that work stops until a written variation is agreed by text or email.',
    'Clear access, power, and running water are available at the site on the day of the works.',
  ],
  /** Printed in the box at the top of every fast quote. */
  basis: {
    described: 'Site not inspected. Priced from the client\'s description.',
    withPhotos: 'Site not inspected. Priced from the client\'s description and the photos the client supplied.',
  },
  photosHeading: 'Photos supplied by the client',
  terms:
    'A deposit of 50% of the fixed price is requested before the works start. The balance is due 7 days from the invoice. The price is fixed for the scope of work on this quote. GST is 10%.',
  authority:
    'Acceptance authorises the works on this quote at the address on this quote, for the fixed price shown.',
  acceptance:
    'I accept this quote, its scope of work, its fixed price, and the terms on this page.',
  startNote: 'The start date is confirmed when the deposit is received.',
} as const

/** `photo_ids` are the photos the client supplied, chosen from the job's folder. Unset means none. */
export interface InstantQuoteCapture extends PhotoIdsField {
  services: InstantQuoteService[]
  /** Printed in place of the title made from the services. Blank uses that title. */
  custom_title: string
  /** What the client reported about the job. Read by the wording draft. Never printed. */
  brief: string
  /** Printed. A neutral description of the job as it was described. */
  presentation: string
  /** Printed. One step per line. */
  scope_of_work: string
  /** One item per line. Printed after the standard lines. */
  job_inclusions: string
  job_exclusions: string
  job_assumptions: string
  /** The fixed price, typed by staff. */
  price: number | null
  /** True when the typed price already includes GST. */
  price_includes_gst: boolean
  /** ISO date (YYYY-MM-DD). Blank stays off the quote. */
  earliest_start: string
  /** Null follows the job site address. */
  job_address: string | null
}

export interface InstantQuoteFigures {
  subtotal: number
  gst: number
  total: number
  deposit: number
  balance: number
}

export interface InstantQuoteContent extends PhotoIdsField {
  title: string
  reference: string
  client_name: string
  site_address: string
  job_address: string
  presentation: string
  scope_of_work: string
  /** Ex GST. */
  subtotal: number
  gst: number
  /** Inc GST. */
  total: number
  deposit: number
  balance: number
  /** e.g. "Monday 23 November 2026". Blank when no date is set. */
  earliest_start: string
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

export function instantQuoteLines(text: string | null | undefined): string[] {
  return (text ?? '').split('\n').map(line => line.trim()).filter(Boolean)
}

function sameLine(a: string, b: string): boolean {
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return plain(a) === plain(b)
}

/** The standard lines, then this job's lines that do not repeat one already listed. */
function withJobLines(standard: readonly string[], jobOnly: string): string[] {
  const out = [...standard]
  for (const line of instantQuoteLines(jobOnly)) {
    if (!out.some(existing => sameLine(existing, line))) out.push(line)
  }
  return out
}

export function emptyInstantQuoteCapture(): InstantQuoteCapture {
  return {
    services: [],
    custom_title: '',
    brief: '',
    presentation: '',
    scope_of_work: '',
    job_inclusions: '',
    job_exclusions: '',
    job_assumptions: '',
    price: null,
    price_includes_gst: true,
    earliest_start: '',
    job_address: null,
  }
}

export function normalizeInstantQuoteCapture(raw: unknown): InstantQuoteCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const text = (key: string) => (typeof o[key] === 'string' ? o[key] as string : '')
  const ids = INSTANT_QUOTE_SERVICES.map(service => service.id)
  const chosen = Array.isArray(o.services) ? o.services : []
  const price = o.price == null || o.price === '' ? null : Number(o.price)
  const start = text('earliest_start').trim()
  return {
    // Kept in the fixed order, so the title reads the same however they were ticked.
    services: ids.filter(id => chosen.includes(id)),
    custom_title: text('custom_title'),
    brief: text('brief'),
    presentation: text('presentation'),
    scope_of_work: text('scope_of_work'),
    job_inclusions: text('job_inclusions'),
    job_exclusions: text('job_exclusions'),
    job_assumptions: text('job_assumptions'),
    price: price != null && Number.isFinite(price) && price >= 0 ? price : null,
    price_includes_gst: o.price_includes_gst !== false,
    earliest_start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : '',
    job_address: typeof o.job_address === 'string' ? o.job_address : null,
    ...normalizePhotoIds(o),
  }
}

function joined(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** The custom title when one is typed. Otherwise the services, e.g. "Contents Clearance and Surface Cleaning". */
export function instantQuoteTitle(capture: Pick<InstantQuoteCapture, 'services' | 'custom_title'>): string {
  const custom = capture.custom_title.trim()
  if (custom) return custom
  const titles = INSTANT_QUOTE_SERVICES.filter(service => capture.services.includes(service.id)).map(service => service.title)
  return joined(titles) || 'Quote'
}

/** GST is 10%. A price typed inc GST is split back into the ex-GST amount and the GST. */
export function instantQuoteFigures(capture: Pick<InstantQuoteCapture, 'price' | 'price_includes_gst'>): InstantQuoteFigures {
  const price = capture.price != null && Number.isFinite(capture.price) && capture.price > 0 ? capture.price : 0
  const total = capture.price_includes_gst ? round2(price) : round2(round2(price) + round2(price * 0.1))
  const subtotal = capture.price_includes_gst ? round2(total / 1.1) : round2(price)
  const gst = round2(total - subtotal)
  const deposit = round2(total * INSTANT_QUOTE_DEPOSIT_FRACTION)
  return { subtotal, gst, total, deposit, balance: round2(total - deposit) }
}

export function instantQuoteStandardInclusions(services: InstantQuoteService[]): string[] {
  const lines: string[] = INSTANT_QUOTE_SERVICES
    .filter(service => services.includes(service.id))
    .map(service => INSTANT_QUOTE_SCHEMA.inclusions[service.id])
  return [...lines, INSTANT_QUOTE_SCHEMA.inclusions.always]
}

export function instantQuoteStandardExclusions(services: InstantQuoteService[]): string[] {
  const lines: string[] = [...INSTANT_QUOTE_SCHEMA.exclusions.always]
  if (!services.includes('contents')) lines.push(INSTANT_QUOTE_SCHEMA.exclusions.withoutContents)
  if (!services.includes('biohazard')) lines.push(INSTANT_QUOTE_SCHEMA.exclusions.withoutBiohazard)
  return lines
}

export function instantQuoteStandardAssumptions(): string[] {
  return [...INSTANT_QUOTE_SCHEMA.assumptions]
}

/** "Monday 23 November 2026" for an ISO date. Blank for anything else. */
export function instantQuoteStartLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(date.getTime()) || date.getMonth() !== Number(match[2]) - 1) return ''
  return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** Why the quote cannot be generated yet. Empty when it can. */
export function instantQuoteProblems(capture: InstantQuoteCapture): string[] {
  const problems: string[] = []
  if (capture.services.length === 0 && !capture.custom_title.trim()) problems.push('Tick at least one service.')
  if (instantQuoteLines(capture.scope_of_work).length === 0) problems.push('Add the scope of work. The fixed price only covers what it describes.')
  if (!(capture.price != null && capture.price > 0)) problems.push('Enter the fixed price.')
  return problems
}

export function instantQuoteContent(input: {
  reference: string
  clientName: string
  siteAddress: string
  capture: InstantQuoteCapture
  /** The company's engagement agreement, with its brackets unfilled. */
  engagementAgreement?: string | null
}): InstantQuoteContent {
  const capture = input.capture
  const figures = instantQuoteFigures(capture)
  const jobAddress = (capture.job_address ?? input.siteAddress).trim()
  return {
    title: instantQuoteTitle(capture),
    reference: input.reference,
    client_name: input.clientName.trim(),
    site_address: jobAddress,
    job_address: jobAddress,
    presentation: capture.presentation.trim(),
    scope_of_work: instantQuoteLines(capture.scope_of_work).join('\n'),
    subtotal: figures.subtotal,
    gst: figures.gst,
    total: figures.total,
    deposit: figures.deposit,
    balance: figures.balance,
    earliest_start: instantQuoteStartLabel(capture.earliest_start),
    inclusions: withJobLines(instantQuoteStandardInclusions(capture.services), capture.job_inclusions),
    exclusions: withJobLines(instantQuoteStandardExclusions(capture.services), capture.job_exclusions),
    assumptions: withJobLines(instantQuoteStandardAssumptions(), capture.job_assumptions),
    terms: INSTANT_QUOTE_SCHEMA.terms,
    engagement_agreement: (input.engagementAgreement ?? '').trim(),
    authority: INSTANT_QUOTE_SCHEMA.authority,
    acceptance: INSTANT_QUOTE_SCHEMA.acceptance,
    ...(capture.photo_ids ? { photo_ids: capture.photo_ids } : {}),
  }
}
