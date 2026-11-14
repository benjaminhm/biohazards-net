/*
 * The photos one document section has chosen from the job's folder, in order.
 * Drag to reorder, × to take one out (it stays in the folder), "Select from
 * folder" to add. Taking or uploading a photo here puts it in the folder and
 * on this section.
 *
 * A section saved before it had its own list shows `fallback` (what its old
 * rule picked); the first change saves that set as the list.
 */
'use client'

import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import type { Photo } from '@/lib/types'
import { selectedPhotos } from '@/lib/photoSelection'
import { uploadJobPhotos } from '@/lib/jobPhotoUpload'
import PhotoFolderPicker from '@/components/PhotoFolderPicker'
import PhotoMeta from '@/components/PhotoMeta'

const removeBtn: CSSProperties = {
  position: 'absolute', top: 4, right: 4, width: 22, height: 22, padding: 0, border: 'none', borderRadius: 999,
  background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: '22px', cursor: 'pointer',
}
const thumb: CSSProperties = { width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 8, display: 'block', background: 'var(--surface-2)' }
const captionInput: CSSProperties = { width: '100%', padding: '6px 8px', fontSize: 12, marginTop: 6 }

export default function SelectedPhotos({
  jobId,
  title,
  photos,
  ids,
  fallback,
  onChange,
  onPhotosUpdate,
  usedIds,
  heading = true,
  captions = true,
  emptyText = 'No photos chosen.',
}: {
  jobId: string
  /** Section name, shown as the heading and in the picker. */
  title: string
  photos: Photo[]
  /** The section's list. Undefined when it was saved before it had one. */
  ids: string[] | undefined
  /** What the section showed before it had a list. */
  fallback?: Photo[]
  onChange: (ids: string[]) => Promise<void> | void
  onPhotosUpdate: (photos: Photo[]) => void
  usedIds?: Set<string>
  heading?: boolean
  captions?: boolean
  emptyText?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const chosen = Array.isArray(ids) ? selectedPhotos(ids, photos) : (fallback ?? [])
  const chosenIds = new Set(chosen.map(p => p.id))

  function save(next: string[]) {
    setError('')
    void Promise.resolve(onChange(next)).catch(err => setError(err instanceof Error ? err.message : 'Could not save the photos'))
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(file => file.type.startsWith('image/'))
    e.target.value = ''
    if (!files.length || uploading) return
    setUploading(true)
    setError('')
    const { added, error: uploadError } = await uploadJobPhotos(jobId, files)
    if (added.length) {
      onPhotosUpdate([...photos, ...added])
      save([...chosen.map(p => p.id), ...added.map(p => p.id)])
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
    const caption = (drafts[photo.id] ?? photo.caption ?? '').trim()
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
      setDrafts(prev => {
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
      {heading && <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>}
      <input ref={fileRef} type="file" accept="image/*" multiple onChange={e => void onPick(e)} style={{ display: 'none' }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={e => void onPick(e)} style={{ display: 'none' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={() => setChoosing(true)} style={{ padding: '10px 14px', fontWeight: 700 }}>
          Select from folder
        </button>
        <button type="button" className="btn btn-secondary" disabled={uploading} onClick={() => cameraRef.current?.click()} style={{ padding: '10px 14px', fontWeight: 700 }}>
          Take a photo
        </button>
        <button type="button" className="btn btn-secondary" disabled={uploading} onClick={() => fileRef.current?.click()} style={{ padding: '10px 14px', fontWeight: 700 }}>
          {uploading ? 'Uploading…' : 'Upload a photo'}
        </button>
      </div>
      {error && <div style={{ color: '#F87171', fontSize: 13, marginTop: 8 }} role="alert">{error}</div>}

      {chosen.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '10px 0 0' }}>{emptyText}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginTop: 12 }}>
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
                  aria-label={`Remove from ${title}`}
                  title="Remove from this section (the photo stays in the folder)"
                  onClick={() => save(chosen.filter(p => p.id !== photo.id).map(p => p.id))}
                  style={removeBtn}
                >
                  ×
                </button>
              </div>
              {captions && (
                <input
                  value={drafts[photo.id] ?? photo.caption ?? ''}
                  onChange={e => setDrafts(prev => ({ ...prev, [photo.id]: e.target.value }))}
                  onBlur={() => void saveCaption(photo)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  placeholder="Caption"
                  aria-label="Caption"
                  style={captionInput}
                />
              )}
              <div style={{ marginTop: 4 }}><PhotoMeta photo={photo} compact /></div>
            </div>
          ))}
        </div>
      )}

      {choosing && (
        <PhotoFolderPicker
          jobId={jobId}
          title={title}
          photos={photos}
          alreadyIds={chosenIds}
          usedIds={usedIds}
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
