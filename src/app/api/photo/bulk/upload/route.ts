/*
 * POST /api/photo/bulk/upload — one photo from the bulk loader, saved as an
 * ordinary job photo credited to the signed-in person.
 *
 * Multipart fields: file (JPEG, compressed in the browser), job_id, category
 * (untagged | before | during | after | assessment), optional taken_at, lat, lng.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { insertPhotoRow } from '@/lib/photoRowInsert'
import { photoBulkPerson } from '@/lib/photoBulkSession'

const CATEGORIES = ['untagged', 'before', 'during', 'after', 'assessment'] as const
type Category = (typeof CATEGORIES)[number]
const MAX_BYTES = 4 * 1024 * 1024

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

export async function POST(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing photo file.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Photo is too large.' }, { status: 413 })

  const jobId = String(form.get('job_id') ?? '').trim()
  const rawCategory = String(form.get('category') ?? '').trim()
  const category: Category = (CATEGORIES as readonly string[]).includes(rawCategory) ? (rawCategory as Category) : 'untagged'

  const supabase = createServiceClient()
  const { data: job } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', person.org_id)
    .is('archived_at', null)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: 'That job is not open.' }, { status: 404 })

  const path = `${jobId}/bulk_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.jpg`
  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage
    .from('job-photos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false })
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const fileUrl = supabase.storage.from('job-photos').getPublicUrl(path).data.publicUrl
  const lat = optionalNumber(form.get('lat'))
  const lng = optionalNumber(form.get('lng'))
  const { data: photo, error } = await insertPhotoRow(supabase, {
    job_id: jobId,
    org_id: person.org_id,
    file_url: fileUrl,
    caption: '',
    area_ref: '',
    category,
    capture_phase: category === 'during' || category === 'after' ? 'progress' : 'assessment',
    uploaded_by_person_id: person.person_id,
    uploaded_by_name: `${person.name} (${person.person_code})`,
    taken_at: optionalIso(form.get('taken_at')),
    location_lat: lat != null && lng != null ? lat : null,
    location_lng: lat != null && lng != null ? lng : null,
  })
  if (error || !photo) {
    await supabase.storage.from('job-photos').remove([path])
    return NextResponse.json({ error: error?.message ?? 'Could not save photo.' }, { status: 500 })
  }

  return NextResponse.json({ photo: { id: photo.id as string } })
}
