import type { AssessmentData, DisposalManifestCapture, Document, QuoteGstMode, QuoteSpoke, StatementLedgerLine, StatementOfAccountsContent } from '@/lib/types'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { computeDisposalTotals, disposalPriceLines, formatAud, formatKg, formatM3, loadHasContent, mergedDisposalManifestCapture, vehicleVolumeM3 } from '@/lib/disposalManifest'
import { houseSurveyDocument } from '@/lib/houseSurvey'
import { getQuoteSpokes } from '@/lib/quoteSpokes'
import {
  areaPricingSectionSubtotal,
  computeQuoteCaptureTotals,
  customSectionSubtotal,
  derivePricingLayoutFromCapture,
  quoteContentIsEstimate,
  volumePricingSectionSubtotal,
} from '@/lib/quoteSections'

export interface StatementSurveyArea {
  label: string
  sqm: number | null
}

export interface StatementOfAccountsCapture {
  deposit_taken: boolean
  /** Dollars received. Includes GST when deposit_includes_gst is true and the quote charges GST. */
  deposit_amount: number | null
  deposit_includes_gst: boolean
  original_invoice_number: string
  original_invoice_url: string
  new_invoice_number: string
  new_invoice_url: string
  /** Invoice 1 after the surfaces were measured again. Null until staff enter it. */
  invoice1_adjusted_amount: number | null
  /** The adjusted amount includes GST when the quote charges GST. */
  invoice1_adjusted_includes_gst: boolean
  /** Issued invoice 1. Typed. Not taken from the quote. */
  invoice1_amount: number | null
  /** Contents invoice. Typed. Not taken from the disposal record. */
  invoice2_amount: number | null
  /** How invoice 1 is made up. Blank lines are omitted. Filled lines must add up to invoice 1. */
  invoice1_callout: number | null
  invoice1_contents: number | null
  invoice1_cleaning: number | null
  /** Square metres by area. Null uses the saved survey. Not a dollar amount. */
  survey_areas: StatementSurveyArea[] | null
  /** Quantity on invoice 2. Not a dollar amount. */
  invoice2_m3: number | null
  /** How invoice 2 is made up. Blank lines are omitted. Filled lines must add up to invoice 2. Prepaid is taken off. */
  invoice2_skips: number | null
  invoice2_trailers: number | null
  invoice2_utes: number | null
  invoice2_tip_receipts: number | null
  invoice2_prepaid: number | null
  /** Every typed amount includes GST. */
  charges_gst: boolean
  /** When the deposit was received, shown on the statement as the payment date. */
  deposit_date: string
  /** Why invoice 1 was adjusted. Required before an adjusted statement can be generated. */
  adjustment_reason: string
}

export interface StatementFigures {
  reference: string
  gst_mode: QuoteGstMode
  quote_ex: number
  quote_gst: number
  quote_inc: number
  disposal: number
  deposit_taken: boolean
  deposit_entered: number
  deposit_ex: number
  owing_ex: number
  gst: number
  owing_inc: number
  original_owing_ex: number
  original_owing_inc: number
  new_invoice_ex: number
  new_invoice_inc: number
  /** True once staff enter a remeasured invoice 1. */
  remeasured: boolean
  invoice1_revised_ex: number | null
  invoice1_revised_inc: number | null
  /** Original invoice 1 minus the remeasure. Positive when the price went down. */
  remeasure_ex: number
  remeasure_inc: number
  /** Contents invoice after the remeasure difference is applied. */
  invoice2_owing_ex: number
  invoice2_owing_inc: number
  job_total_ex: number | null
  job_total_inc: number | null
  has_invoice2: boolean
  lines: StatementLedgerLine[]
}

function textField(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export function emptyStatementCapture(): StatementOfAccountsCapture {
  return {
    deposit_taken: false,
    deposit_amount: null,
    deposit_includes_gst: true,
    original_invoice_number: '',
    original_invoice_url: '',
    new_invoice_number: '',
    new_invoice_url: '',
    invoice1_adjusted_amount: null,
    invoice1_adjusted_includes_gst: true,
    invoice1_amount: null,
    invoice2_amount: null,
    invoice1_callout: null,
    invoice1_contents: null,
    invoice1_cleaning: null,
    survey_areas: null,
    invoice2_m3: null,
    invoice2_skips: null,
    invoice2_trailers: null,
    invoice2_utes: null,
    invoice2_tip_receipts: null,
    invoice2_prepaid: null,
    charges_gst: true,
    deposit_date: '',
    adjustment_reason: '',
  }
}

export function normalizeStatementCapture(raw: unknown): StatementOfAccountsCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const amount = typeof o.deposit_amount === 'number' ? o.deposit_amount : Number(o.deposit_amount)
  return {
    deposit_taken: o.deposit_taken === true,
    deposit_amount: Number.isFinite(amount) && amount >= 0 ? amount : null,
    deposit_includes_gst: o.deposit_includes_gst !== false,
    original_invoice_number: textField(o.original_invoice_number),
    original_invoice_url: textField(o.original_invoice_url),
    new_invoice_number: textField(o.new_invoice_number),
    new_invoice_url: textField(o.new_invoice_url),
    invoice1_adjusted_amount: moneyOrNull(o.invoice1_adjusted_amount),
    invoice1_adjusted_includes_gst: o.invoice1_adjusted_includes_gst !== false,
    invoice1_amount: moneyOrNull(o.invoice1_amount),
    invoice2_amount: moneyOrNull(o.invoice2_amount),
    invoice1_callout: moneyOrNull(o.invoice1_callout),
    invoice1_contents: moneyOrNull(o.invoice1_contents),
    invoice1_cleaning: moneyOrNull(o.invoice1_cleaning),
    survey_areas: surveyAreasOrNull(o.survey_areas),
    invoice2_m3: moneyOrNull(o.invoice2_m3),
    invoice2_skips: moneyOrNull(o.invoice2_skips),
    invoice2_trailers: moneyOrNull(o.invoice2_trailers),
    invoice2_utes: moneyOrNull(o.invoice2_utes),
    invoice2_tip_receipts: moneyOrNull(o.invoice2_tip_receipts),
    invoice2_prepaid: moneyOrNull(o.invoice2_prepaid),
    charges_gst: o.charges_gst !== false,
    deposit_date: textField(o.deposit_date),
    adjustment_reason: textField(o.adjustment_reason),
  }
}

function surveyAreasOrNull(value: unknown): StatementSurveyArea[] | null {
  if (!Array.isArray(value)) return null
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const label = textField(row.label)
    const sqm = moneyOrNull(row.sqm)
    if (!label && sqm == null) return []
    return [{ label, sqm }]
  })
}

/** Priced square metres for each survey area. The statement prints these, and does not add them to the invoice. */
export function surveyAreaQuantities(assessment: AssessmentData | null | undefined): StatementSurveyArea[] {
  const survey = houseSurveyDocument('', '', assessment?.house_survey)
  return survey.areas.flatMap(area => {
    if (area.priced == null || !Number.isFinite(area.priced)) return []
    return [{ label: area.title, sqm: area.priced }]
  })
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function formatSqm(n: number): string {
  const text = round2(n).toLocaleString('en-AU', { maximumFractionDigits: 2 })
  return `${text} m²`
}

/** Cubic metres from each vehicle's length, width, and height, split the same way as the price. */
function disposalVolumes(loads: Parameters<typeof computeDisposalTotals>[0]): { skip: string; trailer: string; ute: string } {
  let skip = 0
  let trailer = 0
  let ute = 0
  let skipN = 0
  let trailerN = 0
  let uteN = 0
  for (const load of loads) {
    for (const vehicle of load.vehicles) {
      const volume = vehicleVolumeM3(vehicle)
      if (volume == null) continue
      if (vehicle.type === 'skip') {
        skip += volume
        skipN += 1
      } else if (vehicle.type === 'ute') {
        ute += volume
        uteN += 1
      } else {
        trailer += volume
        trailerN += 1
      }
    }
  }
  return {
    skip: skipN > 0 ? formatM3(round2(skip)) : '',
    trailer: trailerN > 0 ? formatM3(round2(trailer)) : '',
    ute: uteN > 0 ? formatM3(round2(ute)) : '',
  }
}

function latestOfType(documents: Document[], type: Document['type']): Document | null {
  const rows = documents.filter(d => d.type === type)
  if (!rows.length) return null
  return [...rows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
}

export function latestQuoteDocument(documents: Document[]): Document | null {
  return latestOfType(documents, 'quote')
}

export function latestDisposalDocument(documents: Document[]): Document | null {
  return latestOfType(documents, 'waste_disposal_manifest')
}

export function latestSurveyDocument(documents: Document[]): Document | null {
  return latestOfType(documents, 'house_survey')
}

export function documentReference(doc: Document | null, fallback: string): string {
  const raw = doc?.content?.reference
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
}

export interface StatementReferenceLine {
  label: string
  ex: number
  inc: number
  strong?: boolean
  /** Cubic metres or weight shown beside this price. */
  quantity?: string
}

/** One source of prices shown beside the statement. Never written into statement fields. */
export interface StatementReferenceBlock {
  heading: string
  reference: string
  detail: string
  /** Quantities beside the prices. Display only. */
  facts: { label: string; value: string }[]
  /** Survey and disposal: item, quantity, ex GST, and inc GST. */
  quantityColumn?: boolean
  itemHeading?: string
  quantityHeading?: string
  /** no_gst quotes show a single amount. Survey and disposal always show both. */
  gst_mode: QuoteGstMode
  lines: StatementReferenceLine[]
  empty: string | null
}

export interface StatementReferencePanel {
  survey: StatementReferenceBlock
  quotes: StatementReferenceBlock[]
  disposal: StatementReferenceBlock
}

function quoteMoney(amount: number, gstMode: QuoteGstMode): { ex: number; inc: number } {
  if (gstMode === 'no_gst') {
    const value = round2(amount)
    return { ex: value, inc: value }
  }
  if (gstMode === 'inclusive') {
    const inc = round2(amount)
    return { ex: round2(inc / 1.1), inc }
  }
  const ex = round2(amount)
  return { ex, inc: round2(ex * 1.1) }
}

function gstDetail(gstMode: QuoteGstMode): string {
  if (gstMode === 'inclusive') return 'Amounts include GST'
  if (gstMode === 'exclusive') return 'GST is added on'
  return 'No GST'
}

function quoteDocuments(documents: Document[]): Document[] {
  return documents
    .filter(doc => doc.type === 'quote')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
}

function referenceForSpoke(docs: Document[], spokeId: string, singleSpoke: boolean): string {
  const matched = docs.find(doc => doc.content?.quote_id === spokeId)
  if (matched) return documentReference(matched, '')
  if (singleSpoke && docs.length === 1) return documentReference(docs[0], '')
  return ''
}

function quoteHeading(kind: 'quote' | 'estimate', label: string): string {
  const name = label.trim()
  const title = kind === 'estimate' ? 'Estimate' : 'Quote'
  if (!name || name.toLowerCase() === title.toLowerCase()) return title
  return `${title} · ${name}`
}

function blockFromQuoteDocument(doc: Document): StatementReferenceBlock {
  const content = doc.content ?? {}
  const subtotal = typeof content.subtotal === 'number' ? content.subtotal : Number(content.subtotal)
  const total = typeof content.total === 'number' ? content.total : Number(content.total)
  const gst = typeof content.gst === 'number' ? content.gst : Number(content.gst)
  const ex = Number.isFinite(subtotal) ? round2(subtotal) : 0
  const inc = Number.isFinite(total) ? round2(total) : ex
  const gst_mode: QuoteGstMode = content.gst_mode === 'inclusive' || content.gst_mode === 'exclusive' || content.gst_mode === 'no_gst'
    ? content.gst_mode
    : (Number.isFinite(gst) && gst > 0 ? 'exclusive' : 'no_gst')
  const kind = content.is_estimate === true ? 'estimate' : 'quote'
  const label = typeof content.quote_label === 'string' ? content.quote_label : ''
  const priced = ex > 0.004 || inc > 0.004
  return {
    heading: quoteHeading(kind, label),
    reference: documentReference(doc, ''),
    detail: priced ? gstDetail(gst_mode) : '',
    facts: [],
    gst_mode,
    lines: priced ? [{ label: 'Total', ex, inc, strong: true }] : [],
    empty: priced ? null : 'No price on this document yet.',
  }
}

function blockFromSpoke(spoke: QuoteSpoke, reference: string): StatementReferenceBlock {
  const layout = derivePricingLayoutFromCapture(spoke)
  const gst_mode: QuoteGstMode = spoke.gst_mode === 'inclusive' || spoke.gst_mode === 'exclusive' ? spoke.gst_mode : 'no_gst'
  const kind = spoke.quote_kind ?? (quoteContentIsEstimate({
    pricing_layout: layout,
    volume_pricing: spoke.volume_pricing,
  }) ? 'estimate' : 'quote')
  const mobilisation = Math.max(0, Number(spoke.global_mobilisation_fee || 0))
  const outcomeRows = (spoke.rows ?? []).reduce((sum, row) => sum + Math.max(0, Number(row.price || 0)), 0)
  const outcomeSum = layout.outcomes_enabled
    ? mobilisation + ((spoke.rows ?? []).length > 0 ? outcomeRows : 0)
    : 0
  const surfaceSum = layout.per_sqm_enabled
    ? areaPricingSectionSubtotal(spoke.area_pricing, spoke.area_pricing_section_total)
    : 0
  const volumeSum = layout.per_m3_enabled
    ? volumePricingSectionSubtotal(spoke.volume_pricing, spoke.volume_pricing_section_total)
    : 0
  const customSum = layout.custom_enabled
    ? customSectionSubtotal(spoke.custom_section_rows, spoke.custom_section_total)
    : 0
  const totals = computeQuoteCaptureTotals(
    spoke.rows ?? [],
    spoke.area_pricing,
    spoke.volume_pricing,
    layout,
    gst_mode,
    mobilisation,
    Math.max(0, Number(spoke.area_pricing_section_total || 0)),
    Math.max(0, Number(spoke.volume_pricing_section_total || 0)),
    spoke.custom_section_rows,
    Math.max(0, Number(spoke.custom_section_total || 0)),
  )
  const sections: { label: string; amount: number }[] = [
    { label: 'Mobilisation & fees', amount: outcomeSum },
    { label: 'Contents removal', amount: volumeSum },
    { label: 'Remediation & cleaning', amount: surfaceSum },
    { label: (spoke.custom_section_title ?? '').trim() || 'Other', amount: customSum },
  ]
  const lines: StatementReferenceLine[] = sections
    .filter(section => section.amount > 0.004)
    .map(section => ({ label: section.label, ...quoteMoney(section.amount, gst_mode) }))
  const priced = totals.total > 0.004 || totals.subtotal > 0.004
  if (priced) {
    lines.push({ label: 'Total', ex: totals.subtotal, inc: totals.total, strong: true })
  }
  return {
    heading: quoteHeading(kind, spoke.label),
    reference,
    detail: priced ? gstDetail(gst_mode) : '',
    facts: [],
    gst_mode,
    lines,
    empty: priced ? null : 'No quote price yet.',
  }
}

/** Prices from the survey, each quote or estimate, and the contents disposal record. Display only. */
export function statementReferencePanel(
  assessment: AssessmentData | null | undefined,
  documents: Document[],
): StatementReferencePanel {
  const surveyDoc = houseSurveyDocument('', '', assessment?.house_survey)
  const surveyReference = documentReference(latestOfType(documents, 'house_survey'), '')
  const surveyLines: StatementReferenceLine[] = surveyDoc.areas
    .filter(area => area.priced != null || area.price_ex != null)
    .map(area => ({
      label: area.title,
      ex: area.price_ex ?? Number.NaN,
      inc: area.price_inc ?? Number.NaN,
      quantity: area.priced == null ? '' : formatSqm(area.priced),
    }))
  const surveyPriced = surveyLines.length > 0
  if (surveyDoc.totals.price_ex != null && surveyDoc.totals.price_inc != null) {
    surveyLines.push({
      label: 'Total',
      ex: surveyDoc.totals.price_ex,
      inc: surveyDoc.totals.price_inc,
      quantity: surveyDoc.totals.priced == null ? '' : formatSqm(surveyDoc.totals.priced),
      strong: true,
    })
  }

  const quotes = quoteDocuments(documents)
  const spokes = getQuoteSpokes(assessment)
  const quoteBlocks = spokes.length > 0
    ? spokes.map(spoke => blockFromSpoke(spoke, referenceForSpoke(quotes, spoke.id, spokes.length === 1)))
    : quotes.map(blockFromQuoteDocument)

  const disposalCapture = mergedDisposalManifestCapture(assessment)
  const disposalLoads = disposalCapture.loads.filter(loadHasContent)
  const disposalPrices = disposalPriceLines(disposalLoads, disposalCapture.cost_per_m3, disposalCapture.prepaid_m3)
  const volumes = disposalVolumes(disposalLoads)
  const disposalTotals = computeDisposalTotals(disposalLoads)
  const weight = disposalTotals.weight_recorded > 0 ? formatKg(disposalTotals.weight_kg) : ''
  const disposalLines: StatementReferenceLine[] = []
  const priced = (amount: number) => amount > 0.004
  if (priced(disposalPrices.skips_inc) || volumes.skip) {
    disposalLines.push({ label: 'Skip', ex: disposalPrices.skips_ex, inc: disposalPrices.skips_inc, quantity: volumes.skip })
  }
  if (priced(disposalPrices.trailers_ex) || volumes.trailer) {
    disposalLines.push({ label: 'Trailer', ex: disposalPrices.trailers_ex, inc: disposalPrices.trailers_inc, quantity: volumes.trailer })
  }
  if (priced(disposalPrices.utes_ex) || volumes.ute) {
    disposalLines.push({ label: 'Ute', ex: disposalPrices.utes_ex, inc: disposalPrices.utes_inc, quantity: volumes.ute })
  }
  if (priced(disposalPrices.dump_fees_inc) || weight) {
    disposalLines.push({ label: 'Tip fees', ex: disposalPrices.dump_fees_ex, inc: disposalPrices.dump_fees_inc, quantity: weight })
  }
  if (priced(disposalPrices.prepaid_ex)) {
    disposalLines.push({
      label: 'Prepaid',
      ex: round2(-disposalPrices.prepaid_ex),
      inc: round2(-disposalPrices.prepaid_inc),
    })
  }
  const disposalPriced = disposalLines.length > 0
  if (disposalPriced) {
    disposalLines.push({
      label: 'Total',
      ex: disposalPrices.total_ex,
      inc: disposalPrices.total_inc,
      strong: true,
    })
  }

  return {
    survey: {
      heading: 'Survey',
      reference: surveyReference,
      detail: '',
      facts: [],
      quantityColumn: true,
      itemHeading: 'Room',
      quantityHeading: 'Area',
      gst_mode: 'exclusive',
      lines: surveyLines,
      empty: surveyPriced ? null : 'No survey price yet.',
    },
    quotes: quoteBlocks,
    disposal: {
      heading: 'Contents disposal',
      reference: documentReference(latestDisposalDocument(documents), ''),
      detail: '',
      facts: [],
      quantityColumn: true,
      gst_mode: 'exclusive',
      lines: disposalLines,
      empty: disposalPriced ? null : 'No disposal price yet.',
    },
  }
}

export function disposalTotals(capture: DisposalManifestCapture | null | undefined): { ex: number; inc: number } {
  if (!capture) return { ex: 0, inc: 0 }
  const lines = disposalPriceLines(capture.loads ?? [], capture.cost_per_m3, capture.prepaid_m3)
  return { ex: lines.total_ex, inc: lines.total_inc }
}

export function disposalTotal(capture: DisposalManifestCapture | null | undefined): number {
  return disposalTotals(capture).ex
}

function withNumber(label: string, number: string): string {
  const trimmed = number.trim()
  return trimmed ? `${label} (${trimmed})` : label
}

function positionLine(owingEx: number, owingInc: number, overLabel: string, underLabel: string, evenLabel: string): StatementLedgerLine {
  if (owingInc > 0.004) return { label: underLabel, ex: owingEx, inc: owingInc, strong: true }
  if (owingInc < -0.004) return { label: overLabel, ex: round2(-owingEx), inc: round2(-owingInc), strong: true }
  return { label: evenLabel, ex: 0, inc: 0, strong: true }
}

/** Dollars are typed on the statement. The quote and disposal record are references only. */
export function statementFigures(capture: StatementOfAccountsCapture): StatementFigures {
  const gst_mode: QuoteGstMode = capture.charges_gst ? 'exclusive' : 'no_gst'
  const pair = (amount: number | null) => amount == null ? null : enteredPair(amount, gst_mode, true)
  const invoice1 = pair(capture.invoice1_amount) ?? { ex: 0, inc: 0 }
  const deposit = capture.deposit_taken ? (pair(capture.deposit_amount) ?? { ex: 0, inc: 0 }) : { ex: 0, inc: 0 }
  const revised = pair(capture.invoice1_adjusted_amount)
  const invoice2 = pair(capture.invoice2_amount)
  const quote_ex = invoice1.ex
  const quote_inc = invoice1.inc
  const quote_gst = gst_mode === 'no_gst' ? 0 : round2(quote_inc - quote_ex)
  const deposit_ex = deposit.ex
  const deposit_inc = deposit.inc
  const new_invoice_ex = invoice2?.ex ?? 0
  const new_invoice_inc = invoice2?.inc ?? 0
  const original_owing_ex = round2(quote_ex - deposit_ex)
  const original_owing_inc = round2(quote_inc - deposit_inc)
  const remeasured = revised != null
  const remeasure_ex = revised == null ? 0 : round2(quote_ex - revised.ex)
  const remeasure_inc = revised == null ? 0 : round2(quote_inc - revised.inc)
  const has_invoice2 = invoice2 != null
  const invoice2_owing_ex = round2(new_invoice_ex - remeasure_ex)
  const invoice2_owing_inc = round2(new_invoice_inc - remeasure_inc)
  const owing_ex = has_invoice2
    ? round2(original_owing_ex + invoice2_owing_ex)
    : round2(original_owing_ex - remeasure_ex)
  const owing_inc = has_invoice2
    ? round2(original_owing_inc + invoice2_owing_inc)
    : round2(original_owing_inc - remeasure_inc)
  const priced = revised ?? invoice1
  const job_total_ex = round2(priced.ex + new_invoice_ex)
  const job_total_inc = round2(priced.inc + new_invoice_inc)
  const gst = gst_mode === 'no_gst' ? 0 : round2(owing_inc - owing_ex)
  const lines: StatementLedgerLine[] = [
    { label: 'Invoice 1', ex: quote_ex, inc: quote_inc },
    { label: 'Deposit paid', ex: deposit_ex, inc: deposit_inc },
    positionLine(
      original_owing_ex,
      original_owing_inc,
      'Overpay on invoice 1',
      withNumber('Underpay. Still to come on invoice 1', capture.original_invoice_number),
      'Invoice 1 is paid',
    ),
  ]
  if (revised) {
    lines.push({ label: 'Invoice 1 after adjustment', ex: revised.ex, inc: revised.inc })
    lines.push(positionLine(
      -remeasure_ex,
      -remeasure_inc,
      'Overpay carried to the next invoice',
      'Underpay added to the next invoice',
      'No change from the adjustment',
    ))
  }
  if (invoice2) {
    lines.push({ label: 'Invoice 2', ex: new_invoice_ex, inc: new_invoice_inc })
    lines.push(positionLine(
      invoice2_owing_ex,
      invoice2_owing_inc,
      withNumber('Overpay on invoice 2', capture.new_invoice_number),
      withNumber('Underpay. Owing on invoice 2', capture.new_invoice_number),
      'Invoice 2 is paid',
    ))
  }
  if (revised || invoice2) {
    lines.push({ label: 'Job total after adjustments', ex: job_total_ex, inc: job_total_inc, strong: true })
  }
  lines.push({ label: 'Total remaining owed', ex: owing_ex, inc: owing_inc, strong: true })
  return {
    reference: '',
    gst_mode,
    quote_ex,
    quote_gst,
    quote_inc,
    disposal: round2(new_invoice_ex),
    deposit_taken: capture.deposit_taken,
    deposit_entered: deposit_inc,
    deposit_ex,
    owing_ex,
    gst,
    owing_inc,
    original_owing_ex,
    original_owing_inc,
    new_invoice_ex,
    new_invoice_inc,
    remeasured,
    invoice1_revised_ex: revised?.ex ?? null,
    invoice1_revised_inc: revised?.inc ?? null,
    remeasure_ex,
    remeasure_inc,
    invoice2_owing_ex: has_invoice2 ? invoice2_owing_ex : 0,
    invoice2_owing_inc: has_invoice2 ? invoice2_owing_inc : 0,
    job_total_ex,
    job_total_inc,
    has_invoice2,
    lines,
  }
}

/** Split a typed dollar amount into ex GST and inc GST. */
function enteredPair(amount: number, gstMode: QuoteGstMode, includesGst: boolean): { ex: number; inc: number } {
  if (gstMode === 'no_gst') {
    const value = round2(amount)
    return { ex: value, inc: value }
  }
  if (includesGst) {
    const inc = round2(amount)
    return { ex: round2(inc / 1.1), inc }
  }
  const ex = round2(amount)
  return { ex, inc: round2(ex * 1.1) }
}

export function statementFromJob(
  documents: Document[],
  assessment: AssessmentData | null | undefined,
): StatementFigures {
  const capture = normalizeStatementCapture(assessment?.statement_of_accounts)
  const figures = statementFigures(capture)
  return { ...figures, reference: documentReference(latestQuoteDocument(documents), '—') }
}

export class StatementReconciliationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StatementReconciliationError'
  }
}

export interface StatementLedgerDisplayRow {
  label: string
  /** GST-inclusive. Negative rows are deductions and print in brackets. */
  amountInc: number
  strong?: boolean
  /** Shown instead of the dollar amount. Used for quantities such as cubic metres. */
  display?: string
  /** Explains the invoice amount. Printed above it, and left out of the balance. */
  explain?: boolean
  /** The invoice amount row, once a breakdown is shown above it. */
  charge?: boolean
}

export interface StatementInvoiceBlock {
  heading: string
  rows: StatementLedgerDisplayRow[]
  balanceInc: number
  payHref: string | null
  payLabel: string | null
}

export interface StatementPresentation {
  summary: {
    jobTotalInc: number
    paidInc: number
    balanceInc: number
    /** GST included in the job total. Null when the statement does not charge GST. */
    gst: number | null
  }
  invoices: StatementInvoiceBlock[]
  adjustmentNote: string | null
  warnings: string[]
}

function closeMoney(a: number, b: number): boolean {
  return Math.abs(round2(a) - round2(b)) < 0.02
}

function moneyLabel(n: number): string {
  return '$' + round2(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Drop tracking parameters so the pay link is the invoice, not a campaign URL. */
export function statementPayHref(raw: string): string | null {
  const href = raw.trim()
  if (!/^https?:\/\//i.test(href)) return null
  try {
    const url = new URL(href)
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return href
  }
}

/** Legal name on the first line, ACN on the second, when the client string includes one. */
export function statementClientLines(name: string): { line1: string; line2: string } {
  const trimmed = name.trim()
  const match = trimmed.match(/\bACN\s*([0-9][0-9\s]*)/i)
  if (!match || match.index == null) return { line1: trimmed, line2: '' }
  const line1 = trimmed.slice(0, match.index).replace(/[\s,–—-]+$/, '').trim()
  const digits = match[1].replace(/\s/g, '')
  const grouped = digits.length === 9
    ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
    : match[1].trim()
  return { line1: line1 || trimmed, line2: `ACN ${grouped}` }
}

function spacedAustralian(nationalNine: string): string {
  if (/^[2378]/.test(nationalNine)) {
    return `+61 ${nationalNine[0]} ${nationalNine.slice(1, 5)} ${nationalNine.slice(5)}`
  }
  return `+61 ${nationalNine.slice(0, 3)} ${nationalNine.slice(3, 6)} ${nationalNine.slice(6)}`
}

/** +61404143284 → +61 404 143 284. Unknown numbers are returned trimmed. */
export function statementPhone(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const phone = parsePhoneNumberFromString(trimmed, 'AU')
    if (phone?.isValid()) {
      const intl = phone.formatInternational()
      if (intl.includes(' ')) return intl
    }
  } catch {
    /* fall through to a spaced Australian pattern */
  }
  const digits = trimmed.replace(/[^\d+]/g, '')
  const international = digits.match(/^\+?61(\d{9})$/)
  if (international) return spacedAustralian(international[1])
  const local = digits.match(/^0(\d{9})$/)
  if (local) return spacedAustralian(local[1])
  return trimmed
}

function paymentDateLabel(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return 'Less: payment received'
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!iso) return `Less: payment received ${value}`
  const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  if (Number.isNaN(date.getTime())) return `Less: payment received ${value}`
  return `Less: payment received ${date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`
}

function invoiceHeading(number: string, label: string): string {
  const num = number.trim()
  return num ? `${num} — ${label}` : label
}

function balanceLabel(number: string, fallback: string): string {
  const num = number.trim()
  return `Balance due on ${num || fallback}`
}

interface BuiltInvoice {
  heading: string
  amountInc: number
  rows: StatementLedgerDisplayRow[]
  balanceInc: number
  payHref: string | null
}

function moneyParts(pairs: Array<[string, number | null | undefined]>): StatementLedgerDisplayRow[] {
  return pairs.flatMap(([label, amount]) => {
    if (amount == null || !Number.isFinite(amount)) return []
    return [{ label, amountInc: round2(amount), explain: true }]
  })
}

function areaRows(areas: StatementSurveyArea[] | null | undefined): StatementLedgerDisplayRow[] {
  if (!areas || areas.length === 0) return []
  const rows: StatementLedgerDisplayRow[] = []
  let total = 0
  for (const area of areas) {
    const label = area.label.trim()
    if (!label || area.sqm == null || !Number.isFinite(area.sqm)) continue
    total += area.sqm
    rows.push({ label, amountInc: 0, display: formatSqm(area.sqm), explain: true })
  }
  if (rows.length > 1) {
    rows.push({ label: 'Total area', amountInc: 0, display: formatSqm(round2(total)), explain: true })
  }
  return rows
}

function metresRow(amount: number | null | undefined): StatementLedgerDisplayRow | null {
  if (amount == null || !Number.isFinite(amount)) return null
  const text = round2(amount).toLocaleString('en-AU', { maximumFractionDigits: 2 })
  return { label: 'Cubic metres removed', amountInc: 0, display: `${text} m³`, explain: true }
}

/** Filled dollar lines must equal the invoice. An empty breakdown is left off the page. */
function assertExplained(heading: string, parts: StatementLedgerDisplayRow[], invoiceAmount: number) {
  if (parts.length === 0) return
  const sum = round2(parts.reduce((total, row) => total + row.amountInc, 0))
  if (closeMoney(sum, invoiceAmount)) return
  const names = parts.map(row => row.label.toLowerCase()).join(', ')
  throw new StatementReconciliationError(
    `${heading}: ${names} add to ${moneyLabel(sum)}, but the invoice amount is ${moneyLabel(invoiceAmount)}.`,
  )
}

function buildInvoice(input: {
  heading: string
  balanceName: string
  amountInc: number
  balanceInc: number
  deductions: StatementLedgerDisplayRow[]
  explanation: StatementLedgerDisplayRow[]
  payUrl: string
}): BuiltInvoice {
  const signed = input.deductions.reduce((sum, row) => sum + row.amountInc, 0)
  const computed = round2(input.amountInc + signed)
  if (!closeMoney(computed, input.balanceInc)) {
    throw new StatementReconciliationError(
      `${input.heading} does not reconcile. ${moneyLabel(input.amountInc)} plus the rows shown (${moneyLabel(signed)}) is ${moneyLabel(computed)}, but the balance is ${moneyLabel(input.balanceInc)}.`,
    )
  }
  const balance = round2(input.balanceInc)
  const payHref = balance > 0.004 ? statementPayHref(input.payUrl) : null
  const explained = input.explanation.length > 0
  return {
    heading: input.heading,
    amountInc: round2(input.amountInc),
    rows: [
      ...input.explanation,
      { label: 'Invoice amount', amountInc: round2(input.amountInc), charge: explained },
      ...input.deductions.map(row => ({ ...row, amountInc: round2(row.amountInc) })),
      { label: balanceLabel(input.balanceName, input.heading), amountInc: balance, strong: true },
    ],
    balanceInc: balance,
    payHref,
  }
}

function xeroWarning(number: string, balance: number, xeroDue: number | null | undefined, warnings: string[]) {
  if (xeroDue == null || !Number.isFinite(xeroDue)) return
  if (closeMoney(balance, xeroDue)) return
  const name = number.trim() || 'Invoice'
  warnings.push(`${name} balance on this statement is ${moneyLabel(balance)}. The Xero invoice amount due is ${moneyLabel(xeroDue)}.`)
}

/**
 * Client-facing statement. Calculations stay as typed on the job.
 * Each invoice balance is its amount plus the signed rows above it, and the
 * summary balance is the job total minus what has been paid.
 */
export function presentStatementDocument(c: StatementOfAccountsContent): StatementPresentation {
  const chargesGst = c.gst_mode !== 'no_gst'
  const invoice1Amount = round2(chargesGst ? c.quote_inc : c.quote_ex)
  const paid = round2(c.deposit_taken ? c.deposit_entered : 0)
  const hasInvoice2 = c.has_invoice2 === true
  const invoice2Amount = round2(hasInvoice2 ? (c.new_invoice_inc ?? 0) : 0)
  const remeasure = round2(c.remeasured ? (c.remeasure_inc ?? 0) : 0)
  const credit = remeasure > 0.004 ? remeasure : 0
  const increase = remeasure < -0.004 ? round2(-remeasure) : 0
  const sourceNumber = c.original_invoice_number?.trim() || 'Invoice 1'
  const targetNumber = c.new_invoice_number?.trim() || 'Invoice 2'
  const increaseOnSource = !hasInvoice2 && increase > 0
  const sourceBalance = round2(hasInvoice2 ? (c.original_owing_inc ?? invoice1Amount - paid) : c.owing_inc)
  const targetBalance = hasInvoice2 ? round2(c.invoice2_owing_inc ?? invoice2Amount - credit + increase) : 0
  const creditReflectedOnSource = credit > 0.004 && closeMoney(sourceBalance, round2(invoice1Amount - paid - credit))
  const jobTotal = round2(c.job_total_inc ?? (hasInvoice2 ? invoice1Amount - credit + increase + invoice2Amount : invoice1Amount - credit + increase))
  const balance = round2(c.owing_inc)
  const sourceRows: StatementLedgerDisplayRow[] = []
  if (paid > 0.004) sourceRows.push({ label: paymentDateLabel(c.deposit_date), amountInc: round2(-paid) })
  if (creditReflectedOnSource) {
    sourceRows.push({
      label: hasInvoice2 ? `Less: credit transferred to ${targetNumber}` : 'Less: adjustment',
      amountInc: round2(-credit),
    })
  }
  if (increaseOnSource) sourceRows.push({ label: 'Added from adjustment', amountInc: increase })
  const sourceHeading = invoiceHeading(c.original_invoice_number ?? '', 'Invoice 1 (initial works)')
  const sourceParts = moneyParts([
    ['Call out', c.invoice1_callout],
    ['Contents', c.invoice1_contents],
    ['Cleaning', c.invoice1_cleaning],
  ])
  assertExplained(sourceHeading, sourceParts, invoice1Amount)
  const source = buildInvoice({
    heading: sourceHeading,
    balanceName: (c.original_invoice_number ?? '').trim() || 'invoice 1',
    amountInc: invoice1Amount,
    balanceInc: sourceBalance,
    deductions: sourceRows,
    explanation: [...areaRows(c.survey_areas), ...sourceParts],
    payUrl: c.original_invoice_url ?? '',
  })
  const invoices: BuiltInvoice[] = [source]
  if (hasInvoice2) {
    const targetRows: StatementLedgerDisplayRow[] = []
    if (credit > 0.004) {
      targetRows.push({
        label: `Less: credit from ${sourceNumber} adjustment (${moneyLabel(credit)})`,
        amountInc: round2(-credit),
      })
    }
    if (increase > 0.004) {
      targetRows.push({
        label: `Added from ${sourceNumber} adjustment`,
        amountInc: increase,
      })
    }
    const targetHeading = invoiceHeading(c.new_invoice_number ?? '', 'Invoice 2 (contents)')
    const targetParts = [
      ...moneyParts([
        ['Skips', c.invoice2_skips],
        ['Trailers', c.invoice2_trailers],
        ['Utes', c.invoice2_utes],
        ['Tip receipts', c.invoice2_tip_receipts],
      ]),
      ...moneyParts([['Prepaid', c.invoice2_prepaid]]).map(row => ({ ...row, amountInc: round2(-row.amountInc) })),
    ]
    assertExplained(targetHeading, targetParts, invoice2Amount)
    const metres = metresRow(c.invoice2_m3)
    invoices.push(buildInvoice({
      heading: targetHeading,
      balanceName: (c.new_invoice_number ?? '').trim() || 'invoice 2',
      amountInc: invoice2Amount,
      balanceInc: targetBalance,
      deductions: targetRows,
      explanation: metres ? [metres, ...targetParts] : targetParts,
      payUrl: c.new_invoice_url ?? '',
    }))
  }
  const summed = round2(invoices.reduce((sum, invoice) => sum + invoice.balanceInc, 0))
  if (!closeMoney(summed, balance)) {
    throw new StatementReconciliationError(
      `Invoice balances add to ${moneyLabel(summed)}, but the statement balance due is ${moneyLabel(balance)}.`,
    )
  }
  if (!closeMoney(round2(jobTotal - paid), balance)) {
    throw new StatementReconciliationError(
      `Total job value ${moneyLabel(jobTotal)} minus paid to date ${moneyLabel(paid)} is ${moneyLabel(round2(jobTotal - paid))}, but the balance due is ${moneyLabel(balance)}.`,
    )
  }
  let adjustmentNote: string | null = null
  if (credit > 0.004 || increase > 0.004) {
    const reason = (c.adjustment_reason ?? '').trim()
    if (!reason) {
      throw new StatementReconciliationError('Enter why invoice 1 changed. The statement needs that reason before it can be generated.')
    }
    const amount = moneyLabel(credit || increase)
    if (credit > 0.004 && hasInvoice2) {
      adjustmentNote = `${sourceNumber} was reduced by ${amount} (inc GST) because ${reason}. This credit has been applied to ${targetNumber}.`
    } else if (increase > 0.004 && hasInvoice2) {
      adjustmentNote = `${sourceNumber} was increased by ${amount} (inc GST) because ${reason}. This amount has been added to ${targetNumber}.`
    } else if (credit > 0.004) {
      adjustmentNote = `${sourceNumber} was reduced by ${amount} (inc GST) because ${reason}.`
    } else {
      adjustmentNote = `${sourceNumber} was increased by ${amount} (inc GST) because ${reason}.`
    }
  }
  const warnings: string[] = []
  xeroWarning(sourceNumber, source.balanceInc, c.xero_original_amount_due, warnings)
  if (hasInvoice2) xeroWarning(targetNumber, targetBalance, c.xero_new_amount_due, warnings)
  const gst = chargesGst && c.job_total_ex != null && c.job_total_inc != null
    ? round2(c.job_total_inc - c.job_total_ex)
    : null
  return {
    summary: { jobTotalInc: jobTotal, paidInc: paid, balanceInc: balance, gst },
    invoices: invoices.map(invoice => ({
      heading: invoice.heading,
      rows: invoice.rows,
      balanceInc: invoice.balanceInc,
      payHref: invoice.payHref,
      payLabel: invoice.payHref ? `Pay ${moneyLabel(invoice.balanceInc)} online` : null,
    })),
    adjustmentNote,
    warnings,
  }
}
