import type { Area, Photo } from '@/lib/types'

/**
 * Photos eligible for HTML print, PDF, and composed document previews.
 * Excluded when `include_in_composed_reports === false` (unset / missing = included),
 * unless the document chose the photo itself: the switch only applies to photos
 * that older documents pick by their area, stage or appendix rule.
 */
export function photosForComposedReports<P extends Photo>(photos: P[], chosen: ReadonlySet<string> = new Set()): P[] {
  return photos.filter(p => p.include_in_composed_reports !== false || chosen.has(p.id))
}

/** Photo ids this document (and the job's areas) chose explicitly. */
export function chosenPhotoIds(content: object, areas: readonly Area[] = []): Set<string> {
  const ids = new Set<string>()
  const add = (v: unknown) => {
    if (Array.isArray(v)) for (const id of v) if (typeof id === 'string') ids.add(id)
  }
  const c = content as Record<string, unknown>
  add(c.photo_ids)
  add(c.before_photo_ids)
  add(c.after_photo_ids)
  if (c.report_images_chosen === true) add(c.report_image_ids)
  for (const area of areas) {
    add(area.photo_ids)
    add(area.during_photo_ids)
    add(area.after_photo_ids)
  }
  return ids
}
