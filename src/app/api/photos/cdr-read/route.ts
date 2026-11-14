/*
 * POST /api/photos/cdr-read — read one disposal photo (what it shows, and a
 * docket's weight and fee). Body: { job_id, photo_id }. The read is kept on the
 * photo, so a photo is read once. Staff confirm every value on the record.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { getOrgId } from '@/lib/org'
import { createServiceClient } from '@/lib/supabase'
import { cdrJobInOrg, readAndStoreCdrPhoto } from '@/lib/cdrPhotoStore'

export const maxDuration = 60

export async function POST(req: Request) {
  const { userId } = await auth()
  const { orgId } = await getOrgId(req, userId ?? null)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { job_id?: unknown; photo_id?: unknown } | null
  const supabase = createServiceClient()
  const job = await cdrJobInOrg(supabase, String(body?.job_id ?? ''), orgId)
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 })

  const result = await readAndStoreCdrPhoto(supabase, job.id, String(body?.photo_id ?? ''))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ photo: result.photo })
}
