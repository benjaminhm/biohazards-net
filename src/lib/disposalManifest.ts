import type {
  AssessmentData,
  DisposalContentsTypeId,
  DisposalLoad,
  DisposalManifestCapture,
  DisposalManifestTotals,
  DisposalPhotoRef,
  DisposalTripDefaults,
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
    photo_include_in_compose: true,
    extra_photos: [],
    skip_cost: null,
    waste_sqm: null,
    waste_price: null,
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
    docket_pdf_url: null,
    docket_include_in_compose: true,
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
    waste_sqm: null,
    waste_price: null,
    dump_fee: null,
    distance_km: null,
    distance_out_km: null,
    distance_return_km: null,
    distance_from_geo: false,
    facility: '',
    notes: '',
    facility_photos: [],
  }
}

export function emptyTripDefaults(): DisposalTripDefaults {
  return {
    vehicle_type: 'trailer',
    size: '',
    length_m: null,
    width_m: null,
    height_m: null,
    location: '',
    location_lat: null,
    location_lng: null,
    facility: '',
    dump_lat: null,
    dump_lng: null,
    distance_km: null,
    distance_out_km: null,
    distance_return_km: null,
    distance_from_geo: false,
  }
}

export function emptyDisposalManifestCapture(): DisposalManifestCapture {
  return { defaults: emptyTripDefaults(), loads: [emptyDisposalLoad()], cost_per_m3: null, prepaid_m3: null }
}

export function mergedDisposalManifestCapture(ad: AssessmentData | null | undefined): DisposalManifestCapture {
  const raw = ad?.disposal_manifest_capture
  const loads = Array.isArray(raw?.loads) ? raw.loads.map(normalizeLoad) : []
  const defaults = normalizeTripDefaults(
    raw && typeof raw === 'object' && 'defaults' in raw ? raw.defaults : undefined,
  )
  const rawRecord = raw && typeof raw === 'object' ? (raw as unknown as Record<string, unknown>) : {}
  return {
    defaults,
    loads: loads.length ? loads : [emptyDisposalLoad()],
    cost_per_m3: nonNegativeOrNull(rawRecord.cost_per_m3),
    prepaid_m3: nonNegativeOrNull(rawRecord.prepaid_m3),
  }
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

function applyJobSiteToDefaults(
  defaults: DisposalTripDefaults,
  job: { site_address?: string | null; site_lat?: number | null; site_lng?: number | null },
): DisposalTripDefaults {
  const address = job.site_address?.trim() || ''
  const next = { ...defaults }
  const locationBlank = !next.location.trim() || looksLikeCoordLabel(next.location)
  if (locationBlank && address) next.location = address
  if (next.location_lat == null && job.site_lat != null) next.location_lat = job.site_lat
  if (next.location_lng == null && job.site_lng != null) next.location_lng = job.site_lng
  return next
}

export function applyJobSiteToCapture(
  capture: DisposalManifestCapture,
  job: { site_address?: string | null; site_lat?: number | null; site_lng?: number | null },
): DisposalManifestCapture {
  return {
    ...capture,
    defaults: applyJobSiteToDefaults(capture.defaults ?? emptyTripDefaults(), job),
    loads: capture.loads.map(l => applyJobSiteToLoad(l, job)),
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function nonNegativeOrNull(v: unknown): number | null {
  const n = numOrNull(v)
  if (n == null || n < 0) return null
  return n
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

function boolDefaultTrue(v: unknown): boolean {
  return v !== false
}

export function photoInCompose(flag: boolean | undefined): boolean {
  return flag !== false
}

function normalizePhotoList(raw: unknown): DisposalPhotoRef[] {
  if (!Array.isArray(raw)) return []
  const photos: DisposalPhotoRef[] = []
  for (const p of raw) {
    const row = p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
    const id = str(row.id)
    const url = str(row.url)
    if (!id || !url) continue
    photos.push({
      id,
      url,
      note: str(row.note),
      include_in_compose: boolDefaultTrue(row.include_in_compose),
    })
  }
  return photos
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
    photo_include_in_compose: boolDefaultTrue(o.photo_include_in_compose),
    extra_photos: normalizePhotoList(o.extra_photos),
    skip_cost: numOrNull(o.skip_cost),
    waste_sqm: numOrNull(o.waste_sqm),
    waste_price: numOrNull(o.waste_price),
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

function normalizeTripDefaults(raw: unknown): DisposalTripDefaults {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const base = emptyTripDefaults()
  return {
    ...base,
    vehicle_type: vehicleTypeOf(o.vehicle_type) || 'trailer',
    size: str(o.size),
    length_m: numOrNull(o.length_m),
    width_m: numOrNull(o.width_m),
    height_m: numOrNull(o.height_m),
    location: str(o.location),
    location_lat: numOrNull(o.location_lat),
    location_lng: numOrNull(o.location_lng),
    facility: str(o.facility) || str(o.dump_location),
    dump_lat: numOrNull(o.dump_lat),
    dump_lng: numOrNull(o.dump_lng),
    distance_km: numOrNull(o.distance_km),
    distance_out_km: numOrNull(o.distance_out_km),
    distance_return_km: numOrNull(o.distance_return_km),
    distance_from_geo: bool(o.distance_from_geo),
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
    docket_pdf_url: str(o.docket_pdf_url) || null,
    docket_include_in_compose: boolDefaultTrue(o.docket_include_in_compose),
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
    waste_sqm: numOrNull(o.waste_sqm),
    waste_price: numOrNull(o.waste_price),
    dump_fee: numOrNull(o.dump_fee),
    distance_km: numOrNull(o.distance_km),
    distance_out_km: numOrNull(o.distance_out_km),
    distance_return_km: numOrNull(o.distance_return_km),
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

export function loadHasSkipVehicle(load: { vehicles: DisposalVehicle[] }): boolean {
  return load.vehicles.some(v => v.type === 'skip')
}

/** Every typed vehicle on the load is a skip (skip-company trip, not a weighbridge dump). */
export function loadSkipOnly(load: { vehicles: DisposalVehicle[] }): boolean {
  const typed = load.vehicles.filter(v => v.type)
  return typed.length > 0 && typed.every(v => v.type === 'skip')
}

export function loadSkipCost(load: { vehicles: DisposalVehicle[] }): number | null {
  let sum = 0
  let any = false
  for (const v of load.vehicles) {
    if (v.type !== 'skip' || v.skip_cost == null) continue
    sum += v.skip_cost
    any = true
  }
  return any ? Math.round(sum * 100) / 100 : null
}

/** Prefer skip-hire totals; fall back to dump_fee on older skip-only loads. */
export function loadSkipFeeForTotals(load: DisposalLoad): number | null {
  const skip = loadSkipCost(load)
  if (skip != null) return skip
  if (loadSkipOnly(load) && load.dump_fee != null) return load.dump_fee
  return null
}

export function loadDumpFeeForTotals(load: DisposalLoad): number | null {
  if (loadSkipOnly(load)) return null
  return load.dump_fee
}

/** Move dump_fee ↔ skip_cost when the load switches between skip and trailer/ute. */
export function reconcileSkipPricing(load: DisposalLoad): DisposalLoad {
  if (loadSkipOnly(load)) {
    const skips = load.vehicles.filter(v => v.type === 'skip')
    if (load.dump_fee != null && skips.length === 1 && skips.every(v => v.skip_cost == null)) {
      const fee = load.dump_fee
      return {
        ...load,
        dump_fee: null,
        vehicles: load.vehicles.map(v => (v.type === 'skip' ? { ...v, skip_cost: fee } : v)),
      }
    }
    return load
  }
  if (!loadHasSkipVehicle(load)) {
    const costs = load.vehicles.map(v => v.skip_cost).filter((n): n is number => n != null)
    if (load.dump_fee == null && costs.length === 1) {
      return {
        ...load,
        dump_fee: costs[0],
        vehicles: load.vehicles.map(v => ({ ...v, skip_cost: null })),
      }
    }
  }
  return load
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

/**
 * Tape measures are usually millimetres (4050×1800×500) or centimetres (405×180×50).
 * 4050 × 2 × 500 as metres is 4,050,000 m³; as mixed mm/m it is 4.05 × 2 × 0.5.
 */
export const MM_DIM_THRESHOLD = 20

export function dimensionTrioToMetres(
  length: number | null | undefined,
  width: number | null | undefined,
  height: number | null | undefined,
): { length_m: number | null; width_m: number | null; height_m: number | null } {
  const raw = [length, width, height]
  const present = raw.filter((n): n is number => n != null && Number.isFinite(n) && n > 0)
  const max = present.length ? Math.max(...present) : 0
  const min = present.length ? Math.min(...present) : 0

  const scale = (n: number | null | undefined): number | null => {
    if (n == null || !Number.isFinite(n) || n <= 0) return null
    if (max >= 1000) return n >= MM_DIM_THRESHOLD ? Math.round(n) / 1000 : n
    if (min >= MM_DIM_THRESHOLD && max < 1000) return Math.round(n) / 100
    if (n >= MM_DIM_THRESHOLD) return Math.round(n) / 1000
    return n
  }

  return { length_m: scale(length), width_m: scale(width), height_m: scale(height) }
}

export function looksLikeMillimetres(n: number | null | undefined): boolean {
  return n != null && Number.isFinite(n) && n >= MM_DIM_THRESHOLD
}

export function vehicleVolumeM3(vehicle: DisposalVehicle): number | null {
  const { length_m: l, width_m: w, height_m: h } = dimensionTrioToMetres(
    vehicle.length_m,
    vehicle.width_m,
    vehicle.height_m,
  )
  if (l == null || w == null || h == null) return null
  return Math.round(l * w * h * 100) / 100
}

export function withMetreDimensions(vehicle: DisposalVehicle): DisposalVehicle {
  return {
    ...vehicle,
    ...dimensionTrioToMetres(vehicle.length_m, vehicle.width_m, vehicle.height_m),
  }
}

export function captureWithMetreDimensions(capture: DisposalManifestCapture): DisposalManifestCapture {
  const defaults = capture.defaults ?? emptyTripDefaults()
  return {
    ...capture,
    defaults: {
      ...defaults,
      ...dimensionTrioToMetres(defaults.length_m, defaults.width_m, defaults.height_m),
    },
    loads: capture.loads.map(l => ({
      ...l,
      vehicles: l.vehicles.map(withMetreDimensions),
    })),
  }
}

function strFollows(current: string, prev: string): boolean {
  if (!current.trim()) return true
  const previous = prev.trim()
  if (!previous) return false
  return current.trim() === previous
}

function numFollows(current: number | null, prev: number | null): boolean {
  if (current == null) return true
  if (prev == null) return false
  return current === prev
}

function addressFollows(current: string, prev: string): boolean {
  const value = current.trim()
  if (!value || looksLikeCoordLabel(value)) return true
  return strFollows(value, prev)
}

function loadTipText(load: DisposalLoad): string {
  return (load.facility || load.dump_location).trim()
}

function distanceFollows(load: DisposalLoad, prev: DisposalTripDefaults): boolean {
  if (load.distance_km == null) return true
  if (prev.distance_km == null) return false
  return load.distance_km === prev.distance_km && load.distance_from_geo === prev.distance_from_geo
}

/**
 * Copy shared trailer / route fields onto a load when that load still has the
 * previous shared value (or the field is blank). Edited loads keep their own value.
 */
export function applyFollowingDefaults(
  load: DisposalLoad,
  prev: DisposalTripDefaults,
  next: DisposalTripDefaults,
): DisposalLoad {
  const vehicle = load.vehicles[0]
  if (!vehicle) return load

  let v = vehicle
  let vehicleChanged = false
  const typeFollows = !v.type || v.type === prev.vehicle_type
  if (typeFollows) {
    if (next.vehicle_type && v.type !== next.vehicle_type) {
      v = { ...v, type: next.vehicle_type }
      vehicleChanged = true
    }
    if (strFollows(v.size, prev.size) && v.size !== next.size) {
      v = { ...v, size: next.size }
      vehicleChanged = true
    }
    if (numFollows(v.length_m, prev.length_m) && v.length_m !== next.length_m) {
      v = { ...v, length_m: next.length_m }
      vehicleChanged = true
    }
    if (numFollows(v.width_m, prev.width_m) && v.width_m !== next.width_m) {
      v = { ...v, width_m: next.width_m }
      vehicleChanged = true
    }
    if (numFollows(v.height_m, prev.height_m) && v.height_m !== next.height_m) {
      v = { ...v, height_m: next.height_m }
      vehicleChanged = true
    }
  }

  let nextLoad = vehicleChanged ? { ...load, vehicles: [v, ...load.vehicles.slice(1)] } : load

  if (
    next.location.trim() &&
    addressFollows(nextLoad.location, prev.location) &&
    (nextLoad.location !== next.location ||
      nextLoad.location_lat !== next.location_lat ||
      nextLoad.location_lng !== next.location_lng)
  ) {
    nextLoad = {
      ...nextLoad,
      location: next.location,
      location_lat: next.location_lat,
      location_lng: next.location_lng,
      location_from_photo: false,
    }
  }

  const nextTip = next.facility.trim()
  if (
    nextTip &&
    addressFollows(loadTipText(nextLoad), prev.facility) &&
    (loadTipText(nextLoad) !== nextTip ||
      nextLoad.dump_lat !== next.dump_lat ||
      nextLoad.dump_lng !== next.dump_lng)
  ) {
    nextLoad = {
      ...nextLoad,
      facility: next.facility,
      dump_location: next.facility,
      dump_lat: next.dump_lat,
      dump_lng: next.dump_lng,
      dump_location_from_photo: false,
      dump_location_from_device: false,
    }
  }

  const routeMatches =
    (!next.location.trim() || nextLoad.location.trim() === next.location.trim()) &&
    (!nextTip || loadTipText(nextLoad) === nextTip)
  if (
    routeMatches &&
    distanceFollows(nextLoad, prev) &&
    (nextLoad.distance_km !== next.distance_km ||
      nextLoad.distance_out_km !== next.distance_out_km ||
      nextLoad.distance_return_km !== next.distance_return_km ||
      nextLoad.distance_from_geo !== next.distance_from_geo)
  ) {
    nextLoad = {
      ...nextLoad,
      distance_km: next.distance_km,
      distance_out_km: next.distance_out_km,
      distance_return_km: next.distance_return_km,
      distance_from_geo: next.distance_from_geo,
    }
  }

  if (nextLoad === load) return load
  return reconcileSkipPricing(withLegacyMirrors(nextLoad))
}

/** New load starts from the shared trailer and route. Photos, weight, and price stay empty. */
export function loadFromTripDefaults(load: DisposalLoad, defaults: DisposalTripDefaults): DisposalLoad {
  const vehicle = load.vehicles[0] ?? emptyDisposalVehicle(defaults.vehicle_type || 'trailer')
  const nextVehicle: DisposalVehicle = {
    ...vehicle,
    type: defaults.vehicle_type || vehicle.type || 'trailer',
    size: defaults.size.trim() || vehicle.size,
    length_m: defaults.length_m ?? vehicle.length_m,
    width_m: defaults.width_m ?? vehicle.width_m,
    height_m: defaults.height_m ?? vehicle.height_m,
  }
  const origin = defaults.location.trim()
  const tip = defaults.facility.trim()
  return reconcileSkipPricing(withLegacyMirrors({
    ...load,
    vehicles: [nextVehicle, ...load.vehicles.slice(1)],
    location: origin || load.location,
    location_lat: origin ? defaults.location_lat : load.location_lat,
    location_lng: origin ? defaults.location_lng : load.location_lng,
    location_from_photo: origin ? false : load.location_from_photo,
    facility: tip || load.facility,
    dump_location: tip || load.dump_location,
    dump_lat: tip ? defaults.dump_lat : load.dump_lat,
    dump_lng: tip ? defaults.dump_lng : load.dump_lng,
    distance_km: defaults.distance_km ?? load.distance_km,
    distance_out_km: defaults.distance_out_km ?? load.distance_out_km,
    distance_return_km: defaults.distance_return_km ?? load.distance_return_km,
    distance_from_geo: defaults.distance_km != null ? defaults.distance_from_geo : load.distance_from_geo,
  }))
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

/** Combine outbound and return legs. A missing leg copies the other so both can display. */
export function roundTripKm(
  outKm: number | null,
  returnKm: number | null,
): { distance_out_km: number | null; distance_return_km: number | null; distance_km: number | null } {
  if (outKm == null && returnKm == null) {
    return { distance_out_km: null, distance_return_km: null, distance_km: null }
  }
  const out = outKm ?? returnKm
  const ret = returnKm ?? outKm
  if (out == null || ret == null) {
    return { distance_out_km: null, distance_return_km: null, distance_km: null }
  }
  return {
    distance_out_km: out,
    distance_return_km: ret,
    distance_km: Math.round((out + ret) * 10) / 10,
  }
}

/** e.g. "10.3 km out / 20.6 km return" — return is the round-trip total. */
export function formatDistanceLegs(
  outKm: number | null | undefined,
  returnKm: number | null | undefined,
): string | null {
  if (outKm == null && returnKm == null) return null
  const total =
    outKm != null && returnKm != null
      ? Math.round((outKm + returnKm) * 10) / 10
      : (outKm ?? returnKm ?? null)
  const out = outKm != null ? `${outKm} km out` : '— km out'
  const ret = total != null ? `${total} km return` : '— km return'
  return `${out} / ${ret}`
}

export function geoRoundTripPatch(outKm: number | null, returnKm: number | null) {
  return { ...roundTripKm(outKm, returnKm), distance_from_geo: true as const }
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
  let skip_fees = 0
  let volume_m3 = 0
  let weight_n = 0
  let distance_n = 0
  let fee_n = 0
  let skip_n = 0
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
    const dump = loadDumpFeeForTotals(load)
    if (dump != null) {
      dump_fees += dump
      fee_n += 1
    }
    const skip = loadSkipFeeForTotals(load)
    if (skip != null) {
      skip_fees += skip
      skip_n += 1
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
    skip_fees: Math.round(skip_fees * 100) / 100,
    volume_recorded: volume_n,
    weight_recorded: weight_n,
    distance_recorded: distance_n,
    fees_recorded: fee_n,
    skip_fees_recorded: skip_n,
  }
}

export interface DisposalWasteCharge {
  cost_per_m3: number | null
  prepaid_m3: number | null
  gross: number | null
  prepaid_value: number | null
  balance: number | null
}

/** Square metres billed for this vehicle. An edited amount wins; otherwise its volume. */
export function vehicleWasteSqm(vehicle: DisposalVehicle): number | null {
  if (vehicle.waste_sqm != null && Number.isFinite(vehicle.waste_sqm)) return vehicle.waste_sqm
  return vehicleVolumeM3(vehicle)
}

/** Price billed for this vehicle. An edited price wins; otherwise its square metres × the rate. */
export function vehicleWastePrice(vehicle: DisposalVehicle, rate: number | null | undefined): number | null {
  if (vehicle.waste_price != null && Number.isFinite(vehicle.waste_price)) return vehicle.waste_price
  const sqm = vehicleWasteSqm(vehicle)
  if (sqm == null || rate == null || !Number.isFinite(rate) || rate < 0) return null
  return Math.round(sqm * rate * 100) / 100
}

/** Square metres billed for this load, added up per vehicle. */
export function loadWasteSqm(load: DisposalLoad): number | null {
  const single = load.vehicles.length <= 1
  let sum = 0
  let n = 0
  for (const vehicle of load.vehicles) {
    const sqm = vehicle.waste_sqm ?? (single ? load.waste_sqm : null) ?? vehicleVolumeM3(vehicle)
    if (sqm == null || !Number.isFinite(sqm)) continue
    sum += sqm
    n += 1
  }
  return n ? Math.round(sum * 100) / 100 : null
}

/** Price billed for this load, added up per vehicle so a ute and a trailer stay separate. */
export function loadWastePrice(load: DisposalLoad, rate: number | null | undefined): number | null {
  const single = load.vehicles.length <= 1
  const safeRate = rate != null && Number.isFinite(rate) && rate >= 0 ? rate : null
  let sum = 0
  let n = 0
  for (const vehicle of load.vehicles) {
    let price: number | null = null
    if (vehicle.waste_price != null && Number.isFinite(vehicle.waste_price)) price = vehicle.waste_price
    else if (single && load.waste_price != null && Number.isFinite(load.waste_price)) price = load.waste_price
    else {
      const sqm = vehicle.waste_sqm ?? (single ? load.waste_sqm : null) ?? vehicleVolumeM3(vehicle)
      if (sqm != null && safeRate != null) price = Math.round(sqm * safeRate * 100) / 100
    }
    if (price == null) continue
    sum += price
    n += 1
  }
  return n ? Math.round(sum * 100) / 100 : null
}

/** Waste dollars from each load's square metres and price. Prepaid cubic metres come off that total. */
export function disposalWasteCharge(
  loads: DisposalLoad[],
  cost_per_m3: number | null | undefined,
  prepaid_m3: number | null | undefined,
): DisposalWasteCharge {
  const rate = cost_per_m3 != null && Number.isFinite(cost_per_m3) && cost_per_m3 >= 0 ? cost_per_m3 : null
  const prepaid = prepaid_m3 != null && Number.isFinite(prepaid_m3) && prepaid_m3 > 0 ? prepaid_m3 : null
  let sum = 0
  let priced = 0
  for (const load of loads) {
    const price = loadWastePrice(load, rate)
    if (price == null) continue
    sum += price
    priced += 1
  }
  const gross = priced === 0 ? null : Math.round(sum * 100) / 100
  const prepaid_value = rate == null || prepaid == null ? null : Math.round(prepaid * rate * 100) / 100
  const balance = gross == null ? null : Math.round((gross - (prepaid_value ?? 0)) * 100) / 100
  return { cost_per_m3: rate, prepaid_m3: prepaid, gross, prepaid_value, balance }
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function gstExFromInc(n: number): number {
  return roundMoney(n / 1.1)
}

function gstIncFromEx(n: number): number {
  return roundMoney(n * 1.1)
}

function vehicleExclusiveWastePrice(
  load: DisposalLoad,
  vehicle: DisposalVehicle,
  rate: number | null,
): number | null {
  if (vehicle.type === 'skip') return null
  const single = load.vehicles.length <= 1
  if (vehicle.waste_price != null && Number.isFinite(vehicle.waste_price)) return vehicle.waste_price
  if (single && load.waste_price != null && Number.isFinite(load.waste_price)) return load.waste_price
  if (rate == null) return null
  const sqm = vehicle.waste_sqm ?? (single ? load.waste_sqm : null) ?? vehicleVolumeM3(vehicle)
  if (sqm == null) return null
  return roundMoney(sqm * rate)
}

export interface LoadPriceBreakdown {
  skip_ex: number
  skip_inc: number
  trailer_ex: number
  trailer_inc: number
  ute_ex: number
  ute_inc: number
  dump_ex: number
  dump_inc: number
  total_ex: number
  total_inc: number
}

export function loadPriceBreakdown(
  load: DisposalLoad,
  cost_per_m3: number | null | undefined,
): LoadPriceBreakdown {
  const rate = cost_per_m3 != null && Number.isFinite(cost_per_m3) && cost_per_m3 >= 0 ? cost_per_m3 : null
  const skip_inc = roundMoney(loadSkipFeeForTotals(load) ?? 0)
  const dump_inc = roundMoney(loadDumpFeeForTotals(load) ?? 0)
  let trailer_ex = 0
  let ute_ex = 0
  for (const vehicle of load.vehicles) {
    const price = vehicleExclusiveWastePrice(load, vehicle, rate)
    if (price == null) continue
    if (vehicle.type === 'ute') ute_ex += price
    else trailer_ex += price
  }
  trailer_ex = roundMoney(trailer_ex)
  ute_ex = roundMoney(ute_ex)
  const skip_ex = gstExFromInc(skip_inc)
  const dump_ex = gstExFromInc(dump_inc)
  const trailer_inc = gstIncFromEx(trailer_ex)
  const ute_inc = gstIncFromEx(ute_ex)
  return {
    skip_ex,
    skip_inc,
    trailer_ex,
    trailer_inc,
    ute_ex,
    ute_inc,
    dump_ex,
    dump_inc,
    total_ex: roundMoney(skip_ex + trailer_ex + ute_ex + dump_ex),
    total_inc: roundMoney(skip_inc + trailer_inc + ute_inc + dump_inc),
  }
}

export interface DisposalPriceLines {
  skips: number
  trailers_utes: number
  dump_fees: number
  prepaid: number
  total: number
  skips_ex: number
  skips_inc: number
  trailers_utes_ex: number
  trailers_utes_inc: number
  trailers_ex: number
  trailers_inc: number
  utes_ex: number
  utes_inc: number
  dump_fees_ex: number
  dump_fees_inc: number
  prepaid_ex: number
  prepaid_inc: number
  total_ex: number
  total_inc: number
}

/** Skip hire and dump fees are GST-inclusive pass-through. Trailer/ute waste is GST-exclusive. */
export function disposalPriceLines(
  loads: DisposalLoad[],
  cost_per_m3: number | null | undefined,
  prepaid_m3: number | null | undefined,
): DisposalPriceLines {
  const rate = cost_per_m3 != null && Number.isFinite(cost_per_m3) && cost_per_m3 >= 0 ? cost_per_m3 : null
  let skips_inc = 0
  let trailers_ex = 0
  let utes_ex = 0
  let dump_fees_inc = 0
  for (const load of loads) {
    const row = loadPriceBreakdown(load, rate)
    skips_inc += row.skip_inc
    trailers_ex += row.trailer_ex
    utes_ex += row.ute_ex
    dump_fees_inc += row.dump_inc
  }
  const prepaidQty = prepaid_m3 != null && Number.isFinite(prepaid_m3) && prepaid_m3 > 0 ? prepaid_m3 : 0
  const prepaid_ex_r = rate == null ? 0 : roundMoney(prepaidQty * rate)
  const skips_inc_r = roundMoney(skips_inc)
  const dump_inc_r = roundMoney(dump_fees_inc)
  const trailers_ex_r = roundMoney(trailers_ex)
  const utes_ex_r = roundMoney(utes_ex)
  const trailers_utes_ex = roundMoney(trailers_ex_r + utes_ex_r)
  const skips_ex = gstExFromInc(skips_inc_r)
  const dump_fees_ex = gstExFromInc(dump_inc_r)
  const trailers_inc = gstIncFromEx(trailers_ex_r)
  const utes_inc = gstIncFromEx(utes_ex_r)
  const trailers_utes_inc = roundMoney(trailers_inc + utes_inc)
  const prepaid_inc = gstIncFromEx(prepaid_ex_r)
  const total_ex = roundMoney(skips_ex + trailers_utes_ex + dump_fees_ex - prepaid_ex_r)
  const total_inc = roundMoney(skips_inc_r + trailers_utes_inc + dump_inc_r - prepaid_inc)
  return {
    skips: skips_inc_r,
    trailers_utes: trailers_utes_ex,
    dump_fees: dump_inc_r,
    prepaid: prepaid_ex_r,
    total: total_inc,
    skips_ex,
    skips_inc: skips_inc_r,
    trailers_utes_ex,
    trailers_utes_inc,
    trailers_ex: trailers_ex_r,
    trailers_inc,
    utes_ex: utes_ex_r,
    utes_inc,
    dump_fees_ex,
    dump_fees_inc: dump_inc_r,
    prepaid_ex: prepaid_ex_r,
    prepaid_inc,
    total_ex,
    total_inc,
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
    v.photo_skipped ||
    v.skip_cost != null,
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
    loadSkipCost(load) != null ||
    load.distance_km != null ||
    load.facility.trim() ||
    load.dump_location.trim() ||
    load.dump_date.trim() ||
    load.dump_time.trim() ||
    load.trailer_photo_url ||
    load.docket_photo_url ||
    load.docket_pdf_url ||
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
    const skipFee = loadSkipFeeForTotals(l)
    const dumpFee = loadDumpFeeForTotals(l)
    const bits = [
      vehicleBits.join('; ') || contentsLabel(l) || 'Waste',
      l.weight_kg != null ? formatKg(l.weight_kg) : null,
      skipFee != null ? `${formatAud(skipFee)} skip` : null,
      dumpFee != null ? formatAud(dumpFee) : null,
      formatDistanceLegs(l.distance_out_km, l.distance_return_km)
        ?? (l.distance_km != null ? `${l.distance_km} km` : null),
      l.dump_date.trim()
        ? `${loadSkipOnly(l) ? 'collected' : 'dumped'} ${l.dump_date}${l.dump_time.trim() ? ` ${l.dump_time}` : ''}`
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
  const feeBits = [
    totals.fees_recorded ? `${formatAud(totals.dump_fees)} dump fees` : null,
    totals.skip_fees_recorded ? `${formatAud(totals.skip_fees)} skip costs` : null,
  ].filter(Boolean)
  const waste = disposalWasteCharge(loads, capture.cost_per_m3, capture.prepaid_m3)
  const wasteBit = waste.gross == null
    ? ''
    : waste.prepaid_value != null
      ? ` Waste ${formatM3(totals.volume_m3)} × ${formatAud(waste.cost_per_m3 ?? 0)} = ${formatAud(waste.gross)}. Prepaid ${formatM3(waste.prepaid_m3 ?? 0)} (${formatAud(waste.prepaid_value)}). To bill ${formatAud(waste.balance ?? 0)}.`
      : ` Waste ${formatM3(totals.volume_m3)} × ${formatAud(waste.cost_per_m3 ?? 0)} = ${formatAud(waste.gross)}.`
  return [
    `Disposal loads (${totals.load_count})`,
    '',
    ...lines,
    '',
    `Totals — ${volumeBit}${formatKg(totals.weight_kg)}, ${totals.distance_km} km return${feeBits.length ? `, ${feeBits.join(', ')}` : ''}.${wasteBit} Volume is a close estimate. Weight is from docket weights.`,
  ].join('\n')
}
