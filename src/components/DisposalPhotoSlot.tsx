/*
 * Single-photo slot for a disposal load (trailer/skip or dump docket).
 * Reads EXIF from the original file before canvas compression strips it.
 */
'use client'

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent } from 'react'
import type { Photo } from '@/lib/types'
import { enrichExifWithDevice, formatCoordLabel, readPhotoExif, type PhotoExif } from '@/lib/photoExif'

const ZOOM_BTN: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.28)',
  background: 'rgba(16,16,16,0.82)',
  color: '#fff',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
  padding: 0,
}

export function ZoomablePhoto({
  src,
  alt,
  maxHeight = 260,
}: {
  src: string
  alt: string
  maxHeight?: number
}) {
  const [scale, setScale] = useState(1)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)

  useEffect(() => {
    setScale(1)
  }, [src])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setScale(s => Math.min(4, Math.max(1, Math.round((s + (e.deltaY > 0 ? -0.25 : 0.25)) * 10) / 10)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function setZoom(next: number) {
    setScale(Math.min(4, Math.max(1, Math.round(next * 10) / 10)))
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (scale <= 1) return
    const el = stageRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = stageRef.current
    if (!d || !el) return
    el.scrollLeft = d.sl - (e.clientX - d.x)
    el.scrollTop = d.st - (e.clientY - d.y)
  }

  function onPointerUp() {
    drag.current = null
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          height: maxHeight,
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          background: 'var(--surface-2)',
          cursor: scale > 1 ? 'grab' : 'default',
          touchAction: scale > 1 ? 'none' : 'pan-x pan-y',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            width: scale === 1 ? '100%' : `${scale * 100}%`,
            maxWidth: scale === 1 ? '100%' : 'none',
            height: 'auto',
            display: 'block',
            userSelect: 'none',
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 6,
          zIndex: 1,
        }}
      >
        <button type="button" style={ZOOM_BTN} onClick={() => setZoom(scale - 0.5)} aria-label="Zoom out">−</button>
        <button type="button" style={ZOOM_BTN} onClick={() => setZoom(scale + 0.5)} aria-label="Zoom in">+</button>
      </div>
    </div>
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
          <ZoomablePhoto src={photoUrl} alt={caption} maxHeight={280} />
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
