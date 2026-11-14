/*
 * POST /api/photo/bulk/upload — one photo from the bulk loader, saved as an
 * ordinary job photo credited to the signed-in person.
 *
 * Multipart fields: file (JPEG, compressed in the browser), job_id, category
 * (untagged | before | during | after | assessment), optional caption, taken_at, lat, lng,
 * and cdr=1 to mark the photo for the Contents Disposal Record.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { PHONE_PHOTO_CATEGORIES, saveJobPhoneUpload, type PhonePhotoCategory } from '@/lib/jobPhotoSave'
import { photoBulkPerson } from '@/lib/photoBulkSession'

export async function POST(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })

  const form = await req.formData()
  const jobId = String(form.get('job_id') ?? '').trim()
  const rawCategory = String(form.get('category') ?? '').trim()
  const category: PhonePhotoCategory = (PHONE_PHOTO_CATEGORIES as readonly string[]).includes(rawCategory)
    ? (rawCategory as PhonePhotoCategory)
    : 'untagged'

  const supabase = createServiceClient()
  const { data: job } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', person.org_id)
    .is('archived_at', null)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: 'That job is not open.' }, { status: 404 })

  const result = await saveJobPhoneUpload(supabase, form, {
    jobId,
    orgId: person.org_id,
    personId: person.person_id,
    uploaderName: `${person.name} (${person.person_code})`,
    category,
    cdr: form.get('cdr') === '1',
    pathPrefix: 'bulk',
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ photo: result.photo })
}
