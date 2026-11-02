/**
 * POST /api/jobs/[id]/letterhead-image
 *
 * Uploads one image for a Company Letterhead. The file is stored on the job
 * but is not a job photo, so it does not appear in Photos or other documents.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: jobId } = await params
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: 'Choose an image to attach.' }, { status: 400 })
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image is too large (max 8 MB).' }, { status: 400 })
    }
    const mime = file instanceof File ? file.type : ''
    if (mime && !mime.startsWith('image/')) {
      return NextResponse.json({ error: 'Attach an image file.' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (jobErr) throw jobErr
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const buf = Buffer.from(await file.arrayBuffer())
    const path = `${jobId}/letterhead/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const { error: uploadError } = await supabase.storage.from('job-photos').upload(path, buf, {
      contentType: mime.startsWith('image/') ? mime : 'image/jpeg',
      upsert: false,
    })
    if (uploadError) throw uploadError

    const publicUrl = supabase.storage.from('job-photos').getPublicUrl(path).data.publicUrl
    return NextResponse.json({ url: publicUrl }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Could not upload image'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
