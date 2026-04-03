/*
 * components/tabs/PhotosTab.tsx
 *
 * The Photos tab on the job detail page. Manages the job's photo library with
 * a three-step upload pattern:
 *   1. User selects file(s) — browser generates an object URL for preview.
 *   2. "Upload" sends POST /api/photos/upload-url to get a signed Supabase Storage URL.
 *   3. File is PUT directly to Storage; public URL is then POSTed to /api/photos.
 *
 * Photos are categorised as before/assessment/during/after to control which
 * appear in which document types. Each photo can have a caption and an area_ref
 * linking it to an area defined in AssessmentTab.
 *
 * PendingPhoto holds the pre-upload state: the local File object, object URL for
 * the <Image> preview, user-selected category, caption, and area ref. Multiple
 * photos can be staged simultaneously and uploaded together.
 *
 * Deletion sends DELETE /api/photos/[id] which also removes the Storage object.
 *
 * Area refs in the area selector come from the job's assessment_data.areas names
 * (passed down as the `areas` prop) so photo-to-area linking stays in sync with
 * the AssessmentTab's area list.
 */
'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import type { Photo, PhotoCategory } from '@/lib/types'

interface Props {
  jobId: string
  photos: Photo[]
  areas?: string[]
  onPhotosUpdate: (photos: Photo[]) => void
}

interface PendingPhoto {
  id: string
  file: File
  preview: string
  originalSize: number
  category: PhotoCategory
  caption: string
  areaRef: string
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

// ─── Compress image using Canvas API ──────────────────────────────────────────
async function compressImage(file: File, maxDim = 1920, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img')
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim }
        else { width = Math.round(width * maxDim / height); height = maxDim }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')) }
    img.src = objectUrl
  })
}

function fmt(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// ─── Uploaded photo card ───────────────────────────────────────────────────────
function PhotoCard({ photo, onDelete, onUpdate }: {
  photo: Photo
  onDelete: (id: string) => void
  onUpdate: (photo: Photo) => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [editingCaption, setEditingCaption] = useState(false)
  const [captionDraft, setCaptionDraft] = useState(photo.caption)

  async function handleDelete() {
    if (!confirm('Delete this photo?')) return
    setDeleting(true)
    await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' })
    onDelete(photo.id)
  }

  async function saveCaption() {
    const res = await fetch(`/api/photos/${photo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: captionDraft }),
    })
    const data = await res.json()
    onUpdate(data.photo)
    setEditingCaption(false)
  }

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', opacity: deleting ? 0.4 : 1 }}>
      <div style={{ position: 'relative', aspectRatio: '4/3', background: 'var(--surface-2)' }}>
        <Image src={photo.file_url} alt={photo.caption || photo.category} fill style={{ objectFit: 'cover' }} unoptimized />
        <button onClick={handleDelete} title="Delete photo" style={{
          position: 'absolute', top: 6, right: 6,
          background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 5,
          padding: '4px 7px', fontSize: 13, cursor: 'pointer', color: '#fff',
        }}>🗑️</button>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: CATEGORY_COLORS[photo.category] }}>
            {photo.category}
          </span>
          {photo.area_ref && (
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4 }}>
              {photo.area_ref}
            </span>
          )}
        </div>
        {editingCaption ? (
          <div>
            <textarea value={captionDraft} onChange={e => setCaptionDraft(e.target.value)} rows={3}
              style={{ width: '100%', fontSize: 12, resize: 'vertical', marginBottom: 6 }} autoFocus />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-primary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={saveCaption}>Save</button>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => setEditingCaption(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
            <div style={{ flex: 1 }}>
              {photo.caption
                ? <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{photo.caption}</div>
                : <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No note — tap ✏️ to add</div>}
            </div>
            <button onClick={() => { setCaptionDraft(photo.caption); setEditingCaption(true) }} title="Edit note"
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 7px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>✏️</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function PhotosTab({ jobId, photos, areas = [], onPhotosUpdate }: Props) {
  const [filter, setFilter] = useState<PhotoCategory | 'all'>('all')
  const [pending, setPending] = useState<PendingPhoto[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, 'waiting' | 'uploading' | 'done' | 'error'>>({})
  const [uploadError, setUploadError] = useState('')
  const fileRef    = useRef<HTMLInputElement>(null)
  const cameraRef  = useRef<HTMLInputElement>(null)

  async function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return

    const newPending: PendingPhoto[] = await Promise.all(files.map(async (file) => {
      const preview = await new Promise<string>(resolve => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })
      return {
        id: `${Date.now()}-${Math.random()}`,
        file, preview,
        originalSize: file.size,
        category: 'before' as PhotoCategory,
        caption: '',
        areaRef: '',
      }
    }))

    setPending(prev => [...prev, ...newPending])
    if (fileRef.current) fileRef.current.value = ''
  }

  function updatePending(id: string, updates: Partial<PendingPhoto>) {
    setPending(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
  }

  function removePending(id: string) {
    setPending(prev => prev.filter(p => p.id !== id))
  }

  function applyAllCategory(category: PhotoCategory) {
    setPending(prev => prev.map(p => ({ ...p, category })))
  }

  async function uploadSingle(p: PendingPhoto): Promise<Photo | null> {
    setUploadProgress(prev => ({ ...prev, [p.id]: 'uploading' }))
    try {
      // Compress
      const compressed = await compressImage(p.file)
      const fileName = `${Date.now()}-${p.file.name.replace(/[^a-z0-9.]/gi, '_')}`

      // Get signed URL
      const urlRes = await fetch('/api/photos/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, fileName, contentType: 'image/jpeg' }),
      })
      const { signedUrl, publicUrl, error: urlErr } = await urlRes.json()
      if (urlErr) throw new Error(urlErr)

      // Upload compressed blob
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: compressed,
      })
      if (!uploadRes.ok) throw new Error('Upload failed')

      // Save record
      const saveRes = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          file_url: publicUrl,
          caption: p.caption,
          area_ref: p.areaRef,
          category: p.category,
        }),
      })
      const { photo, error: saveErr } = await saveRes.json()
      if (saveErr) throw new Error(saveErr)

      setUploadProgress(prev => ({ ...prev, [p.id]: 'done' }))
      return photo
    } catch {
      setUploadProgress(prev => ({ ...prev, [p.id]: 'error' }))
      return null
    }
  }

  async function uploadAll() {
    if (!pending.length) return
    setUploading(true)
    setUploadError('')

    const results: Photo[] = []
    for (const p of pending) {
      const photo = await uploadSingle(p)
      if (photo) results.push(photo)
    }

    onPhotosUpdate([...results, ...photos])
    setPending([])
    setUploadProgress({})
    setUploading(false)
  }

  const filtered = filter === 'all' ? photos : photos.filter(p => p.category === filter)

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── Upload panel ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>
            Upload Photos
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Auto-compressed · max 1920px · JPEG 82%
          </div>
        </div>

        {/* Hidden inputs */}
        <input type="file" ref={cameraRef} onChange={onFileSelect} accept="image/*" capture="environment" style={{ display: 'none' }} />
        <input type="file" ref={fileRef}   onChange={onFileSelect} accept="image/*" multiple            style={{ display: 'none' }} />

        {/* Camera + Gallery buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <button
            className="btn btn-primary"
            onClick={() => cameraRef.current?.click()}
            style={{ padding: '14px 8px', fontSize: 15, fontWeight: 700, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            📷 Camera
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => fileRef.current?.click()}
            style={{ padding: '14px 8px', fontSize: 15, fontWeight: 700, borderRadius: 12, borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            🖼 Gallery
          </button>
        </div>
        {pending.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 8 }}>
            {pending.length} photo{pending.length > 1 ? 's' : ''} queued — tap Camera or Gallery to add more
          </div>
        )}

        {/* Apply-all category bar */}
        {pending.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>Set all:</span>
            {CATEGORIES.map(c => (
              <button key={c.value} onClick={() => applyAllCategory(c.value)} style={{
                padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                border: `1px solid ${c.color}`, background: 'transparent', color: c.color, cursor: 'pointer',
              }}>{c.label}</button>
            ))}
          </div>
        )}

        {/* Pending photo queue */}
        {pending.map((p) => {
          const status = uploadProgress[p.id]
          return (
            <div key={p.id} style={{
              display: 'flex', gap: 12, marginBottom: 12, padding: 12,
              background: 'var(--surface-2)', borderRadius: 8,
              border: `1px solid ${status === 'error' ? '#F87171' : status === 'done' ? '#4ADE80' : 'var(--border)'}`,
              opacity: status === 'done' ? 0.6 : 1,
            }}>
              {/* Thumbnail */}
              <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'var(--border)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {status === 'uploading' && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="spinner" />
                  </div>
                )}
                {status === 'done' && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>✅</div>
                )}
              </div>

              {/* Fields */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {p.file.name} · {fmt(p.originalSize)}
                </div>

                {/* Category */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                  {CATEGORIES.map(c => (
                    <button key={c.value} onClick={() => updatePending(p.id, { category: c.value })} style={{
                      padding: '3px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      border: `1px solid ${p.category === c.value ? c.color : 'var(--border)'}`,
                      background: p.category === c.value ? `${c.color}22` : 'transparent',
                      color: p.category === c.value ? c.color : 'var(--text-muted)',
                    }}>{c.label}</button>
                  ))}
                </div>

                {/* Area */}
                {areas.length > 0 ? (
                  <select value={p.areaRef} onChange={e => updatePending(p.id, { areaRef: e.target.value })}
                    style={{ width: '100%', fontSize: 12, marginBottom: 6, padding: '6px 8px' }}>
                    <option value="">Area (optional)</option>
                    {areas.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                ) : (
                  <input value={p.areaRef} onChange={e => updatePending(p.id, { areaRef: e.target.value })}
                    placeholder="Area / room (optional)" style={{ width: '100%', fontSize: 12, marginBottom: 6 }} />
                )}

                {/* Note */}
                <textarea
                  value={p.caption}
                  onChange={e => updatePending(p.id, { caption: e.target.value })}
                  placeholder="Note — what does this photo show? Be specific."
                  rows={2}
                  style={{
                    width: '100%', fontSize: 12, resize: 'vertical',
                    border: `1px solid ${p.caption ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 6, padding: '6px 8px', background: 'var(--surface)',
                    color: 'var(--text)', transition: 'border-color 0.15s',
                  }}
                />
              </div>

              {/* Remove */}
              {!status && (
                <button onClick={() => removePending(p.id)} style={{
                  background: 'none', border: 'none', fontSize: 16, cursor: 'pointer',
                  color: 'var(--text-muted)', alignSelf: 'flex-start', flexShrink: 0, padding: '2px 4px',
                }}>✕</button>
              )}
            </div>
          )
        })}

        {pending.length > 0 && (
          <>
            {uploadError && <div style={{ color: '#F87171', fontSize: 13, marginBottom: 8 }}>{uploadError}</div>}
            <button
              className="btn btn-primary"
              onClick={uploadAll}
              disabled={uploading}
              style={{ width: '100%', padding: 14, fontSize: 15 }}
            >
              {uploading
                ? <><span className="spinner" /> Uploading {pending.length} photo{pending.length !== 1 ? 's' : ''}...</>
                : `⬆ Upload ${pending.length} Photo${pending.length !== 1 ? 's' : ''}`
              }
            </button>
          </>
        )}
      </div>

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
              onDelete={(id) => onPhotosUpdate(photos.filter(p => p.id !== id))}
              onUpdate={(updated) => onPhotosUpdate(photos.map(p => p.id === updated.id ? updated : p))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
