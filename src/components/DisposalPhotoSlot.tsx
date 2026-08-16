/*
 * Single-photo slot for a disposal load (trailer/skip or dump docket).
 * Reads EXIF from the original file before canvas compression strips it.
 */
'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent } from 'react'
import type { Photo } from '@/lib/types'
import {
  applyGalleryChoice,
  formatCoordLabel,
  photoHasTime,
  readPhotoExif,
  stampTimeIfMissing,
  type GalleryPlace,
  type GalleryPlaceContext,
  type GalleryWhen,
  type PhotoExif,
} from '@/lib/photoExif'

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
  const [grabbing, setGrabbing] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
  const restoreRef = useRef<{ contentX: number; contentY: number; fx: number; fy: number } | null>(null)
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)
  const tap = useRef<{ t: number; x: number; y: number; moved: boolean } | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const pendingZoom = useRef<{ next: number; fx: number; fy: number } | null>(null)
  const zoomRaf = useRef(0)

  function zoomAround(next: number, fx: number, fy: number) {
    pendingZoom.current = { next, fx, fy }
    if (zoomRaf.current) return
    zoomRaf.current = requestAnimationFrame(() => {
      zoomRaf.current = 0
      const pending = pendingZoom.current
      const el = stageRef.current
      if (!pending) return
      const s = clampZoom(pending.next)
      if (el) {
        restoreRef.current = {
          contentX: (el.scrollLeft + pending.fx) / scaleRef.current,
          contentY: (el.scrollTop + pending.fy) / scaleRef.current,
          fx: pending.fx,
          fy: pending.fy,
        }
      }
      scaleRef.current = s
      setScale(s)
    })
  }

  const zoomAroundRef = useRef(zoomAround)
  zoomAroundRef.current = zoomAround

  useEffect(() => {
    scaleRef.current = 1
    setScale(1)
    const el = stageRef.current
    if (el) {
      el.scrollLeft = 0
      el.scrollTop = 0
    }
    return () => {
      if (zoomRaf.current) cancelAnimationFrame(zoomRaf.current)
    }
  }, [src])

  useLayoutEffect(() => {
    const el = stageRef.current
    const r = restoreRef.current
    if (!el || !r) return
    restoreRef.current = null
    el.scrollLeft = r.contentX * scale - r.fx
    el.scrollTop = r.contentY * scale - r.fy
  }, [scale])

  function zoomCenter(next: number) {
    const el = stageRef.current
    zoomAround(next, el ? el.clientWidth / 2 : 0, el ? el.clientHeight / 2 : 0)
  }

  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    const touchDist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    const localPoint = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      return { x: clientX - rect.left, y: clientY - rect.top }
    }

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const p = localPoint(e.clientX, e.clientY)
      zoomAroundRef.current(scaleRef.current + (e.deltaY > 0 ? -0.2 : 0.2), p.x, p.y)
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        tap.current = null
        pinch.current = { dist: touchDist(e.touches[0], e.touches[1]), scale: scaleRef.current }
        return
      }
      if (e.touches.length === 1) {
        const t = e.touches[0]
        tap.current = { t: Date.now(), x: t.clientX, y: t.clientY, moved: false }
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinch.current) {
        e.preventDefault()
        const a = e.touches[0]
        const b = e.touches[1]
        const mid = localPoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2)
        zoomAroundRef.current(
          pinch.current.scale * (touchDist(a, b) / pinch.current.dist),
          mid.x,
          mid.y,
        )
        return
      }
      const start = tap.current
      if (start && e.touches.length === 1) {
        const t = e.touches[0]
        if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8) start.moved = true
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null
      if (e.touches.length !== 0) return
      const start = tap.current
      tap.current = null
      if (!start || start.moved || Date.now() - start.t > 280) return
      const prev = lastTap.current
      const now = Date.now()
      if (prev && now - prev.t < 280 && Math.hypot(start.x - prev.x, start.y - prev.y) < 40) {
        const p = localPoint(start.x, start.y)
        zoomAroundRef.current(scaleRef.current > 1 ? 1 : 2.5, p.x, p.y)
        lastTap.current = null
      } else {
        lastTap.current = { t: now, x: start.x, y: start.y }
      }
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

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') return
    const el = stageRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
    setGrabbing(true)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') return
    const d = drag.current
    const el = stageRef.current
    if (!d || !el) return
    el.scrollLeft = d.sl - (e.clientX - d.x)
    el.scrollTop = d.st - (e.clientY - d.y)
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    drag.current = null
    setGrabbing(false)
    if (e.pointerType === 'mouse' && e.detail === 2) {
      const rect = e.currentTarget.getBoundingClientRect()
      zoomAround(scaleRef.current > 1 ? 1 : 2, e.clientX - rect.left, e.clientY - rect.top)
    }
  }

  return (
    <div>
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setGrabbing(false) }}
        style={{
          height: maxHeight,
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          background: 'var(--surface-2)',
          cursor: grabbing ? 'grabbing' : 'grab',
          touchAction: 'pan-x pan-y',
          borderRadius: 10,
        }}
      >
        <div style={{ width: `${scale * 100}%` }}>
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
              WebkitUserSelect: 'none',
              pointerEvents: 'none',
            }}
          />
        </div>
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
        <button type="button" style={ZOOM_BTN} onClick={() => zoomCenter(scale - 0.5)} aria-label="Zoom out">−</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 40, textAlign: 'center' }}>
          {Math.round(scale * 100)}%
        </span>
        <button type="button" style={ZOOM_BTN} onClick={() => zoomCenter(scale + 0.5)} aria-label="Zoom in">+</button>
      </div>
    </div>
  )
}

function clampZoom(n: number) {
  return Math.min(4, Math.max(1, n))
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
      placeholder="Which address was this taken at?"
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
  /** Remaining gallery files after the first fills this slot (extras / facility). */
  onOverflow?: (photo: Photo, exif: PhotoExif) => void
  onSkip: () => void
  onClear: () => void
  hideSkip?: boolean
  note?: string
  onNoteChange?: (note: string) => void
  placeContext?: GalleryPlaceContext
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
  onOverflow,
  onSkip,
  onClear,
  hideSkip = false,
  note,
  onNoteChange,
  placeContext,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadIndex, setUploadIndex] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ file: File; exif: PhotoExif }[] | null>(null)
  const [place, setPlace] = useState<GalleryPlace>('site')
  const [when, setWhen] = useState<GalleryWhen>('skip')
  const [promptError, setPromptError] = useState('')
  const [needTime, setNeedTime] = useState(false)

  function resetPickers() {
    if (cameraRef.current) cameraRef.current.value = ''
    if (fileRef.current) fileRef.current.value = ''
  }

  async function uploadOne(file: File, exif: PhotoExif, overflow: boolean) {
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
      fd.append('location_label', exif.placeNote || formatCoordLabel(exif.lat, exif.lng))
    }
    const saveRes = await fetch('/api/photos/upload', { method: 'POST', body: fd })
    const saveJson = (await saveRes.json()) as { photo?: Photo; error?: string }
    if (!saveRes.ok || !saveJson.photo) throw new Error(saveJson.error || `Upload failed (${saveRes.status})`)
    if (overflow && onOverflow) onOverflow(saveJson.photo, exif)
    else onUploaded(saveJson.photo, exif)
  }

  async function uploadBatch(items: { file: File; exif: PhotoExif }[]) {
    setUploading(true)
    setError('')
    setUploadTotal(items.length)
    try {
      for (let i = 0; i < items.length; i++) {
        setUploadIndex(i + 1)
        await uploadOne(items[i].file, items[i].exif, i > 0)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      setUploadIndex(0)
      setUploadTotal(0)
      setPending(null)
      resetPickers()
    }
  }

  async function handleCameraFile(file: File) {
    setError('')
    const exif = stampTimeIfMissing(await readPhotoExif(file))
    if (placeContext) {
      setPending([{ file, exif }])
      setNeedTime(false)
      setPlace(placeContext.defaultPlace)
      setWhen('skip')
      setPromptError('')
      return
    }
    setUploading(true)
    setUploadTotal(1)
    setUploadIndex(1)
    try {
      await uploadOne(file, { ...exif, geoSource: 'skipped', lat: null, lng: null }, false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      setUploadIndex(0)
      setUploadTotal(0)
      resetPickers()
    }
  }

  async function handleGalleryFiles(files: File[]) {
    if (!files.length) return
    setError('')
    const items: { file: File; exif: PhotoExif }[] = []
    for (const file of files) {
      items.push({ file, exif: await readPhotoExif(file) })
    }
    const timeMissing = items.some(item => !photoHasTime(item.exif))
    if (placeContext) {
      setPending(items)
      setNeedTime(timeMissing)
      setPlace(placeContext.defaultPlace)
      setWhen('skip')
      setPromptError('')
      return
    }
    await uploadBatch(items.map(item => ({
      ...item,
      exif: { ...item.exif, lat: null, lng: null, geoSource: 'skipped' as const },
    })))
  }

  async function confirmGallery() {
    if (!pending || !placeContext) return
    setPromptError('')
    const items = pending.map(item => ({
      file: item.file,
      exif: applyGalleryChoice(item.exif, { place, when: needTime ? when : 'skip' }, {
        siteLat: placeContext.siteLat,
        siteLng: placeContext.siteLng,
        dumpLat: placeContext.dumpLat,
        dumpLng: placeContext.dumpLng,
        siteLabel: placeContext.siteLabel,
        dumpLabel: placeContext.dumpLabel,
      }),
    }))
    await uploadBatch(items)
  }

  function onCameraSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleCameraFile(file)
  }

  function onGallerySelect(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length) void handleGalleryFiles(files)
  }

  if (photoUrl) {
    return (
      <div>
        <div
          style={{
            position: 'relative',
            borderRadius: 10,
            overflow: 'visible',
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
        onChange={onCameraSelect}
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={fileRef}
        accept="image/*"
        multiple
        onChange={onGallerySelect}
        style={{ display: 'none' }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={uploading || Boolean(pending)}
          onClick={() => cameraRef.current?.click()}
          style={{ padding: '12px 8px', fontSize: 14, fontWeight: 700, borderRadius: 12 }}
        >
          {uploading ? (uploadTotal > 1 ? `Uploading ${uploadIndex}/${uploadTotal}…` : 'Uploading…') : cameraLabel}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={uploading || Boolean(pending)}
          onClick={() => fileRef.current?.click()}
          style={{ padding: '12px 8px', fontSize: 14, fontWeight: 700, borderRadius: 12, borderStyle: 'dashed' }}
        >
          {galleryLabel}
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: hideSkip ? 0 : 8 }}>
        You’ll be asked which address each photo belongs to.
      </div>
      {!hideSkip && (
      <button
        type="button"
        onClick={onSkip}
        disabled={uploading || Boolean(pending)}
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
      {pending && placeContext && (
        <GalleryPlaceSheet
          count={pending.length}
          ctx={placeContext}
          place={place}
          when={when}
          needTime={needTime}
          error={promptError}
          busy={uploading}
          onPlace={setPlace}
          onWhen={setWhen}
          onCancel={() => { setPending(null); setPromptError(''); resetPickers() }}
          onConfirm={() => void confirmGallery()}
        />
      )}
    </div>
  )
}

const SHEET_OPT: CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '12px 14px',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  background: 'var(--bg)',
  color: 'var(--text)',
}

function GalleryPlaceSheet({
  count,
  ctx,
  place,
  when,
  needTime,
  error,
  busy,
  onPlace,
  onWhen,
  onCancel,
  onConfirm,
}: {
  count: number
  ctx: GalleryPlaceContext
  place: GalleryPlace
  when: GalleryWhen
  needTime: boolean
  error: string
  busy: boolean
  onPlace: (v: GalleryPlace) => void
  onWhen: (v: GalleryWhen) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  function optStyle(selected: boolean): CSSProperties {
    return {
      ...SHEET_OPT,
      border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
    }
  }
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !busy) onCancel() }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: '20px 20px 0 0',
          padding: '24px 20px 36px',
          width: '100%',
          maxWidth: 480,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>
          {count === 1 ? 'Which address was this taken at?' : `Which address were these ${count} photos taken at?`}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
          Photos aren’t taken at the job addresses — pick whether this belongs to pickup or drop-off.
        </div>
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          <button type="button" style={optStyle(place === 'site')} onClick={() => onPlace('site')}>
            Pickup
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginTop: 2 }}>{ctx.siteLabel}</div>
          </button>
          <button type="button" style={optStyle(place === 'dump')} onClick={() => onPlace('dump')}>
            Drop-off
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginTop: 2 }}>{ctx.dumpLabel}</div>
          </button>
          <button type="button" style={optStyle(place === 'skip')} onClick={() => onPlace('skip')}>
            Skip — I’ll type it
          </button>
        </div>
        {needTime && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
              When were they taken?
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <button type="button" style={optStyle(when === 'now')} onClick={() => onWhen('now')}>
                Use the time I’m uploading
              </button>
              <button type="button" style={optStyle(when === 'skip')} onClick={() => onWhen('skip')}>
                I’ll type the date / time
              </button>
            </div>
          </div>
        )}
        {error && <div style={{ color: '#F87171', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onCancel}
            style={{ flex: 1, padding: 13, borderRadius: 10, fontWeight: 700 }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={onConfirm}
            style={{ flex: 1, padding: 13, borderRadius: 10, fontWeight: 700 }}
          >
            {busy ? 'Uploading…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
