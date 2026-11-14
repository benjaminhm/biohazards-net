/**
 * Biohazard Cleaning Record — what the biohazard cleaning actually came to.
 *
 * Staff enter the measured square metres per zone and the tests done. Rates,
 * labour, call-out fee, travel, affected contents, COH/RAP and extra lines are carried over from
 * the Biohazard Cleaning Quote: a blank field takes the quote's figure. A quote
 * with no square metres and no tests is fixed price and needs no record.
 */
import type { AssessmentData } from '@/lib/types'
import {
  BIOHAZARD_CONTENTS_LABEL,
  BIOHAZARD_DISPOSAL_LABEL,
  biohazardCleaningFigures,
  joinBiohazardNames,
  normalizeBiohazardCleaningCapture,
  resolvedAreaAffected,
  resolvedOtherZones,
  type BiohazardCleaningCapture,
} from '@/lib/biohazardCleaningQuote'
import { fixedCharges, labourDaysText, type FixedChargeFields, type FixedCharges } from '@/lib/fixedCharges'
import { formatAud } from '@/lib/disposalManifest'

export interface BiohazardRecordZone {
  name: string
  m2: number | null
  /** Ex GST. Other zones are not priced on the quote, so a blank rate leaves the zone off. */
  rate_per_m2: number | null
}

export interface BiohazardCleaningRecordCapture extends FixedChargeFields {
  primary_m2: number | null
  rate_per_m2: number | null
  secondary_m2: number | null
  secondary_rate_per_m2: number | null
  other_zones: BiohazardRecordZone[]
  atp_tests: number | null
  atp_rate: number | null
  lab_tests: number | null
  lab_rate: number | null
  travel_km: number | null
  rate_per_km: number | null
  /** Cubic metres of affected contents removed. Blank takes the quote's estimate. */
  contents_m3: number | null
  contents_rate_per_m3: number | null
  contents_disposal_fee: number | null
  coh_rap_fee: number | null
  /** Ex GST amount by quote extra line id. Missing follows the quote line. */
  extra_amounts: Record<string, number | null>
}

export type BiohazardRecordLineKind = 'zone' | 'contents' | 'disposal' | 'labour' | 'travel' | 'callout' | 'testing' | 'other'

export interface BiohazardRecordLine {
  kind: BiohazardRecordLineKind
  /** For example "Primary zone: kitchen (12 m² × $50.00)". */
  label: string
  amount_ex: number
}

export interface BiohazardRecordSummary {
  lines: BiohazardRecordLine[]
  charges: FixedCharges
  total_ex: number
  gst: number
  total_inc: number
  /** Actuals still to enter. The statement is refused until this is empty. */
  missing: string[]
}

export interface BiohazardRecordView {
  /** The BCQ has square metres or tests, so the statement bills from the record. */
  needed: boolean
  exists: boolean
  quote: BiohazardCleaningCapture
  record: BiohazardCleaningRecordCapture
  summary: BiohazardRecordSummary
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeBiohazardCleaningRecord(raw: unknown): BiohazardCleaningRecordCapture {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const zones = Array.isArray(o.other_zones) ? o.other_zones : []
  const extras = o.extra_amounts && typeof o.extra_amounts === 'object' ? o.extra_amounts as Record<string, unknown> : {}
  return {
    primary_m2: numberOrNull(o.primary_m2),
    rate_per_m2: numberOrNull(o.rate_per_m2),
    secondary_m2: numberOrNull(o.secondary_m2),
    secondary_rate_per_m2: numberOrNull(o.secondary_rate_per_m2),
    other_zones: zones.flatMap(zone => {
      if (!zone || typeof zone !== 'object') return []
      const z = zone as Record<string, unknown>
      const name = textField(z.name)
      return name ? [{ name, m2: numberOrNull(z.m2), rate_per_m2: numberOrNull(z.rate_per_m2) }] : []
    }),
    atp_tests: numberOrNull(o.atp_tests),
    atp_rate: numberOrNull(o.atp_rate),
    lab_tests: numberOrNull(o.lab_tests),
    lab_rate: numberOrNull(o.lab_rate),
    labour_days: numberOrNull(o.labour_days),
    rate_per_labour_day: numberOrNull(o.rate_per_labour_day),
    mobilisation_fee: numberOrNull(o.mobilisation_fee),
    travel_km: numberOrNull(o.travel_km),
    rate_per_km: numberOrNull(o.rate_per_km),
    contents_m3: numberOrNull(o.contents_m3),
    contents_rate_per_m3: numberOrNull(o.contents_rate_per_m3),
    contents_disposal_fee: numberOrNull(o.contents_disposal_fee),
    coh_rap_fee: numberOrNull(o.coh_rap_fee),
    extra_amounts: Object.fromEntries(Object.entries(extras).map(([id, amount]) => [id, numberOrNull(amount)])),
  }
}

/** Square metres or test counts on the quote. Without them the quote is fixed price. */
export function biohazardQuoteHasEstimates(quote: BiohazardCleaningCapture): boolean {
  const figures = biohazardCleaningFigures(quote)
  return figures.estimated_m2 > 0
    || (figures.has_secondary && figures.secondary_m2 > 0)
    || (quote.atp_testing && (quote.atp_tests ?? 0) > 0)
    || (quote.lab_testing && (quote.lab_tests ?? 0) > 0)
}

function sentenceStart(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

function quantityText(n: number): string {
  return round2(n).toLocaleString('en-AU', { maximumFractionDigits: 2 })
}

function testsText(n: number, kind: string): string {
  return `${n} ${kind} ${n === 1 ? 'test' : 'tests'}`
}

/** Zone names as the quote prints them: rooms first, then the areas affected. */
export function biohazardZoneNames(quote: BiohazardCleaningCapture, ad?: AssessmentData | null): { primary: string; secondary: string; other: string[] } {
  const areaNames = (ad?.areas ?? []).map(area => area.name).filter(name => typeof name === 'string' && name.trim())
  const roomNames = (rooms: { name: string }[]) => joinBiohazardNames(rooms.map(room => room.name))
  return {
    primary: roomNames(quote.rooms ?? []) || resolvedAreaAffected(quote, { assessmentAreaNames: areaNames }),
    secondary: roomNames(quote.secondary_rooms ?? []) || quote.secondary_zone.trim(),
    other: resolvedOtherZones(quote),
  }
}

/** The record's figures. One source for the tab, the printed House Survey, the statement and the agents. */
export function biohazardRecordSummary(
  record: BiohazardCleaningRecordCapture,
  quote: BiohazardCleaningCapture,
  ad?: AssessmentData | null,
): BiohazardRecordSummary {
  const figures = biohazardCleaningFigures(quote)
  const names = biohazardZoneNames(quote, ad)
  const lines: BiohazardRecordLine[] = []
  const missing: string[] = []
  const push = (kind: BiohazardRecordLineKind, label: string, amount: number) => {
    if (amount > 0.004) lines.push({ kind, label, amount_ex: round2(amount) })
  }
  const zone = (label: string, m2: number | null, rate: number, required: boolean) => {
    if (m2 == null) {
      if (required) missing.push(`Measured m² for ${label.toLowerCase()}`)
      return
    }
    push('zone', `${label} (${quantityText(m2)} m² × ${formatAud(rate)})`, m2 * rate)
  }
  zone(names.primary ? `Primary zone: ${names.primary}` : 'Primary zone', record.primary_m2, record.rate_per_m2 ?? figures.rate_per_m2, figures.estimated_m2 > 0)
  if (figures.has_secondary) {
    zone(
      names.secondary ? `Secondary zone: ${names.secondary}` : 'Secondary zone',
      record.secondary_m2,
      record.secondary_rate_per_m2 ?? figures.secondary_rate_per_m2,
      figures.secondary_m2 > 0,
    )
  }
  for (const name of names.other) {
    const typed = record.other_zones.find(z => z.name.toLowerCase() === name.toLowerCase())
    if (typed?.m2 != null && typed.rate_per_m2 != null) zone(sentenceStart(name), typed.m2, typed.rate_per_m2, false)
  }

  const contentsM3 = record.contents_m3 ?? figures.contents_m3
  const perM3 = record.contents_rate_per_m3 ?? figures.contents_rate_per_m3
  push('contents', `${BIOHAZARD_CONTENTS_LABEL} (${quantityText(contentsM3)} m³ × ${formatAud(perM3)})`, contentsM3 * perM3)
  push('disposal', BIOHAZARD_DISPOSAL_LABEL, record.contents_disposal_fee ?? figures.contents_disposal_fee)

  const charges = fixedCharges(record, {
    labour_days: figures.labour_days,
    rate_per_labour_day: figures.rate_per_labour_day,
    mobilisation_fee: figures.mobilisation_fee,
  })
  push('labour', `Labour (${labourDaysText(charges.labour_days)} × ${formatAud(charges.rate_per_labour_day)})`, charges.labour_ex)

  const km = record.travel_km ?? figures.travel_km
  const perKm = record.rate_per_km ?? figures.rate_per_km
  push('travel', `Travel (${quantityText(km)} km × ${formatAud(perKm)})`, km * perKm)
  push('callout', 'Call-out fee', charges.mobilisation_ex)

  const tests: string[] = []
  let testing = 0
  const test = (on: boolean, quoted: number | null, done: number | null, rate: number, kind: string) => {
    if (!on) return
    if (done == null) {
      if ((quoted ?? 0) > 0) missing.push(`${sentenceStart(kind)} tests done`)
      return
    }
    const count = Math.round(done)
    if (count <= 0) return
    tests.push(`${testsText(count, kind)} × ${formatAud(rate)}`)
    testing += round2(count * rate)
  }
  test(quote.atp_testing, quote.atp_tests, record.atp_tests, record.atp_rate ?? quote.atp_rate ?? 0, 'ATP')
  test(quote.lab_testing, quote.lab_tests, record.lab_tests, record.lab_rate ?? quote.lab_rate ?? 0, 'lab')
  push('testing', `Testing (${tests.join(', ')})`, testing)

  const others: string[] = []
  let other = 0
  if (quote.coh_rap) {
    const fee = record.coh_rap_fee ?? quote.coh_rap_fee ?? 0
    if (fee > 0) {
      others.push('COH/RAP')
      other += fee
    }
  }
  for (const extra of quote.extra_lines ?? []) {
    const label = extra.label.trim()
    if (!label) continue
    const amount = record.extra_amounts[extra.id] ?? round2((extra.quantity ?? 0) * (extra.rate ?? 0))
    if (amount > 0) {
      others.push(label)
      other += amount
    }
  }
  push('other', `Other fees (${others.join(', ')})`, other)

  const total_ex = round2(lines.reduce((sum, line) => sum + line.amount_ex, 0))
  const gst = round2(total_ex * 0.1)
  return { lines, charges, total_ex, gst, total_inc: round2(total_ex + gst), missing }
}

/** Null when the job has no Biohazard Cleaning Quote. */
export function biohazardRecordFromJob(ad: AssessmentData | null | undefined): BiohazardRecordView | null {
  if (ad?.biohazard_cleaning_quote == null) return null
  const quote = normalizeBiohazardCleaningCapture(ad.biohazard_cleaning_quote)
  const record = normalizeBiohazardCleaningRecord(ad.biohazard_cleaning_record)
  return {
    needed: biohazardQuoteHasEstimates(quote),
    exists: ad.biohazard_cleaning_record != null,
    quote,
    record,
    summary: biohazardRecordSummary(record, quote, ad),
  }
}
