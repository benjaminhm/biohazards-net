/*
 * Every job photo sits in one bucket with only its facts: when it was taken,
 * where, and who loaded it. A document keeps its own ordered list of photo ids.
 *
 * A document saved before it had a list (ids undefined) still shows the photos
 * its old rule picked (area, stage or appendix tag), so nothing printed
 * changes until staff choose photos on it. An empty list means none.
 */
import type { AssessmentData, Photo } from './types'
import { formatEventWhen, localStamp } from './disposalTimeline'

/** The photos for these ids, in that order. Ids no longer on the job are skipped. */
export function selectedPhotos<T extends { id: string }>(ids: readonly string[] | undefined | null, photos: readonly T[]): T[] {
  const byId = new Map(photos.map(p => [p.id, p]))
  return [...new Set(ids ?? [])].map(id => byId.get(id)).filter((p): p is T => !!p)
}

/** The chosen photos when the document has a list, otherwise what its old rule picks. */
export function photosFor<T extends { id: string }>(
  ids: readonly string[] | undefined | null,
  photos: readonly T[],
  fallback: (photos: readonly T[]) => T[],
): T[] {
  return Array.isArray(ids) ? selectedPhotos(ids, photos) : fallback(photos)
}

/** The ids a document starts from: its list, or the photos its old rule picks. */
export function selectionIds<T extends { id: string }>(
  ids: readonly string[] | undefined | null,
  photos: readonly T[],
  fallback: (photos: readonly T[]) => T[],
): string[] {
  return photosFor(ids, photos, fallback).map(p => p.id)
}

/** Photos that are images (dockets can be PDFs). */
export function isImagePhoto(p: Pick<Photo, 'file_url'>): boolean {
  return !!p.file_url && !/\.pdf($|\?)/i.test(p.file_url)
}

function idList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Every photo id some document on this job has chosen. Disposal photos count once sorted into a load. */
export function usedPhotoIds(data: AssessmentData | null | undefined, photos: readonly Photo[] = []): Set<string> {
  const used = new Set<string>()
  const add = (v: unknown) => { for (const id of idList(v)) used.add(id) }
  const d = (data ?? {}) as unknown as Record<string, unknown>
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

  for (const area of Array.isArray(d.areas) ? d.areas : []) {
    const a = obj(area)
    add(a.photo_ids)
    add(a.during_photo_ids)
    add(a.after_photo_ids)
  }
  for (const key of ['contents_clearance_quote', 'surface_area_cleaning_quote', 'biohazard_cleaning_quote']) {
    add(obj(d[key]).photo_ids)
  }
  add(obj(d.fast_quote).photo_ids)
  add(obj(d.outcome_quote_capture).photo_ids)
  for (const quote of Array.isArray(d.outcome_quotes) ? d.outcome_quotes : []) add(obj(quote).photo_ids)
  for (const pre of Array.isArray(d.pre_multi_part) ? d.pre_multi_part : []) {
    const p = obj(pre)
    add(p.before_photo_ids)
    add(p.after_photo_ids)
    add(p.report_image_ids)
  }
  for (const pre of Array.isArray(d.post_remediation_evaluations) ? d.post_remediation_evaluations : []) {
    add(obj(pre).report_image_ids)
  }
  for (const p of photos) if ((p.cdr_load ?? 0) >= 1) used.add(p.id)
  return used
}

/** Footer lines for a photo: when, where, and who loaded it. */
export function photoMeta(p: Pick<Photo, 'taken_at' | 'uploaded_at' | 'location_label' | 'location_lat' | 'location_lng' | 'uploaded_by_name'>): {
  when: string
  whenIsUpload: boolean
  place: string
  mapUrl: string | null
  by: string
} {
  const taken = formatEventWhen(localStamp(p.taken_at))
  const uploaded = formatEventWhen(localStamp(p.uploaded_at))
  const hasGps = typeof p.location_lat === 'number' && typeof p.location_lng === 'number'
  const coords = hasGps ? `${(p.location_lat as number).toFixed(5)}, ${(p.location_lng as number).toFixed(5)}` : ''
  return {
    when: taken || uploaded,
    whenIsUpload: !taken && !!uploaded,
    place: (p.location_label ?? '').trim() || coords,
    mapUrl: hasGps ? `https://www.google.com/maps?q=${p.location_lat},${p.location_lng}` : null,
    by: (p.uploaded_by_name ?? '').trim(),
  }
}
