/*
 * lib/preVerifiedRecords.ts
 *
 * What the completion report may state as fact: the Contents Disposal Record,
 * the House Survey and the Biohazard Cleaning Record. Quotes are never read.
 * These records decide which report sections appear, feed the AI draft as
 * verified_records, and print as the measured and waste tables. NON-FINANCIAL.
 */
import type { AssessmentData, PrePartKey, PreRecordRow } from '@/lib/types'
import { cdrSummary } from '@/lib/agent/recordSummaries'
import { loadHasContent, looksLikeCoordLabel, mergedDisposalManifestCapture, vehicleTypeLabel } from '@/lib/disposalManifest'
import { houseSurveyDocument, normalizeHouseSurvey } from '@/lib/houseSurvey'
import { biohazardRecordFromJob, biohazardZoneNames } from '@/lib/biohazardCleaningRecord'

export interface CdrVerified {
  /** Counted m³ across loads, as the record summary shows it. */
  volume_m3: number | null
  loads: { date: string; vehicles: string[]; facility: string }[]
  facilities: string[]
}

export interface SurveyVerified {
  rooms: { name: string; m2: number | null }[]
  total_m2: number | null
}

export interface BiohazardVerified {
  zones: { name: string; m2: number }[]
  atp_tests: number | null
  lab_tests: number | null
}

export interface PreVerifiedRecords {
  a: BiohazardVerified | null
  b: CdrVerified | null
  c: SurveyVerified | null
}

/** Where a section's facts come from. 'fixed_price': a BCQ with no Biohazard Cleaning Record keeps its quote-linked path. */
export type PrePartSource = 'record' | 'fixed_price' | null

function quantity(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('en-AU', { maximumFractionDigits: 2 })
}

function dateText(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return raw
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function cdrVerified(ad: AssessmentData | null | undefined): CdrVerified | null {
  if (ad?.disposal_manifest_capture == null) return null
  const loads = mergedDisposalManifestCapture(ad).loads.filter(loadHasContent)
  if (!loads.length) return null
  const rows = loads.map(load => {
    const counts = new Map<string, number>()
    for (const v of load.vehicles) {
      const label = vehicleTypeLabel(v.type)
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    const dump = load.dump_location.trim()
    return {
      date: dateText(load.dump_date.trim() || load.date.trim()),
      vehicles: [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)),
      facility: load.facility.trim() || (looksLikeCoordLabel(dump) ? '' : dump),
    }
  })
  return {
    volume_m3: cdrSummary(ad).quantity,
    loads: rows,
    facilities: [...new Set(rows.map(r => r.facility).filter(Boolean))],
  }
}

export function surveyVerified(ad: AssessmentData | null | undefined): SurveyVerified | null {
  if (ad?.house_survey == null) return null
  const raw = normalizeHouseSurvey(ad.house_survey).areas
  const doc = houseSurveyDocument('', '', ad.house_survey)
  const rooms = doc.areas
    .filter((_, i) => raw[i] && (raw[i].title.trim() || raw[i].legs.length > 0))
    .map(area => ({ name: area.title, m2: area.priced }))
  if (!rooms.length) return null
  return { rooms, total_m2: doc.totals.priced }
}

export function biohazardVerified(ad: AssessmentData | null | undefined): BiohazardVerified | null {
  const r = biohazardRecordFromJob(ad)
  if (!r?.exists) return null
  const names = biohazardZoneNames(r.quote, ad)
  const zones: BiohazardVerified['zones'] = []
  if (r.record.primary_m2 != null) zones.push({ name: names.primary ? `Primary zone: ${names.primary}` : 'Primary zone', m2: r.record.primary_m2 })
  if (r.record.secondary_m2 != null) zones.push({ name: names.secondary ? `Secondary zone: ${names.secondary}` : 'Secondary zone', m2: r.record.secondary_m2 })
  for (const z of r.record.other_zones) if (z.m2 != null) zones.push({ name: z.name, m2: z.m2 })
  const tests = (n: number | null) => (n != null && n > 0 ? Math.round(n) : null)
  return { zones, atp_tests: tests(r.record.atp_tests), lab_tests: tests(r.record.lab_tests) }
}

export function preVerifiedRecords(ad: AssessmentData | null | undefined): PreVerifiedRecords {
  return { a: biohazardVerified(ad), b: cdrVerified(ad), c: surveyVerified(ad) }
}

/**
 * Contents Clearance needs a CDR with loads, Surface Area Cleaning a House
 * Survey with areas, Biohazard Cleaning its record. A BCQ priced by area or
 * tests without its record yet gives nothing; any other BCQ (fixed price) has
 * no record and keeps the quote-linked path.
 */
export function prePartSources(
  ad: AssessmentData | null | undefined,
  records: PreVerifiedRecords = preVerifiedRecords(ad),
): Record<PrePartKey, PrePartSource> {
  const bcq = biohazardRecordFromJob(ad)
  return {
    a: records.a ? 'record' : bcq?.needed ? null : 'fixed_price',
    b: records.b ? 'record' : null,
    c: records.c ? 'record' : null,
  }
}

/** Rooms or zones and their measured m², and tests done. */
export function preMeasuredRows(key: PrePartKey, records: PreVerifiedRecords): PreRecordRow[] {
  if (key === 'c' && records.c) {
    const rows = records.c.rooms.filter(r => r.m2 != null).map(r => ({ label: r.name, value: `${quantity(r.m2 as number)} m²` }))
    if (rows.length > 1 && records.c.total_m2 != null) rows.push({ label: 'Total surface area cleaned', value: `${quantity(records.c.total_m2)} m²` })
    return rows
  }
  if (key === 'a' && records.a) {
    const rows = records.a.zones.map(z => ({ label: z.name, value: `${quantity(z.m2)} m²` }))
    if (records.a.atp_tests) rows.push({ label: 'ATP tests done', value: String(records.a.atp_tests) })
    if (records.a.lab_tests) rows.push({ label: 'Laboratory tests done', value: String(records.a.lab_tests) })
    return rows
  }
  return []
}

/** Volume removed, each load's date and vehicles, and the disposal facility. */
export function preWasteRecordRows(key: PrePartKey, records: PreVerifiedRecords): PreRecordRow[] {
  const cdr = key === 'b' ? records.b : null
  if (!cdr) return []
  const n = cdr.loads.length
  const loadsText = `${n} ${n === 1 ? 'load' : 'loads'}`
  const rows: PreRecordRow[] = [
    { label: 'Volume removed', value: cdr.volume_m3 != null ? `${quantity(cdr.volume_m3)} m³ over ${loadsText}` : loadsText },
  ]
  cdr.loads.forEach((load, i) => {
    const value = [load.date, load.vehicles.join(', ')].filter(Boolean).join(' · ')
    if (value) rows.push({ label: `Load ${i + 1}`, value })
  })
  if (cdr.facilities.length) {
    rows.push({ label: cdr.facilities.length > 1 ? 'Disposal facilities' : 'Disposal facility', value: cdr.facilities.join('; ') })
  }
  return rows
}
