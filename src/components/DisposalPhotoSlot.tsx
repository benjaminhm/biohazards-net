/*
 * Single-photo slot for a disposal load (trailer/skip or dump docket).
 * Reads EXIF from the original file before canvas compression strips it.
 */
'use client'

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent } from 'react'
import type { Photo } from '@/lib/types'
import { enrichExifWithDevice, formatCoordLabel, readPhotoExif, type PhotoExif } from '@/lib/photoExif'

const ZOOM_BTN: CSSProperties = {
  minWidth: 44,
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 18,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '0 12px',
  lineHeight: 1,
  touchAction: 'manipulation',
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
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const lastTap = useRef(0)
  scaleRef.current = scale
  panRef.current = pan

  useEffect(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [src])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    const touchDist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      applyScale(scaleRef.current + (e.deltaY > 0 ? -0.25 : 0.25))
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        drag.current = null
        pinch.current = { dist: touchDist(e.touches[0], e.touches[1]), scale: scaleRef.current }
        return
      }
      if (e.touches.length === 1 && scaleRef.current > 1) {
        const t = e.touches[0]
        drag.current = { x: t.clientX, y: t.clientY, panX: panRef.current.x, panY: panRef.current.y }
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinch.current) {
        e.preventDefault()
        applyScale(pinch.current.scale * (touchDist(e.touches[0], e.touches[1]) / pinch.current.dist))
        return
      }
      if (e.touches.length === 1 && drag.current && scaleRef.current > 1) {
        e.preventDefault()
        const t = e.touches[0]
        setPan(clampPan(
          drag.current.panX + (t.clientX - drag.current.x),
          drag.current.panY + (t.clientY - drag.current.y),
          scaleRef.current,
        ))
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null
      if (e.touches.length === 0) drag.current = null
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  function applyScale(next: number) {
    const s = clampZoom(next)
    setScale(s)
    if (s <= 1) setPan({ x: 0, y: 0 })
    else setPan(p => clampPan(p.x, p.y, s))
  }

  function clampPan(x: number, y: number, s: number) {
    const el = stageRef.current
    if (!el) return { x: 0, y: 0 }
    const maxX = (el.clientWidth * (s - 1)) / 2
    const maxY = (el.clientHeight * (s - 1)) / 2
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    }
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') return
    if (scale <= 1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') return
    const d = drag.current
    if (!d) return
    setPan(clampPan(d.panX + (e.clientX - d.x), d.panY + (e.clientY - d.y), scale))
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    drag.current = null
    if (e.pointerType === 'mouse' && e.detail === 2) {
      applyScale(scale > 1 ? 1 : 2)
      return
    }
    if (e.pointerType !== 'touch' || pinch.current) return
    const now = Date.now()
    if (now - lastTap.current < 280) {
      applyScale(scale > 1 ? 1 : 2.5)
      lastTap.current = 0
    } else {
      lastTap.current = now
    }
  }

  return (
    <div>
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null }}
        onDoubleClick={() => applyScale(scale > 1 ? 1 : 2)}
        style={{
          height: maxHeight,
          overflow: 'hidden',
          background: 'var(--surface-2)',
          cursor: scale > 1 ? 'grab' : 'zoom-in',
          touchAction: 'none',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            userSelect: 'none',
            pointerEvents: 'none',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: 'center center',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 6,
        }}
      >
        <button type="button" style={ZOOM_BTN} onClick={() => applyScale(scale - 0.5)} aria-label="Zoom out">−</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 40, textAlign: 'center' }}>
          {Math.round(scale * 100)}%
        </span>
        <button type="button" style={ZOOM_BTN} onClick={() => applyScale(scale + 0.5)} aria-label="Zoom in">+</button>
      </div>
    </div>
  )
}

function clampZoom(n: number) {
  return Math.min(4, Math.max(1, Math.round(n * 10) / 10))
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
