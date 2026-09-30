import type { ContentsClearanceQuoteContent } from '@/lib/contentsClearanceQuote'
import { proseHasPrintableContent } from '@/lib/richTextPrint'
import type { SurfaceAreaCleaningQuoteContent } from '@/lib/surfaceAreaCleaningQuote'

/**
 * One engagement agreement for contents clearance and surface cleaning.
 * The contents-clearance copy wins when it has text. Otherwise the surface-cleaning copy is used.
 * An edit is written back to both, so the next quote of either kind starts from the latest text.
 */
export function sharedEngagementAgreement(primary: unknown, secondary: unknown): string {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const first = text(primary)
  const second = text(secondary)
  if (proseHasPrintableContent(first)) return first
  if (proseHasPrintableContent(second)) return second
  return first || second
}

export function withSharedEngagement<T extends { engagement_agreement: string }>(
  standards: T,
  engagement: string,
): T {
  return { ...standards, engagement_agreement: engagement }
}

/** Company engagement. Brackets are filled on the printed quote. Signature lines stay blank. */
export const DEFAULT_ENGAGEMENT_AGREEMENT = `ENGAGEMENT AGREEMENT

[company] ("the Contractor") and [name] ("the Client") agree to the [title] at [address]. This agreement is part of quote [reference], dated [date].

The price is [total] including GST.
Estimated contents: [volume].
Contents rate: [rate per m3] ex GST.
Contents amount: [volume amount] ex GST.
Estimated travel: [kilometres].
Travel rate: [rate per km] ex GST.
Travel amount: [distance amount] ex GST.
Disposal: [tonnes].
Disposal rate: [rate per tonne] ex GST.
Estimated surface: [surface].
Surface rate: [rate per m2] ex GST.
Surface amount: [surface amount] ex GST.
Labour: [labour days] for the fixed amount of [labour amount] ex GST.
Mobilisation: [mobilisation].
Deposit: [deposit], half the price including GST, before the work starts. Balance: [balance], due 7 days from the invoice.

1. Capacity and payment
1.1 The Contractor performs the works in this quote for the Client. The Signatory signs in the capacity ticked below.
1.2 Executor or administrator. The Signatory signs for an estate. They pay the Contractor from estate funds before distributing assets. They are personally liable if they lacked authority, or if they distribute assets without paying the Contractor. If probate has not been granted, they are personally liable until a legal personal representative adopts this agreement in writing and pays the Contractor.
1.3 Signing personally. The Signatory is personally liable. Payment in full from estate funds discharges that liability, and the Contractor refunds anything the Signatory paid personally.
1.4 The Signatory warrants they can arrange access and can direct removal and disposal of the contents. They warrant that no beneficiary, co-executor, owner, landlord, or other person with an interest in the contents objects. They indemnify the Contractor against a claim arising from removal or disposal under their instructions.

2. Works and retained items
2.1 The works are those described in this quote. Disposal, recycling, or donation of contents that are not retained is at the Contractor's discretion.
2.2 Before the works start, the Signatory removes every item they want kept, or marks it and lists it below. Every other item is authorised for disposal. Disposal cannot be reversed. The Contractor is not liable for an item removed under this clause.
2.3 The Contractor sets aside and reports cash, jewellery, documents, photographs, identification, keys, or other items of apparent value or personal significance that it finds. The Signatory collects these within 7 days of notice. After that they may be treated as abandoned. The Contractor searches for a specific item only when that search is listed in the works.

3. Quantities, hazards, and the site
3.1 Contents are estimated at [volume]. The measured volume replaces that estimate and is charged at [rate per m3] ex GST. The Contractor will tell the Signatory before charging a measured volume above [volume].
3.2 Travel is estimated at [kilometres] and is charged at [rate per km] ex GST.
3.3 Surface cleaning is estimated at [surface] and is charged at [rate per m2] ex GST.
3.4 Labour stays the fixed amount in this quote. It is not recalculated from the measured volume or the measured area.
3.5 If the Contractor finds an undisclosed hazard, such as bodily fluids, sharps, drugs, chemicals, gas cylinders, ammunition or firearms, asbestos, or extensive mould or vermin, it may stop the affected area until the Signatory approves a written variation by text or email. The Contractor reports firearms and illicit substances to police as the law requires.
3.6 The Signatory provides access and a clear space for the Contractor's vehicles. If access is unavailable, the Contractor may charge the extra cost.
3.7 Where contents are moved, minor scuffs to walls, doorways, or floors are a risk of the works. The Contractor remains liable for damage caused by its negligence.

4. Payment
4.1 The Contractor may address the invoice to the Client, the Client's solicitor, or, for an estate, the estate care of the Signatory. The completion report and disposal records are released when payment is made in full.
4.2 An overdue amount attracts interest at 10% per year, plus reasonable recovery costs.
4.3 Cancelling within 48 hours of the start, or failing to provide access, incurs the mobilisation fee in this quote when one is charged. If the works stop part-way, the Contractor is paid for the work done and for disposal costs already incurred.

5. General
The Contractor's liability is limited to the price paid for the works, to the extent the law allows, including the Australian Consumer Law. The Contractor holds public liability insurance. This agreement is governed by Queensland law and may be signed electronically. An approval or a variation may be given by text or email.

Signatory: [name], [address], [phone], [email]

Areas to be cleared: ____________________
Items to be retained: ____________________
Start date: ____________________

Signing capacity (tick one):
☐ Executor, probate not yet granted
☐ Executor, probate granted. Date: __________
☐ Administrator, letters granted. Date: __________
☐ Signing personally. Relationship to the deceased: __________

Signatory: ____________________  Name: ____________________  Date: __________
For the Contractor: ____________________  Name: ____________________  Date: __________`

/**
 * The first saved estate draft used blanks such as $[amount]. That draft is replaced by the bracketed agreement.
 * Any other saved wording is kept.
 */
export function storedEngagementAgreement(saved: string, fallback: string): string {
  const plain = saved.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ')
  if (/CONTENTS REMOVAL \(DECEASED ESTATE\)/i.test(plain) || /\$\[amount\]/.test(plain)) return fallback
  return saved
}

/** Values available when an engagement agreement is printed. Absent fields are left out of the document. */
export interface EngagementTokenValues {
  name?: string
  address?: string
  title?: string
  reference?: string
  labourDays?: number
  labourAmount?: number
  mobilisation?: number
  subtotal?: number
  gst?: number
  total?: number
  volume?: number
  volumeAmount?: number
  kilometres?: number
  distanceAmount?: number
  tipAddress?: string
  tonnes?: number
  surface?: number
  surfaceAmount?: number
  ratePerM3?: number
  ratePerKm?: number
  ratePerTonne?: number
  ratePerM2?: number
  deposit?: number
  balance?: number
  date?: string
  company?: string
  phone?: string
  email?: string
}

export interface EngagementPrintContext {
  companyName?: string | null
  abn?: string | null
  phone?: string | null
  email?: string | null
  date?: string | null
}

function textValue(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed || null
}

function quantityValue(value: number | undefined, unit: string): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  const amount = value.toLocaleString('en-AU', { maximumFractionDigits: 2 })
  return unit ? `${amount} ${unit}` : amount
}

function moneyValue(value: number | undefined, onlyWhenCharged = false): string | null {
  if (value == null || !Number.isFinite(value)) return null
  if (onlyWhenCharged && value <= 0) return null
  return '$' + value.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const ENGAGEMENT_TOKENS: Record<string, (values: EngagementTokenValues) => string | null> = {
  name: values => textValue(values.name),
  address: values => textValue(values.address),
  title: values => textValue(values.title),
  reference: values => textValue(values.reference),
  'labour days': values => quantityValue(values.labourDays, values.labourDays === 1 ? 'labour day' : 'labour days'),
  'labour amount': values => moneyValue(values.labourAmount),
  mobilisation: values => moneyValue(values.mobilisation, true),
  subtotal: values => moneyValue(values.subtotal),
  gst: values => moneyValue(values.gst),
  total: values => moneyValue(values.total),
  volume: values => quantityValue(values.volume, 'm³'),
  'volume amount': values => moneyValue(values.volumeAmount, true),
  kilometres: values => quantityValue(values.kilometres, 'km'),
  'distance amount': values => moneyValue(values.distanceAmount, true),
  'tip address': values => textValue(values.tipAddress),
  tonnes: values => quantityValue(values.tonnes, values.tonnes === 1 ? 'tonne' : 'tonnes'),
  surface: values => quantityValue(values.surface, 'm²'),
  'surface amount': values => moneyValue(values.surfaceAmount, true),
  'rate per m3': values => moneyValue(values.ratePerM3, true),
  'rate per m³': values => moneyValue(values.ratePerM3, true),
  'rate per cubic metre': values => moneyValue(values.ratePerM3, true),
  'rate per km': values => moneyValue(values.ratePerKm, true),
  'rate per kilometre': values => moneyValue(values.ratePerKm, true),
  'rate per tonne': values => moneyValue(values.ratePerTonne, true),
  'rate per m2': values => moneyValue(values.ratePerM2, true),
  'rate per m²': values => moneyValue(values.ratePerM2, true),
  'rate per square metre': values => moneyValue(values.ratePerM2, true),
  deposit: values => moneyValue(values.deposit, true),
  balance: values => moneyValue(values.balance, true),
  date: values => textValue(values.date),
  company: values => textValue(values.company),
  phone: values => textValue(values.phone),
  email: values => textValue(values.email),
}

function tokenKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

function knownTokenKeys(text: string): string[] {
  const keys: string[] = []
  for (const match of text.matchAll(/\[([^\[\]\n]+)\]/g)) {
    const key = tokenKey(match[1])
    if (ENGAGEMENT_TOKENS[key]) keys.push(key)
  }
  return keys
}

function sentenceHasNoValue(sentence: string, values: EngagementTokenValues): boolean {
  const keys = knownTokenKeys(sentence)
  return keys.length > 0 && keys.every(key => !ENGAGEMENT_TOKENS[key](values))
}

function keepSentences(text: string, values: EngagementTokenValues): string {
  return text
    .split(/(?<=\.)\s+/)
    .filter(sentence => !sentenceHasNoValue(sentence, values))
    .join(' ')
    .trim()
}

function dropEmptyTokenSentences(text: string, values: EngagementTokenValues): string {
  if (/<p\b/i.test(text)) {
    return text
      .replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, paragraph => {
        const open = paragraph.match(/^<p\b[^>]*>/i)?.[0] ?? '<p>'
        const inner = keepSentences(paragraph.slice(open.length, -4), values)
        return inner ? `${open}${inner}</p>` : ''
      })
      .replace(/\n{3,}/g, '\n\n')
  }
  return text
    .split('\n')
    .map(line => keepSentences(line, values))
    .filter(line => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function escapeToken(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Replace brackets in the saved engagement agreement. The saved text is unchanged.
 * A bracket this quote does not have is removed. Any other bracket is left as written.
 */
export function fillEngagementAgreement(template: string, values: EngagementTokenValues): string {
  if (!template) return template
  const html = /<[a-z][\s\S]*>/i.test(template.trim())
  const prepared = dropEmptyTokenSentences(template, values)
  const filled = prepared.replace(/\[([^\[\]\n]+)\]/g, (match, raw: string) => {
    const format = ENGAGEMENT_TOKENS[tokenKey(raw)]
    if (!format) return match
    const value = format(values)
    if (!value) return ''
    return html ? escapeToken(value) : value
  })
  return filled
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/\(\s*\)/g, '')
}

function companyLabel(context?: EngagementPrintContext): string | undefined {
  const name = (context?.companyName ?? '').trim()
  if (!name) return undefined
  const abn = (context?.abn ?? '').trim()
  return abn ? `${name} (ABN ${abn})` : name
}

function quoteDate(context?: EngagementPrintContext): string {
  const given = (context?.date ?? '').trim()
  if (given) return given
  return new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function halfThePrice(total: number): { deposit: number, balance: number } {
  if (!Number.isFinite(total) || total <= 0) return { deposit: 0, balance: 0 }
  const deposit = Math.round(total * 50) / 100
  const balance = Math.round((total - deposit) * 100) / 100
  return { deposit, balance }
}

export function fillContentsClearanceEngagement(
  content: ContentsClearanceQuoteContent,
  context?: EngagementPrintContext,
): string {
  const title = content.title.trim().replace(/ Quote$/i, '')
  const split = halfThePrice(content.total)
  return fillEngagementAgreement(content.engagement_agreement, {
    name: content.client_name,
    address: content.job_address || content.site_address,
    title,
    reference: content.reference,
    labourDays: content.labour_days,
    labourAmount: content.labour_amount,
    mobilisation: content.mobilisation_fee,
    subtotal: content.subtotal,
    gst: content.gst,
    total: content.total,
    volume: content.estimated_m3,
    volumeAmount: content.volume_amount,
    kilometres: content.estimated_km,
    distanceAmount: content.distance_amount,
    tipAddress: content.tip_address,
    tonnes: content.estimated_tonnes,
    ratePerM3: content.rate_per_m3,
    ratePerKm: content.rate_per_km,
    ratePerTonne: content.disposal_rate_per_tonne,
    deposit: split.deposit,
    balance: split.balance,
    date: quoteDate(context),
    company: companyLabel(context),
    phone: context?.phone ?? undefined,
    email: context?.email ?? undefined,
  })
}

export function fillSurfaceAreaCleaningEngagement(
  content: SurfaceAreaCleaningQuoteContent,
  context?: EngagementPrintContext,
): string {
  const title = content.title.trim().replace(/ Quote$/i, '')
  const split = halfThePrice(content.total)
  return fillEngagementAgreement(content.engagement_agreement, {
    name: content.client_name,
    address: content.job_address || content.site_address,
    title,
    reference: content.reference,
    labourDays: content.labour_days,
    labourAmount: content.labour_amount,
    mobilisation: content.mobilisation_fee,
    subtotal: content.subtotal,
    gst: content.gst,
    total: content.total,
    surface: content.estimated_m2,
    surfaceAmount: content.area_amount,
    ratePerM2: content.rate_per_m2,
    deposit: split.deposit,
    balance: split.balance,
    date: quoteDate(context),
    company: companyLabel(context),
    phone: context?.phone ?? undefined,
    email: context?.email ?? undefined,
  })
}
