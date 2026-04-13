'use client'

import { useMemo } from 'react'
import PhotoUploadPanel from '@/components/PhotoUploadPanel'
import PhotoCard from '@/components/PhotoCard'
import { AREA_ROOM_TYPES } from '@/lib/areaRoomTypes'
import type { Job, Photo } from '@/lib/types'

interface Props {
  job: Job
  photos: Photo[]
  onPhotosUpdate: (photos: Photo[]) => void
}

function isProgressPhoto(photo: Photo): boolean {
  if (photo.capture_phase === 'progress') return true
  if (photo.capture_phase === 'assessment') return false
  // Backward compatibility for historical rows created before capture_phase.
  return photo.category === 'during' || photo.category === 'after'
}

export default function ProgressPhotosTab({ job, photos, onPhotosUpdate }: Props) {
  const rooms = useMemo(() => {
    const fromAssessment = (job.assessment_data?.areas ?? [])
      .map(a => (a.name || '').trim())
      .filter(Boolean)
    const fromPhotos = photos
      .filter(isProgressPhoto)
      .map(p => (p.area_ref || '').trim())
      .filter(Boolean)
    const set = new Set<string>([...fromAssessment, ...fromPhotos])
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [job.assessment_data?.areas, photos])

  const progressPhotos = useMemo(() => photos.filter(isProgressPhoto), [photos])

  if (rooms.length === 0) {
    return (
      <div style={{ paddingBottom: 40 }}>
        <div className="card" style={{ marginBottom: 16, borderStyle: 'dashed' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No rooms found yet</div>
          <div style={{ color: 'var(--text-muted)', lineHeight: 1.5, fontSize: 13 }}>
            Add rooms on Assessment → Presentation first. Progress Photos mirrors those rooms and only captures
            <strong> During</strong> and <strong>After</strong> evidence for completion reporting.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div className="card" style={{ marginBottom: 16, borderStyle: 'dashed' }}>
        <div style={{ color: 'var(--text-muted)', lineHeight: 1.5, fontSize: 13 }}>
          Progress capture is isolated to <strong>During</strong> and <strong>After</strong>. These photos are tagged as
          <strong> Progress</strong> phase and are used by completion reporting workflows.
        </div>
      </div>

      {rooms.map((room) => {
        const roomPhotos = progressPhotos.filter(p => (p.area_ref || '').trim() === room)
        return (
          <div key={room} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ margin: 0 }}>Room</label>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{room}</div>
            </div>

            <PhotoUploadPanel
              jobId={job.id}
              fixedAreaRef={room}
              photos={photos}
              onPhotosUpdate={onPhotosUpdate}
              defaultPendingCategory="during"
              allowedCategories={['during', 'after']}
              fixedCapturePhase="progress"
              compact
            />

            {roomPhotos.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 10,
                  marginBottom: 4,
                }}
              >
                {roomPhotos.map(photo => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    areaNames={[...AREA_ROOM_TYPES, ...rooms]}
                    allowedCategories={['during', 'after']}
                    showAreaChip={false}
                    onDelete={id => onPhotosUpdate(photos.filter(p => p.id !== id))}
                    onUpdate={updated => onPhotosUpdate(photos.map(p => (p.id === updated.id ? updated : p)))}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
