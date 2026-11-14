/*
 * lib/jobPhotoSave.ts
 *
 * Save one browser-compressed JPEG from a phone upload as an ordinary job
 * photo: store it, then add the photo row. Shared by the PIN bulk loader and
 * the QR upload link. The caller has already checked who may add to the job.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { insertPhotoRow } from '@/lib/photoRowInsert'

export const PHONE_PHOTO_MAX_BYTES = 4 * 1024 * 1024
const MAX_CAPTION = 2000

export const PHONE_PHOTO_CATEGORIES = ['untagged', 'before', 'during', 'after', 'assessment'] as const
export type PhonePhotoCategory = (typeof PHONE_PHOTO_CATEGORIES)[number]

function optionalNumber(v: FormDataEntryValue | null): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function optionalIso(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export interface PhonePhotoSaved {
  id: string
  file_url: string
  caption: string
  taken_at: string | null
  uploaded_at: string
}

/**
 * Form fields: file, optional caption, taken_at, lat, lng. Returns the saved
 * photo, or an error with the HTTP status to answer with.
 */
export async function saveJobPhoneUpload(
  supabase: SupabaseClient,
  form: FormData,
  opts: {
    jobId: string
    orgId: string
    personId: string | null
    uploaderName: string
    category?: PhonePhotoCategory
    /** Mark as a disposal photo waiting to be sorted into a load. */
    cdr?: boolean
    pathPrefix: string
  },
): Promise<{ photo: PhonePhotoSaved } | { error: string; status: number }> {
  const file = form.get('file')
  if (!(file instanceof File)) return { error: 'Missing photo file.', status: 400 }
  if (file.size > PHONE_PHOTO_MAX_BYTES) return { error: 'Photo is too large.', status: 413 }

  const category = opts.category ?? 'untagged'
  const path = `${opts.jobId}/${opts.pathPrefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.jpg`
  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage
    .from('job-photos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false })
  if (uploadError) return { error: uploadError.message, status: 500 }

  const fileUrl = supabase.storage.from('job-photos').getPublicUrl(path).data.publicUrl
  const lat = optionalNumber(form.get('lat'))
  const lng = optionalNumber(form.get('lng'))
  const { data: photo, error } = await insertPhotoRow(supabase, {
    job_id: opts.jobId,
    org_id: opts.orgId,
    file_url: fileUrl,
    caption: String(form.get('caption') ?? '').trim().slice(0, MAX_CAPTION),
    area_ref: '',
    category,
    capture_phase: category === 'during' || category === 'after' ? 'progress' : 'assessment',
    uploaded_by_person_id: opts.personId,
    uploaded_by_name: opts.uploaderName,
    taken_at: optionalIso(form.get('taken_at')),
    location_lat: lat != null && lng != null ? lat : null,
    location_lng: lat != null && lng != null ? lng : null,
    ...(opts.cdr ? { cdr_load: 0 } : {}),
  })
  if (error || !photo) {
    await supabase.storage.from('job-photos').remove([path])
    return { error: error?.message ?? 'Could not save photo.', status: 500 }
  }
  return {
    photo: {
      id: photo.id as string,
      file_url: photo.file_url as string,
      caption: (photo.caption as string | null) ?? '',
      taken_at: (photo.taken_at as string | null) ?? null,
      uploaded_at: photo.uploaded_at as string,
    },
  }
}
