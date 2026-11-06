/*
 * Standalone photo capture helpers (photo.forensiccleaningqld.com.au / /photo).
 * - Prominent evidence stamp burned onto the JPEG (Date/Time · Operator ID · Job Code · GPS)
 * - Supports both live <video> viewfinder capture and native file input fallback
 * - IndexedDB offline queue so photos taken without signal upload automatically
 */

const DB_NAME = 'fcq-standalone-photo-queue'
const STORE = 'pending'

export interface QueuedStandalonePhoto {
  id: string
  pin: string
  jobCode: string
  jobId: string | null
  photoTag?: string
  blob: Blob
  deviceTime: string
  lat: number | null
  lng: number | null
  accuracyM: number | null
  stampText: string
  note: string
}

export interface GeoPointWithAccuracy {
  lat: number
  lng: number
  accuracy_m: number | null
}

export interface PhotoStampDetails {
  timeLine: string
  operatorLine: string
  gpsLine: string
  noteLine?: string
}

export function readPositionWithAccuracy(): Promise<GeoPointWithAccuracy | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy_m: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 },
    )
  })
}

export function formatBrisbaneFullStamp(date: Date): string {
  return (
    new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Brisbane',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date) + ' AEST'
  )
}

function drawEvidenceStampOnCanvas(ctx: CanvasRenderingContext2D, width: number, height: number, lines: string[]) {
  const cleanLines = lines.map(l => l.trim()).filter(Boolean)
  if (cleanLines.length === 0) return

  const font = Math.max(18, Math.round(width / 36))
  const lineHeight = Math.round(font * 1.38)
  const padX = Math.round(font * 0.85)
  const padY = Math.round(font * 0.7)
  const barHeight = cleanLines.length * lineHeight + padY * 2 + Math.round(font * 1.1)
  const top = Math.max(0, height - barHeight)

  // High-contrast evidence footer with orange top rule
  ctx.fillStyle = 'rgba(8, 13, 23, 0.86)'
  ctx.fillRect(0, top, width, barHeight)
  ctx.fillStyle = '#FF6B35'
  ctx.fillRect(0, top, width, Math.max(3, Math.round(font * 0.22)))

  // Header badge inside the stamp
  const headerFont = Math.max(12, Math.round(font * 0.72))
  ctx.font = `800 ${headerFont}px ui-monospace, SFMono-Regular, Menlo, monospace`
  ctx.fillStyle = '#FF6B35'
  ctx.fillText('VERIFIED FIELD EVIDENCE RECORD — LOGGED TO AUDIT TRAIL', padX, top + padY + headerFont)

  // Stamp data lines
  ctx.font = `700 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`
  ctx.fillStyle = '#FFFFFF'
  const startY = top + padY + headerFont + Math.round(font * 0.45) + font
  cleanLines.forEach((line, index) => {
    ctx.fillText(line, padX, startY + index * lineHeight)
  })
}

export async function stampPhotoJpeg(file: File | Blob, lines: string[]): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const maxWidth = 1600
  const scale = Math.min(1, maxWidth / bitmap.width)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not prepare that photo.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  drawEvidenceStampOnCanvas(ctx, width, height, lines)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84))
  if (!blob) throw new Error('Could not prepare that photo.')
  return blob
}

export async function stampVideoFrameJpeg(video: HTMLVideoElement, lines: string[]): Promise<Blob> {
  const rawW = video.videoWidth || 1280
  const rawH = video.videoHeight || 960
  const maxWidth = 1600
  const scale = Math.min(1, maxWidth / rawW)
  const width = Math.max(1, Math.round(rawW * scale))
  const height = Math.max(1, Math.round(rawH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not capture camera frame.')
  ctx.drawImage(video, 0, 0, width, height)

  drawEvidenceStampOnCanvas(ctx, width, height, lines)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84))
  if (!blob) throw new Error('Could not capture camera frame.')
  return blob
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = run(tx.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function queueStandalonePhoto(item: QueuedStandalonePhoto) {
  return withStore('readwrite', store => store.put(item))
}

export function listQueuedStandalonePhotos() {
  return withStore<QueuedStandalonePhoto[]>('readonly', store => store.getAll())
}

export function removeQueuedStandalonePhoto(id: string) {
  return withStore('readwrite', store => store.delete(id))
}

let flushing = false

export async function flushStandalonePhotoQueue(): Promise<number> {
  if (flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0
  flushing = true
  let uploaded = 0
  try {
    const rows = await listQueuedStandalonePhotos()
    for (const item of rows) {
      const form = new FormData()
      form.set('pin', item.pin)
      form.set('job_code', item.jobCode ?? '')
      if (item.jobId) form.set('job_id', item.jobId)
      if (item.photoTag) form.set('photo_tag', item.photoTag)
      form.set('file', item.blob, 'photo.jpg')
      form.set('device_time', item.deviceTime)
      form.set('stamp_text', item.stampText)
      form.set('note', item.note)
      if (item.lat != null) form.set('lat', String(item.lat))
      if (item.lng != null) form.set('lng', String(item.lng))
      if (item.accuracyM != null) form.set('accuracy_m', String(item.accuracyM))
      const res = await fetch('/api/photo', { method: 'POST', body: form })
      if (!res.ok) break
      await removeQueuedStandalonePhoto(item.id)
      uploaded += 1
    }
    return uploaded
  } finally {
    flushing = false
  }
}
