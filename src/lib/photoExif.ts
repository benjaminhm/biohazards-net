/**
 * Lightweight JPEG EXIF reader for DateTimeOriginal + GPS.
 * Canvas compression strips EXIF, so call this on the original File first.
 * HEIC / stripped shares (iMessage, WhatsApp) return empty fields.
 */

export type PhotoGeoSource = 'exif' | 'device' | 'site' | 'dump' | 'skipped'
export type GalleryPlace = 'site' | 'dump' | 'here' | 'skip'
export type GalleryWhen = 'now' | 'skip'

export interface PhotoExif {
  takenAt: string | null
  date: string | null
  lat: number | null
  lng: number | null
  timeFromDevice?: boolean
  geoFromDevice?: boolean
  geoSource?: PhotoGeoSource
}

export interface GalleryPlaceContext {
  siteLabel: string
  siteLat: number | null
  siteLng: number | null
  dumpLabel: string
  dumpLat: number | null
  dumpLng: number | null
  defaultPlace: 'site' | 'dump'
}

const EMPTY: PhotoExif = { takenAt: null, date: null, lat: null, lng: null }

export async function readPhotoExif(file: File): Promise<PhotoExif> {
  try {
    const buf = await file.arrayBuffer()
    return { ...parseJpegExif(buf) }
  } catch {
    return { ...EMPTY }
  }
}

export function parseJpegExif(buf: ArrayBuffer): PhotoExif {
  const v = new DataView(buf)
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return EMPTY

  let offset = 2
  while (offset + 4 <= v.byteLength) {
    if (v.getUint8(offset) !== 0xff) break
    const marker = v.getUint8(offset + 1)
    const size = v.getUint16(offset + 2)
    if (size < 2) break
    if (marker === 0xe1) {
      const start = offset + 4
      if (start + 6 <= v.byteLength && ascii(v, start, 4) === 'Exif' && v.getUint16(start + 4) === 0) {
        return parseTiff(buf, start + 6)
      }
    }
    if (marker === 0xda) break
    offset += 2 + size
  }
  return EMPTY
}

function ascii(v: DataView, start: number, len: number): string {
  let s = ''
  for (let i = 0; i < len && start + i < v.byteLength; i++) {
    const c = v.getUint8(start + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

function parseTiff(buf: ArrayBuffer, tiffStart: number): PhotoExif {
  const v = new DataView(buf)
  if (tiffStart + 8 > v.byteLength) return EMPTY
  const order = ascii(v, tiffStart, 2)
  const le = order === 'II'
  if (!le && order !== 'MM') return EMPTY
  const magic = u16(v, tiffStart + 2, le)
  if (magic !== 42) return EMPTY
  const ifd0 = tiffStart + u32(v, tiffStart + 4, le)
  const ifd0Entries = readIfd(v, ifd0, tiffStart, le)

  let dateStr = readAsciiTag(v, ifd0Entries.get(0x0132), tiffStart, le)
  const exifOff = ifd0Entries.get(0x8769)
  if (exifOff) {
    const exifIfd = tiffStart + numValue(v, exifOff, le)
    const exifEntries = readIfd(v, exifIfd, tiffStart, le)
    dateStr = readAsciiTag(v, exifEntries.get(0x9003), tiffStart, le) || dateStr
  }

  let lat: number | null = null
  let lng: number | null = null
  const gpsOff = ifd0Entries.get(0x8825)
  if (gpsOff) {
    const gpsIfd = tiffStart + numValue(v, gpsOff, le)
    const gps = readIfd(v, gpsIfd, tiffStart, le)
    const latRef = (readAsciiTag(v, gps.get(0x0001), tiffStart, le) || 'N').toUpperCase()
    const lngRef = (readAsciiTag(v, gps.get(0x0003), tiffStart, le) || 'E').toUpperCase()
    const latDms = readGpsRational(v, gps.get(0x0002), tiffStart, le)
    const lngDms = readGpsRational(v, gps.get(0x0004), tiffStart, le)
    if (latDms != null) lat = latRef === 'S' ? -latDms : latDms
    if (lngDms != null) lng = lngRef === 'W' ? -lngDms : lngDms
    if (lat != null && (lat < -90 || lat > 90)) lat = null
    if (lng != null && (lng < -180 || lng > 180)) lng = null
  }

  const parsed = parseExifDate(dateStr)
  return {
    takenAt: parsed.takenAt,
    date: parsed.date,
    lat,
    lng,
  }
}

interface IfdEntry {
  tag: number
  type: number
  count: number
  valueOffset: number
}

function readIfd(v: DataView, ifd: number, _tiffStart: number, le: boolean): Map<number, IfdEntry> {
  const map = new Map<number, IfdEntry>()
  if (ifd < 0 || ifd + 2 > v.byteLength) return map
  const count = u16(v, ifd, le)
  for (let i = 0; i < count; i++) {
    const p = ifd + 2 + i * 12
    if (p + 12 > v.byteLength) break
    const tag = u16(v, p, le)
    map.set(tag, {
      tag,
      type: u16(v, p + 2, le),
      count: u32(v, p + 4, le),
      valueOffset: p + 8,
    })
  }
  return map
}

function readAsciiTag(v: DataView, entry: IfdEntry | undefined, tiffStart: number, le: boolean): string | null {
  if (!entry || entry.type !== 2 || entry.count < 1) return null
  const start = entry.count <= 4 ? entry.valueOffset : tiffStart + u32(v, entry.valueOffset, le)
  return ascii(v, start, entry.count).trim() || null
}

function readGpsRational(v: DataView, entry: IfdEntry | undefined, tiffStart: number, le: boolean): number | null {
  if (!entry || (entry.type !== 5 && entry.type !== 10) || entry.count < 3) return null
  const start = tiffStart + u32(v, entry.valueOffset, le)
  const deg = rational(v, start, le, entry.type === 10)
  const min = rational(v, start + 8, le, entry.type === 10)
  const sec = rational(v, start + 16, le, entry.type === 10)
  if (deg == null || min == null || sec == null) return null
  return deg + min / 60 + sec / 3600
}

function rational(v: DataView, offset: number, le: boolean, signed: boolean): number | null {
  if (offset + 8 > v.byteLength) return null
  const n = signed ? i32(v, offset, le) : u32(v, offset, le)
  const d = signed ? i32(v, offset + 4, le) : u32(v, offset + 4, le)
  if (!d) return null
  return n / d
}

function numValue(v: DataView, entry: IfdEntry, le: boolean): number {
  return u32(v, entry.valueOffset, le)
}

function u16(v: DataView, o: number, le: boolean): number {
  return v.getUint16(o, le)
}
function u32(v: DataView, o: number, le: boolean): number {
  return v.getUint32(o, le)
}
function i32(v: DataView, o: number, le: boolean): number {
  return v.getInt32(o, le)
}

function parseExifDate(raw: string | null): { takenAt: string | null; date: string | null } {
  if (!raw) return { takenAt: null, date: null }
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/)
  if (!m) return { takenAt: null, date: null }
  const date = `${m[1]}-${m[2]}-${m[3]}`
  if (!m[4]) return { takenAt: `${date}T00:00:00`, date }
  const takenAt = `${date}T${m[4]}:${m[5]}:${m[6]}`
  return { takenAt, date }
}

export function timeFromTakenAt(takenAt: string | null | undefined): string {
  if (!takenAt) return ''
  const m = takenAt.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return ''
  // Date-only EXIF is stored as T00:00:00 — don't treat that as a dump time.
  if (m[1] === '00' && m[2] === '00' && (m[3] == null || m[3] === '00')) return ''
  return `${m[1]}:${m[2]}`
}

/** Phone clock at capture — used when the image has no EXIF (HEIC / camera via Safari). */
export function localStampNow(): { takenAt: string; date: string } {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return { date, takenAt: `${date}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` }
}

export function readDeviceLocation(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    )
  })
}

export async function enrichExifWithDevice(exif: PhotoExif): Promise<PhotoExif> {
  const next: PhotoExif = { ...exif }
  if (next.lat != null && next.lng != null) next.geoSource = 'exif'
  if (!next.date || !next.takenAt) {
    const stamp = localStampNow()
    if (!next.date) next.date = stamp.date
    if (!next.takenAt) next.takenAt = stamp.takenAt
    next.timeFromDevice = true
  }
  if (next.lat == null || next.lng == null) {
    const geo = await readDeviceLocation()
    if (geo) {
      next.lat = geo.lat
      next.lng = geo.lng
      next.geoFromDevice = true
      next.geoSource = 'device'
    }
  }
  return next
}

/** Apply a camera-roll place/time choice. Never overwrites GPS or time already in the file. */
export function applyGalleryChoice(
  exif: PhotoExif,
  choice: { place: GalleryPlace; when: GalleryWhen },
  places: {
    siteLat: number | null
    siteLng: number | null
    dumpLat: number | null
    dumpLng: number | null
    here: { lat: number; lng: number } | null
  },
): PhotoExif {
  const next: PhotoExif = { ...exif }
  if (next.lat != null && next.lng != null) {
    next.geoSource = next.geoSource ?? 'exif'
  } else if (choice.place === 'site' && places.siteLat != null && places.siteLng != null) {
    next.lat = places.siteLat
    next.lng = places.siteLng
    next.geoSource = 'site'
    next.geoFromDevice = false
  } else if (choice.place === 'dump' && places.dumpLat != null && places.dumpLng != null) {
    next.lat = places.dumpLat
    next.lng = places.dumpLng
    next.geoSource = 'dump'
    next.geoFromDevice = false
  } else if (choice.place === 'here' && places.here) {
    next.lat = places.here.lat
    next.lng = places.here.lng
    next.geoSource = 'device'
    next.geoFromDevice = true
  } else {
    next.geoSource = 'skipped'
  }

  if ((!next.date || !next.takenAt) && choice.when === 'now') {
    const stamp = localStampNow()
    if (!next.date) next.date = stamp.date
    if (!next.takenAt) next.takenAt = stamp.takenAt
    next.timeFromDevice = true
  }
  return next
}

export function photoHasGps(exif: PhotoExif): boolean {
  return exif.lat != null && exif.lng != null
}

export function photoHasTime(exif: PhotoExif): boolean {
  return Boolean(exif.date && exif.takenAt)
}

export function formatCoordLabel(lat: number, lng: number): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lng).toFixed(5)}° ${ew}`
}
