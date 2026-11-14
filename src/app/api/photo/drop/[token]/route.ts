/*
 * app/api/photo/drop/[token]/route.ts — the phone side of a QR upload link
 * (lib/photoUploadLink). The token is the only credential.
 *   GET  — which job the link adds to, and until when
 *   POST — one photo (multipart: file, optional taken_at, lat, lng), saved
 *          untagged to the job's folder and credited to whoever made the link
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { saveJobPhoneUpload } from '@/lib/jobPhotoSave'
import { isUploadTokenShape, uploadLinkState, type UploadLinkRow } from '@/lib/photoUploadLink'

type Supabase = ReturnType<typeof createServiceClient>

const CLOSED: Record<'expired' | 'stopped', string> = {
  expired: 'This upload link has expired. Ask for a new QR code.',
  stopped: 'This upload link was stopped. Ask for a new QR code.',
}

async function resolve(supabase: Supabase, token: string) {
  if (!isUploadTokenShape(token)) return { error: NextResponse.json({ error: 'Link not found.' }, { status: 404 }) }
  const { data } = await supabase.from('photo_upload_links').select('*').eq('token', token).maybeSingle()
  const link = data as UploadLinkRow | null
  if (!link) return { error: NextResponse.json({ error: 'Link not found.' }, { status: 404 }) }
  const state = uploadLinkState(link)
  if (state !== 'open') return { error: NextResponse.json({ error: CLOSED[state] }, { status: 410 }) }
  const { data: job } = await supabase
    .from('jobs')
    .select('id, job_code, client_name, site_address')
    .eq('id', link.job_id)
    .eq('org_id', link.org_id)
    .is('archived_at', null)
    .maybeSingle()
  if (!job) return { error: NextResponse.json({ error: 'That job is not open.' }, { status: 404 }) }
  return { link, job }
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await resolve(createServiceClient(), token)
  if ('error' in r) return r.error
  return NextResponse.json({
    job: { job_code: r.job.job_code, client_name: r.job.client_name, site_address: r.job.site_address },
    expires_at: r.link.expires_at,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const r = await resolve(supabase, token)
  if ('error' in r) return r.error
  const form = await req.formData()
  const result = await saveJobPhoneUpload(supabase, form, {
    jobId: r.link.job_id,
    orgId: r.link.org_id,
    personId: r.link.created_by_person_id,
    uploaderName: r.link.created_by_name,
    pathPrefix: 'drop',
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
