/*
 * POST /api/photo/bulk/cdr-read — read one disposal photo from the bulk
 * loader. Body: { job_id, photo_id }. Same read as the staff route; only photos
 * already marked for the disposal record can be read.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { photoBulkPerson } from '@/lib/photoBulkSession'
import { cdrJobInOrg, readAndStoreCdrPhoto } from '@/lib/cdrPhotoStore'

export const maxDuration = 60

export async function POST(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { job_id?: unknown; photo_id?: unknown } | null
  const supabase = createServiceClient()
  const job = await cdrJobInOrg(supabase, String(body?.job_id ?? ''), person.org_id)
  if (!job) return NextResponse.json({ error: 'That job is not open.' }, { status: 404 })

  const photoId = String(body?.photo_id ?? '')
  const { data: marked } = await supabase
    .from('photos')
    .select('id')
    .eq('id', photoId)
    .eq('job_id', job.id)
    .not('cdr_load', 'is', null)
    .maybeSingle()
  if (!marked) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })

  const result = await readAndStoreCdrPhoto(supabase, job.id, photoId)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ photo: result.photo })
}
