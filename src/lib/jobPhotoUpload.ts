/*
 * Client upload into the job's photo bucket. Photos go in untagged; the
 * document that loaded them keeps their ids.
 */
import type { Photo, PhotoCapturePhase, PhotoCategory } from './types'
import { readPhotoExif } from './photoExif'
import { compressImage } from './compressImage'

/** Camera time from the original file; must run before compressImage, which strips it. */
async function takenAtIso(file: File): Promise<string | null> {
  const { takenAt } = await readPhotoExif(file)
  if (!takenAt) return null
  const t = new Date(takenAt)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

/** Uploads images as job photos in the order they were taken. Stops at the first failure; earlier uploads are kept. */
export async function uploadJobPhotos(
  jobId: string,
  files: File[],
  tags: { category: PhotoCategory; capture_phase: PhotoCapturePhase } = { category: 'untagged', capture_phase: 'assessment' },
): Promise<{ added: Photo[]; error?: string }> {
  const added: Photo[] = []
  try {
    const picked = await Promise.all(files.map(async (file, index) => ({ file, index, takenAt: await takenAtIso(file) })))
    picked.sort((a, b) => {
      if (a.takenAt && b.takenAt && a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? -1 : 1
      if (a.takenAt && !b.takenAt) return -1
      if (!a.takenAt && b.takenAt) return 1
      return a.index - b.index
    })
    for (const { file, takenAt } of picked) {
      const compressed = await compressImage(file)
      const body = new FormData()
      body.append('job_id', jobId)
      body.append('file', compressed, 'upload.jpg')
      body.append('caption', '')
      body.append('area_ref', '')
      body.append('category', tags.category)
      body.append('capture_phase', tags.capture_phase)
      if (takenAt) body.append('taken_at', takenAt)
      const res = await fetch('/api/photos/upload', { method: 'POST', body })
      const data = (await res.json()) as { photo?: Photo; error?: string }
      if (!res.ok || !data.photo) throw new Error(data.error || 'Upload failed')
      added.push(data.photo)
    }
    return { added }
  } catch (err) {
    return { added, error: err instanceof Error ? err.message : 'Upload failed' }
  }
}
