/*
 * app/api/photos/[id]/route.ts
 *
 * DELETE /api/photos/[id] — delete photo from both Storage and the DB.
 *   Storage path is taken from the public URL (/object/public/{bucket}/…).
 *
 * PATCH /api/photos/[id] — update photo metadata (caption, area_ref, category, include_in_composed_reports)
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import { shouldRetryPhotoInsertWithoutCapturePhase } from '@/lib/photoRowInsert'
import { inferCapturePhaseFromCategory } from '@/lib/photoCapturePhase'

const PHOTO_CATEGORIES = ['before', 'during', 'after', 'assessment'] as const

/** Loose UUID check — avoids bad dynamic segment values (e.g. literal "undefined"). */
function normalizePhotoId(raw: string | undefined): string | null {
  if (raw == null || typeof raw !== 'string') return null
  const id = decodeURIComponent(raw.trim())
  if (!id || id === 'undefined') return null
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return re.test(id) ? id : null
}

async function assertPhotoInOrg(
  supabase: ReturnType<typeof createServiceClient>,
  photoId: string,
  orgId: string,
): Promise<{ ok: true; capture_phase: string; category: string } | { ok: false; status: number; error: string }> {
  let photoRes = await supabase
    .from('photos')
    .select('id, capture_phase, category, job_id')
    .eq('id', photoId)
    .maybeSingle()

  if (photoRes.error && shouldRetryPhotoInsertWithoutCapturePhase(photoRes.error)) {
    photoRes = await supabase.from('photos').select('id, category, job_id').eq('id', photoId).maybeSingle()
  }

  const { data: photoRow, error: photoErr } = photoRes
  if (photoErr) {
    return { ok: false, status: 500, error: photoErr.message || 'Photo lookup failed' }
  }
  if (!photoRow) {
    return { ok: false, status: 404, error: 'Photo not found' }
  }

  const photo = photoRow as {
    id: string
    category: string
    job_id: string
    capture_phase?: string
  }
  const capture_phase =
    photo.capture_phase != null && photo.capture_phase !== ''
      ? photo.capture_phase
      : inferCapturePhaseFromCategory(photo.category)

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', photo.job_id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (jobErr) {
    return { ok: false, status: 500, error: jobErr.message || 'Job lookup failed' }
  }
  if (!job) {
    return { ok: false, status: 404, error: 'Photo not found' }
  }

  return { ok: true, capture_phase, category: photo.category }
}

/** PostgREST: unknown column include_in_composed_reports before migration 033 / cache. */
function shouldRetryPhotoUpdateWithoutIncludeColumn(e: { code?: string; message?: string }): boolean {
  const msg = (e.message ?? '').toLowerCase()
  return (
    e.code === 'PGRST204' ||
    msg.includes('include_in_composed_reports') ||
    (msg.includes('schema cache') && msg.includes('column'))
  )
}

function storageRemovePathFromPublicUrl(fileUrl: string): { bucket: string; path: string } | null {
  try {
    const url = new URL(fileUrl)
    const m = url.pathname.match(/\/object\/public\/([^/]+)\/(.+)/)
    if (!m) return null
    return { bucket: m[1], path: m[2] }
  } catch {
    return null
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const id = normalizePhotoId((await params).id)
    if (!id) {
      return NextResponse.json({ error: 'Invalid photo id' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const gate = await assertPhotoInOrg(supabase, id, orgId)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }

    const { data: photo, error: fetchErr } = await supabase
      .from('photos')
      .select('file_url')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) throw fetchErr

    if (photo?.file_url) {
      const loc = storageRemovePathFromPublicUrl(photo.file_url)
      if (loc) {
        await supabase.storage.from(loc.bucket).remove([loc.path])
      }
    }

    const { error } = await supabase.from('photos').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    const { orgId } = await getOrgId(req, userId ?? null)
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const id = normalizePhotoId((await params).id)
    if (!id) {
      return NextResponse.json({ error: 'Invalid photo id' }, { status: 400 })
    }

    const body = (await req.json()) as Record<string, unknown>
    const supabase = createServiceClient()

    const gate = await assertPhotoInOrg(supabase, id, orgId)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }
    const existing = { capture_phase: gate.capture_phase, category: gate.category }

    const patch: Record<string, string | boolean> = {}
    if (typeof body.caption === 'string') patch.caption = body.caption
    if (typeof body.area_ref === 'string') patch.area_ref = body.area_ref
    if (typeof body.include_in_composed_reports === 'boolean') {
      patch.include_in_composed_reports = body.include_in_composed_reports
    }
    if (typeof body.category === 'string' && (PHOTO_CATEGORIES as readonly string[]).includes(body.category)) {
      if (existing.capture_phase === 'progress' && (body.category === 'before' || body.category === 'assessment')) {
        return NextResponse.json(
          { error: 'Progress photos can only be During or After' },
          { status: 400 },
        )
      }
      patch.category = body.category
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    let upd = await supabase.from('photos').update(patch).eq('id', id).select().single()

    if (upd.error && shouldRetryPhotoUpdateWithoutIncludeColumn(upd.error)) {
      const { include_in_composed_reports: _i, ...rest } = patch
      if (Object.keys(rest).length > 0) {
        upd = await supabase.from('photos').update(rest).eq('id', id).select().single()
      } else {
        return NextResponse.json(
          {
            error:
              'include_in_composed_reports is not available on the server yet. Run the latest Supabase migration (033) or reload the API schema cache.',
          },
          { status: 503 },
        )
      }
    }

    if (upd.error) throw upd.error
    return NextResponse.json({ photo: upd.data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
