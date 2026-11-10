/*
 * Before / After Remediation photo loader for the multi-part PRE. Uploads are
 * saved as ordinary job photos (Before: before/assessment, After:
 * after/progress); the report keeps only the chosen ids, in order. "Choose
 * photos" opens PhotoBrowserModal over every job photo, including Untagged.
 */
'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import type { Photo } from '@/lib/types'
import { preSelectedPhotos } from '@/lib/preReportOutline'
import { sectionHeading, textInput, uploadJobPhotos } from '@/components/tabs/PostRemediationEvaluationTab'
import PhotoBrowserModal from '@/components/PhotoBrowserModal'

const STAGES = {
  before: { title: 'Before remediation', tags: { category: 'before', capture_phase: 'assessment' } },
  after: { title: 'After remediation', tags: { category: 'after', capture_phase: 'progress' } },
} as const

const removeBtn = {
  position: 'absolute' as const,
  top: 4,
  right: 4,
  width: 22,
  height: 22,
  padding: 0,
  border: 'none',
  borderRadius: 999,
  background: 'rgba(0,0,0,0.72)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 700,
  lineHeight: '22px',
  cursor: 'pointer',
}

const thumb = { width: '100%', height: 96, objectFit: 'cover' as const, borderRadius: 8, display: 'block', background: 'var(--surface-2)' }

export default function PreReportPhotoLoader({
  jobId,
  stage,
  photos,
  ids,
  onChange,
  onPhotosUpdate,
}: {
  jobId: string
  stage: keyof typeof STAGES
  photos: Photo[]
  ids: string[] | undefined
  onChange: (ids: string[]) => Promise<void>
  onPhotosUpdate: (photos: Photo[]) => void
}) {
  const { title, tags } = STAGES[stage]
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [captions, setCaptions] = useState<Record<string, string>>({})

  const chosen = preSelectedPhotos(ids, photos)
  const chosenIds = new Set(chosen.map(p => p.id))

  function save(next: string[]) {
    setError('')
    void onChange(next).catch(err => setError(err instanceof Error ? err.message : 'Could not save the photos'))
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(file => file.type.startsWith('image/'))
    e.target.value = ''
    if (!files.length || uploading) return
    setUploading(true)
    setError('')
    const { added, error: uploadError } = await uploadJobPhotos(jobId, files, tags)
    if (added.length) {
      onPhotosUpdate([...photos, ...added])
      try {
        await onChange([...chosen.map(p => p.id), ...added.map(p => p.id)])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the photos')
      }
    }
    if (uploadError) setError(uploadError)
    setUploading(false)
  }

  function move(fromId: string, toId: string) {
    const next = chosen.map(p => p.id)
    const from = next.indexOf(fromId)
    const to = next.indexOf(toId)
    if (from < 0 || to < 0 || from === to) return
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    save(next)
  }

  async function saveCaption(photo: Photo) {
    const caption = (captions[photo.id] ?? photo.caption ?? '').trim()
    if (caption === (photo.caption ?? '').trim()) return
    setError('')
    try {
      const res = await fetch(`/api/photos/${photo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption }),
      })
      const data = (await res.json().catch(() => ({}))) as { photo?: Photo; error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not save the caption')
      onPhotosUpdate(photos.map(p => (p.id === photo.id ? { ...p, ...(data.photo ?? {}), caption } : p)))
      setCaptions(prev => {
        const next = { ...prev }
        delete next[photo.id]
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the caption')
    }
  }

  return (
    <div>
      <div style={sectionHeading}>{title}</div>
      <input ref={fileRef} type="file" accept="image/*" multiple onChange={e => void onPick(e)} style={{ display: 'none' }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={e => void onPick(e)} style={{ display: 'none' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          style={{ padding: '12px 16px', fontWeight: 700 }}
        >
          {uploading ? 'Uploading…' : 'Upload photos'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={uploading}
          onClick={() => cameraRef.current?.click()}
          style={{ padding: '12px 16px', fontWeight: 700 }}
        >
          Take photo
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setChoosing(true)}
          style={{ padding: '12px 16px', fontWeight: 700 }}
        >
          Choose photos
        </button>
      </div>
      {error && <div style={{ color: '#F87171', fontSize: 13, marginTop: 8 }} role="alert">{error}</div>}

      {chosen.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '10px 0 0' }}>No photos chosen — this section is left out.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, marginTop: 12 }}>
          {chosen.map(photo => (
            <div
              key={photo.id}
              onDragOver={e => {
                e.preventDefault()
                if (overId !== photo.id) setOverId(photo.id)
              }}
              onDrop={e => {
                e.preventDefault()
                const fromId = e.dataTransfer.getData('text/plain') || dragId
                if (fromId) move(fromId, photo.id)
                setDragId(null)
                setOverId(null)
              }}
              style={{
                borderRadius: 8,
                outline: overId === photo.id && dragId && dragId !== photo.id ? '2px solid var(--accent, #60a5fa)' : 'none',
                opacity: dragId === photo.id ? 0.55 : 1,
              }}
            >
              <div
                draggable
                title="Drag to reorder"
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', photo.id)
                  setDragId(photo.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
                style={{ position: 'relative', cursor: 'grab' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.file_url} alt={photo.caption || title} draggable={false} style={{ ...thumb, pointerEvents: 'none' }} />
                <button
                  type="button"
                  aria-label="Remove from the report"
                  title="Remove from the report (the photo stays on the job)"
                  onClick={() => save(chosen.filter(p => p.id !== photo.id).map(p => p.id))}
                  style={removeBtn}
                >
                  ×
                </button>
              </div>
              <input
                value={captions[photo.id] ?? photo.caption ?? ''}
                onChange={e => setCaptions(prev => ({ ...prev, [photo.id]: e.target.value }))}
                onBlur={() => void saveCaption(photo)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                placeholder="Caption"
                style={{ ...textInput, padding: '6px 8px', fontSize: 12, marginTop: 6 }}
              />
            </div>
          ))}
        </div>
      )}

      {choosing && (
        <PhotoBrowserModal
          jobId={jobId}
          title={title}
          photos={photos}
          alreadyIds={chosenIds}
          onPhotosUpdate={onPhotosUpdate}
          onClose={() => setChoosing(false)}
          onAdd={added => {
            setChoosing(false)
            save([...chosen.map(p => p.id), ...added])
          }}
        />
      )}
    </div>
  )
}
