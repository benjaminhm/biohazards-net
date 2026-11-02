import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  const { data: rows, error } = await supabase
    .from('standalone_photos')
    .select('id, person_id, person_name, person_code, job_code, job_id, storage_path, device_time, server_time, lat, lng, accuracy_m, stamp_text, note, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const photos = await Promise.all(
    (rows ?? []).map(async row => {
      const { data: signed } = await supabase.storage
        .from('record-photos')
        .createSignedUrl(row.storage_path as string, 60 * 60)
      return {
        ...row,
        url: signed?.signedUrl ?? null,
      }
    }),
  )

  return NextResponse.json({ photos })
}
