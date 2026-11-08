import type { AssessmentData, StatementLedgerLine, StatementOfAccountsContent, StatementOfAccountsV2Content } from '@/lib/types'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { formatAud } from '@/lib/disposalManifest'
import { biohazardCleaningFigures } from '@/lib/biohazardCleaningQuote'
import { biohazardRecordFromJob } from '@/lib/biohazardCleaningRecord'
import { normalizeSurfaceAreaCleaningCapture, surfaceAreaCaptureFigures } from '@/lib/surfaceAreaCleaningQuote'
import { contentsClearanceCaptureFigures, normalizeContentsClearanceCapture } from '@/lib/contentsClearanceQuote'
import { cdrSummary, surveySummary } from '@/lib/agent/recordSummaries'

export const STATEMENT_MODEL_VERSION = 2

interface StatementSurveyArea {
  label: string
  sqm: number | null
  total: number | null
}

/**
 * Model 2 reads deposit_amount, deposit_date, manual_adjustment (+ reason),
 * invoice_number / invoice_url, invoice2_number / invoice2_url and charges_gst.
 * The other fields are model 1 and are kept so saving does not drop them.
 */
export interface StatementOfAccountsCapture {
  model_version: number
  /** Invoice 1: the estimate invoice the deposit was paid against. */
  invoice_number: string
  invoice_url: string
  /** Invoice 2 (or credit note): the difference between the actual total and the estimate. */
  invoice2_number: string
  invoice2_url: string
  deposit_taken: boolean
  /** Dollars received. Includes GST when the statement charges GST. */
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
  /** Signed dollars. Negative reduces the balance. Includes GST when the statement charges GST. */
  manual_adjustment: number | null
  /** Required when an adjustment is entered. Printed with it. */
  manual_adjustment_reason: string
  /** The job charges GST: every typed amount includes it. */
  charges_gst: boolean
  /** When the deposit was received, shown on the statement as the payment date. */
  deposit_date: string
  /** Why invoice 1 was adjusted. Required before an adjusted statement can be generated. */
  adjustment_reason: string
}

function textField(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export function emptyStatementCapture(): StatementOfAccountsCapture {
  return {
    model_version: STATEMENT_MODEL_VERSION,
    invoice_number: '',
    invoice_url: '',
    invoice2_number: '',
    invoice2_url: '',
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
    manual_adjustment: null,
    manual_adjustment_reason: '',
    charges_gst: true,
    deposit_date: '',
    adjustment_reason: '',
  }
}

/** A model 1 capture is read as model 2: its deposit only counts when it was ticked as taken, and invoice 1 becomes the invoice. */
export function normalizeStatementCapture(raw: unknown): StatementOfAccountsCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const v2 = o.model_version === STATEMENT_MODEL_VERSION
  const amount = moneyOrNull(o.deposit_amount)
  const originalNumber = textField(o.original_invoice_number)
  const newNumber = textField(o.new_invoice_number)
  return {
    model_version: STATEMENT_MODEL_VERSION,
    invoice_number: v2 ? textField(o.invoice_number) : originalNumber || newNumber,
    invoice_url: v2
      ? textField(o.invoice_url)
      : (originalNumber ? textField(o.original_invoice_url) : textField(o.new_invoice_url) || textField(o.original_invoice_url)),
    invoice2_number: v2 ? textField(o.invoice2_number) : (originalNumber ? newNumber : ''),
    invoice2_url: v2 ? textField(o.invoice2_url) : (originalNumber ? textField(o.new_invoice_url) : ''),
    deposit_taken: v2 ? (amount ?? 0) > 0 : o.deposit_taken === true,
    deposit_amount: v2 || o.deposit_taken === true ? amount : null,
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
    manual_adjustment: signedMoneyOrNull(o.manual_adjustment),
    manual_adjustment_reason: textField(o.manual_adjustment_reason),
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
    const total = moneyOrNull(row.total)
    if (!label && sqm == null && total == null) return []
    return [{ label, sqm, total }]
  })
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

function signedMoneyOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.004) return null
  return amount
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function formatSqm(n: number): string {
  const text = round2(n).toLocaleString('en-AU', { maximumFractionDigits: 2 })
  return `${text} m²`
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
  /** Square metres printed between the item and the amount. */
  quantity?: string
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
  let sqm = 0
  let price = 0
  let priced = 0
  for (const area of areas) {
    const label = area.label.trim()
    if (!label || area.sqm == null || !Number.isFinite(area.sqm)) continue
    sqm += area.sqm
    const total = area.total
    const hasTotal = total != null && Number.isFinite(total)
    if (hasTotal) {
      price += total
      priced += 1
    }
    rows.push({
      label,
      quantity: formatSqm(area.sqm),
      amountInc: hasTotal ? round2(total) : 0,
      display: hasTotal ? undefined : '—',
      explain: true,
    })
  }
  if (rows.length > 1) {
    rows.push({
      label: 'Total area',
      quantity: formatSqm(round2(sqm)),
      amountInc: round2(price),
      display: priced > 0 ? undefined : '—',
      explain: true,
    })
  }
  return rows
}

function explanationWithAreas(parts: StatementLedgerDisplayRow[], areas: StatementLedgerDisplayRow[]): StatementLedgerDisplayRow[] {
  const cleaning = parts.findIndex(row => row.label === 'Cleaning')
  if (cleaning < 0) return [...parts, ...areas]
  return [...parts.slice(0, cleaning + 1), ...areas, ...parts.slice(cleaning + 1)]
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
  /** Layout 2 prints survey rooms and CDR facts in their own sections, so the invoices do not repeat them. */
  const combined = c.layout_version === 2
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
  const manualInc = round2(c.manual_adjustment_inc ?? 0)
  const manualReason = (c.manual_adjustment_reason ?? '').trim()
  const manualRow: StatementLedgerDisplayRow | null = Math.abs(manualInc) < 0.004
    ? null
    : manualReason
      ? { label: manualReason, amountInc: manualInc }
      : (() => {
          throw new StatementReconciliationError('Enter why the last invoice total changed. The statement needs that reason before it can be generated.')
        })()
  const balanceForCreditCheck = hasInvoice2 ? sourceBalance : round2(sourceBalance - manualInc)
  const creditReflectedOnSource = credit > 0.004 && closeMoney(balanceForCreditCheck, round2(invoice1Amount - paid - credit))
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
  if (!hasInvoice2 && manualRow) sourceRows.push(manualRow)
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
    explanation: combined
      ? sourceParts
      : explanationWithAreas(sourceParts, areaRows(c.survey_areas?.map(area => ({
          label: area.label,
          sqm: area.sqm,
          total: area.total ?? null,
        })))),
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
    if (manualRow) targetRows.push(manualRow)
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
    const metres = combined && c.disposal_snapshot ? null : metresRow(c.invoice2_m3)
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

export function isStatementV2Content(content: unknown): content is StatementOfAccountsV2Content {
  return Boolean(content && typeof content === 'object' && (content as { model_version?: unknown }).model_version === STATEMENT_MODEL_VERSION)
}

export type StatementLineKey = 'surface' | 'contents' | 'biohazard'

export interface StatementEstimate {
  key: StatementLineKey
  label: string
  /** Inc GST when the statement charges GST. */
  amount: number
}

export type StatementV2Figures = Omit<StatementOfAccountsV2Content, 'model_version' | 'title' | 'reference' | 'site_address' | 'payment_terms' | 'due_date'> & {
  estimates: StatementEstimate[]
  /** Half the quotes' total, in the statement's GST basis. Null without quotes. */
  suggested_deposit: number | null
}

const LINE_LABELS: Record<StatementLineKey, string> = {
  surface: 'Surface cleaning',
  contents: 'Contents removal',
  biohazard: 'Biohazard cleaning',
}

const ADJUSTMENT_LABELS: Record<StatementLineKey, string> = {
  surface: 'Surface area cleaning (SACQ)',
  contents: 'Contents clearance (CCQ)',
  biohazard: 'Biohazard cleaning (BCQ)',
}

const ESTIMATE_LABELS: Record<StatementLineKey, string> = {
  surface: 'Surface area cleaning',
  contents: 'Contents clearance',
  biohazard: 'Biohazard cleaning',
}

/** Quote totals ex GST. A quote counts once it has a price. */
function quoteTotals(ad: AssessmentData | null | undefined): Partial<Record<StatementLineKey, number>> {
  const totals: Partial<Record<StatementLineKey, number>> = {}
  if (ad?.surface_area_cleaning_quote != null) {
    const ex = surfaceAreaCaptureFigures(normalizeSurfaceAreaCleaningCapture(ad.surface_area_cleaning_quote)).subtotal
    if (ex > 0.004) totals.surface = ex
  }
  if (ad?.contents_clearance_quote != null) {
    const ex = contentsClearanceCaptureFigures(normalizeContentsClearanceCapture(ad.contents_clearance_quote)).subtotal
    if (ex > 0.004) totals.contents = ex
  }
  const bcq = biohazardRecordFromJob(ad)
  if (bcq) {
    const ex = biohazardCleaningFigures(bcq.quote).subtotal
    if (ex > 0.004) totals.biohazard = ex
  }
  return totals
}

function longDate(raw: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!iso) return raw.trim()
  const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  if (Number.isNaN(date.getTime())) return raw.trim()
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function estimatesNote(estimates: StatementEstimate[]): string {
  if (estimates.length === 0) return ''
  const total = round2(estimates.reduce((sum, e) => sum + e.amount, 0))
  const parts = estimates.map(e => `${e.label} ${formatAud(e.amount)}`).join(', ')
  return `The original estimates totalled ${formatAud(total)} (${parts}). Final figures are based on measured surface area, counted volume and work completed.`
}

/**
 * The statement's only maths: each record's total, GST once, less the deposit,
 * plus an optional adjustment. Quotes are shown as estimates and never added in.
 */
export function statementV2Figures(
  ad: AssessmentData | null | undefined,
  capture: StatementOfAccountsCapture = normalizeStatementCapture(ad?.statement_of_accounts),
): StatementV2Figures {
  const quotes = quoteTotals(ad)
  const problems: string[] = []
  const lines: StatementOfAccountsV2Content['lines'] = []
  const actual: Partial<Record<StatementLineKey, number>> = {}
  const add = (key: StatementLineKey, ex: number | null | undefined) => {
    if (ex == null || ex <= 0.004) return
    actual[key] = round2(ex)
    lines.push({ label: LINE_LABELS[key], amount_ex: round2(ex) })
  }

  const survey = surveySummary(ad)
  if (quotes.surface != null && !survey.exists) problems.push('The surface area cleaning quote needs a House Survey. Measure the surfaces first.')
  else if (quotes.surface != null && survey.total_ex_gst == null) problems.push('The House Survey has no total yet. Measure an area and set the rate.')
  add('surface', survey.total_ex_gst)

  const cdr = cdrSummary(ad)
  if (quotes.contents != null && !cdr.exists) problems.push('The contents clearance quote needs a Contents Disposal Record. Count the loads first.')
  else if (quotes.contents != null && cdr.total_ex_gst == null) problems.push('The Contents Disposal Record has no total yet.')
  add('contents', cdr.total_ex_gst)

  const bcq = biohazardRecordFromJob(ad)
  if (bcq?.needed) {
    if (!bcq.exists) problems.push('The Biohazard Cleaning Quote is priced by area or tests. Fill in the Biohazard Cleaning Record on the House Survey.')
    else if (bcq.summary.missing.length > 0) problems.push(`The Biohazard Cleaning Record is missing: ${bcq.summary.missing.join(', ')}.`)
    add('biohazard', bcq.summary.total_ex)
  } else {
    add('biohazard', quotes.biohazard)
  }

  if (lines.length === 0 && problems.length === 0) problems.push('There is nothing to bill yet. Complete the House Survey, Contents Disposal Record or Biohazard Cleaning Record.')

  const charges_gst = capture.charges_gst
  const total_ex = round2(lines.reduce((sum, line) => sum + line.amount_ex, 0))
  const gst = charges_gst ? round2(total_ex * 0.1) : 0
  const total_inc = round2(total_ex + gst)
  const deposit = round2(capture.deposit_amount ?? 0)
  if (deposit > 0.004 && !capture.deposit_date.trim()) problems.push('Enter the date the deposit was paid.')
  const adjustment = capture.manual_adjustment == null ? null : round2(capture.manual_adjustment)
  const adjustment_reason = capture.manual_adjustment_reason.trim()
  if (adjustment != null && !adjustment_reason) problems.push('Enter the reason for the adjustment.')

  const basis = (ex: number) => charges_gst ? round2(ex * 1.1) : round2(ex)
  const estimates = (Object.keys(ESTIMATE_LABELS) as StatementLineKey[]).flatMap(key => {
    const ex = quotes[key]
    return ex == null ? [] : [{ key, label: ESTIMATE_LABELS[key], amount: basis(ex) }]
  })
  const quoted = estimates.reduce((sum, e) => sum + e.amount, 0)
  const adjustment_lines = estimates.length === 0 ? [] : (Object.keys(ADJUSTMENT_LABELS) as StatementLineKey[]).flatMap(key => {
    const actual_ex = actual[key] ?? 0
    const estimate_ex = round2(quotes[key] ?? 0)
    return Math.abs(actual_ex - estimate_ex) > 0.004 ? [{ label: ADJUSTMENT_LABELS[key], actual_ex, estimate_ex }] : []
  })
  return {
    adjustment_lines,
    charges_gst,
    estimates_note: estimatesNote(estimates),
    lines,
    total_ex,
    gst,
    total_inc,
    deposit,
    deposit_date: capture.deposit_date.trim(),
    adjustment,
    adjustment_reason,
    balance: round2(total_inc - deposit + (adjustment ?? 0)),
    invoice_number: capture.invoice_number.trim(),
    invoice_url: capture.invoice_url.trim(),
    invoice2_number: capture.invoice2_number.trim(),
    invoice2_url: capture.invoice2_url.trim(),
    estimate_total: estimates.length > 0 ? round2(quoted) : null,
    problems,
    estimates,
    suggested_deposit: estimates.length > 0 ? round2(quoted / 2) : null,
  }
}

export function statementV2Content(f: StatementV2Figures, reference: string, siteAddress: string): StatementOfAccountsV2Content {
  return {
    model_version: STATEMENT_MODEL_VERSION,
    title: 'Statement of Accounts',
    reference,
    site_address: siteAddress,
    charges_gst: f.charges_gst,
    estimates_note: f.estimates_note,
    lines: f.lines,
    total_ex: f.total_ex,
    gst: f.gst,
    total_inc: f.total_inc,
    deposit: f.deposit,
    deposit_date: f.deposit_date,
    adjustment: f.adjustment,
    adjustment_reason: f.adjustment_reason,
    balance: f.balance,
    invoice_number: f.invoice_number,
    invoice_url: f.invoice_url,
    invoice2_number: f.invoice2_number,
    invoice2_url: f.invoice2_url,
    estimate_total: f.estimate_total,
    adjustment_lines: f.adjustment_lines,
    problems: f.problems,
  }
}

export interface StatementV2Row {
  label: string
  amount: number
  /** Totals and the balance. */
  strong?: boolean
}

export interface StatementV2Presentation {
  rows: StatementV2Row[]
  jobTotal: number
  paid: number
  /** Positive is owing. Negative is a credit to the client. */
  balance: number
  balanceLabel: 'Balance owing' | 'Credit'
  payHref: string | null
  payLabel: string | null
  estimatesNote: string
  /** How the balance is split across the Xero invoices. Empty without an estimate. */
  invoices: StatementV2Invoice[]
  invoicesNote: string
}

export interface StatementV2Invoice {
  heading: string
  detail: string
  /** Positive is still to pay on this invoice. Negative is a credit. */
  amount: number
  amountLabel: string
  payHref: string | null
  payLabel: string | null
  /** Invoice 2 only: each quote's actual against its estimate, then any adjustment. */
  breakdown: StatementV2AdjustmentRow[]
}

export interface StatementV2AdjustmentRow {
  label: string
  /** Ex GST. Null on the manual adjustment row. */
  actual_ex: number | null
  estimate_ex: number | null
  difference_ex: number
  gst: number
  difference_inc: number
}

/** The invoice 2 total row: inc GST is the invoice amount, so per-line rounding never changes what is billed. */
export function breakdownTotal(invoice: Pick<StatementV2Invoice, 'amount' | 'breakdown'>): StatementV2AdjustmentRow {
  const difference_ex = round2(invoice.breakdown.reduce((sum, row) => sum + row.difference_ex, 0))
  return { label: invoice.amount < -0.004 ? 'Credit note total' : 'Invoice 2 total', actual_ex: null, estimate_ex: null, difference_ex, gst: round2(invoice.amount - difference_ex), difference_inc: invoice.amount }
}

type StatementV2Split = Pick<StatementOfAccountsV2Content,
  'charges_gst' | 'total_inc' | 'deposit' | 'adjustment' | 'adjustment_reason' | 'invoice_number' | 'invoice_url' | 'invoice2_number' | 'invoice2_url' | 'estimate_total' | 'adjustment_lines'>

export const STATEMENT_INVOICES_NOTE =
  'The original estimate was invoiced on invoice 1 and the deposit was paid against it. Invoice 2 covers the difference between the final figures and the estimate, or is a credit note when the final figures came in lower. Together they make up the balance.'

/**
 * The balance as it is billed in Xero: invoice 1 is the estimate less the
 * deposit; invoice 2 (or a credit note) is the actual total less the estimate,
 * plus any adjustment. The two always add up to the balance.
 */
export function statementV2Invoices(c: StatementV2Split): StatementV2Invoice[] {
  const estimate = c.estimate_total
  if (estimate == null || estimate <= 0.004) return []
  const title = (name: string, number: string | undefined) => number?.trim() ? `${name} ${number.trim()}` : name
  const pay = (url: string | undefined, amount: number) => {
    const payHref = amount > 0.004 ? statementPayHref(url ?? '') : null
    return { payHref, payLabel: payHref ? `Pay ${moneyLabel(amount)} online` : null }
  }
  const gstNote = c.charges_gst ? ' inc GST' : ''
  const invoice1 = round2(estimate - c.deposit)
  const invoices: StatementV2Invoice[] = [{
    heading: `${title('Invoice 1', c.invoice_number)} · estimate`,
    detail: `Original estimate ${formatAud(estimate)}${c.deposit > 0.004 ? ` less deposit paid ${formatAud(c.deposit)}` : ''}${gstNote}.`,
    amount: invoice1,
    amountLabel: invoice1 > 0.004 ? 'Still to pay' : invoice1 < -0.004 ? 'Overpaid' : 'Paid',
    ...pay(c.invoice_url, invoice1),
    breakdown: [],
  }]
  const basis = (ex: number) => c.charges_gst ? round2(ex * 1.1) : round2(ex)
  const breakdown: StatementV2AdjustmentRow[] = (c.adjustment_lines ?? []).map(line => {
    const difference_ex = round2(line.actual_ex - line.estimate_ex)
    const difference_inc = round2(basis(line.actual_ex) - basis(line.estimate_ex))
    return { label: line.label, actual_ex: line.actual_ex, estimate_ex: line.estimate_ex, difference_ex, gst: round2(difference_inc - difference_ex), difference_inc }
  })
  if (c.adjustment != null) {
    const difference_ex = c.charges_gst ? round2(c.adjustment / 1.1) : c.adjustment
    breakdown.push({
      label: `Adjustment (${c.adjustment_reason.trim() || 'adjustment'})`,
      actual_ex: null,
      estimate_ex: null,
      difference_ex,
      gst: round2(c.adjustment - difference_ex),
      difference_inc: c.adjustment,
    })
  }
  const invoice2 = round2(c.total_inc - estimate + (c.adjustment ?? 0))
  if (Math.abs(invoice2) > 0.004 || c.invoice2_number?.trim()) {
    const adjustment = c.adjustment == null
      ? ''
      : `, ${c.adjustment < 0 ? 'less' : 'plus'} ${c.adjustment_reason.trim() || 'adjustment'} ${formatAud(Math.abs(c.adjustment))}`
    invoices.push({
      heading: `${title(invoice2 < -0.004 ? 'Credit note' : 'Invoice 2', c.invoice2_number)} · adjustment to actual`,
      detail: `Actual job total ${formatAud(c.total_inc)} less the original estimate ${formatAud(estimate)}${adjustment}${gstNote}.`,
      amount: invoice2,
      amountLabel: invoice2 > 0.004 ? 'To pay' : invoice2 < -0.004 ? 'Credit' : 'Nil',
      ...pay(c.invoice2_url, invoice2),
      breakdown,
    })
  }
  return invoices
}

type StatementV2Totals = Pick<StatementOfAccountsV2Content,
  'charges_gst' | 'lines' | 'total_ex' | 'gst' | 'total_inc' | 'deposit' | 'deposit_date' | 'adjustment' | 'adjustment_reason' | 'balance' | 'invoice_url' | 'estimates_note'>

/** The summary rows. One source for the tab, the printed statement and the payment reminder. */
export function statementV2Rows(c: StatementV2Totals): StatementV2Row[] {
  const rows: StatementV2Row[] = c.lines.map(line => ({ label: line.label, amount: line.amount_ex }))
  if (c.charges_gst) {
    rows.push({ label: 'Job total ex GST', amount: c.total_ex, strong: true })
    rows.push({ label: 'GST', amount: c.gst })
    rows.push({ label: 'Job total inc GST', amount: c.total_inc, strong: true })
  } else {
    rows.push({ label: 'Job total', amount: c.total_ex, strong: true })
  }
  if (c.deposit > 0.004) {
    rows.push({ label: c.deposit_date ? `Less deposit paid (${longDate(c.deposit_date)})` : 'Less deposit paid', amount: -c.deposit })
  }
  if (c.adjustment != null) rows.push({ label: `Adjustment (${c.adjustment_reason})`, amount: c.adjustment })
  const credit = c.balance < -0.004
  rows.push({ label: credit ? 'Credit' : 'Balance owing', amount: credit ? -c.balance : c.balance, strong: true })
  return rows
}

/** Throws when the statement cannot be issued, so the page and print refuse it with the reason. */
export function presentStatementV2(c: StatementOfAccountsV2Content): StatementV2Presentation {
  if (c.problems.length > 0) throw new StatementReconciliationError(c.problems.join(' '))
  const invoices = statementV2Invoices(c)
  const payHref = invoices.length === 0 && c.balance > 0.004 ? statementPayHref(c.invoice_url) : null
  return {
    invoices,
    invoicesNote: invoices.length > 0 ? STATEMENT_INVOICES_NOTE : '',
    rows: statementV2Rows(c),
    jobTotal: c.total_inc,
    paid: c.deposit,
    balance: c.balance,
    balanceLabel: c.balance < -0.004 ? 'Credit' : 'Balance owing',
    payHref,
    payLabel: payHref ? `Pay ${moneyLabel(c.balance)} online` : null,
    estimatesNote: c.estimates_note,
  }
}

/** The statement as the payment reminder shows it: job total, deposit, adjustment, balance. */
export function statementReminderLines(f: StatementV2Figures): StatementLedgerLine[] {
  const pair = (amount: number) => ({ ex: f.charges_gst ? round2(amount / 1.1) : amount, inc: amount })
  const lines: StatementLedgerLine[] = [{ label: 'Job total', ex: f.total_ex, inc: f.total_inc }]
  if (f.deposit > 0.004) lines.push({ label: 'Less deposit paid', ...pair(-f.deposit) })
  if (f.adjustment != null) lines.push({ label: `Adjustment (${f.adjustment_reason})`, ...pair(f.adjustment) })
  lines.push({ label: f.balance < -0.004 ? 'Credit' : 'Balance owing', ...pair(Math.abs(f.balance)), strong: true })
  return lines
}
