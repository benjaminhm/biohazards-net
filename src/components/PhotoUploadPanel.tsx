/*
 * components/PhotoUploadPanel.tsx
 *
 * Photo upload queue (camera / gallery, staging, category, caption) embedded in
 * each Assessment area card. `fixedAreaRef` sets `area_ref` on save; signed URL,
 * compress, POST /api/photos.
 */
'use client'

import { useEffect, useState, useRef } from 'react'
import type { Photo, PhotoCategory } from '@/lib/types'

export interface PhotoUploadPanelProps {
  jobId: string
  photos: Photo[]
  onPhotosUpdate: (photos: Photo[]) => void
  /** Category for newly queued files */
  defaultPendingCategory?: PhotoCategory
  /**
   * When non-empty, uploads are saved with this `area_ref` and the area picker is hidden.
   * Pass empty string to disable camera/gallery until the area has a name.
   */
  fixedAreaRef: string
  /** Tighter layout when embedded inside an area card */
  compact?: boolean
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
  { value: 'before', label: 'Before', color: '#F87171' },
  { value: 'assessment', label: 'Assessment', color: '#60A5FA' },
  { value: 'during', label: 'During', color: '#FBBF24' },
  { value: 'after', label: 'After', color: '#4ADE80' },
]

async function compressImage(file: File, maxDim = 1920, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img')
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width)
          width = maxDim
        } else {
          width = Math.round((width * maxDim) / height)
          height = maxDim
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
        'image/jpeg',
        quality
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to load image'))
    }
    img.src = objectUrl
  })
}

function fmt(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export default function PhotoUploadPanel({
  jobId,
  photos,
  onPhotosUpdate,
  defaultPendingCategory = 'assessment',
  fixedAreaRef,
  compact = false,
}: PhotoUploadPanelProps) {
  const [pending, setPending] = useState<PendingPhoto[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, 'waiting' | 'uploading' | 'done' | 'error'>>({})
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const areaTag = fixedAreaRef.trim()
  const scoped = areaTag.length > 0

  useEffect(() => {
    if (!scoped) {
      setPending([])
      setUploadProgress({})
      setUploadError('')
      return
    }
    setPending(prev => prev.map(p => ({ ...p, areaRef: areaTag })))
  }, [scoped, areaTag])

  async function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length || !scoped) return

    const newPending: PendingPhoto[] = await Promise.all(
      files.map(async file => {
        const preview = await new Promise<string>(resolve => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
        return {
          id: `${Date.now()}-${Math.random()}`,
          file,
          preview,
          originalSize: file.size,
          category: defaultPendingCategory,
          caption: '',
          areaRef: areaTag,
        }
      })
    )

    setPending(prev => [...prev, ...newPending])
    if (fileRef.current) fileRef.current.value = ''
  }

  function updatePending(id: string, updates: Partial<PendingPhoto>) {
    setPending(prev => prev.map(p => (p.id === id ? { ...p, ...updates } : p)))
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
      const compressed = await compressImage(p.file)
      const fileName = `${Date.now()}-${p.file.name.replace(/[^a-z0-9.]/gi, '_')}`

      const urlRes = await fetch('/api/photos/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, fileName, contentType: 'image/jpeg' }),
      })
      const { signedUrl, publicUrl, error: urlErr } = await urlRes.json()
      if (urlErr) throw new Error(urlErr)

      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: compressed,
      })
      if (!uploadRes.ok) throw new Error('Upload failed')

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
    if (!pending.length || !scoped) return
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

  if (!scoped) {
    return (
      <div
        style={{
          padding: compact ? '10px 12px' : 14,
          marginBottom: compact ? 0 : 28,
          borderRadius: 8,
          border: '1px dashed var(--border)',
          fontSize: 12,
          color: 'var(--text-muted)',
          lineHeight: 1.5,
        }}
      >
        Select a room type above to add photos for this area.
      </div>
    )
  }

  const outerMb = compact ? 12 : 28
  const titleMb = compact ? 8 : 14
  const btnPad = compact ? '10px 8px' : '14px 8px'
  const btnFs = compact ? 14 : 15

  return (
    <div
      className={compact ? undefined : 'card'}
      style={
        compact
          ? {
              marginBottom: outerMb,
              padding: '12px 0 0 0',
              borderTop: '1px solid var(--border)',
            }
          : { marginBottom: outerMb }
      }
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: titleMb,
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <div
          style={{
            fontSize: compact ? 11 : 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
          }}
        >
          {compact ? 'Photos' : 'Upload photos'}
        </div>
        <div style={{ fontSize: compact ? 10 : 11, color: 'var(--text-muted)' }}>
          {compact ? 'JPEG · max 1920px' : 'Auto-compressed · max 1920px · JPEG 82%'}
        </div>
      </div>
      {!compact && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          New photos default to <strong>Assessment</strong>. They are saved under this room ({areaTag}).
        </div>
      )}
      {compact && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.45 }}>
          Default category <strong>Assessment</strong> — adjust per photo before upload or later on Photos.
        </div>
      )}

      <input type="file" ref={cameraRef} onChange={onFileSelect} accept="image/*" capture="environment" style={{ display: 'none' }} />
      <input type="file" ref={fileRef} onChange={onFileSelect} accept="image/*" multiple style={{ display: 'none' }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: compact ? 8 : 10, marginBottom: compact ? 10 : 12 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => cameraRef.current?.click()}
          style={{
            padding: btnPad,
            fontSize: btnFs,
            fontWeight: 700,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          📷 Camera
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => fileRef.current?.click()}
          style={{
            padding: btnPad,
            fontSize: btnFs,
            fontWeight: 700,
            borderRadius: 12,
            borderStyle: 'dashed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          🖼 Gallery
        </button>
      </div>
      {pending.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 8 }}>
          {pending.length} photo{pending.length > 1 ? 's' : ''} queued — tap Camera or Gallery to add more
        </div>
      )}

      {pending.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>Set all:</span>
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              type="button"
              onClick={() => applyAllCategory(c.value)}
              style={{
                padding: '4px 10px',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 600,
                border: `1px solid ${c.color}`,
                background: 'transparent',
                color: c.color,
                cursor: 'pointer',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {pending.map(p => {
        const status = uploadProgress[p.id]
        return (
          <div
            key={p.id}
            style={{
              display: 'flex',
              gap: 12,
              marginBottom: 12,
              padding: 12,
              background: 'var(--surface-2)',
              borderRadius: 8,
              border: `1px solid ${status === 'error' ? '#F87171' : status === 'done' ? '#4ADE80' : 'var(--border)'}`,
              opacity: status === 'done' ? 0.6 : 1,
            }}
          >
            <div
              style={{
                position: 'relative',
                width: 72,
                height: 72,
                flexShrink: 0,
                borderRadius: 6,
                overflow: 'hidden',
                background: 'var(--border)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {status === 'uploading' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span className="spinner" />
                </div>
              )}
              {status === 'done' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                  }}
                >
                  ✅
                </div>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                {p.file.name} · {fmt(p.originalSize)}
              </div>

              <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                {CATEGORIES.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => updatePending(p.id, { category: c.value })}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: `1px solid ${p.category === c.value ? c.color : 'var(--border)'}`,
                      background: p.category === c.value ? `${c.color}22` : 'transparent',
                      color: p.category === c.value ? c.color : 'var(--text-muted)',
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <textarea
                value={p.caption}
                onChange={e => updatePending(p.id, { caption: e.target.value })}
                placeholder="Note — what does this photo show? Be specific."
                rows={2}
                style={{
                  width: '100%',
                  fontSize: 12,
                  resize: 'vertical',
                  border: `1px solid ${p.caption ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 6,
                  padding: '6px 8px',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  transition: 'border-color 0.15s',
                }}
              />
            </div>

            {!status && (
              <button
                type="button"
                onClick={() => removePending(p.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 16,
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  alignSelf: 'flex-start',
                  flexShrink: 0,
                  padding: '2px 4px',
                }}
              >
                ✕
              </button>
            )}
          </div>
        )
      })}

      {pending.length > 0 && (
        <>
          {uploadError && <div style={{ color: '#F87171', fontSize: 13, marginBottom: 8 }}>{uploadError}</div>}
          <button
            type="button"
            className="btn btn-primary"
            onClick={uploadAll}
            disabled={uploading}
            style={{ width: '100%', padding: 14, fontSize: 15 }}
          >
            {uploading ? (
              <>
                <span className="spinner" /> Uploading {pending.length} photo{pending.length !== 1 ? 's' : ''}...
              </>
            ) : (
              `⬆ Upload ${pending.length} Photo${pending.length !== 1 ? 's' : ''}`
            )}
          </button>
        </>
      )}
    </div>
  )
}
