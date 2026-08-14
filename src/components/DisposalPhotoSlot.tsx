/*
 * Single-photo slot for a disposal load (trailer/skip or dump docket).
 * Reads EXIF from the original file before canvas compression strips it.
 */
'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import type { Photo } from '@/lib/types'
import { formatCoordLabel, readPhotoExif, type PhotoExif } from '@/lib/photoExif'

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

function readDeviceLocation(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 4000, maximumAge: 60_000 },
    )
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
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function handleFile(file: File, fromCamera: boolean) {
    setUploading(true)
    setError('')
    try {
      const exif = await readPhotoExif(file)
      if ((exif.lat == null || exif.lng == null) && fromCamera) {
        const geo = await readDeviceLocation()
        if (geo) {
          exif.lat = geo.lat
          exif.lng = geo.lng
        }
      }
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

  function onSelect(e: ChangeEvent<HTMLInputElement>, fromCamera: boolean) {
    const file = e.target.files?.[0]
    if (file) void handleFile(file, fromCamera)
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
            aspectRatio: '16 / 10',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt={caption} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
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
        onChange={e => onSelect(e, true)}
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={fileRef}
        accept="image/*"
        onChange={e => onSelect(e, false)}
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
      {error && <div style={{ color: '#F87171', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  )
}
