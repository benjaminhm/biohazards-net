import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { personShortCode } from '@/lib/phoneSignIn'
import { brisbaneStamp } from '@/lib/jobRecords'
import { insertPhotoRow } from '@/lib/photoRowInsert'

export interface PinPerson {
  person_id: string
  org_id: string
  name: string
  person_code: string
}

export interface PinJobOption {
  job_id: string | null
  job_code: string
  label: string
  address: string
}

export function jobShortCode(jobId: string): string {
  return jobId.replace(/-/g, '').slice(0, 4).toUpperCase()
}

export async function resolvePersonByPin(pin: string): Promise<PinPerson | null> {
  const cleaned = pin.trim()
  if (!/^\d{4}$/.test(cleaned)) return null
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('people')
    .select('id, org_id, name, status')
    .eq('photo_pin', cleaned)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  if (error || !data || !data.org_id) return null
  return {
    person_id: data.id as string,
    org_id: data.org_id as string,
    name: data.name as string,
    person_code: personShortCode(data.id as string),
  }
}

async function listActiveJobOptions(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
): Promise<PinJobOption[]> {
  const [{ data: deskJobs }, { data: recordJobs }] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, job_code, client_name, site_address, status, archived_at, created_at')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('record_jobs')
      .select('id, job_number, address, status, created_at')
      .eq('org_id', orgId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  const options: PinJobOption[] = []
  const seenCodes = new Set<string>()

  for (const j of deskJobs ?? []) {
    const id = j.id as string
    const code = (typeof j.job_code === 'string' && j.job_code.trim() ? j.job_code.trim() : jobShortCode(id)).toUpperCase()
    seenCodes.add(code)
    const address = String(j.site_address ?? '').trim()
    const client = String(j.client_name ?? '').trim()
    options.push({
      job_id: id,
      job_code: code,
      label: `${code} — ${address || client || 'Job'}`,
      address: address || client,
    })
  }

  for (const r of recordJobs ?? []) {
    const rawNum = String(r.job_number ?? '').trim().toUpperCase()
    const digits4 = rawNum.replace(/\D/g, '').padStart(4, '0').slice(-4)
    const code = digits4 || rawNum
    if (!code || seenCodes.has(code)) continue
    seenCodes.add(code)
    const address = String(r.address ?? '').trim()
    options.push({
      job_id: null,
      job_code: code,
      label: `${code} — ${address || rawNum}`,
      address,
    })
  }

  return options
}

async function resolveJobForCode(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
  rawJobCode: string,
  explicitJobId: string,
): Promise<{ jobId: string | null; jobCode: string; address: string }> {
  const cleanedCode = rawJobCode.trim().toUpperCase().slice(0, 32)
  if (explicitJobId) {
    const { data: found } = await supabase
      .from('jobs')
      .select('id, job_code, site_address')
      .eq('id', explicitJobId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (found?.id) {
      return {
        jobId: found.id as string,
        jobCode: (typeof found.job_code === 'string' && found.job_code.trim()) || cleanedCode || jobShortCode(found.id as string),
        address: String(found.site_address ?? '').trim(),
      }
    }
  }
  if (!cleanedCode) return { jobId: null, jobCode: '', address: '' }

  // 1. Direct match on jobs.job_code (4-digit dispatch code)
  const { data: directMatch } = await supabase
    .from('jobs')
    .select('id, job_code, site_address')
    .eq('org_id', orgId)
    .eq('job_code', cleanedCode)
    .is('archived_at', null)
    .limit(1)
    .maybeSingle()

  if (directMatch?.id) {
    return {
      jobId: directMatch.id as string,
      jobCode: (directMatch.job_code as string) || cleanedCode,
      address: String(directMatch.site_address ?? '').trim(),
    }
  }

  // 2. Fallback: match 4-char UUID prefix or document code suffix
  const stripped = cleanedCode.replace(/^(JOB|CCQ|SACQ|BCQ|CDR|SOA|RPT|QUO)-(\d{8}-)?/, '')
  const { data: deskJobs } = await supabase
    .from('jobs')
    .select('id, job_code, site_address')
    .eq('org_id', orgId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(100)

  const match = (deskJobs ?? []).find(row => {
    const code = jobShortCode(row.id as string)
    return code === cleanedCode || code === stripped
  })
  return {
    jobId: (match?.id as string | undefined) ?? null,
    jobCode: (match?.job_code as string | undefined) || cleanedCode,
    address: String(match?.site_address ?? '').trim(),
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const pin = url.searchParams.get('pin') ?? ''
  const person = await resolvePersonByPin(pin)
  if (!person) {
    return NextResponse.json({ error: 'Invalid 4-digit PIN.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const [{ data: rows }, jobs] = await Promise.all([
    supabase
      .from('standalone_photos')
      .select('id, storage_path, device_time, lat, lng, accuracy_m, stamp_text, note, job_code, job_id, created_at')
      .eq('org_id', person.org_id)
      .eq('person_id', person.person_id)
      .order('created_at', { ascending: false })
      .limit(24),
    listActiveJobOptions(supabase, person.org_id),
  ])

  const photos = await Promise.all(
    (rows ?? []).map(async row => {
      const { data: signed } = await supabase.storage
        .from('record-photos')
        .createSignedUrl(row.storage_path as string, 60 * 60)
      return {
        id: row.id as string,
        url: signed?.signedUrl ?? null,
        device_time: row.device_time as string,
        lat: row.lat as number | null,
        lng: row.lng as number | null,
        accuracy_m: row.accuracy_m as number | null,
        stamp_text: row.stamp_text as string,
        note: row.note as string,
        job_code: (row.job_code as string) || '',
        job_id: (row.job_id as string | null) ?? null,
        created_at: row.created_at as string,
      }
    }),
  )

  return NextResponse.json({ person, jobs, photos })
}

export async function POST(req: Request) {
  const form = await req.formData()
  const pin = String(form.get('pin') ?? '')
  const person = await resolvePersonByPin(pin)
  if (!person) {
    return NextResponse.json({ error: 'Invalid 4-digit PIN.' }, { status: 401 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing photo file.' }, { status: 400 })
  }

  const rawTime = String(form.get('device_time') ?? '')
  const parsedTime = rawTime ? new Date(rawTime) : new Date()
  const deviceTime = Number.isNaN(parsedTime.getTime()) ? new Date() : parsedTime

  const rawLat = form.get('lat')
  const rawLng = form.get('lng')
  const rawAcc = form.get('accuracy_m')
  const lat = rawLat != null && rawLat !== '' && Number.isFinite(Number(rawLat)) ? Number(rawLat) : null
  const lng = rawLng != null && rawLng !== '' && Number.isFinite(Number(rawLng)) ? Number(rawLng) : null
  const accuracy_m = rawAcc != null && rawAcc !== '' && Number.isFinite(Number(rawAcc)) ? Number(rawAcc) : null
  const note = String(form.get('note') ?? '').trim().slice(0, 240)
  const rawTag = String(form.get('photo_tag') ?? '').trim().toLowerCase()
  const rawJobCode = String(form.get('job_code') ?? '').trim()
  const rawJobId = String(form.get('job_id') ?? '').trim()

  const supabase = createServiceClient()
  const { jobId, jobCode } = await resolveJobForCode(supabase, person.org_id, rawJobCode, rawJobId)

  const tagCategory: 'before' | 'during' | 'after' | 'assessment' =
    rawTag === 'before'
      ? 'before'
      : rawTag === 'after'
        ? 'after'
        : rawTag === 'assessment'
          ? 'assessment'
          : 'during'
  const tagPhase: 'assessment' | 'progress' =
    tagCategory === 'before' || tagCategory === 'assessment' ? 'assessment' : 'progress'
  const tagAreaRef =
    rawTag === 'cdr_load'
      ? 'CDR Load'
      : rawTag === 'cdr_docket'
        ? 'CDR Docket'
        : rawTag === 'cdr_dropoff'
          ? 'CDR Drop-off'
          : ''

  const stampText =
    String(form.get('stamp_text') ?? '').trim() ||
    [
      brisbaneStamp(deviceTime),
      jobCode ? `JOB ${jobCode}` : null,
      `${person.name} (${person.person_code})`,
      lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'No GPS',
    ]
      .filter(Boolean)
      .join('  ·  ')

  const photoId = crypto.randomUUID()
  const ymd = deviceTime.toISOString().slice(0, 10)
  const storagePath = `${person.org_id}/standalone/${ymd}/${person.person_id}_${photoId}.jpg`
  const bytes = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabase.storage
    .from('record-photos')
    .upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: false })
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  // If the 4-digit job code resolved to an active desk job, also upload to `job-photos` and insert into `photos`
  // so it appears immediately inside that job's Photos tab, CDR picker, and reports.
  if (jobId) {
    const jobPhotoPath = `${jobId}/pin_${Date.now()}_${photoId.slice(0, 6)}.jpg`
    const { error: jobBucketErr } = await supabase.storage
      .from('job-photos')
      .upload(jobPhotoPath, bytes, { contentType: 'image/jpeg', upsert: false })
    if (!jobBucketErr) {
      const publicUrl = supabase.storage.from('job-photos').getPublicUrl(jobPhotoPath).data.publicUrl
      await insertPhotoRow(supabase, {
        job_id: jobId,
        org_id: person.org_id,
        file_url: publicUrl,
        caption: note || stampText,
        area_ref: tagAreaRef,
        category: tagCategory,
        capture_phase: tagPhase,
        uploaded_by_person_id: person.person_id,
        uploaded_by_name: `${person.name} (${person.person_code})`,
        taken_at: deviceTime.toISOString(),
        location_lat: lat,
        location_lng: lng,
        location_accuracy_m: accuracy_m,
      })
    }
  }

  const { error: insertError } = await supabase.from('standalone_photos').insert({
    id: photoId,
    org_id: person.org_id,
    person_id: person.person_id,
    person_name: person.name,
    person_code: person.person_code,
    storage_path: storagePath,
    device_time: deviceTime.toISOString(),
    lat,
    lng,
    accuracy_m,
    stamp_text: stampText,
    note,
    job_code: jobCode,
    job_id: jobId,
  })
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  const { data: signed } = await supabase.storage
    .from('record-photos')
    .createSignedUrl(storagePath, 60 * 60)

  return NextResponse.json({
    photo: {
      id: photoId,
      url: signed?.signedUrl ?? null,
      device_time: deviceTime.toISOString(),
      lat,
      lng,
      accuracy_m,
      stamp_text: stampText,
      note,
      job_code: jobCode,
      job_id: jobId,
    },
  })
}
