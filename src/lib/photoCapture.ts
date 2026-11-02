import { isLikelyCameraFile } from '@/lib/jobRecords'

export function readPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  })
}

export async function watermarkJpeg(file: File, lines: string[]): Promise<Blob> {
  if (!isLikelyCameraFile(file.lastModified)) {
    throw new Error('Use the camera. Photos from the library are not accepted.')
  }
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
  const font = Math.max(16, Math.round(width / 36))
  ctx.font = `700 ${font}px sans-serif`
  const text = lines.filter(Boolean).join('  ·  ')
  const pad = Math.round(font * 0.45)
  const metrics = ctx.measureText(text)
  const boxHeight = font + pad * 2
  const top = height - boxHeight - pad
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(pad, top, Math.min(width - pad * 2, metrics.width + pad * 2), boxHeight)
  ctx.fillStyle = '#fff'
  ctx.fillText(text, pad * 2, top + font + pad * 0.15)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72))
  if (!blob) throw new Error('Could not prepare that photo.')
  return blob
}
