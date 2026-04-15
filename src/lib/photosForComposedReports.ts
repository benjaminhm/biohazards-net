import type { Photo } from '@/lib/types'

/**
 * Photos eligible for HTML print, PDF, and composed document previews.
 * Excluded when `include_in_composed_reports === false` (unset / missing = included).
 */
export function photosForComposedReports(photos: Photo[]): Photo[] {
  return photos.filter(p => p.include_in_composed_reports !== false)
}
