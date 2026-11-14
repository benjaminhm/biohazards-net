/*
 * Disposal record photos for the bulk loader (photo.biohazards.net/bulk).
 *
 * GET  /api/photo/bulk/cdr?job_id=… — the job's disposal photos and its site pin.
 * POST /api/photo/bulk/cdr — { job_id, tags: [{ id, load, role }] } sorts them into loads.
 *
 * Only photos already marked for the disposal record are listed, so a PIN does
 * not open the rest of the job's photos.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { photoBulkPerson } from '@/lib/photoBulkSession'
import { CDR_PHOTO_COLUMNS, cdrJobInOrg, parseCdrTags, saveCdrTags } from '@/lib/cdrPhotoStore'

const SIGNED_OUT = { error: 'Signed out. Enter your PIN again.' }

export async function GET(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json(SIGNED_OUT, { status: 401 })

  const supabase = createServiceClient()
  const job = await cdrJobInOrg(supabase, new URL(req.url).searchParams.get('job_id') ?? '', person.org_id)
  if (!job) return NextResponse.json({ error: 'That job is not open.' }, { status: 404 })

  const { data, error } = await supabase
    .from('photos')
    .select(CDR_PHOTO_COLUMNS)
    .eq('job_id', job.id)
    .not('cdr_load', 'is', null)
    .order('taken_at', { ascending: true, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ photos: data ?? [], site: { site_address: job.site_address, site_lat: job.site_lat, site_lng: job.site_lng } })
}

export async function POST(req: Request) {
  const person = await photoBulkPerson(req)
  if (!person) return NextResponse.json(SIGNED_OUT, { status: 401 })

  const body = (await req.json().catch(() => null)) as { job_id?: unknown; tags?: unknown } | null
  const tags = parseCdrTags(body?.tags)
  if (!tags) return NextResponse.json({ error: 'No valid tags to save.' }, { status: 400 })

  const supabase = createServiceClient()
  const job = await cdrJobInOrg(supabase, String(body?.job_id ?? ''), person.org_id)
  if (!job) return NextResponse.json({ error: 'That job is not open.' }, { status: 404 })

  // A PIN sorts disposal photos. It cannot pull other job photos into the record.
  const { data: allowed } = await supabase
    .from('photos')
    .select('id')
    .eq('job_id', job.id)
    .not('cdr_load', 'is', null)
    .in('id', tags.map(t => t.id))
  const ok = new Set((allowed ?? []).map(p => p.id as string))
  const rows = tags.filter(t => ok.has(t.id))
  if (!rows.length) return NextResponse.json({ error: 'No disposal photos to sort.' }, { status: 400 })

  const result = await saveCdrTags(supabase, job.id, rows)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ photos: result.photos })
}
