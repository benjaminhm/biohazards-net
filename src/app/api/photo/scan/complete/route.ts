/*
 * POST /api/photo/scan/complete — the three scan files are in Storage.
 * The photo PIN has to be the person who started the scan.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { resolvePersonByPin } from '@/lib/photoPin'
import { isScanUuid, JOB_SCANS_BUCKET } from '@/lib/spatialScan'

async function objectIsThere(
  supabase: ReturnType<typeof createServiceClient>,
  path: string,
): Promise<boolean> {
  const slash = path.lastIndexOf('/')
  const folder = slash >= 0 ? path.slice(0, slash) : ''
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const { data, error } = await supabase.storage.from(JOB_SCANS_BUCKET).list(folder, { search: name, limit: 20 })
  if (error) throw new Error(error.message)
  return (data ?? []).some(file => file.name === name)
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { pin?: unknown; scan_id?: unknown } | null
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  const person = await resolvePersonByPin(pin)
  if (!person) return NextResponse.json({ error: 'Invalid 4-digit PIN.' }, { status: 401 })
  if (!isScanUuid(body?.scan_id)) return NextResponse.json({ error: 'Missing scan.' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: scan, error } = await supabase
    .from('job_spatial_scans')
    .select('id, status, mesh_path, video_path, timeline_path, person_id, org_id')
    .eq('id', body.scan_id)
    .eq('org_id', person.org_id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!scan || scan.person_id !== person.person_id) {
    return NextResponse.json({ error: 'That scan is not on your PIN.' }, { status: 404 })
  }
  if (scan.status === 'ready') return NextResponse.json({ scan_id: scan.id, status: 'ready' })

  try {
    const mesh = await objectIsThere(supabase, scan.mesh_path as string)
    const video = await objectIsThere(supabase, scan.video_path as string)
    const timeline = await objectIsThere(supabase, scan.timeline_path as string)
    if (!mesh || !video || !timeline) {
      const missing = [mesh ? null : 'mesh', video ? null : 'video', timeline ? null : 'timeline'].filter(Boolean)
      return NextResponse.json({ error: `Still waiting for ${missing.join(', ')}.` }, { status: 409 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not check the scan files.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const { error: updateError } = await supabase
    .from('job_spatial_scans')
    .update({ status: 'ready' })
    .eq('id', scan.id)
    .eq('org_id', person.org_id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ scan_id: scan.id, status: 'ready' })
}
