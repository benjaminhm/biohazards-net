/*
 * components/tabs/PhotosTab.tsx
 *
 * The Photos tab on the job detail page: browse, filter, and edit existing photos
 * (category, area, caption) and sync room notes with assessment_data.
 *
 * Uploading new photos happens on the Assessment tab inside each area card
 * (camera / gallery) so capture is tied to the room being documented.
 *
 * Deletion sends DELETE /api/photos/[id] which also removes the Storage object.
 */
'use client'

import { useMemo, useState, useEffect } from 'react'
import type { Photo, PhotoCategory, AssessmentData } from '@/lib/types'
import PhotoCard from '@/components/PhotoCard'

interface Props {
  jobId: string
  photos: Photo[]
  assessmentData?: AssessmentData | null
  onAssessmentDataUpdate?: (assessmentData: AssessmentData) => void
  onPhotosUpdate: (photos: Photo[]) => void
}

const CATEGORIES: { value: PhotoCategory; label: string; color: string }[] = [
  { value: 'before',     label: 'Before',     color: '#F87171' },
  { value: 'assessment', label: 'Assessment', color: '#60A5FA' },
  { value: 'during',     label: 'During',     color: '#FBBF24' },
  { value: 'after',      label: 'After',      color: '#4ADE80' },
]

const CATEGORY_COLORS: Record<PhotoCategory, string> = {
  before: '#F87171', during: '#FBBF24', after: '#4ADE80', assessment: '#60A5FA',
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function PhotosTab({ jobId, photos, assessmentData = null, onAssessmentDataUpdate, onPhotosUpdate }: Props) {
  const [filter, setFilter] = useState<PhotoCategory | 'all'>('all')
  const [viewMode, setViewMode] = useState<'category' | 'room'>('category')
  const [roomFilter, setRoomFilter] = useState<string>('all')
  const [roomNotesDraft, setRoomNotesDraft] = useState<Record<string, string>>({})
  const [savingRoom, setSavingRoom] = useState<string | null>(null)
  const areaNames = useMemo(
    () => (assessmentData?.areas ?? []).map(a => (a.name || '').trim()).filter(Boolean),
    [assessmentData]
  )

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const area of assessmentData?.areas ?? []) {
      const key = (area.name || '').trim()
      if (key) next[key] = area.note ?? ''
    }
    setRoomNotesDraft(next)
  }, [assessmentData])

  async function saveRoomNote(areaName: string) {
    const trimmed = areaName.trim()
    if (!trimmed) return
    if (!assessmentData) {
      window.alert('Add assessment areas first, then room notes can sync here.')
      return
    }
    setSavingRoom(trimmed)
    try {
      const existing = assessmentData.areas ?? []
      const note = roomNotesDraft[trimmed] ?? ''
      const idx = existing.findIndex(a => (a.name || '').trim() === trimmed)
      const nextAreas = [...existing]
      if (idx >= 0) nextAreas[idx] = { ...nextAreas[idx], note }
      else nextAreas.push({ name: trimmed, sqm: 0, hazard_level: 1, description: '', note })
      const nextAssessment: AssessmentData = { ...assessmentData, areas: nextAreas }

      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_data: nextAssessment }),
      })
      const payload = await res.json() as { error?: string; job?: { assessment_data?: AssessmentData | null } }
      if (!res.ok || payload.error) throw new Error(payload.error ?? 'Failed to save room note')
      onAssessmentDataUpdate?.(payload.job?.assessment_data ?? nextAssessment)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not save room note')
    } finally {
      setSavingRoom(null)
    }
  }

  const filtered = filter === 'all' ? photos : photos.filter(p => p.category === filter)
  const roomGroups = useMemo(() => {
    const map = new Map<string, Photo[]>()
    for (const p of photos) {
      const key = (p.area_ref || '').trim() || 'Unassigned Area'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    for (const name of areaNames) {
      if (!map.has(name)) map.set(name, [])
    }
    return Array.from(map.entries()).map(([name, roomPhotos]) => {
      const staged = {
        assessment: roomPhotos.filter(p => p.category === 'assessment'),
        before: roomPhotos.filter(p => p.category === 'before'),
        during: roomPhotos.filter(p => p.category === 'during'),
        after: roomPhotos.filter(p => p.category === 'after'),
      }
      return { name, note: roomNotesDraft[name] ?? '', photos: roomPhotos, stages: staged }
    })
  }, [photos, areaNames, roomNotesDraft])
  const roomTabs = useMemo(() => {
    const names = new Set<string>(areaNames)
    for (const p of photos) {
      const key = (p.area_ref || '').trim()
      if (key) names.add(key)
    }
    const ordered = Array.from(names.values())
    const hasUnassigned = photos.some(p => !(p.area_ref || '').trim())
    if (hasUnassigned) ordered.push('Unassigned Area')
    return ['all', ...ordered]
  }, [areaNames, photos])
  const filteredRoomGroups = roomFilter === 'all'
    ? roomGroups
    : roomGroups.filter(group => group.name === roomFilter)

  useEffect(() => {
    if (!roomTabs.includes(roomFilter)) setRoomFilter('all')
  }, [roomTabs, roomFilter])

  return (
    <div style={{ paddingBottom: 40 }}>
      <div
        className="card"
        style={{
          marginBottom: 20,
          padding: '14px 16px',
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--text-muted)',
          borderStyle: 'dashed',
        }}
      >
        <strong style={{ color: 'var(--text)' }}>Upload photos on Assessment.</strong>{' '}
        Open Assessment (Home → Before Works → Assessment), pick a room in an area row, then use Camera or Gallery in that area&apos;s Photos block.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => setViewMode('category')}
          style={{
            padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            border: `1px solid ${viewMode === 'category' ? 'var(--accent)' : 'var(--border)'}`,
            background: viewMode === 'category' ? 'var(--accent-dim)' : 'transparent',
            color: viewMode === 'category' ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          By Category
        </button>
        <button
          type="button"
          onClick={() => setViewMode('room')}
          style={{
            padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            border: `1px solid ${viewMode === 'room' ? 'var(--accent)' : 'var(--border)'}`,
            background: viewMode === 'room' ? 'var(--accent-dim)' : 'transparent',
            color: viewMode === 'room' ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          By Room
        </button>
      </div>

      {viewMode === 'category' ? (
        <>
          {/* ── Filter bar ── */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
            {(['all', ...CATEGORIES.map(c => c.value)] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
                background: filter === f ? 'var(--accent-dim)' : 'transparent',
                color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}>
                {f === 'all' ? `All (${photos.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${photos.filter(p => p.category === f).length})`}
              </button>
            ))}
          </div>

          {/* ── Photo grid ── */}
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 14 }}>
              No photos in this category yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {filtered.map(photo => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  areaNames={areaNames}
                  onDelete={(id) => onPhotosUpdate(photos.filter(p => p.id !== id))}
                  onUpdate={(updated) => onPhotosUpdate(photos.map(p => p.id === updated.id ? updated : p))}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {roomTabs.map(room => (
              <button
                key={room}
                type="button"
                onClick={() => setRoomFilter(room)}
                style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${roomFilter === room ? 'var(--accent)' : 'var(--border)'}`,
                  background: roomFilter === room ? 'var(--accent-dim)' : 'transparent',
                  color: roomFilter === room ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {room === 'all' ? `All Rooms (${roomGroups.length})` : room}
              </button>
            ))}
          </div>

          {filteredRoomGroups.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 14 }}>
              No rooms found yet.
            </div>
          )}

          {filteredRoomGroups.map(room => (
            <div key={room.name} className="card">
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{room.name}</div>
              {room.name !== 'Unassigned Area' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Room Notes</label>
                  <textarea
                    rows={2}
                    value={roomNotesDraft[room.name] ?? ''}
                    onChange={e => setRoomNotesDraft(prev => ({ ...prev, [room.name]: e.target.value }))}
                    placeholder="Technician note for this room..."
                    style={{ resize: 'vertical', marginTop: 4 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '6px 10px' }}
                      disabled={savingRoom === room.name}
                      onClick={() => saveRoomNote(room.name)}
                    >
                      {savingRoom === room.name ? 'Saving...' : 'Save room note'}
                    </button>
                  </div>
                </div>
              )}
              {(['assessment', 'before', 'during', 'after'] as const).map(stage => (
                room.stages[stage].length > 0 ? (
                  <div key={stage} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: CATEGORY_COLORS[stage], marginBottom: 8 }}>
                      {stage} ({room.stages[stage].length})
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                      {room.stages[stage].map(photo => (
                        <PhotoCard
                          key={photo.id}
                          photo={photo}
                          areaNames={areaNames}
                          onDelete={(id) => onPhotosUpdate(photos.filter(p => p.id !== id))}
                          onUpdate={(updated) => onPhotosUpdate(photos.map(p => p.id === updated.id ? updated : p))}
                        />
                      ))}
                    </div>
                  </div>
                ) : null
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
