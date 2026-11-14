/*
 * POST /api/photos/cdr-tags — sort a job's photos into disposal record loads.
 * Body: { job_id, tags: [{ id, load, role }] }. load null takes a photo out of
 * the record; role is load | dropoff | docket.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'
import { cdrJobInOrg, parseCdrTags, saveCdrTags } from '@/lib/cdrPhotoStore'

export async function POST(req: Request) {
  const { userId } = await auth()
  const { orgId } = await getOrgId(req, userId ?? null)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { job_id?: unknown; tags?: unknown } | null
  const tags = parseCdrTags(body?.tags)
  if (!tags) return NextResponse.json({ error: 'No valid tags to save.' }, { status: 400 })

  const supabase = createServiceClient()
  const job = await cdrJobInOrg(supabase, String(body?.job_id ?? ''), orgId)
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 })

  const result = await saveCdrTags(supabase, job.id, tags)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ photos: result.photos })
}
