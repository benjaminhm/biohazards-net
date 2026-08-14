import type { AssessmentData, DisposalLoad, DisposalManifestCapture, DisposalManifestTotals } from '@/lib/types'

export const DISPOSAL_CONTENTS_TYPES = [
  { id: 'clinical', label: 'Clinical / biomedical' },
  { id: 'asbestos', label: 'Asbestos' },
  { id: 'mixed_cd', label: 'Mixed C&D' },
  { id: 'general', label: 'General waste' },
  { id: 'sharps', label: 'Sharps' },
  { id: 'other', label: 'Other' },
] as const

export type DisposalContentsTypeId = (typeof DISPOSAL_CONTENTS_TYPES)[number]['id']

export function emptyDisposalLoad(): DisposalLoad {
  return {
    id: `load_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    trailer_skipped: false,
    trailer_photo_id: null,
    trailer_photo_url: null,
    size: '',
    contents_type: '',
    contents_other: '',
    date: '',
    location: '',
    location_lat: null,
    location_lng: null,
    date_from_photo: false,
    location_from_photo: false,
    docket_skipped: false,
    docket_photo_id: null,
    docket_photo_url: null,
    dump_location: '',
    dump_lat: null,
    dump_lng: null,
    dump_location_from_photo: false,
    weight_kg: null,
    dump_fee: null,
    distance_km: null,
    distance_from_geo: false,
    facility: '',
    notes: '',
  }
}

export function emptyDisposalManifestCapture(): DisposalManifestCapture {
  return { loads: [emptyDisposalLoad()] }
}

export function mergedDisposalManifestCapture(ad: AssessmentData | null | undefined): DisposalManifestCapture {
  const raw = ad?.disposal_manifest_capture
  const loads = Array.isArray(raw?.loads) ? raw.loads.map(normalizeLoad) : []
  return { loads: loads.length ? loads : [emptyDisposalLoad()] }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function bool(v: unknown): boolean {
  return v === true
}

const CONTENTS_IDS = new Set<string>(DISPOSAL_CONTENTS_TYPES.map(t => t.id))

function normalizeLoad(raw: unknown): DisposalLoad {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const contents = str(o.contents_type)
  const base = emptyDisposalLoad()
  return {
    ...base,
    id: str(o.id) || base.id,
    trailer_skipped: bool(o.trailer_skipped),
    trailer_photo_id: str(o.trailer_photo_id) || null,
    trailer_photo_url: str(o.trailer_photo_url) || null,
    size: str(o.size),
    contents_type: CONTENTS_IDS.has(contents) ? (contents as DisposalContentsTypeId) : '',
    contents_other: str(o.contents_other),
    date: str(o.date),
    location: str(o.location),
    location_lat: numOrNull(o.location_lat),
    location_lng: numOrNull(o.location_lng),
    date_from_photo: bool(o.date_from_photo),
    location_from_photo: bool(o.location_from_photo),
    docket_skipped: bool(o.docket_skipped),
    docket_photo_id: str(o.docket_photo_id) || null,
    docket_photo_url: str(o.docket_photo_url) || null,
    dump_location: str(o.dump_location),
    dump_lat: numOrNull(o.dump_lat),
    dump_lng: numOrNull(o.dump_lng),
    dump_location_from_photo: bool(o.dump_location_from_photo),
    weight_kg: numOrNull(o.weight_kg),
    dump_fee: numOrNull(o.dump_fee),
    distance_km: numOrNull(o.distance_km),
    distance_from_geo: bool(o.distance_from_geo),
    facility: str(o.facility),
    notes: str(o.notes),
  }
}

export function disposalManifestEqual(a: DisposalManifestCapture, b: DisposalManifestCapture): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function contentsLabel(load: DisposalLoad): string {
  if (load.contents_type === 'other') return load.contents_other.trim() || 'Other'
  const row = DISPOSAL_CONTENTS_TYPES.find(t => t.id === load.contents_type)
  return row?.label ?? ''
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

/** Site → dump when both coordinates exist. Returns km rounded to 1 decimal, or null. */
export function distanceFromSiteKm(
  siteLat: number | null | undefined,
  siteLng: number | null | undefined,
  dumpLat: number | null | undefined,
  dumpLng: number | null | undefined,
): number | null {
  if (
    siteLat == null || siteLng == null || dumpLat == null || dumpLng == null ||
    !Number.isFinite(siteLat) || !Number.isFinite(siteLng) ||
    !Number.isFinite(dumpLat) || !Number.isFinite(dumpLng)
  ) {
    return null
  }
  const km = haversineKm(siteLat, siteLng, dumpLat, dumpLng)
  if (!Number.isFinite(km)) return null
  return Math.round(km * 10) / 10
}

export function computeDisposalTotals(loads: DisposalLoad[]): DisposalManifestTotals {
  let weight_kg = 0
  let distance_km = 0
  let dump_fees = 0
  let weight_n = 0
  let distance_n = 0
  let fee_n = 0
  for (const load of loads) {
    if (load.weight_kg != null) {
      weight_kg += load.weight_kg
      weight_n += 1
    }
    if (load.distance_km != null) {
      distance_km += load.distance_km
      distance_n += 1
    }
    if (load.dump_fee != null) {
      dump_fees += load.dump_fee
      fee_n += 1
    }
  }
  return {
    load_count: loads.length,
    weight_kg: Math.round(weight_kg * 10) / 10,
    distance_km: Math.round(distance_km * 10) / 10,
    dump_fees: Math.round(dump_fees * 100) / 100,
    weight_recorded: weight_n,
    distance_recorded: distance_n,
    fees_recorded: fee_n,
  }
}

export function formatKg(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`
  return `${kg.toFixed(kg % 1 === 0 ? 0 : 1)} kg`
}

export function formatAud(n: number): string {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

export function loadHasContent(load: DisposalLoad): boolean {
  return Boolean(
    load.size.trim() ||
    contentsLabel(load) ||
    load.weight_kg != null ||
    load.dump_fee != null ||
    load.distance_km != null ||
    load.facility.trim() ||
    load.dump_location.trim() ||
    load.trailer_photo_url ||
    load.docket_photo_url,
  )
}

export function formatWasteDisposalNarrative(capture: DisposalManifestCapture): string {
  const loads = capture.loads.filter(loadHasContent)
  if (!loads.length) return ''
  const totals = computeDisposalTotals(loads)
  const lines = loads.map((l, i) => {
    const bits = [
      contentsLabel(l) || 'Waste',
      l.size.trim() ? l.size.trim() : null,
      l.weight_kg != null ? formatKg(l.weight_kg) : null,
      l.dump_fee != null ? formatAud(l.dump_fee) : null,
      l.distance_km != null ? `${l.distance_km} km` : null,
      l.facility.trim() || l.dump_location.trim() || null,
    ].filter(Boolean)
    return `${i + 1}. ${bits.join(' · ')}`
  })
  return [
    `Disposal loads (${totals.load_count})`,
    '',
    ...lines,
    '',
    `Totals — ${formatKg(totals.weight_kg)}, ${totals.distance_km} km, ${formatAud(totals.dump_fees)} dump fees.`,
  ].join('\n')
}
