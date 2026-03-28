'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import type { Photo, PhotoCategory } from '@/lib/types'

interface Props {
  jobId: string
  photos: Photo[]
  onPhotosUpdate: (photos: Photo[]) => void
}

const CATEGORIES: { value: PhotoCategory; label: string }[] = [
  { value: 'before', label: 'Before' },
  { value: 'during', label: 'During' },
  { value: 'after', label: 'After' },
  { value: 'assessment', label: 'Assessment' },
]

const CATEGORY_COLORS: Record<PhotoCategory, string> = {
  before: '#F87171',
  during: '#FBBF24',
  after: '#4ADE80',
  assessment: '#60A5FA',
}

export default function PhotosTab({ jobId, photos, onPhotosUpdate }: Props) {
  const [filter, setFilter] = useState<PhotoCategory | 'all'>('all')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingCategory, setPendingCategory] = useState<PhotoCategory>('before')
  const [pendingCaption, setPendingCaption] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    setPendingCaption('')
    setPendingCategory('before')
  }

  async function uploadPhoto() {
    if (!pendingFile) return
    setUploading(true)
    setUploadError('')
    try {
      // Get signed upload URL
      const urlRes = await fetch('/api/photos/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          fileName: pendingFile.name,
          contentType: pendingFile.type,
        }),
      })
      const { signedUrl, publicUrl, error: urlErr } = await urlRes.json()
      if (urlErr) throw new Error(urlErr)

      // Upload to Supabase Storage
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': pendingFile.type },
        body: pendingFile,
      })
      if (!uploadRes.ok) throw new Error('Upload failed')

      // Save to DB
      const saveRes = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          file_url: publicUrl,
          caption: pendingCaption,
          category: pendingCategory,
        }),
      })
      const { photo, error: saveErr } = await saveRes.json()
      if (saveErr) throw new Error(saveErr)

      onPhotosUpdate([photo, ...photos])
      setPendingFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const filtered = filter === 'all' ? photos : photos.filter(p => p.category === filter)

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Upload */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 14 }}>
          Upload Photo
        </div>

        {!pendingFile ? (
          <div>
            <input type="file" ref={fileRef} onChange={onFileSelect} accept="image/*" style={{ display: 'none' }} />
            <button
              className="btn btn-secondary"
              onClick={() => fileRef.current?.click()}
              style={{ width: '100%', padding: 20, borderStyle: 'dashed', fontSize: 14 }}
            >
              📷 Select Photo
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              {pendingFile.name} ({(pendingFile.size / 1024).toFixed(0)}KB)
            </div>
            <div className="field">
              <label>Category</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {CATEGORIES.map(c => (
                  <button
                    key={c.value}
                    onClick={() => setPendingCategory(c.value)}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      border: `2px solid ${pendingCategory === c.value ? CATEGORY_COLORS[c.value] : 'var(--border)'}`,
                      background: pendingCategory === c.value ? `${CATEGORY_COLORS[c.value]}20` : 'var(--surface-2)',
                      color: pendingCategory === c.value ? CATEGORY_COLORS[c.value] : 'var(--text-muted)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Caption (optional)</label>
              <input value={pendingCaption} onChange={e => setPendingCaption(e.target.value)} placeholder="Describe what's in this photo..." />
            </div>
            {uploadError && (
              <div style={{ color: '#F87171', fontSize: 13, marginBottom: 12 }}>{uploadError}</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={uploadPhoto} disabled={uploading} style={{ flex: 1 }}>
                {uploading ? <><span className="spinner" /> Uploading...</> : 'Upload Photo'}
              </button>
              <button className="btn btn-ghost" onClick={() => { setPendingFile(null); if (fileRef.current) fileRef.current.value = '' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {(['all', ...CATEGORIES.map(c => c.value)] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
              background: filter === f ? 'var(--accent-dim)' : 'transparent',
              color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}
          >
            {f === 'all' ? `All (${photos.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${photos.filter(p => p.category === f).length})`}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 14 }}>
          No photos in this category yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {filtered.map(photo => (
            <div key={photo.id} style={{ background: 'var(--surface)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
              <div style={{ position: 'relative', aspectRatio: '4/3', background: 'var(--surface-2)' }}>
                <Image
                  src={photo.file_url}
                  alt={photo.caption || photo.category}
                  fill
                  style={{ objectFit: 'cover' }}
                  unoptimized
                />
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: CATEGORY_COLORS[photo.category],
                  }}>
                    {photo.category}
                  </span>
                </div>
                {photo.caption && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{photo.caption}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
