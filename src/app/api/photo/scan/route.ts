/*
 * POST /api/photo/scan — start a LiDAR scan upload for a job.
 *
 * The phone already holds the USDZ, the walkthrough MP4 and the timeline.
 * This route checks the photo PIN, files a pending row on the job, and
 * returns signed upload URLs. The bytes go straight to Storage so a long
 * scan is not limited by the function body size. POST /api/photo/scan/complete
 * marks the row ready once the three objects are there.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { resolveJobForCode, resolvePersonByPin } from '@/lib/photoPin'
import { JOB_SCANS_BUCKET, parseScanStart, scanObjectPaths } from '@/lib/spatialScan'

const UPLOADS = [
  ['mesh', 'model/vnd.usdz+zip'],
  ['video', 'video/mp4'],
  ['timeline', 'application/json'],
] as const

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const pin = typeof (body as { pin?: unknown } | null)?.pin === 'string' ? (body as { pin: string }).pin : ''
  const person = await resolvePersonByPin(pin)
  if (!person) return NextResponse.json({ error: 'Invalid 4-digit PIN.' }, { status: 401 })

  const parsed = parseScanStart(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const supabase = createServiceClient()
  const resolved = await resolveJobForCode(supabase, person.org_id, parsed.jobCode, parsed.jobId)
  if (!resolved.jobId) return NextResponse.json({ error: 'That job code is not an open job.' }, { status: 404 })

  const scanId = crypto.randomUUID()
  const paths = scanObjectPaths(person.org_id, resolved.jobId, scanId)

  const { error: insertError } = await supabase.from('job_spatial_scans').insert({
    id: scanId,
    org_id: person.org_id,
    job_id: resolved.jobId,
    person_id: person.person_id,
    person_name: person.name,
    person_code: person.person_code,
    mesh_path: paths.mesh,
    video_path: paths.video,
    timeline_path: paths.timeline,
    started_at: parsed.startedAt,
    duration_s: parsed.durationS,
    note: parsed.note,
    lat: parsed.lat,
    lng: parsed.lng,
    accuracy_m: parsed.accuracyM,
    status: 'pending',
  })
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  const uploads: Record<string, { path: string; signedUrl: string; token: string; contentType: string }> = {}
  for (const [key, contentType] of UPLOADS) {
    const path = paths[key]
    const { data, error } = await supabase.storage.from(JOB_SCANS_BUCKET).createSignedUploadUrl(path)
    if (error || !data?.signedUrl || !data.token) {
      await supabase.from('job_spatial_scans').delete().eq('id', scanId).eq('org_id', person.org_id)
      return NextResponse.json(
        { error: error?.message || 'Could not prepare the scan upload. Check the job-scans bucket.' },
        { status: 500 },
      )
    }
    uploads[key] = { path, signedUrl: data.signedUrl, token: data.token, contentType }
  }

  return NextResponse.json({
    scan_id: scanId,
    job_id: resolved.jobId,
    job_code: resolved.jobCode,
    uploads,
  })
}
