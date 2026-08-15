/*
 * Single-photo slot for a disposal load (trailer/skip or dump docket).
 * Reads EXIF from the original file before canvas compression strips it.
 */
'use client'

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import type { Photo } from '@/lib/types'
import { enrichExifWithDevice, formatCoordLabel, readPhotoExif, type PhotoExif } from '@/lib/photoExif'

const TOOL_BTN: CSSProperties = {
  minWidth: 40,
  height: 40,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(16,16,16,0.88)',
  color: '#fff',
  fontSize: 18,
  fontWeight: 700,
  cursor: 'pointer',
}

export function ZoomablePhoto({
  src,
  alt,
  maxHeight = 140,
}: {
  src: string
  alt: string
  maxHeight?: number
}) {
  const [open, setOpen] = useState(false)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (!open) {
      setScale(1)
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === '+' || e.key === '=') setScale(s => Math.min(4, s + 0.5))
      if (e.key === '-' || e.key === '_') setScale(s => Math.max(1, s - 0.5))
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Tap to zoom"
        style={{
          display: 'block',
          width: '100%',
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'zoom-in',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          style={{
            width: '100%',
            height: 'auto',
            maxHeight,
            objectFit: 'contain',
            objectPosition: 'center',
            display: 'block',
          }}
        />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt || 'Photo'}
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '12px 12px 8px',
            }}
            onClick={e => e.stopPropagation()}
          >
            <button type="button" style={TOOL_BTN} onClick={() => setScale(s => Math.max(1, s - 0.5))} aria-label="Zoom out">−</button>
            <button type="button" style={TOOL_BTN} onClick={() => setScale(s => Math.min(4, s + 0.5))} aria-label="Zoom in">+</button>
            <button type="button" style={{ ...TOOL_BTN, fontSize: 13, minWidth: 64 }} onClick={() => setOpen(false)}>Close</button>
          </div>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1,
              overflow: 'auto',
              WebkitOverflowScrolling: 'touch',
              padding: 12,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              style={{
                width: scale === 1 ? '100%' : `${scale * 100}%`,
                maxWidth: scale === 1 ? '100%' : 'none',
                height: 'auto',
                display: 'block',
                margin: '0 auto',
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}

const NOTE_INPUT: CSSProperties = {
  width: '100%',
  marginTop: 6,
  fontSize: 12,
  fontWeight: 500,
  padding: '5px 8px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-muted)',
}

export function PhotoNoteField({
  value,
  onChange,
}: {
  value: string
  onChange: (note: string) => void
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Note…"
      style={NOTE_INPUT}
    />
  )
}

interface Props {
  jobId: string
  areaRef: string
  caption: string
  photoUrl: string | null
  skipped: boolean
  skipLabel: string
  cameraLabel: string
  galleryLabel: string
  onUploaded: (photo: Photo, exif: PhotoExif) => void
  onSkip: () => void
  onClear: () => void
  hideSkip?: boolean
  note?: string
  onNoteChange?: (note: string) => void
}

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
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Compression failed'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to load image'))
    }
    img.src = objectUrl
  })
}

export default function DisposalPhotoSlot({
  jobId,
  areaRef,
  caption,
  photoUrl,
  skipped,
  skipLabel,
  cameraLabel,
  galleryLabel,
  onUploaded,
  onSkip,
  onClear,
  hideSkip = false,
  note,
  onNoteChange,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function handleFile(file: File) {
    setUploading(true)
    setError('')
    try {
      const exif = await enrichExifWithDevice(await readPhotoExif(file))
      const compressed = await compressImage(file)
      const fd = new FormData()
      fd.append('job_id', jobId)
      fd.append('file', compressed, 'upload.jpg')
      fd.append('caption', caption)
      fd.append('area_ref', areaRef)
      fd.append('category', 'during')
      fd.append('capture_phase', 'progress')
      if (exif.takenAt) fd.append('taken_at', exif.takenAt)
      if (exif.lat != null) fd.append('location_lat', String(exif.lat))
      if (exif.lng != null) fd.append('location_lng', String(exif.lng))
      if (exif.lat != null && exif.lng != null) {
        fd.append('location_label', formatCoordLabel(exif.lat, exif.lng))
      }

      const saveRes = await fetch('/api/photos/upload', { method: 'POST', body: fd })
      const saveJson = (await saveRes.json()) as { photo?: Photo; error?: string }
      if (!saveRes.ok || !saveJson.photo) throw new Error(saveJson.error || `Upload failed (${saveRes.status})`)
      onUploaded(saveJson.photo, exif)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (cameraRef.current) cameraRef.current.value = ''
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function onSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
  }

  if (photoUrl) {
    return (
      <div>
        <div
          style={{
            position: 'relative',
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
          }}
        >
          <ZoomablePhoto src={photoUrl} alt={caption} maxHeight={140} />
        </div>
        {onNoteChange && (
          <PhotoNoteField value={note ?? ''} onChange={onNoteChange} />
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClear}
          style={{ marginTop: 8, fontSize: 12, padding: '6px 10px' }}
        >
          Replace / remove
        </button>
      </div>
    )
  }

  if (skipped) {
    return (
      <div
        style={{
          borderRadius: 10,
          border: '1px dashed var(--border)',
          padding: '14px 12px',
          background: 'var(--surface-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Photo skipped</div>
        <button type="button" className="btn btn-secondary" onClick={onClear} style={{ fontSize: 12, padding: '6px 10px' }}>
          Undo skip
        </button>
      </div>
    )
  }

  return (
    <div>
      <input
        type="file"
        ref={cameraRef}
        accept="image/*"
        capture="environment"
        onChange={onSelect}
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={fileRef}
        accept="image/*"
        onChange={onSelect}
        style={{ display: 'none' }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={uploading}
          onClick={() => cameraRef.current?.click()}
          style={{ padding: '12px 8px', fontSize: 14, fontWeight: 700, borderRadius: 12 }}
        >
          {uploading ? 'Uploading…' : cameraLabel}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          style={{ padding: '12px 8px', fontSize: 14, fontWeight: 700, borderRadius: 12, borderStyle: 'dashed' }}
        >
          {galleryLabel}
        </button>
      </div>
      {!hideSkip && (
      <button
        type="button"
        onClick={onSkip}
        disabled={uploading}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: 12,
          fontWeight: 600,
          cursor: uploading ? 'not-allowed' : 'pointer',
          padding: 0,
        }}
      >
        {skipLabel}
      </button>
      )}
      {error && <div style={{ color: '#F87171', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  )
}
