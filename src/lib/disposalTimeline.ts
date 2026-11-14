/*
 * Contents Disposal Record v2: photos first.
 *
 * Photos are sorted into loads (cdr_load) and given a role (cdr_role). A load's
 * timeline is built from its photos: one event per stop, in time order, with
 * the time and place the photos carry. The older load fields (vehicle photo,
 * docket photo, dates, tip pin) mirror the timeline, so the statement, the
 * totals and the agents read the record as they always have.
 *
 * Everything here is pure. Suggestions are only ever suggestions: a load is
 * not verified until staff say so.
 */
import type {
  CdrPhotoRead,
  CdrRole,
  DisposalContainerPreset,
  DisposalContentsTypeId,
  DisposalLoad,
  DisposalLoadEvent,
  DisposalManifestCapture,
  DisposalPhotoRef,
  DisposalVehicle,
  DisposalVehicleTypeId,
  Photo,
  WasteDisposalManifestLoadSnapshot,
} from '@/lib/types'
import {
  DISPOSAL_CONTENTS_TYPES,
  DISPOSAL_VEHICLE_TYPES,
  applyJobSiteToLoad,
  emptyDisposalLoad,
  emptyDisposalVehicle,
  emptyTripDefaults,
  haversineKm,
  loadHasContent,
  loadSkipOnly,
  loadVolumeM3,
  photoInCompose,
  reconcileSkipPricing,
  vehicleTypeLabel,
  withLegacyMirrors,
} from '@/lib/disposalManifest'

export const CDR_ROLES: { id: CdrRole; label: string }[] = [
  { id: 'load', label: 'Load' },
  { id: 'dropoff', label: 'Drop-off' },
  { id: 'docket', label: 'Docket' },
]

/** A photo within this distance of the site pin was taken at the site. */
export const SITE_RADIUS_KM = 0.25
/** Photos this close in time were taken at the same stop. */
export const SAME_STOP_MS = 15 * 60_000
/** Photos of one role further apart than this are separate events. */
export const EVENT_GAP_MS = 45 * 60_000
/** A drop-off photo this far from the load's tip pin means a different tip. */
const TIP_MATCH_KM = 1

const TIME_ZONE = 'Australia/Brisbane'
const ROLE_ORDER: Record<CdrRole, number> = { load: 0, dropoff: 1, docket: 2 }
const ROLE_IDS = new Set<string>(CDR_ROLES.map(r => r.id))
const VEHICLE_IDS = new Set<string>(DISPOSAL_VEHICLE_TYPES.map(t => t.id))
const CONTENTS_IDS = new Set<string>(DISPOSAL_CONTENTS_TYPES.map(t => t.id))

export type CdrPhoto = Pick<
  Photo,
  'id' | 'file_url' | 'caption' | 'taken_at' | 'location_lat' | 'location_lng' | 'cdr_load' | 'cdr_role' | 'cdr_read'
>

export interface CdrTag {
  /** Null is not in the disposal record. 0 is in it but not yet in a load. */
  load: number | null
  role: CdrRole | null
}

export interface CdrSuggestion extends CdrTag {
  /** What the suggestion rests on: GPS against the site, the image itself, or time alone. */
  basis: 'gps' | 'photo' | 'time'
}

export interface SiteContext {
  site_address?: string | null
  site_lat?: number | null
  site_lng?: number | null
}

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n)
}

function photoTime(p: Pick<Photo, 'taken_at'>): number | null {
  if (!p.taken_at) return null
  const t = Date.parse(p.taken_at)
  return Number.isFinite(t) ? t : null
}

/** A copy with one optional field left off. */
export function without<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const next = { ...obj }
  delete next[key]
  return next
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Camera time as local date and time, YYYY-MM-DDTHH:mm. */
export function localStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/** "14 Nov 2026, 8:10 am" from a local stamp. A date with no time prints the date alone. */
export function formatEventWhen(at: string): string {
  const m = at.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!m) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const date = `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ''} ${m[1]}`
  if (m[4] == null) return date
  const hour = Number(m[4])
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${m[5]} ${hour < 12 ? 'am' : 'pm'}`
  return `${date}, ${clock}`
}

/** Normalise a stored or returned image read. Null when it is not one. */
export function parseCdrPhotoRead(raw: unknown): CdrPhotoRead | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const role = typeof o.role === 'string' ? o.role : ''
  if (!ROLE_IDS.has(role) && role !== 'other') return null
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const amount = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[$,\s]/g, '')) : NaN
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const container = text(o.container)
  const contents = text(o.contents_type)
  const docket = role === 'docket'
  return {
    role: role as CdrPhotoRead['role'],
    container: (container && VEHICLE_IDS.has(container) ? container : '') as DisposalVehicleTypeId,
    contents_type: (contents && CONTENTS_IDS.has(contents) ? contents : '') as DisposalContentsTypeId,
    description: text(o.description).slice(0, 300),
    weight_kg: docket ? amount(o.weight_kg) : null,
    fee: docket ? amount(o.fee) : null,
    facility: docket ? text(o.facility).slice(0, 200) : '',
    read_at: text(o.read_at),
  }
}

function readOf(p: Pick<Photo, 'cdr_read'>): CdrPhotoRead | null {
  return parseCdrPhotoRead(p.cdr_read)
}

// ── Sorting photos into loads ────────────────────────────────────────────────

/**
 * Suggest a load and a role for every disposal photo not yet in a load.
 *
 * Photos are walked in the order they were taken. A photo at the site belongs
 * to the load being filled; a photo away from the site is that load at the
 * tip; the next photo back at the site starts the next load. Where a photo has
 * no GPS the image read is used, and failing that the time gap from the photo
 * before it. A photo with no camera time is left for staff to place.
 */
export function suggestCdrTags(photos: CdrPhoto[], site: SiteContext | null): Map<string, CdrSuggestion> {
  const out = new Map<string, CdrSuggestion>()
  const placed = photos.filter(p => (p.cdr_load ?? 0) >= 1)
  const pending = photos
    .filter(p => (p.cdr_load ?? 0) < 1)
    .map(p => ({ photo: p, time: photoTime(p), read: readOf(p) }))
    .filter((row): row is { photo: CdrPhoto; time: number; read: CdrPhotoRead | null } => row.time != null)
    .sort((a, b) => a.time - b.time)

  let siteLat = finite(site?.site_lat) ? site.site_lat : null
  let siteLng = finite(site?.site_lng) ? site.site_lng : null
  if (siteLat == null || siteLng == null) {
    // No site pin: the first photo with GPS that is not known to be at the tip stands in for the site.
    const first = [...placed.map(p => ({ photo: p, time: photoTime(p) ?? 0, read: readOf(p) })), ...pending]
      .sort((a, b) => a.time - b.time)
      .find(row =>
        finite(row.photo.location_lat) && finite(row.photo.location_lng) &&
        (row.photo.cdr_role ?? 'load') === 'load' && (row.read?.role ?? 'load') === 'load')
    siteLat = first?.photo.location_lat ?? null
    siteLng = first?.photo.location_lng ?? null
  }

  const gpsPlace = (p: CdrPhoto): 'site' | 'away' | null => {
    if (!finite(p.location_lat) || !finite(p.location_lng) || siteLat == null || siteLng == null) return null
    return haversineKm(siteLat, siteLng, p.location_lat, p.location_lng) <= SITE_RADIUS_KM ? 'site' : 'away'
  }
  const roleFor = (place: 'site' | 'away', p: CdrPhoto, read: CdrPhotoRead | null): CdrRole => {
    if (p.cdr_role) return p.cdr_role
    if (read?.role === 'docket') return 'docket'
    return place === 'site' ? 'load' : 'dropoff'
  }

  let load = Math.max(0, ...placed.map(p => p.cdr_load ?? 0)) + 1
  let sawAway = false
  let runContainer = ''
  let prev: { time: number; place: 'site' | 'away' } | null = null

  for (const { photo, time, read } of pending) {
    if (read?.role === 'other' && !photo.cdr_role) {
      out.set(photo.id, { load: null, role: null, basis: 'photo' })
      continue
    }

    let place: 'site' | 'away'
    let basis: CdrSuggestion['basis']
    const byGps = gpsPlace(photo)
    if (photo.cdr_role) {
      place = photo.cdr_role === 'load' ? 'site' : 'away'
      basis = 'photo'
    } else if (byGps) {
      place = byGps
      basis = 'gps'
    } else if (read && read.role !== 'other') {
      place = read.role === 'load' ? 'site' : 'away'
      basis = 'photo'
    } else {
      place = !prev ? 'site' : time - prev.time <= SAME_STOP_MS ? prev.place : prev.place === 'site' ? 'away' : 'site'
      basis = 'time'
    }

    // A photo taken at the same stop as one already in a load joins that load.
    const anchor = placed
      .map(p => ({ p, gap: Math.abs((photoTime(p) ?? Infinity) - time) }))
      .filter(row => row.gap <= SAME_STOP_MS)
      .sort((a, b) => a.gap - b.gap)[0]
    if (anchor) {
      out.set(photo.id, { load: anchor.p.cdr_load ?? null, role: roleFor(place, photo, read), basis })
      continue
    }

    const container = place === 'site' ? read?.container ?? '' : ''
    if (place === 'site' && sawAway) {
      load += 1
      sawAway = false
      runContainer = ''
    } else if (place === 'site' && container && runContainer && container !== runContainer) {
      // Two containers filled at the site before one trip to the tip are two loads.
      load += 1
    }
    if (place === 'away') sawAway = true
    if (container) runContainer = container
    prev = { time, place }
    out.set(photo.id, { load, role: roleFor(place, photo, read), basis })
  }
  return out
}

/** Renumber loads 1, 2, 3 in their existing order, closing any gaps. */
export function compactLoadNumbers<T extends CdrTag>(tags: Map<string, T>): Map<string, T> {
  const numbers = [...new Set([...tags.values()].map(t => t.load).filter((n): n is number => n != null && n >= 1))].sort((a, b) => a - b)
  const renumber = new Map(numbers.map((n, i) => [n, i + 1]))
  const out = new Map<string, T>()
  for (const [id, tag] of tags) {
    out.set(id, tag.load != null && tag.load >= 1 ? { ...tag, load: renumber.get(tag.load) ?? tag.load } : tag)
  }
  return out
}

// ── Timeline ─────────────────────────────────────────────────────────────────

function firstVehicle(load: DisposalLoad): DisposalVehicle {
  return load.vehicles[0] ?? emptyDisposalVehicle('trailer')
}

/** What happened at this stop, in the words the record prints. */
export function eventTitle(event: Pick<DisposalLoadEvent, 'role'>, load: DisposalLoad): string {
  const skip = loadSkipOnly(load)
  if (event.role === 'docket') return 'Docket'
  if (event.role === 'dropoff') return skip ? 'Skip collected' : load.recycling ? 'Load dropped for recycling' : 'Load tipped'
  if (skip) return 'Skip filled'
  const type = firstVehicle(load).type
  return type && type !== 'other' ? `${vehicleTypeLabel(type)} loaded` : 'Loaded'
}

function sortEvents(events: DisposalLoadEvent[]): DisposalLoadEvent[] {
  return [...events].sort((a, b) => {
    if (a.at !== b.at) {
      if (!a.at) return 1
      if (!b.at) return -1
      return a.at < b.at ? -1 : 1
    }
    return ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
  })
}

/** A load entered the older way shown as a timeline: its vehicle photos, drop-off photos and docket. */
function legacyEvents(load: DisposalLoad): DisposalLoadEvent[] {
  const events: DisposalLoadEvent[] = []
  const loadPhotos: DisposalPhotoRef[] = []
  for (const v of load.vehicles) {
    if (v.photo_id && v.photo_url) {
      loadPhotos.push({ id: v.photo_id, url: v.photo_url, note: v.photo_note ?? '', include_in_compose: photoInCompose(v.photo_include_in_compose) })
    }
    loadPhotos.push(...(v.extra_photos ?? []))
  }
  const dumpAt = load.dump_date ? `${load.dump_date}${load.dump_time ? `T${load.dump_time}` : ''}` : ''
  if (loadPhotos.length) {
    events.push({
      id: `${load.id}_load`, role: 'load', at: load.date, place: load.location,
      lat: load.location_lat, lng: load.location_lng,
      description: firstVehicle(load).contents_description, photos: loadPhotos, show_to_client: true,
    })
  }
  if (load.facility_photos?.length) {
    events.push({
      id: `${load.id}_dropoff`, role: 'dropoff', at: dumpAt, place: (load.facility || load.dump_location).trim(),
      lat: load.dump_lat, lng: load.dump_lng, description: '', photos: load.facility_photos, show_to_client: true,
    })
  }
  if (load.docket_photo_id && load.docket_photo_url) {
    events.push({
      id: `${load.id}_docket`, role: 'docket', at: dumpAt, place: (load.facility || load.dump_location).trim(),
      lat: load.dump_lat, lng: load.dump_lng, description: '',
      photos: [{ id: load.docket_photo_id, url: load.docket_photo_url, note: load.docket_photo_note ?? '', include_in_compose: true }],
      show_to_client: photoInCompose(load.docket_include_in_compose),
    })
  }
  return sortEvents(events)
}

/** The load's timeline. A load entered the older way is read from its photo slots. */
export function eventsOf(load: DisposalLoad): DisposalLoadEvent[] {
  return load.events ? sortEvents(load.events) : legacyEvents(load)
}

/** True when the load keeps its own timeline (built from tagged photos or added in v2). */
export function isTimelineLoad(load: DisposalLoad): boolean {
  return load.events !== undefined
}

/**
 * Copy the timeline onto the older load fields: the vehicle photo, drop-off
 * photos, docket photo, the load and dump dates, and the tip pin. Everything
 * that reads a load (statement, totals, agents, printed record) uses those.
 */
export function withEventMirrors(load: DisposalLoad): DisposalLoad {
  if (!load.events) return load
  const events = sortEvents(load.events)
  const shown = (e: DisposalLoadEvent, p: DisposalPhotoRef): DisposalPhotoRef => ({
    ...p,
    include_in_compose: photoInCompose(e.show_to_client) && photoInCompose(p.include_in_compose),
  })
  const of = (role: CdrRole) => events.filter(e => e.role === role)
  const loadPhotos = of('load').flatMap(e => e.photos.map(p => shown(e, p)))
  const dropPhotos = of('dropoff').flatMap(e => e.photos.map(p => shown(e, p)))
  const docketPhotos = of('docket').flatMap(e => e.photos.map(p => shown(e, p)))
  const [mainLoad, ...extraLoad] = loadPhotos
  const [docket, ...extraDockets] = docketPhotos

  const vehicle = firstVehicle(load)
  const nextVehicle: DisposalVehicle = {
    ...vehicle,
    photo_id: mainLoad?.id ?? null,
    photo_url: mainLoad?.url ?? null,
    photo_note: mainLoad?.note ?? '',
    photo_include_in_compose: mainLoad ? photoInCompose(mainLoad.include_in_compose) : true,
    photo_skipped: mainLoad ? false : vehicle.photo_skipped,
    extra_photos: extraLoad,
  }

  const skip = loadSkipOnly({ vehicles: [nextVehicle] })
  const firstLoad = of('load').find(e => e.at) ?? events.find(e => e.at)
  const dump = of('docket').find(e => e.at) ?? of('dropoff').find(e => e.at)
  const pin = [...of('dropoff'), ...of('docket')].find(e => finite(e.lat) && finite(e.lng))

  return reconcileSkipPricing(withLegacyMirrors({
    ...load,
    events,
    vehicles: [nextVehicle, ...load.vehicles.slice(1)],
    facility_photos: [...dropPhotos, ...extraDockets],
    docket_photo_id: docket?.id ?? null,
    docket_photo_url: docket?.url ?? null,
    docket_photo_note: docket?.note ?? '',
    docket_include_in_compose: docket ? photoInCompose(docket.include_in_compose) : true,
    docket_skipped: docket ? false : load.docket_skipped,
    docket_lost: docket ? false : load.docket_lost,
    date: firstLoad ? firstLoad.at.slice(0, 10) : load.date,
    date_from_photo: firstLoad ? true : load.date_from_photo,
    dump_date: dump ? dump.at.slice(0, 10) : load.dump_date,
    dump_time: dump ? dump.at.slice(11, 16) : load.dump_time,
    dump_datetime_from_photo: dump ? true : load.dump_datetime_from_photo,
    ...(pin && !skip ? { dump_lat: pin.lat, dump_lng: pin.lng, dump_location_from_photo: true } : {}),
  }))
}

// ── Containers ───────────────────────────────────────────────────────────────

type ContainerType = Exclude<DisposalVehicleTypeId, ''>

function blankPreset(): DisposalContainerPreset {
  return { size: '', length_m: null, width_m: null, height_m: null }
}

/** Usual dimensions for a container type. The shared trip details seed their own type. */
export function containerPreset(capture: DisposalManifestCapture, type: DisposalVehicleTypeId): DisposalContainerPreset {
  if (!type) return blankPreset()
  const saved = capture.containers?.[type]
  if (saved) return saved
  const d = capture.defaults ?? emptyTripDefaults()
  if (d.vehicle_type === type) return { size: d.size, length_m: d.length_m, width_m: d.width_m, height_m: d.height_m }
  return blankPreset()
}

function follows(current: number | null, prev: number | null): boolean {
  return current == null || current === prev
}

/** Set the usual dimensions for a type. Loads of that type still on the old dimensions take the new ones. */
export function setContainerPreset(
  capture: DisposalManifestCapture,
  type: ContainerType,
  next: DisposalContainerPreset,
): DisposalManifestCapture {
  const prev = containerPreset(capture, type)
  return {
    ...capture,
    containers: { ...capture.containers, [type]: next },
    loads: capture.loads.map(load => {
      const v = load.vehicles[0]
      if (!v || v.type !== type || load.vehicles.length > 1) return load
      const sizeFollows = !v.size.trim() || v.size.trim() === prev.size.trim()
      if (!sizeFollows && !follows(v.length_m, prev.length_m) && !follows(v.width_m, prev.width_m) && !follows(v.height_m, prev.height_m)) return load
      const vehicle: DisposalVehicle = {
        ...v,
        size: sizeFollows ? next.size : v.size,
        length_m: follows(v.length_m, prev.length_m) ? next.length_m : v.length_m,
        width_m: follows(v.width_m, prev.width_m) ? next.width_m : v.width_m,
        height_m: follows(v.height_m, prev.height_m) ? next.height_m : v.height_m,
      }
      return withLegacyMirrors({ ...load, vehicles: [vehicle] })
    }),
  }
}

/** Change a load's container. Dimensions still on the old type's usual size take the new type's. */
export function setLoadContainer(capture: DisposalManifestCapture, load: DisposalLoad, type: ContainerType): DisposalLoad {
  const v = firstVehicle(load)
  const prev = containerPreset(capture, v.type)
  const next = containerPreset(capture, type)
  const vehicle: DisposalVehicle = {
    ...v,
    type,
    size: !v.size.trim() || v.size.trim() === prev.size.trim() ? next.size : v.size,
    length_m: follows(v.length_m, prev.length_m) ? next.length_m : v.length_m,
    width_m: follows(v.width_m, prev.width_m) ? next.width_m : v.width_m,
    height_m: follows(v.height_m, prev.height_m) ? next.height_m : v.height_m,
  }
  let nextLoad: DisposalLoad = { ...load, vehicles: [vehicle, ...load.vehicles.slice(1)] }
  if (type === 'skip') {
    nextLoad = {
      ...nextLoad,
      facility: '', dump_location: '', dump_lat: null, dump_lng: null,
      dump_location_from_photo: false, dump_location_from_device: false,
      distance_km: null, distance_out_km: null, distance_return_km: null, distance_from_geo: false,
    }
  }
  return withEventMirrors(reconcileSkipPricing(withLegacyMirrors(nextLoad)))
}

// ── Building the record from tagged photos ───────────────────────────────────

function photoRef(p: CdrPhoto, prev?: DisposalPhotoRef): DisposalPhotoRef {
  return {
    id: p.id,
    url: p.file_url,
    note: prev ? prev.note : (p.caption ?? '').trim(),
    include_in_compose: prev ? photoInCompose(prev.include_in_compose) : true,
  }
}

function atSite(lat: number | null | undefined, lng: number | null | undefined, site: SiteContext): boolean {
  if (!finite(lat) || !finite(lng) || !finite(site.site_lat) || !finite(site.site_lng)) return false
  return haversineKm(site.site_lat, site.site_lng, lat, lng) <= SITE_RADIUS_KM
}

/** One event per stop: photos of one role, split where they are far apart in time. */
function buildEvents(existing: DisposalLoadEvent[], photos: CdrPhoto[], site: SiteContext): DisposalLoadEvent[] {
  const claimed = new Set<string>()
  const events: DisposalLoadEvent[] = []
  for (const { id: role } of CDR_ROLES) {
    const rows = photos
      .filter(p => (p.cdr_role ?? 'load') === role)
      .map(p => ({ p, time: photoTime(p) }))
      .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity))
    const clusters: typeof rows[] = []
    for (const row of rows) {
      const last = clusters[clusters.length - 1]
      const lastTime = last?.[last.length - 1]?.time
      if (last && (row.time == null || lastTime == null || row.time - lastTime <= EVENT_GAP_MS)) last.push(row)
      else clusters.push([row])
    }
    for (const cluster of clusters) {
      const ids = new Set(cluster.map(row => row.p.id))
      const match = existing.find(e => e.role === role && !claimed.has(e.id) && e.photos.some(p => ids.has(p.id)))
      if (match) {
        claimed.add(match.id)
        const kept = new Map(match.photos.map(p => [p.id, p]))
        events.push({ ...match, photos: cluster.map(row => photoRef(row.p, kept.get(row.p.id))) })
        continue
      }
      const timed = cluster.find(row => row.time != null)
      const located = cluster.find(row => finite(row.p.location_lat) && finite(row.p.location_lng))
      const lat = located?.p.location_lat ?? null
      const lng = located?.p.location_lng ?? null
      const description = cluster.map(row => readOf(row.p)?.description ?? '').find(Boolean) ?? ''
      const here = role === 'load' && (!located || atSite(lat, lng, site))
      events.push({
        id: newId('evt'),
        role,
        at: localStamp(timed?.p.taken_at),
        place: here || atSite(lat, lng, site) ? (site.site_address ?? '').trim() : '',
        lat,
        lng,
        description,
        photos: cluster.map(row => photoRef(row.p)),
        show_to_client: true,
        ...(description ? { suggested: true } : {}),
      })
    }
  }
  return sortEvents(events)
}

function mostCommon<T extends string>(values: T[]): T | '' {
  const counts = new Map<T, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

function newTimelineLoad(capture: DisposalManifestCapture, photos: CdrPhoto[], site: SiteContext): DisposalLoad {
  const defaults = capture.defaults ?? emptyTripDefaults()
  const reads = photos.map(p => ({ role: p.cdr_role, read: readOf(p) }))
  const seen = mostCommon(reads.filter(r => r.role === 'load').map(r => r.read?.container ?? ''))
    || mostCommon(reads.map(r => r.read?.container ?? ''))
  const type: ContainerType = seen || defaults.vehicle_type || 'trailer'
  const preset = containerPreset(capture, type)
  const vehicle: DisposalVehicle = { ...emptyDisposalVehicle(type), ...preset }
  const skip = type === 'skip'
  const base = applyJobSiteToLoad({ ...emptyDisposalLoad(), vehicles: [vehicle] }, site)
  return {
    ...base,
    location: base.location || defaults.location,
    location_lat: base.location_lat ?? defaults.location_lat,
    location_lng: base.location_lng ?? defaults.location_lng,
    facility: skip ? '' : defaults.facility,
    dump_location: skip ? '' : defaults.facility,
    dump_lat: skip ? null : defaults.dump_lat,
    dump_lng: skip ? null : defaults.dump_lng,
    distance_km: skip ? null : defaults.distance_km,
    distance_out_km: skip ? null : defaults.distance_out_km,
    distance_return_km: skip ? null : defaults.distance_return_km,
    distance_from_geo: skip ? false : defaults.distance_km != null ? defaults.distance_from_geo : false,
    events: [],
    ...(seen ? { suggested: ['container'] } : {}),
  }
}

/** A drop-off photo taken somewhere other than the load's tip means the load went to a different tip. */
function followDropoffPin(load: DisposalLoad): DisposalLoad {
  if (loadSkipOnly(load)) return load
  const pin = (load.events ?? []).filter(e => e.role !== 'load').find(e => finite(e.lat) && finite(e.lng))
  if (!pin || !finite(pin.lat) || !finite(pin.lng)) return load
  if (finite(load.dump_lat) && finite(load.dump_lng) && haversineKm(load.dump_lat, load.dump_lng, pin.lat, pin.lng) <= TIP_MATCH_KM) return load
  const hadPin = finite(load.dump_lat) && finite(load.dump_lng)
  return {
    ...load,
    // The address belonged to the old pin. It is found again from the photo's GPS.
    facility: hadPin ? '' : load.facility,
    dump_location: hadPin ? '' : load.dump_location,
    dump_lat: pin.lat,
    dump_lng: pin.lng,
    dump_location_from_photo: true,
    ...(load.distance_km == null || load.distance_from_geo
      ? { distance_km: null, distance_out_km: null, distance_return_km: null, distance_from_geo: false }
      : {}),
  }
}

/** Fill blank fields from what was read off the load's photos. Each is listed as a suggestion until verified. */
function applyReads(load: DisposalLoad, photos: Map<string, CdrPhoto>): DisposalLoad {
  const reads = (role: CdrRole) => (load.events ?? [])
    .filter(e => e.role === role)
    .flatMap(e => e.photos.map(p => photos.get(p.id)).map(p => (p ? readOf(p) : null)))
    .filter((r): r is CdrPhotoRead => r != null)
  const loadReads = reads('load')
  const dockets = reads('docket')
  const suggested = new Set(load.suggested ?? [])
  let next = load
  const vehicle = firstVehicle(load)
  const skip = loadSkipOnly(load)

  const contents = loadReads.map(r => r.contents_type).find(Boolean)
  if (!vehicle.contents_type && contents) {
    next = { ...next, vehicles: [{ ...firstVehicle(next), contents_type: contents }, ...next.vehicles.slice(1)] }
    suggested.add('contents')
  }
  const weight = dockets.map(r => r.weight_kg).find(n => n != null)
  if (next.weight_kg == null && weight != null) {
    next = { ...next, weight_kg: weight }
    suggested.add('weight_kg')
  }
  const fee = dockets.map(r => r.fee).find(n => n != null)
  if (fee != null && skip && firstVehicle(next).skip_cost == null) {
    next = { ...next, vehicles: [{ ...firstVehicle(next), skip_cost: fee }, ...next.vehicles.slice(1)] }
    suggested.add('skip_cost')
  } else if (fee != null && !skip && next.dump_fee == null) {
    next = { ...next, dump_fee: fee }
    suggested.add('dump_fee')
  }
  const facility = dockets.map(r => r.facility).find(Boolean)
  if (!skip && facility && !next.facility.trim() && !next.dump_location.trim()) {
    next = { ...next, facility, dump_location: facility }
    suggested.add('facility')
  }
  return suggested.size ? { ...next, suggested: [...suggested] } : next
}

function hasTypedData(load: DisposalLoad): boolean {
  return Boolean(
    load.verified_at || load.weight_kg != null || load.dump_fee != null || load.waste_sqm != null ||
    load.notes.trim() || load.vehicles.some(v => v.skip_cost != null || v.waste_sqm != null || v.contents_description.trim()),
  )
}

export interface CdrSyncResult {
  capture: DisposalManifestCapture
  changed: boolean
  /** Loads that gained or lost photos and need checking again. */
  reopened: number
}

/**
 * Bring the record in line with the photo tags. Every tagged load number has a
 * load; each load's timeline holds exactly its tagged photos. Typed values,
 * descriptions and verified loads whose photos did not change are kept.
 */
export function syncCaptureWithPhotos(
  capture: DisposalManifestCapture,
  photos: CdrPhoto[],
  site: SiteContext,
): CdrSyncResult {
  const byId = new Map(photos.map(p => [p.id, p]))
  const byNumber = new Map<number, CdrPhoto[]>()
  for (const p of photos) {
    const n = p.cdr_load ?? 0
    if (n < 1 || !p.file_url) continue
    byNumber.set(n, [...(byNumber.get(n) ?? []), p])
  }
  const numbers = [...byNumber.keys()].sort((a, b) => a - b)
  const timelineLoads = capture.loads.filter(isTimelineLoad)
  const claimed = new Map<number, DisposalLoad>()
  const taken = new Set<string>()

  // A load is recognised by its photos first, so renumbering loads never moves typed values.
  for (const n of numbers) {
    const ids = new Set((byNumber.get(n) ?? []).map(p => p.id))
    const overlap = (l: DisposalLoad) => (l.events ?? []).reduce((sum, e) => sum + e.photos.filter(p => ids.has(p.id)).length, 0)
    const best = timelineLoads
      .filter(l => !taken.has(l.id))
      .map(l => ({ l, shared: overlap(l) }))
      .filter(row => row.shared > 0)
      .sort((a, b) => b.shared - a.shared)[0]
    if (best) {
      claimed.set(n, best.l)
      taken.add(best.l.id)
    }
  }
  for (const n of numbers) {
    if (claimed.has(n)) continue
    const empty = timelineLoads.find(l => !taken.has(l.id) && l.cdr_number === n && !(l.events ?? []).some(e => e.photos.length))
    if (empty) {
      claimed.set(n, empty)
      taken.add(empty.id)
    }
  }

  let reopened = 0
  const built = numbers.map(n => {
    const tagged = byNumber.get(n) ?? []
    const existing = claimed.get(n)
    const base = existing ?? newTimelineLoad(capture, tagged, site)
    const before = new Set((base.events ?? []).flatMap(e => e.photos.map(p => `${e.role}:${p.id}`)))
    const events = buildEvents(base.events ?? [], tagged, site)
    const after = new Set(events.flatMap(e => e.photos.map(p => `${e.role}:${p.id}`)))
    const samePhotos = before.size === after.size && [...after].every(key => before.has(key))
    let load: DisposalLoad = { ...base, cdr_number: n, events }
    if (existing && !samePhotos && load.verified_at) {
      load = { ...load, verified_at: null }
      reopened += 1
    }
    return withEventMirrors(applyReads(followDropoffPin(load), byId))
  })

  const kept = capture.loads.flatMap((load): DisposalLoad[] => {
    if (taken.has(load.id)) return []
    if (!isTimelineLoad(load)) return built.length && !loadHasContent(load) ? [] : [load]
    if (load.cdr_number == null) return [load]
    // Its photos were all moved to other loads. It stays only if something was typed on it.
    if (!hasTypedData(load)) return []
    return [withEventMirrors({ ...without(load, 'cdr_number'), events: [] })]
  })

  const next: DisposalManifestCapture = { ...capture, loads: [...kept, ...built] }
  return { capture: next, changed: JSON.stringify(next) !== JSON.stringify(capture), reopened }
}

/**
 * An address found from an event's GPS. It names the stop, and for a drop-off
 * it also names the tip when the load has none.
 */
export function withEventPlace(load: DisposalLoad, eventId: string, address: string): DisposalLoad {
  const event = load.events?.find(e => e.id === eventId)
  const place = address.trim()
  if (!event || !place || event.place.trim()) return load
  let next: DisposalLoad = { ...load, events: load.events?.map(e => (e.id === eventId ? { ...e, place } : e)) }
  if (event.role !== 'load' && !loadSkipOnly(load) && !load.facility.trim() && !load.dump_location.trim()) {
    next = { ...next, facility: place, dump_location: place, dump_location_from_photo: true }
  }
  return next
}

/** A new load with no photos, for a run nobody photographed. */
export function manualTimelineLoad(capture: DisposalManifestCapture, site: SiteContext): DisposalLoad {
  return without(newTimelineLoad(capture, [], site), 'suggested')
}

// ── Checking a load ──────────────────────────────────────────────────────────

/** Mark a load as checked against its photos. Its suggestions become its values. */
export function verifyLoad(load: DisposalLoad, at: string): DisposalLoad {
  return {
    ...without(load, 'suggested'),
    verified_at: at,
    ...(load.events ? { events: load.events.map(e => without(e, 'suggested')) } : {}),
  }
}

/** A typed value is no longer a suggestion. */
export function clearSuggestion(load: DisposalLoad, field: string): DisposalLoad {
  if (!load.suggested?.includes(field)) return load
  const left = load.suggested.filter(f => f !== field)
  return left.length ? { ...load, suggested: left } : without(load, 'suggested')
}

/** What still stands between this load and a complete record. The first is the one that stops billing. */
export function loadIssues(load: DisposalLoad): string[] {
  const issues: string[] = []
  if (loadVolumeM3(load) == null) issues.push('No volume yet. Add the container dimensions or the cubic metres.')
  const events = eventsOf(load)
  if (!events.some(e => e.role === 'load')) issues.push('No photo of the load.')
  if (!loadSkipOnly(load) && !load.docket_photo_url && !load.docket_skipped && !load.docket_lost) {
    issues.push('No docket photo. Mark it as no docket if there is none.')
  }
  return issues
}

/** Suggested values on this load that nobody has checked yet. */
export function unverifiedCount(load: DisposalLoad): number {
  return (load.suggested?.length ?? 0) + (load.events ?? []).filter(e => e.suggested).length
}

/** The timeline as the composed record prints it: only what the client is shown. */
export function timelineSnapshot(load: DisposalLoad): NonNullable<WasteDisposalManifestLoadSnapshot['events']> {
  if (!load.events) return []
  return sortEvents(load.events)
    .filter(e => photoInCompose(e.show_to_client))
    .map(e => ({
      when: formatEventWhen(e.at),
      place: e.place.trim(),
      title: eventTitle(e, load),
      description: e.description.trim(),
      photos: e.photos
        .filter(p => photoInCompose(p.include_in_compose))
        .map(p => ({ url: p.url, note: p.note?.trim() || undefined })),
      ...(e.role === 'docket' ? { docket: true } : {}),
    }))
}
