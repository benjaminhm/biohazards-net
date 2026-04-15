/*
 * POST /api/photos/upload — multipart upload (job photo) via service role.
 *
 * Browser → signed Supabase URL PUT is brittle (multipart shape, CORS). This route
 * accepts the compressed image from the client and uploads with storage.upload().
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { insertPhotoRow } from '@/lib/photoRowInsert'

const PHOTO_CATEGORIES = ['before', 'during', 'after', 'assessment'] as const
const PHOTO_PHASES = ['assessment', 'progress'] as const

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const form = await req.formData()
    const jobId = String(form.get('job_id') ?? '').trim()
    const file = form.get('file')
    if (!jobId || !(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: 'Missing job_id or file' }, { status: 400 })
    }

    const caption = String(form.get('caption') ?? '')
    const area_ref = String(form.get('area_ref') ?? '')
    const categoryRaw = String(form.get('category') ?? 'assessment')
    const capturePhaseRaw = String(form.get('capture_phase') ?? 'assessment')

    const supabase = createServiceClient()

    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobErr) throw jobErr
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const name = file instanceof File && file.name ? file.name : 'upload.jpg'
    const ext = (name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'jpg'
    const path = `${jobId}/${Date.now()}.${ext}`

    const buf = Buffer.from(await file.arrayBuffer())
    const contentType =
      file instanceof File && file.type && file.type.startsWith('image/')
        ? file.type
        : 'image/jpeg'

    const { error: uploadError } = await supabase.storage.from('job-photos').upload(path, buf, {
      contentType,
      upsert: false,
    })
    if (uploadError) throw uploadError

    const publicUrl = supabase.storage.from('job-photos').getPublicUrl(path).data.publicUrl

    const nextCategory = (PHOTO_CATEGORIES as readonly string[]).includes(categoryRaw)
      ? categoryRaw
      : 'before'
    const nextPhase = (PHOTO_PHASES as readonly string[]).includes(capturePhaseRaw)
      ? capturePhaseRaw
      : nextCategory === 'during' || nextCategory === 'after'
        ? 'progress'
        : 'assessment'

    if (nextPhase === 'progress' && (nextCategory === 'before' || nextCategory === 'assessment')) {
      return NextResponse.json(
        { error: 'Progress capture only allows During/After categories' },
        { status: 400 },
      )
    }

    const ins = await insertPhotoRow(supabase, {
      job_id: jobId,
      file_url: publicUrl,
      caption,
      area_ref,
      category: nextCategory,
      capture_phase: nextPhase,
      org_id: orgId,
    })
    const { data: photo, error: insErr } = ins
    if (insErr) throw insErr
    return NextResponse.json({ photo }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
