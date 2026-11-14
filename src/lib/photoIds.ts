/** A document's chosen photos, in order. Unset means it was saved before it chose any. */
export interface PhotoIdsField {
  photo_ids?: string[]
}

/** Keeps a stored photo list, or leaves it unset. */
export function normalizePhotoIds(o: Record<string, unknown>): PhotoIdsField {
  if (!Array.isArray(o.photo_ids)) return {}
  return { photo_ids: [...new Set(o.photo_ids.filter((id): id is string => typeof id === 'string' && id.length > 0))] }
}

export function samePhotoIds(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a || !b) return a === b
  return a.length === b.length && a.every((id, i) => id === b[i])
}
