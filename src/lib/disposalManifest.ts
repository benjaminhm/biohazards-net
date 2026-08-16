import type {
  AssessmentData,
  DisposalContentsTypeId,
  DisposalLoad,
  DisposalManifestCapture,
  DisposalManifestTotals,
  DisposalVehicle,
  DisposalVehicleTypeId,
} from '@/lib/types'

export const DISPOSAL_CONTENTS_TYPES = [
  { id: 'clinical', label: 'Clinical / biomedical' },
  { id: 'asbestos', label: 'Asbestos' },
  { id: 'mixed_cd', label: 'Mixed C&D' },
  { id: 'general', label: 'General waste' },
  { id: 'sharps', label: 'Sharps' },
  { id: 'other', label: 'Other' },
] as const

export const DISPOSAL_VEHICLE_TYPES = [
  { id: 'trailer', label: 'Trailer' },
  { id: 'ute', label: 'Ute' },
  { id: 'skip', label: 'Skip' },
  { id: 'other', label: 'Other' },
] as const

export type { DisposalContentsTypeId, DisposalVehicleTypeId }

export function emptyDisposalVehicle(type: DisposalVehicleTypeId = 'trailer'): DisposalVehicle {
  return {
    id: `veh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    size: '',
    length_m: null,
    width_m: null,
    height_m: null,
    contents_type: '',
    contents_other: '',
    contents_description: '',
    photo_skipped: false,
    photo_id: null,
    photo_url: null,
    photo_note: '',
    extra_photos: [],
  }
}

export function emptyDisposalLoad(): DisposalLoad {
  const vehicle = emptyDisposalVehicle('trailer')
  return {
    id: `load_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    vehicles: [vehicle],
    trailer_skipped: false,
    trailer_photo_id: null,
    trailer_photo_url: null,
    size: '',
    contents_type: '',
    contents_other: '',
    contents_description: '',
    date: '',
    location: '',
    location_lat: null,
    location_lng: null,
    date_from_photo: false,
    location_from_photo: false,
    date_from_device: false,
    docket_skipped: false,
    docket_photo_id: null,
    docket_photo_url: null,
    docket_photo_note: '',
    docket_lost: false,
    recycling: false,
    recycling_type: '',
    dump_date: '',
    dump_time: '',
    dump_datetime_from_photo: false,
    dump_datetime_from_device: false,
    dump_location: '',
    dump_lat: null,
    dump_lng: null,
    dump_location_from_photo: false,
    dump_location_from_device: false,
    weight_kg: null,
    dump_fee: null,
    distance_km: null,
    distance_from_geo: false,
    facility: '',
    notes: '',
    facility_photos: [],
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

/** Matches formatCoordLabel() — GPS text, not a street address. */
export function looksLikeCoordLabel(s: string): boolean {
  return /^\d+\.\d+° [NS], \d+\.\d+° [EW]$/.test(s.trim())
}

export function applyJobSiteToLoad(
  load: DisposalLoad,
  job: { site_address?: string | null; site_lat?: number | null; site_lng?: number | null },
): DisposalLoad {
  const address = job.site_address?.trim() || ''
  const next = { ...load }
  const locationBlank = !next.location.trim() || looksLikeCoordLabel(next.location)
  if (locationBlank && address) {
    next.location = address
    next.location_from_photo = false
  }
  if (next.location_lat == null && job.site_lat != null) next.location_lat = job.site_lat
  if (next.location_lng == null && job.site_lng != null) next.location_lng = job.site_lng
  return next
}

export function applyJobSiteToCapture(
  capture: DisposalManifestCapture,
  job: { site_address?: string | null; site_lat?: number | null; site_lng?: number | null },
): DisposalManifestCapture {
  return { loads: capture.loads.map(l => applyJobSiteToLoad(l, job)) }
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
const VEHICLE_IDS = new Set<string>(DISPOSAL_VEHICLE_TYPES.map(t => t.id))

function contentsTypeOf(raw: unknown): DisposalContentsTypeId {
  const contents = str(raw)
  return CONTENTS_IDS.has(contents) ? (contents as DisposalContentsTypeId) : ''
}

function vehicleTypeOf(raw: unknown): DisposalVehicleTypeId {
  const t = str(raw)
  return VEHICLE_IDS.has(t) ? (t as DisposalVehicleTypeId) : ''
}

function normalizePhotoList(raw: unknown): { id: string; url: string; note: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(p => {
      const row = p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
      const id = str(row.id)
      const url = str(row.url)
      return id && url ? { id, url, note: str(row.note) } : null
    })
    .filter((p): p is { id: string; url: string; note: string } => p != null)
}

function normalizeVehicle(raw: unknown): DisposalVehicle {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const base = emptyDisposalVehicle()
  return {
    ...base,
    id: str(o.id) || base.id,
    type: vehicleTypeOf(o.type) || 'trailer',
    size: str(o.size),
    length_m: numOrNull(o.length_m),
    width_m: numOrNull(o.width_m),
    height_m: numOrNull(o.height_m),
    contents_type: contentsTypeOf(o.contents_type),
    contents_other: str(o.contents_other),
    contents_description: str(o.contents_description),
    photo_skipped: bool(o.photo_skipped),
    photo_id: str(o.photo_id) || null,
    photo_url: str(o.photo_url) || null,
    photo_note: str(o.photo_note),
    extra_photos: normalizePhotoList(o.extra_photos),
  }
}

function vehicleFromLegacyLoad(o: Record<string, unknown>): DisposalVehicle {
  const base = emptyDisposalVehicle('trailer')
  return {
    ...base,
    type: 'trailer',
    size: str(o.size),
    contents_type: contentsTypeOf(o.contents_type),
    contents_other: str(o.contents_other),
    contents_description: str(o.contents_description),
    photo_skipped: bool(o.trailer_skipped),
    photo_id: str(o.trailer_photo_id) || null,
    photo_url: str(o.trailer_photo_url) || null,
  }
}

function firstVehicle(load: DisposalLoad): DisposalVehicle | undefined {
  return load.vehicles[0]
}

function withLegacyMirrors(load: DisposalLoad): DisposalLoad {
  const v = firstVehicle(load)
  if (!v) return load
  return {
    ...load,
    trailer_skipped: v.photo_skipped,
    trailer_photo_id: v.photo_id,
    trailer_photo_url: v.photo_url,
    size: v.size,
    contents_type: v.contents_type,
    contents_other: v.contents_other,
    contents_description: v.contents_description,
  }
}

function normalizeLoad(raw: unknown): DisposalLoad {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const base = emptyDisposalLoad()
  const rawVehicles = Array.isArray(o.vehicles) ? o.vehicles.map(normalizeVehicle) : []
  const vehicles = rawVehicles.length ? rawVehicles : [vehicleFromLegacyLoad(o)]
  return withLegacyMirrors({
    ...base,
    id: str(o.id) || base.id,
    vehicles,
    date: str(o.date),
    location: str(o.location),
    location_lat: numOrNull(o.location_lat),
    location_lng: numOrNull(o.location_lng),
    date_from_photo: bool(o.date_from_photo),
    location_from_photo: bool(o.location_from_photo),
    date_from_device: bool(o.date_from_device),
    docket_skipped: bool(o.docket_skipped),
    docket_photo_id: str(o.docket_photo_id) || null,
    docket_photo_url: str(o.docket_photo_url) || null,
    docket_photo_note: str(o.docket_photo_note),
    docket_lost: bool(o.docket_lost),
    recycling: bool(o.recycling),
    recycling_type: str(o.recycling_type),
    dump_date: str(o.dump_date),
    dump_time: str(o.dump_time),
    dump_datetime_from_photo: bool(o.dump_datetime_from_photo),
    dump_datetime_from_device: bool(o.dump_datetime_from_device),
    dump_location: str(o.dump_location),
    dump_lat: numOrNull(o.dump_lat),
    dump_lng: numOrNull(o.dump_lng),
    dump_location_from_photo: bool(o.dump_location_from_photo),
    dump_location_from_device: bool(o.dump_location_from_device),
    weight_kg: numOrNull(o.weight_kg),
    dump_fee: numOrNull(o.dump_fee),
    distance_km: numOrNull(o.distance_km),
    distance_from_geo: bool(o.distance_from_geo),
    facility: str(o.facility),
    notes: str(o.notes),
    facility_photos: normalizePhotoList(o.facility_photos),
  })
}

export function moveArrayItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= items.length) return items
  const next = [...items]
  const tmp = next[index]
  next[index] = next[nextIndex]
  next[nextIndex] = tmp
  return next
}

export function disposalManifestEqual(a: DisposalManifestCapture, b: DisposalManifestCapture): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function vehicleTypeLabel(type: DisposalVehicleTypeId | string): string {
  const row = DISPOSAL_VEHICLE_TYPES.find(t => t.id === type)
  return row?.label ?? (type ? String(type) : 'Vehicle')
}

export function vehicleContentsLabel(vehicle: DisposalVehicle): string {
  if (vehicle.contents_type === 'other') return vehicle.contents_other.trim() || 'Other'
  const row = DISPOSAL_CONTENTS_TYPES.find(t => t.id === vehicle.contents_type)
  return row?.label ?? ''
}

export function contentsLabel(load: DisposalLoad): string {
  const labels = load.vehicles.map(vehicleContentsLabel).filter(Boolean)
  if (labels.length) return [...new Set(labels)].join(', ')
  if (load.contents_type === 'other') return load.contents_other.trim() || 'Other'
  const row = DISPOSAL_CONTENTS_TYPES.find(t => t.id === load.contents_type)
  return row?.label ?? ''
}

export function vehicleVolumeM3(vehicle: DisposalVehicle): number | null {
  const l = vehicle.length_m
  const w = vehicle.width_m
  const h = vehicle.height_m
  if (l == null || w == null || h == null) return null
  if (!Number.isFinite(l) || !Number.isFinite(w) || !Number.isFinite(h)) return null
  if (l <= 0 || w <= 0 || h <= 0) return null
  return Math.round(l * w * h * 100) / 100
}

export function loadVolumeM3(load: DisposalLoad): number | null {
  let sum = 0
  let n = 0
  for (const v of load.vehicles) {
    const vol = vehicleVolumeM3(v)
    if (vol != null) {
      sum += vol
      n += 1
    }
  }
  if (!n) return null
  return Math.round(sum * 100) / 100
}

export function formatM3(m3: number): string {
  return `${m3.toFixed(m3 % 1 === 0 ? 0 : 2)} m³`
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

/** Pickup → dump when both coordinates exist. Returns km rounded to 1 decimal, or null. */
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

/** Load location if set, otherwise the job site pin. */
export function loadOriginLatLng(
  load: { location_lat?: number | null; location_lng?: number | null },
  job: { site_lat?: number | null; site_lng?: number | null },
): { lat: number | null; lng: number | null } {
  return {
    lat: load.location_lat ?? job.site_lat ?? null,
    lng: load.location_lng ?? job.site_lng ?? null,
  }
}

export function computeDisposalTotals(loads: DisposalLoad[]): DisposalManifestTotals {
  let weight_kg = 0
  let distance_km = 0
  let dump_fees = 0
  let volume_m3 = 0
  let weight_n = 0
  let distance_n = 0
  let fee_n = 0
  let volume_n = 0
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
    for (const v of load.vehicles) {
      const vol = vehicleVolumeM3(v)
      if (vol != null) {
        volume_m3 += vol
        volume_n += 1
      }
    }
  }
  return {
    load_count: loads.length,
    volume_m3: Math.round(volume_m3 * 100) / 100,
    weight_kg: Math.round(weight_kg * 10) / 10,
    distance_km: Math.round(distance_km * 10) / 10,
    dump_fees: Math.round(dump_fees * 100) / 100,
    volume_recorded: volume_n,
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

function vehicleHasContent(v: DisposalVehicle): boolean {
  return Boolean(
    v.size.trim() ||
    vehicleContentsLabel(v) ||
    v.contents_description.trim() ||
    vehicleVolumeM3(v) != null ||
    v.photo_url ||
    v.extra_photos?.length > 0 ||
    v.photo_skipped,
  )
}

export function loadHasContent(load: DisposalLoad): boolean {
  return Boolean(
    load.vehicles.some(vehicleHasContent) ||
    load.size.trim() ||
    contentsLabel(load) ||
    load.contents_description.trim() ||
    load.weight_kg != null ||
    load.dump_fee != null ||
    load.distance_km != null ||
    load.facility.trim() ||
    load.dump_location.trim() ||
    load.dump_date.trim() ||
    load.dump_time.trim() ||
    load.trailer_photo_url ||
    load.docket_photo_url ||
    load.docket_skipped ||
    load.docket_lost ||
    load.recycling ||
    load.recycling_type.trim() ||
    load.facility_photos?.length > 0,
  )
}

export function anyVehicleReady(load: DisposalLoad): boolean {
  return load.vehicles.some(v => v.photo_url || v.photo_skipped)
}

export function docketStatusLabel(load: {
  docket_photo_url?: string | null
  docket_skipped?: boolean
  docket_unavailable?: boolean
  docket_lost?: boolean
  recycling?: boolean
  recycling_type?: string
}): string {
  const bits: string[] = []
  const noDocket = Boolean((load.docket_skipped || load.docket_unavailable) && !load.docket_photo_url)
  if (noDocket) bits.push('No docket available')
  if (load.docket_lost) bits.push('Lost')
  if (load.recycling) {
    const kind = load.recycling_type?.trim()
    bits.push(kind ? `Recycling — ${kind}` : 'Recycling')
  }
  return bits.join(' · ')
}

export function formatWasteDisposalNarrative(capture: DisposalManifestCapture): string {
  const loads = capture.loads.filter(loadHasContent)
  if (!loads.length) return ''
  const totals = computeDisposalTotals(loads)
  const lines = loads.map((l, i) => {
    const vehicleBits = l.vehicles.map(v => {
      const vol = vehicleVolumeM3(v)
      return [
        vehicleTypeLabel(v.type),
        vehicleContentsLabel(v) || null,
        v.contents_description.trim() || null,
        v.size.trim() || null,
        vol != null ? formatM3(vol) : null,
      ].filter(Boolean).join(' ')
    }).filter(Boolean)
    const bits = [
      vehicleBits.join('; ') || contentsLabel(l) || 'Waste',
      l.weight_kg != null ? formatKg(l.weight_kg) : null,
      l.dump_fee != null ? formatAud(l.dump_fee) : null,
      l.distance_km != null ? `${l.distance_km} km` : null,
      l.dump_date.trim()
        ? `dumped ${l.dump_date}${l.dump_time.trim() ? ` ${l.dump_time}` : ''}`
        : null,
      l.recycling
        ? `recycling${l.recycling_type.trim() ? ` (${l.recycling_type.trim()})` : ''}`
        : null,
      l.docket_skipped && !l.docket_photo_url
        ? l.docket_lost ? 'no docket (lost)' : 'no docket'
        : null,
      l.facility.trim() || l.dump_location.trim() || null,
    ].filter(Boolean)
    return `${i + 1}. ${bits.join(' · ')}`
  })
  const volumeBit = totals.volume_recorded ? `${formatM3(totals.volume_m3)}, ` : ''
  return [
    `Disposal loads (${totals.load_count})`,
    '',
    ...lines,
    '',
    `Totals — ${volumeBit}${formatKg(totals.weight_kg)}, ${totals.distance_km} km, ${formatAud(totals.dump_fees)} dump fees.`,
  ].join('\n')
}
