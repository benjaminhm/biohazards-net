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
  'volume amount': values => moneyValue(values.volumeAmount),
  kilometres: values => quantityValue(values.kilometres, 'km'),
  'distance amount': values => moneyValue(values.distanceAmount),
  'tip address': values => textValue(values.tipAddress),
  tonnes: values => quantityValue(values.tonnes, values.tonnes === 1 ? 'tonne' : 'tonnes'),
  surface: values => quantityValue(values.surface, 'm²'),
  'surface amount': values => moneyValue(values.surfaceAmount),
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
  const filled = template.replace(/\[([^\[\]\n]+)\]/g, (match, raw: string) => {
    const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    const format = ENGAGEMENT_TOKENS[key]
    if (!format) return match
    const value = format(values)
    if (!value) return ''
    return html ? escapeToken(value) : value
  })
  return filled
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
}

export function fillContentsClearanceEngagement(content: ContentsClearanceQuoteContent): string {
  const title = content.title.trim().replace(/ Quote$/i, '')
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
  })
}

export function fillSurfaceAreaCleaningEngagement(content: SurfaceAreaCleaningQuoteContent): string {
  const title = content.title.trim().replace(/ Quote$/i, '')
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
  })
}
