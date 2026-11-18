/*
 * GET /api/jobs/[id]/scans — LiDAR scans on the job file.
 * Same people who can open the job (admin, owner, manager, team lead).
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { isScanUuid, JOB_SCANS_BUCKET } from '@/lib/spatialScan'

const SIGNED_SECONDS = 60 * 60

function fullJobFile(role: string | null | undefined) {
  return role === 'admin' || role === 'owner' || role === 'manager' || role === 'team_lead'
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  const { orgId } = await getOrgId(req, userId ?? null)
  if (!orgId || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isScanUuid(id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const supabase = createServiceClient()
  const { data: me, error: meError } = await supabase
    .from('org_users')
    .select('role')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (meError) return NextResponse.json({ error: meError.message }, { status: 500 })
  if (!fullJobFile(me?.role as string | null)) {
    return NextResponse.json({ error: 'Use the field job view for this account' }, { status: 403 })
  }

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { data: rows, error } = await supabase
    .from('job_spatial_scans')
    .select('id, person_name, person_code, started_at, duration_s, note, lat, lng, accuracy_m, mesh_path, video_path, timeline_path, created_at')
    .eq('job_id', id)
    .eq('org_id', orgId)
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const scans = await Promise.all(
    (rows ?? []).map(async row => {
      const [mesh, video, timeline] = await Promise.all([
        supabase.storage.from(JOB_SCANS_BUCKET).createSignedUrl(row.mesh_path as string, SIGNED_SECONDS),
        supabase.storage.from(JOB_SCANS_BUCKET).createSignedUrl(row.video_path as string, SIGNED_SECONDS),
        supabase.storage.from(JOB_SCANS_BUCKET).createSignedUrl(row.timeline_path as string, SIGNED_SECONDS),
      ])
      return {
        id: row.id as string,
        person_name: row.person_name as string,
        person_code: row.person_code as string,
        started_at: row.started_at as string,
        duration_s: row.duration_s as number | null,
        note: row.note as string,
        lat: row.lat as number | null,
        lng: row.lng as number | null,
        accuracy_m: row.accuracy_m as number | null,
        created_at: row.created_at as string,
        mesh_url: mesh.data?.signedUrl ?? null,
        video_url: video.data?.signedUrl ?? null,
        timeline_url: timeline.data?.signedUrl ?? null,
      }
    }),
  )

  return NextResponse.json({ scans })
}
