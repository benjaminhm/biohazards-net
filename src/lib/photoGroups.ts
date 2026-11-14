import type { Area, Photo, PhotoCategory } from './types'

export interface RoomPhotoGroup {
  room: string
  note: string
  photos: Photo[]
  stages: Record<PhotoCategory, Photo[]>
}

/** Photos loaded on the quote/estimate. They print as one block at the end of that document, not under a room. */
export const QUOTE_APPENDIX_AREA_REF = 'Quote photos'

export function isQuoteAppendixPhoto(photo: { area_ref?: string | null }): boolean {
  return (photo.area_ref || '').trim() === QUOTE_APPENDIX_AREA_REF
}

/** Photos loaded on the contents clearance quote. They print as one block at the end of that document. */
export const CONTENTS_CLEARANCE_APPENDIX_AREA_REF = 'Contents clearance photos'

export function isContentsClearanceAppendixPhoto(photo: { area_ref?: string | null }): boolean {
  return (photo.area_ref || '').trim() === CONTENTS_CLEARANCE_APPENDIX_AREA_REF
}

/** Photos loaded on the surface area cleaning quote. They print as one block at the end of that document. */
export const SURFACE_AREA_APPENDIX_AREA_REF = 'Surface area cleaning photos'

export function isSurfaceAreaAppendixPhoto(photo: { area_ref?: string | null }): boolean {
  return (photo.area_ref || '').trim() === SURFACE_AREA_APPENDIX_AREA_REF
}

/** Photos that belong on one quote, not in a room or on another document. */
export function isDocumentAppendixPhoto(photo: { area_ref?: string | null }): boolean {
  return isQuoteAppendixPhoto(photo) || isContentsClearanceAppendixPhoto(photo) || isSurfaceAreaAppendixPhoto(photo)
}

/** Coerce photo.category to a known stage (null/legacy values → before) so bucketing never indexes undefined. */
export function normalizePhotoCategory(raw: unknown): PhotoCategory {
  if (raw === 'assessment' || raw === 'before' || raw === 'during' || raw === 'after') return raw
  return 'before'
}

const SURVEY_STAGES: readonly PhotoCategory[] = ['assessment', 'before']

function emptyStages(): Record<PhotoCategory, Photo[]> {
  return { assessment: [], before: [], during: [], after: [], untagged: [] }
}

/**
 * Photos by room and stage. An area that has chosen its photos uses them: its
 * survey list prints as the room's assessment photos, its progress lists as
 * during and after. Where a list is unset, the room keeps the old rule (photos
 * whose area and stage match). A chosen photo is not also placed by the old rule,
 * and untagged photos stay in the folder until a document chooses them.
 */
export function groupPhotosByRoomAndStage(photos: Photo[], areas: Area[] = []): RoomPhotoGroup[] {
  const normalizedPhotos = photos.map(p => ({ ...p, category: normalizePhotoCategory(p.category) }))
  const byId = new Map(normalizedPhotos.map(p => [p.id, p]))
  const roomMap = new Map<string, RoomPhotoGroup>()
  const chosen = new Set<string>()
  const overridden = new Map<string, Set<PhotoCategory>>()

  const pick = (ids: string[] | undefined, stage: PhotoCategory): Photo[] =>
    [...new Set(ids ?? [])].flatMap(id => {
      const p = byId.get(id)
      if (!p) return []
      chosen.add(id)
      return [{ ...p, category: stage }]
    })

  for (const area of areas) {
    const room = (area.name || '').trim()
    if (!room) continue
    if (!roomMap.has(room)) {
      roomMap.set(room, { room, note: area.note ?? '', photos: [], stages: emptyStages() })
    } else {
      roomMap.get(room)!.note = area.note ?? roomMap.get(room)!.note
    }
    const group = roomMap.get(room)!
    const lists: [string[] | undefined, PhotoCategory, readonly PhotoCategory[]][] = [
      [area.photo_ids, 'assessment', SURVEY_STAGES],
      [area.during_photo_ids, 'during', ['during']],
      [area.after_photo_ids, 'after', ['after']],
    ]
    for (const [ids, stage, replaces] of lists) {
      if (!Array.isArray(ids)) continue
      const set = overridden.get(room) ?? new Set<PhotoCategory>()
      for (const r of replaces) set.add(r)
      overridden.set(room, set)
      for (const p of pick(ids, stage)) {
        group.photos.push(p)
        group.stages[stage].push(p)
      }
    }
  }

  for (const [index, photo] of normalizedPhotos.entries()) {
    if (photos[index].category === 'untagged') continue
    if (isDocumentAppendixPhoto(photo) || chosen.has(photo.id)) continue
    const room = (photo.area_ref || '').trim() || 'Unassigned Area'
    if (overridden.get(room)?.has(photo.category)) continue
    if (!roomMap.has(room)) {
      roomMap.set(room, { room, note: '', photos: [], stages: emptyStages() })
    }
    const group = roomMap.get(room)!
    group.photos.push(photo)
    group.stages[photo.category].push(photo)
  }

  return Array.from(roomMap.values())
    .filter(group => group.photos.length > 0 || group.room !== 'Unassigned Area')
    .sort((a, b) => {
      if (a.room === 'Unassigned Area') return 1
      if (b.room === 'Unassigned Area') return -1
      const aIndex = areas.findIndex(x => (x.name || '').trim() === a.room)
      const bIndex = areas.findIndex(x => (x.name || '').trim() === b.room)
      if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex
      if (aIndex >= 0) return -1
      if (bIndex >= 0) return 1
      return a.room.localeCompare(b.room)
    })
}

/** Every room's photos for the given stages, room by room, as grouped above. */
export function stagePhotos<P extends Photo>(photos: P[], areas: Area[], stages: readonly PhotoCategory[]): P[] {
  const byId = new Map(photos.map(p => [p.id, p]))
  return groupPhotosByRoomAndStage(photos, areas).flatMap(group =>
    stages.flatMap(stage => group.stages[stage].map(p => ({ ...byId.get(p.id)!, category: stage }))),
  )
}

export function filterGroupedStages(groups: RoomPhotoGroup[], stages: PhotoCategory[]): RoomPhotoGroup[] {
  return groups
    .map(group => ({
      ...group,
      photos: group.photos.filter(p => stages.includes(p.category)),
      stages: {
        assessment: stages.includes('assessment') ? group.stages.assessment : [],
        before: stages.includes('before') ? group.stages.before : [],
        during: stages.includes('during') ? group.stages.during : [],
        after: stages.includes('after') ? group.stages.after : [],
        untagged: stages.includes('untagged') ? group.stages.untagged : [],
      },
    }))
    .filter(group => group.photos.length > 0)
}
