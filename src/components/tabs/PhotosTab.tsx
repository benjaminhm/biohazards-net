'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import type { Photo, PhotoCategory } from '@/lib/types'

interface Props {
  jobId: string
  photos: Photo[]
  areas?: string[]   // area names from assessment, for area_ref dropdown
  onPhotosUpdate: (photos: Photo[]) => void
}

const CATEGORIES: { value: PhotoCategory; label: string; hint: string }[] = [
  { value: 'before', label: 'Before', hint: 'Site conditions on arrival — used in Quote & SOW' },
  { value: 'assessment', label: 'Assessment', hint: 'Assessment detail shots — used in Quote & SOW' },
  { value: 'during', label: 'During', hint: 'Works in progress — used in Report' },
  { value: 'after', label: 'After', hint: 'Completed works — used in Report' },
]

const CATEGORY_COLORS: Record<PhotoCategory, string> = {
  before: '#F87171',
  during: '#FBBF24',
  after: '#4ADE80',
  assessment: '#60A5FA',
}

export default function PhotosTab({ jobId, photos, areas = [], onPhotosUpdate }: Props) {
  const [filter, setFilter] = useState<PhotoCategory | 'all'>('all')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [pendingCategory, setPendingCategory] = useState<PhotoCategory>('before')
  const [pendingCaption, setPendingCaption] = useState('')
  const [pendingAreaRef, setPendingAreaRef] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    setPendingCaption('')
    setPendingAreaRef('')
    setPendingCategory('before')
    // Generate preview
    const reader = new FileReader()
    reader.onloadend = () => setPendingPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function uploadPhoto() {
    if (!pendingFile) return
    setUploading(true)
    setUploadError('')
    try {
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

      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': pendingFile.type },
        body: pendingFile,
      })
      if (!uploadRes.ok) throw new Error('Upload failed')

      const saveRes = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          file_url: publicUrl,
          caption: pendingCaption,
          area_ref: pendingAreaRef,
          category: pendingCategory,
        }),
      })
      const { photo, error: saveErr } = await saveRes.json()
      if (saveErr) throw new Error(saveErr)

      onPhotosUpdate([photo, ...photos])
      setPendingFile(null)
      setPendingPreview(null)
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
      {/* Upload panel */}
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
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
              Add a note to each photo — notes are sent to Claude and appear alongside photos in generated documents.
            </div>
          </div>
        ) : (
          <div>
            {/* Preview */}
            {pendingPreview && (
              <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', marginBottom: 16, borderRadius: 8, overflow: 'hidden', background: 'var(--surface-2)' }}>
                <Image src={pendingPreview} alt="Preview" fill style={{ objectFit: 'contain' }} unoptimized />
              </div>
            )}

            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
              {pendingFile.name} ({(pendingFile.size / 1024).toFixed(0)}KB)
            </div>

            {/* Category */}
            <div className="field">
              <label>Category</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {CATEGORIES.map(c => (
                  <button
                    key={c.value}
                    onClick={() => setPendingCategory(c.value)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textAlign: 'left',
                      border: `2px solid ${pendingCategory === c.value ? CATEGORY_COLORS[c.value] : 'var(--border)'}`,
                      background: pendingCategory === c.value ? `${CATEGORY_COLORS[c.value]}18` : 'var(--surface-2)',
                      color: pendingCategory === c.value ? CATEGORY_COLORS[c.value] : 'var(--text-muted)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {c.label}
                    <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 8, opacity: 0.8 }}>{c.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Area reference */}
            <div className="field">
              <label>
                Area / Room
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                  links this photo to a specific area
                </span>
              </label>
              {areas.length > 0 ? (
                <select
                  value={pendingAreaRef}
                  onChange={e => setPendingAreaRef(e.target.value)}
                >
                  <option value="">— Select area (optional) —</option>
                  {areas.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                  <option value="__custom">Other (type below)</option>
                </select>
              ) : (
                <input
                  value={pendingAreaRef}
                  onChange={e => setPendingAreaRef(e.target.value)}
                  placeholder="e.g. Kitchen, Bedroom 2, Bathroom..."
                />
              )}
              {pendingAreaRef === '__custom' && (
                <input
                  style={{ marginTop: 6 }}
                  placeholder="Type area name..."
                  onChange={e => setPendingAreaRef(e.target.value)}
                  autoFocus
                />
              )}
            </div>

            {/* Note — most important field */}
            <div className="field">
              <label style={{ color: 'var(--accent)' }}>
                Photo Note
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                  this goes directly into the document — be specific
                </span>
              </label>
              <textarea
                value={pendingCaption}
                onChange={e => setPendingCaption(e.target.value)}
                placeholder="Describe exactly what this photo shows — e.g. 'Blood pooling under refrigerator, approx 40cm radius, 10-day exposure evident from staining pattern'"
                rows={3}
                style={{
                  width: '100%', resize: 'vertical',
                  background: 'var(--surface-2)',
                  border: `2px solid ${pendingCaption ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8, padding: '10px 12px',
                  color: 'var(--text)', fontSize: 14, lineHeight: 1.5,
                  transition: 'border-color 0.15s',
                }}
              />
            </div>

            {uploadError && (
              <div style={{ color: '#F87171', fontSize: 13, marginBottom: 12 }}>{uploadError}</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={uploadPhoto} disabled={uploading} style={{ flex: 1 }}>
                {uploading ? <><span className="spinner" /> Uploading...</> : 'Upload Photo'}
              </button>
              <button className="btn btn-ghost" onClick={() => { setPendingFile(null); setPendingPreview(null); if (fileRef.current) fileRef.current.value = '' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filter bar */}
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
            {f === 'all'
              ? `All (${photos.length})`
              : `${f.charAt(0).toUpperCase() + f.slice(1)} (${photos.filter(p => p.category === f).length})`}
          </button>
        ))}
      </div>

      {/* Photo grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 14 }}>
          No photos in this category yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
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
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: CATEGORY_COLORS[photo.category],
                  }}>
                    {photo.category}
                  </span>
                  {photo.area_ref && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4 }}>
                      {photo.area_ref}
                    </span>
                  )}
                </div>
                {photo.caption ? (
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{photo.caption}</div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No note added</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
