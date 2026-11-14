/*
 * components/tabs/PhotosTab.tsx
 *
 * The job's photo folder: every photo loaded to the job, newest first, with
 * when / where / who. Photos carry no stage tags; each document chooses its
 * own photos from this folder. Room notes stay here and sync with assessment_data.
 *
 * Deletion sends DELETE /api/photos/[id] which also removes the Storage object.
 */
'use client'

import { useMemo, useState, useEffect } from 'react'
import type { Photo, AssessmentData } from '@/lib/types'
import PhotoCard from '@/components/PhotoCard'
import PhoneUploadQr from '@/components/PhoneUploadQr'
import { usedPhotoIds } from '@/lib/photoSelection'

interface Props {
  jobId: string
  photos: Photo[]
  assessmentData?: AssessmentData | null
  onAssessmentDataUpdate?: (assessmentData: AssessmentData) => void
  onPhotosUpdate: (photos: Photo[]) => void
}

type Filter = 'all' | 'used' | 'unused' | 'disposal'

function newestFirst(a: Photo, b: Photo): number {
  const t = (p: Photo) => Date.parse(p.taken_at || p.uploaded_at) || 0
  return t(b) - t(a)
}

export default function PhotosTab({ jobId, photos, assessmentData = null, onAssessmentDataUpdate, onPhotosUpdate }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [phoneUpload, setPhoneUpload] = useState(false)
  const [roomNotesDraft, setRoomNotesDraft] = useState<Record<string, string>>({})
  const [savingRoom, setSavingRoom] = useState<string | null>(null)
  const areaNames = useMemo(
    () => (assessmentData?.areas ?? []).map(a => (a.name || '').trim()).filter(Boolean),
    [assessmentData]
  )
  const used = useMemo(() => usedPhotoIds(assessmentData, photos), [assessmentData, photos])

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
    if (!trimmed || !assessmentData) return
    setSavingRoom(trimmed)
    try {
      const note = roomNotesDraft[trimmed] ?? ''
      const nextAreas = (assessmentData.areas ?? []).map(a => ((a.name || '').trim() === trimmed ? { ...a, note } : a))
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

  const sorted = useMemo(() => [...photos].sort(newestFirst), [photos])
  const counts: Record<Filter, number> = {
    all: sorted.length,
    used: sorted.filter(p => used.has(p.id)).length,
    unused: sorted.filter(p => !used.has(p.id)).length,
    disposal: sorted.filter(p => p.cdr_load != null).length,
  }
  const shown = sorted.filter(p =>
    filter === 'all' ? true
      : filter === 'used' ? used.has(p.id)
        : filter === 'unused' ? !used.has(p.id)
          : p.cdr_load != null
  )
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unused', label: 'Not in a document' },
    { id: 'used', label: 'In a document' },
    ...(counts.disposal > 0 ? [{ id: 'disposal' as const, label: 'Disposal record' }] : []),
  ]

  return (
    <div style={{ paddingBottom: 40 }}>
      <div
        className="card"
        style={{ marginBottom: 20, padding: '14px 16px', fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)', borderStyle: 'dashed' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong style={{ color: 'var(--text)' }}>Every photo for this job lands here.</strong>{' '}
            Load them from your phone with the QR code, the photo loader or the PIN camera. Each document picks its own
            photos with &ldquo;Select from folder&rdquo;.
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setPhoneUpload(true)} style={{ fontSize: 13, fontWeight: 800 }}>
            Phone upload (QR)
          </button>
        </div>
      </div>
      {phoneUpload && (
        <PhoneUploadQr jobId={jobId} photoCount={photos.length} onPhotosUpdate={onPhotosUpdate} onClose={() => setPhoneUpload(false)} />
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {filters.map(f => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            border: `1px solid ${filter === f.id ? 'var(--accent)' : 'var(--border)'}`,
            background: filter === f.id ? 'var(--accent-dim)' : 'transparent',
            color: filter === f.id ? 'var(--accent)' : 'var(--text-muted)',
          }}>
            {f.label} ({counts[f.id]})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 14 }}>
          {photos.length === 0 ? 'No photos on this job yet.' : 'No photos match this filter.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {shown.map(photo => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              used={used.has(photo.id)}
              onDelete={(id) => onPhotosUpdate(photos.filter(p => p.id !== id))}
              onUpdate={(updated) => onPhotosUpdate(photos.map(p => p.id === updated.id ? updated : p))}
            />
          ))}
        </div>
      )}

      {areaNames.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Room notes</div>
          <div style={{ display: 'grid', gap: 14 }}>
            {areaNames.map(name => (
              <div key={name}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{name}</label>
                <textarea
                  rows={2}
                  value={roomNotesDraft[name] ?? ''}
                  onChange={e => setRoomNotesDraft(prev => ({ ...prev, [name]: e.target.value }))}
                  placeholder="Technician note for this room..."
                  style={{ resize: 'vertical', marginTop: 4 }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '6px 10px' }}
                    disabled={savingRoom === name}
                    onClick={() => saveRoomNote(name)}
                  >
                    {savingRoom === name ? 'Saving...' : 'Save room note'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
