'use client'

import { useEffect, useMemo, useState } from 'react'
import PhotoUploadPanel from '@/components/PhotoUploadPanel'
import PhotoCard from '@/components/PhotoCard'
import { AREA_ROOM_TYPES } from '@/lib/areaRoomTypes'
import type { Job, Photo, ProgressRoomNote } from '@/lib/types'

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
  const [notesByRoom, setNotesByRoom] = useState<Record<string, ProgressRoomNote>>({})
  const [draftByRoom, setDraftByRoom] = useState<Record<string, string>>({})
  const [savingRoom, setSavingRoom] = useState<string | null>(null)
  const [notesError, setNotesError] = useState('')

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

  useEffect(() => {
    let cancelled = false
    async function loadNotes() {
      setNotesError('')
      try {
        const res = await fetch(`/api/jobs/${job.id}/progress-room-notes`)
        const data = (await res.json()) as { notes?: ProgressRoomNote[]; error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Could not load room notes')
        if (cancelled) return
        const map: Record<string, ProgressRoomNote> = {}
        const drafts: Record<string, string> = {}
        for (const n of data.notes ?? []) {
          map[n.room_name] = n
          drafts[n.room_name] = n.note ?? ''
        }
        setNotesByRoom(map)
        setDraftByRoom(drafts)
      } catch (e) {
        if (!cancelled) setNotesError(e instanceof Error ? e.message : 'Could not load room notes')
      }
    }
    void loadNotes()
    return () => {
      cancelled = true
    }
  }, [job.id])

  useEffect(() => {
    setDraftByRoom(prev => {
      const next = { ...prev }
      for (const room of rooms) {
        if (!(room in next)) next[room] = notesByRoom[room]?.note ?? ''
      }
      return next
    })
  }, [rooms, notesByRoom])

  async function saveRoomNote(room: string) {
    const note = (draftByRoom[room] ?? '').slice(0, 50_000)
    setSavingRoom(room)
    try {
      const res = await fetch(`/api/jobs/${job.id}/progress-room-notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_name: room, note }),
      })
      const data = (await res.json()) as { note?: ProgressRoomNote; error?: string }
      if (!res.ok || !data.note) throw new Error(data.error ?? 'Could not save room note')
      setNotesByRoom(prev => ({ ...prev, [room]: data.note! }))
      setDraftByRoom(prev => ({ ...prev, [room]: data.note!.note ?? '' }))
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not save room note')
    } finally {
      setSavingRoom(null)
    }
  }

  function fmtLocal(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }

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
      {notesError && (
        <div style={{ color: '#F87171', marginBottom: 12, fontSize: 13 }}>{notesError}</div>
      )}

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

            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Progress Room Note</label>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 8px', lineHeight: 1.5 }}>
                Character guidance: what changed since before, what work was performed, and what the current condition is.
              </p>
              <textarea
                rows={3}
                value={draftByRoom[room] ?? ''}
                onChange={e => setDraftByRoom(prev => ({ ...prev, [room]: e.target.value.slice(0, 50_000) }))}
                placeholder="e.g. Blood traces removed from carpet edge; ATP swab clear; deodorisation complete."
                style={{ resize: 'vertical', width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, alignItems: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {notesByRoom[room]?.updated_at
                    ? `Last updated by ${notesByRoom[room].updated_by_first_name || 'User'} on ${fmtLocal(notesByRoom[room].updated_at)}`
                    : 'Not saved yet'}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '6px 10px' }}
                  disabled={savingRoom === room}
                  onClick={() => void saveRoomNote(room)}
                >
                  {savingRoom === room ? 'Saving…' : 'Save room note'}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
