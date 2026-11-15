/*
 * app/api/photo/measure/[token]/route.ts — the phone side of a QR room measure
 * link (migration 081). The token is the only credential.
 *   GET  — which job the link measures for, until when, and the rooms already
 *          on its surface area cleaning quote
 *   POST — one room { id?, name, length_m, width_m, height_m }. With the id of a
 *          room on the quote it replaces that room's name and size; otherwise it
 *          adds a room. The quote's square metres follow.
 *
 * The link cannot remove a room, and it is never sent the rate, the price or
 * the wording of the quote.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { isUploadTokenShape, uploadLinkState, type UploadLinkRow } from '@/lib/photoUploadLink'
import { saveRoomMeasure, type MeasureJobStore } from '@/lib/roomMeasureSave'
import { normalizeSurfaceAreaCleaningCapture, parseRoomMeasure, roomMeasureView } from '@/lib/surfaceAreaCleaningQuote'
import type { AssessmentData } from '@/lib/types'

type Supabase = ReturnType<typeof createServiceClient>

const CLOSED: Record<'expired' | 'stopped', string> = {
  expired: 'This measure link has expired. Ask for a new QR code.',
  stopped: 'This measure link was stopped. Ask for a new QR code.',
}

interface JobRow {
  id: string
  job_code: string | null
  client_name: string | null
  site_address: string | null
  assessment_data: AssessmentData | null
  updated_at: string | null
}

async function readJob(supabase: Supabase, link: UploadLinkRow): Promise<JobRow | null> {
  const { data } = await supabase
    .from('jobs')
    .select('id, job_code, client_name, site_address, assessment_data, updated_at')
    .eq('id', link.job_id)
    .eq('org_id', link.org_id)
    .is('archived_at', null)
    .maybeSingle()
  return (data as JobRow | null) ?? null
}

async function resolve(supabase: Supabase, token: string) {
  if (!isUploadTokenShape(token)) return { error: NextResponse.json({ error: 'Link not found.' }, { status: 404 }) }
  const { data } = await supabase.from('room_measure_links').select('*').eq('token', token).maybeSingle()
  const link = data as UploadLinkRow | null
  if (!link) return { error: NextResponse.json({ error: 'Link not found.' }, { status: 404 }) }
  const state = uploadLinkState(link)
  if (state !== 'open') return { error: NextResponse.json({ error: CLOSED[state] }, { status: 410 }) }
  const job = await readJob(supabase, link)
  if (!job) return { error: NextResponse.json({ error: 'That job is not open.' }, { status: 404 }) }
  return { link, job }
}

function quoteOf(job: JobRow) {
  return normalizeSurfaceAreaCleaningCapture(job.assessment_data?.surface_area_cleaning_quote)
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await resolve(createServiceClient(), token)
  if ('error' in r) return r.error
  return NextResponse.json({
    job: { job_code: r.job.job_code, client_name: r.job.client_name, site_address: r.job.site_address },
    expires_at: r.link.expires_at,
    ...roomMeasureView(quoteOf(r.job)),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

/** The job behind the link, read fresh and written only where its updated_at has not moved. */
function jobStore(supabase: Supabase, link: UploadLinkRow): MeasureJobStore {
  return {
    read: () => readJob(supabase, link),
    async write(assessmentData, expected) {
      const update = supabase
        .from('jobs')
        .update({ assessment_data: assessmentData, updated_at: new Date().toISOString() })
        .eq('id', link.job_id)
        .eq('org_id', link.org_id)
      const { data, error } = await (expected ? update.eq('updated_at', expected) : update.is('updated_at', null)).select('id')
      if (error) throw error
      return Boolean(data?.length)
    },
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const r = await resolve(supabase, token)
  if ('error' in r) return r.error
  const measure = parseRoomMeasure(await req.json().catch(() => null))
  if (typeof measure === 'string') return NextResponse.json({ error: measure }, { status: 400 })
  try {
    const saved = await saveRoomMeasure(jobStore(supabase, r.link), measure)
    if ('error' in saved) return NextResponse.json({ error: saved.error }, { status: saved.status })
    return NextResponse.json({
      ok: true,
      room_id: saved.room.id,
      ...roomMeasureView(saved.capture),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[photo/measure]', e)
    return NextResponse.json({ error: 'The room could not be saved. Try again.' }, { status: 500 })
  }
}
