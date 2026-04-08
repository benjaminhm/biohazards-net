import type { Area, Photo, PhotoCategory } from './types'

export interface RoomPhotoGroup {
  room: string
  note: string
  photos: Photo[]
  stages: Record<PhotoCategory, Photo[]>
}

const STAGES: PhotoCategory[] = ['assessment', 'before', 'during', 'after']

export function groupPhotosByRoomAndStage(photos: Photo[], areas: Area[] = []): RoomPhotoGroup[] {
  const roomMap = new Map<string, RoomPhotoGroup>()

  for (const area of areas) {
    const room = (area.name || '').trim()
    if (!room) continue
    if (!roomMap.has(room)) {
      roomMap.set(room, {
        room,
        note: area.note ?? '',
        photos: [],
        stages: { assessment: [], before: [], during: [], after: [] },
      })
    } else {
      roomMap.get(room)!.note = area.note ?? roomMap.get(room)!.note
    }
  }

  for (const photo of photos) {
    const room = (photo.area_ref || '').trim() || 'Unassigned Area'
    if (!roomMap.has(room)) {
      roomMap.set(room, {
        room,
        note: '',
        photos: [],
        stages: { assessment: [], before: [], during: [], after: [] },
      })
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
      },
    }))
    .filter(group => group.photos.length > 0)
}
