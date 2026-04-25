/*
 * app/api/field/jobs/[id]/photos/route.ts
 *
 * Field-safe photo upload helpers. Members must be assigned to the job before
 * they can create signed upload URLs or record metadata-rich evidence rows.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { insertPhotoRow } from '@/lib/photoRowInsert'
import { type OrgUserAccessRow, resolveFieldAccess } from '@/lib/fieldJobs'

const PHOTO_CATEGORIES = ['before', 'during', 'after', 'assessment'] as const
const PHOTO_PHASES = ['assessment', 'progress'] as const

interface FieldPhotoBody {
  action?: string
  fileName?: string
  contentType?: string
  file_url?: string
  caption?: string
  area_ref?: string
  category?: string
  capture_phase?: string
  taken_at?: string
  location_lat?: number | null
  location_lng?: number | null
  location_accuracy_m?: number | null
  location_label?: string | null
  location_place_id?: string | null
}

interface PersonNameRow {
  name: string | null
}

function safeExt(fileName: string, contentType?: string) {
  const fromName = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (fromName) return fromName.slice(0, 8)
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  return 'jpg'
}

function validNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

async function resolveAccess(req: Request, userId: string, jobId: string) {
  const { orgId } = await getOrgId(req, userId)
  if (!orgId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const supabase = createServiceClient()
  const { data: orgUser, error: orgUserError } = await supabase
    .from('org_users')
    .select('role, person_id, capabilities')
    .eq('clerk_user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (orgUserError) throw orgUserError

  const access = resolveFieldAccess(orgUser as OrgUserAccessRow | null)
  if (!access) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  let isAssigned = false
  if (access.personId) {
    const { data: assignment, error: assignmentError } = await supabase
      .from('job_assignments')
      .select('id')
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .eq('person_id', access.personId)
      .maybeSingle()

    if (assignmentError) throw assignmentError
    isAssigned = !!assignment
  }

  if (!access.canViewAllJobs && !isAssigned) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .is('archived_at', null)
    .maybeSingle()

  if (jobError) throw jobError
  if (!job) return { error: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }

  return { supabase, orgId, access }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await params
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as FieldPhotoBody
    const resolved = await resolveAccess(req, userId, jobId)
    if ('error' in resolved) return resolved.error

    const { supabase, orgId, access } = resolved

    if (body.action === 'sign') {
      if (!body.fileName) return NextResponse.json({ error: 'fileName required' }, { status: 400 })
      if (body.contentType && !body.contentType.startsWith('image/')) {
        return NextResponse.json({ error: 'Only image uploads are supported' }, { status: 400 })
      }

      const ext = safeExt(body.fileName, body.contentType)
      const path = `${orgId}/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { data, error } = await supabase.storage.from('job-photos').createSignedUploadUrl(path)
      if (error) throw error

      const publicUrl = supabase.storage.from('job-photos').getPublicUrl(path).data.publicUrl
      return NextResponse.json({ signedUrl: data.signedUrl, path, publicUrl })
    }

    if (!body.file_url) return NextResponse.json({ error: 'file_url required' }, { status: 400 })

    const nextCategory = (typeof body.category === 'string' && (PHOTO_CATEGORIES as readonly string[]).includes(body.category))
      ? body.category
      : 'during'
    const nextPhase = (typeof body.capture_phase === 'string' && (PHOTO_PHASES as readonly string[]).includes(body.capture_phase))
      ? body.capture_phase
      : 'progress'

    if (nextPhase === 'progress' && (nextCategory === 'before' || nextCategory === 'assessment')) {
      return NextResponse.json(
        { error: 'Progress capture only allows During/After categories' },
        { status: 400 }
      )
    }

    const { data: person } = access.personId
      ? await supabase.from('people').select('name').eq('id', access.personId).eq('org_id', orgId).maybeSingle()
      : { data: null }
    const uploadedByName = ((person as PersonNameRow | null)?.name ?? '').trim() || 'Team member'

    const { data, error } = await insertPhotoRow(supabase, {
      job_id: jobId,
      file_url: body.file_url,
      caption: body.caption ?? '',
      area_ref: body.area_ref ?? '',
      category: nextCategory,
      capture_phase: nextPhase,
      org_id: orgId,
      uploaded_by_user_id: userId,
      uploaded_by_person_id: access.personId,
      uploaded_by_name: uploadedByName,
      taken_at: body.taken_at ?? new Date().toISOString(),
      location_lat: validNumber(body.location_lat) ? body.location_lat : null,
      location_lng: validNumber(body.location_lng) ? body.location_lng : null,
      location_accuracy_m: validNumber(body.location_accuracy_m) ? body.location_accuracy_m : null,
      location_label: typeof body.location_label === 'string' && body.location_label.trim()
        ? body.location_label.trim()
        : null,
      location_place_id: typeof body.location_place_id === 'string' && body.location_place_id.trim()
        ? body.location_place_id.trim()
        : null,
      include_in_composed_reports: true,
    })

    if (error) throw error
    return NextResponse.json({ photo: data }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
